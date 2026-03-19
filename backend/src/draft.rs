use axum::http::StatusCode;
use chrono::Utc;
use petname::petname;
use rand::seq::SliceRandom;
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use std::{collections::HashMap, sync::Arc};
use strum::Display;
use tokio::{
    sync::{broadcast, mpsc, oneshot},
    time::{Duration, Instant},
};
use uuid::Uuid;

use crate::{
    AppError,
    auction::{self, Auction, AuctionResponse},
    db_writer::DbWriter,
    messages::{ClientBidRequest, ServerMessage},
    pokemon::{self, Pokemon, PokemonStage},
    users::User,
};

#[derive(Debug)]
pub struct Draft {
    pub draft_id: Uuid,
    pub draft_name: String,
    pub host: User,
    pub broadcast_rx: broadcast::Receiver<ServerMessage>,
    pub pokemon: Vec<Arc<Pokemon>>,
    actor_sender: mpsc::Sender<DraftCommand>
}

#[derive(Clone, Debug, Serialize)]
pub struct DraftResponse {
    draft_id: String,
    draft_name: String,
    has_password: bool,
    total_auctions: u32,
    host: String,
    ranked: bool,
    total_teams: u32,
    teams: Vec<Team>,
    draft_state: DraftState,
    current_auction: usize,
    completed_auctions: Vec<AuctionResponse>,
    current_server_time: chrono::DateTime<Utc>,
}

#[derive(Clone, Debug, Serialize)]
pub struct DraftLobbyResponse {
    draft_id: Uuid,
    draft_name: String,
    has_password: bool,
    ranked: bool,
    teams_joined: u32,
    total_teams: u32,
    total_auctions: u32,
    draft_state: DraftState,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, Display)]
pub enum DraftState {
    PENDING,
    BIDDING,
    COMPLETED,
}

impl Default for DraftState {
    fn default() -> DraftState {
        DraftState::PENDING
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ExcludedPokemon {
    pub pokedex_id: u32,
    pub form: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct DraftSettings {
    pub num_teams: u32,
    pub starting_money: u32,
    #[serde(default)]
    pub draft_name: String,
    #[serde(default)]
    pub ranked: bool,
    #[serde(default)]
    pub password: Option<String>,
    pub excluded_pokemon: Vec<ExcludedPokemon>,
    pub num_auctions: u32,
    pub auction_length: Duration,
}

#[derive(Clone, Debug, Serialize)]
struct Team {
    pub user_id: String,
    pub username: String,
    pub ready: bool,
    budget_remaining: u32,
    pub auctions_won: Vec<Arc<Pokemon>>,
}

impl Draft {
    fn new(draft_id: Uuid, draft_name: String, host: User, pokemon: Vec<Arc<Pokemon>>, actor_sender: mpsc::Sender<DraftCommand>, broadcast_rx: broadcast::Receiver<ServerMessage>) -> Draft {
        Draft {
            draft_id,
            draft_name,
            host,
            pokemon,
            broadcast_rx,
            actor_sender
        }
    }

    pub async fn build(
        host: User,
        settings: DraftSettings,
        pool: PgPool,
    ) -> Result<Arc<Draft>, AppError> {
        let draft_id = uuid::Uuid::now_v7();
        let draft_name = if settings.draft_name.trim().is_empty() {
            let Some(name) = petname(2, "-") else {
                return Err((
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("failed to generate random draft name"),
                ));
            };
            name
        } else {
            settings.draft_name.trim().to_string()
        };
        let Some(mut pokemon) = pokemon::get_pokemon_data(&settings.excluded_pokemon) else {
            return Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("error getting pokemon data"),
            ));
        };
        // always randomize order
        pokemon.shuffle(&mut rand::rng());
        let db_writer = DbWriter::new(pool.clone(), draft_id, settings.starting_money);

        let auction_ids = db_writer
            .create_draft(host.clone(), settings.clone(), pokemon.clone())
            .await?;
        if !settings.ranked {
            db_writer.join_draft(host.clone()).await?;
        }
        let mut auctions = Vec::new();

        for (i, id) in auction_ids.into_iter().enumerate() {
            let auction = Auction::new(draft_id, id, pokemon[i].clone());
            auctions.push(auction);
        }
        let (actor_sender, actor_receiver) = mpsc::channel(1_000);
        let (broadcast_tx, broadcast_rx) = broadcast::channel(1_000);
        let draft = Arc::new(Draft::new(draft_id, draft_name, host.clone(), pokemon, actor_sender, broadcast_rx));
        let actor_draft = draft.clone();

        tokio::spawn(async move {
            let actor = DraftActor::new(actor_draft, host, settings, auctions, db_writer, actor_receiver, broadcast_tx);
            actor.run().await;
        });

        return Ok(draft);
    }

    pub fn get_pokemon(&self) -> Vec<Arc<Pokemon>> {
        self.pokemon.clone()
    }
    
    pub async fn get_current_auction(&self) -> Result<Option<AuctionResponse>, AppError> {
        let (response_sender, response_receiver) = oneshot::channel();
        let cmd = DraftCommand::GetCurrentAuction(response_sender);
        let _ = self.actor_sender.send(cmd).await
            .map_err(|e| (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("failed to send resolve auction cmd, {}", e)
            ))?;

        response_receiver.await
            .map_err(|e| (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("failed to listen to resolve auction response, {}", e)
            ))?
    }

    pub async fn resolve_auction(&self, completed_auction: AuctionResponse) -> Result<(), AppError> {
        let (response_sender, response_receiver) = oneshot::channel();
        let cmd = DraftCommand::ResolveAuction { response_sender,  completed_auction };
        let _ = self.actor_sender.send(cmd).await
            .map_err(|e| (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("failed to send resolve auction cmd, {}", e)
            ))?;

        response_receiver.await
            .map_err(|e| (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("failed to listen to resolve auction response, {}", e)
            ))?
    }

    pub async fn join_draft(&self, user: User, password: Option<String>) -> Result<(), AppError> {
        let (response_sender, response_receiver) = oneshot::channel();
        let cmd = DraftCommand::Join { response_sender , user, password };
        let _ = self.actor_sender.send(cmd).await
            .map_err(|e| (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("failed to send join draft cmd, {}", e)
            ))?;

        response_receiver.await
            .map_err(|e| (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("failed to listen to join draft response, {}", e)
            ))?
    }

    pub async fn kick(&self, user: User) -> Result<(), AppError> {
        let (response_sender, response_receiver) = oneshot::channel();
        let cmd = DraftCommand::Kick { response_sender , user };
        let _ = self.actor_sender.send(cmd).await
            .map_err(|e| (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("failed to send join draft cmd, {}", e)
            ))?;

        response_receiver.await
            .map_err(|e| (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("failed to listen to join draft response, {}", e)
            ))?
    }

    pub async fn bid(
        &self,
        auction_id: i64,
        bid_value: u32,
        user: User,
    ) -> Result<(), AppError> {
        let (response_sender, response_receiver) = oneshot::channel();
        let cmd = DraftCommand::Bid {
            response_sender,
            auction_id,
            bid_value,
            user,
        };
        self.actor_sender.send(cmd).await.map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to send bid to actor, {}", e),
            )
        })?;

        response_receiver.await.map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to wait for actor response, {}", e),
            )
        })?
    }

    pub async fn start(&self, user_id: String) -> Result<(), AppError> {
        let (response_sender, response_receiver) = oneshot::channel();
        let cmd = DraftCommand::Start {
            response_sender,
            user_id,
        };
        self.actor_sender.send(cmd).await.map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to send to actor, {}", e),
            )
        })?;

        response_receiver.await.map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to wait for actor response, {}", e),
            )
        })?
    }

    pub async fn pause(&self, user_id: String) -> Result<(), AppError> {
        let (response_sender, response_receiver) = oneshot::channel();
        let cmd = DraftCommand::Pause {
            response_sender,
            user_id,
        };
        self.actor_sender.send(cmd).await.map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to send to actor, {}", e),
            )
        })?;

        response_receiver.await.map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to wait for actor response, {}", e),
            )
        })?
    }

    pub async fn resume(&self, user_id: String) -> Result<(), AppError> {
        let (response_sender, response_receiver) = oneshot::channel();
        let cmd = DraftCommand::Resume {
            response_sender,
            user_id,
        };
        self.actor_sender.send(cmd).await.map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to send resume cmd to actor, {}", e),
            )
        })?;

        response_receiver.await.map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to wait for actor response, {}", e),
            )
        })?
    }

    pub async fn get(&self) -> Result<DraftResponse, AppError> {
        let (response_sender, response_receiver) = oneshot::channel();
        let cmd = DraftCommand::Get(response_sender);
        self.actor_sender.send(cmd).await.map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to send get cmd to actor, {}", e),
            )
        })?;

        response_receiver.await.map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to wait for actor response, {}", e),
            )
        })?
    }

    pub async fn get_lobby(&self) -> Result<DraftLobbyResponse, AppError> {
        let (response_sender, response_receiver) = oneshot::channel();
        let cmd = DraftCommand::GetLobby(response_sender);
        self.actor_sender.send(cmd).await.map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to send get lobby cmd to actor, {}", e),
            )
        })?;

        response_receiver.await.map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to wait for actor response, {}", e),
            )
        })?
    }

    pub async fn ready_up(&self, user_id: String) -> Result<(), AppError> {
        let (response_sender, response_receiver) = oneshot::channel();
        let cmd = DraftCommand::ReadyUp { response_sender, user_id };
        self.actor_sender.send(cmd).await.map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to send ready up cmd to actor, {}", e),
            )
        })?;

        response_receiver.await.map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to wait for actor response, {}", e),
            )
        })?
    }

//     pub async fn update_pending_settings(
//         &mut self,
//         num_teams: u32,
//         num_auctions: u32,
//         remove_team_ids: Vec<String>,
//     ) -> Result<(), (StatusCode, String)> {
//         if self.draft_state != DraftState::PENDING {
//             return Err((
//                 StatusCode::PRECONDITION_FAILED,
//                 "draft must be in PENDING state".to_string(),
//             ));
//         }
//
//         if num_teams == 0 {
//             return Err((
//                 StatusCode::BAD_REQUEST,
//                 "num_teams must be greater than 0".to_string(),
//             ));
//         }
//
//         if num_auctions == 0 {
//             return Err((
//                 StatusCode::BAD_REQUEST,
//                 "num_auctions must be greater than 0".to_string(),
//             ));
//         }
//
//         let host_user_id = self.host.get_user_id_string();
//         let mut unique_remove_ids: Vec<String> = Vec::new();
//         for team_id in remove_team_ids {
//             if unique_remove_ids.contains(&team_id) {
//                 continue;
//             }
//
//             if team_id == host_user_id {
//                 return Err((
//                     StatusCode::BAD_REQUEST,
//                     "host cannot be removed from draft".to_string(),
//                 ));
//             }
//
//             if !self.teams.contains_key(&team_id) {
//                 return Err((
//                     StatusCode::BAD_REQUEST,
//                     format!("team {} is not in this draft", team_id),
//                 ));
//             }
//
//             unique_remove_ids.push(team_id);
//         }
//
//         let teams_after_removal = self.teams.len().saturating_sub(unique_remove_ids.len()) as u32;
//         if num_teams < teams_after_removal {
//             return Err((
//                 StatusCode::BAD_REQUEST,
//                 "num_teams cannot be less than teams remaining after removals".to_string(),
//             ));
//         }
//
//         let max_auctions = self.auctions.len() as u32;
//         if num_auctions > max_auctions {
//             return Err((
//                 StatusCode::BAD_REQUEST,
//                 format!("num_auctions cannot exceed {} for this draft", max_auctions),
//             ));
//         }
//
//         let mut tx = self.db_pool.begin().await.map_err(|e| {
//             (
//                 StatusCode::INTERNAL_SERVER_ERROR,
//                 format!("failed to begin transaction: {}", e),
//             )
//         })?;
//
//         for team_id in &unique_remove_ids {
//             let _ = sqlx::query!(
//                 r#"
//                 DELETE FROM teams
//                 WHERE draft_id = $1
//                   AND (user_id = $2 OR guest_id = $2)
//                 "#,
//                 self.draft_id,
//                 team_id,
//             )
//             .execute(&mut *tx)
//             .await
//             .map_err(|e| {
//                 (
//                     StatusCode::INTERNAL_SERVER_ERROR,
//                     format!("failed to remove team {}: {}", team_id, e),
//                 )
//             })?;
//         }
//
//         let _ = sqlx::query!(
//             r#"
//             UPDATE drafts
//             SET num_teams = $1
//             WHERE draft_id = $2
//             "#,
//             num_teams as i32,
//             self.draft_id
//         )
//         .execute(&mut *tx)
//         .await
//         .map_err(|e| {
//             (
//                 StatusCode::INTERNAL_SERVER_ERROR,
//                 format!("failed to update draft settings: {}", e),
//             )
//         })?;
//
//         tx.commit().await.map_err(|e| {
//             (
//                 StatusCode::INTERNAL_SERVER_ERROR,
//                 format!("failed to commit draft settings update: {}", e),
//             )
//         })?;
//
//         for team_id in unique_remove_ids {
//             self.teams.remove(&team_id);
//         }
//
//         self.settings.num_teams = num_teams;
//         self.settings.num_auctions = num_auctions;
//
//         let draft_response = crate::draft::DraftResponse::from(self.clone());
//         let _ = self
//             .tx
//             .send(crate::messages::ServerMessage::DraftUpdate(draft_response));
//
//         Ok(())
//     }
//
//     pub fn all_teams_ready(&self) -> bool {
//         self.teams.len() == self.settings.num_teams as usize
//             && self.teams.values().all(|team| team.ready)
//     }

}

struct DraftActor {
    draft: Arc<Draft>,
    host: String,
    draft_state: DraftState,
    settings: DraftSettings,
    current_auction: usize,
    auctions: Vec<Auction>,
    completed_auctions: Vec<AuctionResponse>,
    db_writer: DbWriter,
    teams: HashMap<String, Team>,
    spectators: Vec<User>,
    receiver: mpsc::Receiver<DraftCommand>,
    broadcast_tx: broadcast::Sender<ServerMessage>
}

enum DraftCommand {
    Start {
        response_sender: oneshot::Sender<Result<(), AppError>>,
        user_id: String,
    },
    Resume {
        response_sender: oneshot::Sender<Result<(), AppError>>,
        user_id: String,
    },
    Pause {
        response_sender: oneshot::Sender<Result<(), AppError>>,
        user_id: String,
    },
    Get(oneshot::Sender<Result<DraftResponse, AppError>>),
    Join {
        response_sender: oneshot::Sender<Result<(), AppError>>,
        user: User,
        password: Option<String>,
    },
    Kick {
        response_sender: oneshot::Sender<Result<(), AppError>>,
        user: User,
    },
    Bid {
        response_sender: oneshot::Sender<Result<(), AppError>>,
        auction_id: i64,
        bid_value: u32,
        user: User,
    },
    ResolveAuction {
        response_sender: oneshot::Sender<Result<(), AppError>>,
        completed_auction: AuctionResponse,
    },
    GetLobby(oneshot::Sender<Result<DraftLobbyResponse, AppError>>),
    ReadyUp {
        response_sender: oneshot::Sender<Result<(), AppError>>,
        user_id: String,
    },
    GetCurrentAuction(oneshot::Sender<Result<Option<AuctionResponse>, AppError>>),
}

impl DraftActor {
    pub fn new(draft: Arc<Draft>, host: User, settings: DraftSettings, auctions: Vec<Auction>, db_writer: DbWriter, receiver: mpsc::Receiver<DraftCommand>, broadcast_tx: broadcast::Sender<ServerMessage>) -> Self {
        let host_id = host.get_user_id_string();
        let mut teams = HashMap::new();
        if !settings.ranked {
            teams.insert(host_id.clone(), Team {
                user_id: host_id.clone(),
                username: host.get_user_name_string(),
                ready: true,
                budget_remaining: settings.starting_money,
                auctions_won: vec![],
            });
        }
        Self {
            draft,
            host: host_id,
            draft_state: DraftState::PENDING,
            settings,
            current_auction: 0,
            teams,
            auctions,
            db_writer,
            completed_auctions: vec![],
            receiver,
            broadcast_tx,
            spectators: vec![],
        }
    }
    pub async fn run(mut self) {
        loop {
            if let Some(cmd) = self.receiver.recv().await {
                match cmd {
                    DraftCommand::Bid {
                        response_sender,
                        auction_id,
                        bid_value,
                        user,
                    } => {
                        let res = self.bid(auction_id, bid_value, user).await;
                        let _ = response_sender.send(res);
                    }
                    DraftCommand::Start {
                        response_sender,
                        user_id,
                    } => {
                        let res = self.start(user_id).await;
                        let _ = response_sender.send(res);
                    }
                    DraftCommand::Pause {
                        response_sender,
                        user_id,
                    } => {
                        let res = self.pause(user_id).await;
                        let _ = response_sender.send(res);
                    }
                    DraftCommand::Resume {
                        response_sender,
                        user_id,
                    } => {
                        let res = self.resume(user_id).await;
                        let _ = response_sender.send(res);
                    }
                    DraftCommand::Join {
                        response_sender,
                        user,
                        password,
                    } => {
                        let res = self.join(user, password).await;
                        let _ = response_sender.send(res);
                    }
                    DraftCommand::Kick {
                        response_sender,
                        user,
                    } => {
                        let res = self.kick(user).await;
                        let _ = response_sender.send(res);
                    },
                    DraftCommand::Get(response_sender) => {
                        let _ = response_sender.send(Ok(DraftResponse::from(&self)));
                    },
                    DraftCommand::GetLobby(response_sender) => {
                        let _ = response_sender.send(Ok(DraftLobbyResponse::from(&self)));
                    }
                    DraftCommand::ResolveAuction {
                        response_sender,
                        completed_auction,
                    } => {
                        let res = self.resolve_auction(completed_auction).await;
                        let _ = response_sender.send(res);
                    }
                    DraftCommand::ReadyUp {
                        response_sender,
                        user_id,
                    } => {
                        let res = self.ready_up(user_id).await;
                        let _ = response_sender.send(res);
                    },
                    DraftCommand::GetCurrentAuction(response_sender) => {
                        let res = self.get_current_auction().await;
                        let _ = response_sender.send(res);
                    },
                }
            }
        }
    }

    async fn get_current_auction(&self) -> Result<Option<AuctionResponse>, AppError> {
        if self.draft_state == DraftState::PENDING {
            return Ok(None);
        }
        let auction = &self.auctions[self.current_auction];
        auction.get().await.map(|ok| Some(ok))
    }

    async fn bid(&self, auction_id: i64, bid_value: u32, user: User) -> Result<(), AppError> {
        let auction = &self.auctions[self.current_auction];
        if self.draft_state != DraftState::BIDDING {
            return Err((
                StatusCode::PRECONDITION_FAILED,
                format!("draft is not accepting bids"),
            ));
        }
        if auction.auction_id != auction_id {
            return Err((
                StatusCode::PRECONDITION_FAILED,
                format!("auction is not active"),
            ));
        }
        if bid_value % 100 != 0 {
            return Err((
                StatusCode::PRECONDITION_FAILED,
                format!("bid must be multiple of 100"),
            ));
        }
        let Some(team) = self.teams.get(&user.get_user_id_string()) else {
            return Err((
                StatusCode::PRECONDITION_FAILED,
                format!("user is not assigned to a team"),
            ));
        };

        if team.budget_remaining < bid_value {
            return Err((
                StatusCode::PRECONDITION_FAILED,
                format!("team does not have enough money remaining"),
            ));
        }

        auction.bid(bid_value, user.get_user_id_string()).await?;
        self.db_writer.write_bid(auction_id, bid_value, user).await;

        Ok(())
    }

    async fn start(&mut self, user_id: String) -> Result<(), AppError> {
        if user_id != self.host {
            return Err((
                    StatusCode::PRECONDITION_FAILED,
                    format!("user is not the host")
            ));
        }
        if self.draft_state != DraftState::PENDING {
            return Err((
                    StatusCode::PRECONDITION_FAILED,
                    format!("draft is not pending")
            ));
        }
        if self.teams.len() < self.settings.num_teams as usize {
            return Err((
                    StatusCode::PRECONDITION_FAILED,
                    format!(
                        "only {} of {} teams have joined the draft",
                        self.teams.len(),
                        self.settings.num_teams
                    )
            ));
        }
        if self.teams.values().any(|t| !t.ready) {
            return Err((
                    StatusCode::PRECONDITION_FAILED,
                    format!("not all teams are ready")
            ));
        }

        self.db_writer.start_draft().await?;

        let auction = &self.auctions[self.current_auction];
        auction
            .start(
                self.draft.clone(),
                self.settings.auction_length.as_secs() as u32,
            )
            .await?;

        self.draft_state = DraftState::BIDDING;

        Ok(())
    }

    async fn resume(&self, user_id: String) -> Result<(), AppError> {
        if user_id != self.host {
            return Err((
                    StatusCode::UNAUTHORIZED,
                    format!("user is not the host")
            ));
        }

        let auction = &self.auctions[self.current_auction];
        self.db_writer.resume_auction(auction.auction_id).await?;
        auction.resume().await
    }

    async fn pause(&self, user_id: String) -> Result<(), AppError> {
        if user_id != self.host {
            return Err((
                    StatusCode::UNAUTHORIZED,
                    format!("user is not the host")
            ));
        }

        let auction = &self.auctions[self.current_auction];
        let time_remaining = auction.pause().await?;
        self.db_writer.pause_auction(auction.auction_id, time_remaining).await
    }

    async fn join(&mut self, user: User, password: Option<String>) -> Result<(), AppError> {
        let user_id = user.get_user_id_string();
        if self.teams.iter().any(|(u_id, _)| *u_id == user_id) {
            return Err((
                    StatusCode::PRECONDITION_FAILED,
                    format!("user is already in this draft")
            ));
        }
        if self.teams.len() >= self.settings.num_teams as usize {
            return Err((
                    StatusCode::PRECONDITION_FAILED,
                    format!("draft is already full")
            ));
        }

        if user_id != self.host {
            if let Some(draft_password) = self.settings.password.as_ref() {
                let Some(password) = password
                    .as_ref()
                    .map(|p| p.trim().to_string())
                    .filter(|p| !p.is_empty())
                else {
                    return Err((
                            StatusCode::BAD_REQUEST,
                            format!("password required")
                    ));
                };

                if password != *draft_password {
                    return Err((
                            StatusCode::BAD_REQUEST,
                            format!("password is incorrect")
                    ));
                }
            }
        }

        let team = Team {
            user_id: user_id.clone(),
            username: user.get_user_name_string(),
            ready: user_id == self.host,
            budget_remaining: self.settings.starting_money,
            auctions_won: vec![],
        };
        self.teams.insert(user_id.clone(), team);

        self.db_writer.join_draft(user).await
    }

    async fn kick(&mut self, user: User) -> Result<(), AppError> {
        let user_id = user.get_user_id_string();
        if !self.teams.iter().any(|(u_id, _)| *u_id == user_id) {
            return Err((
                StatusCode::PRECONDITION_FAILED,
                format!("user is not in draft")
            ));
        }
        if user_id == self.host {
            return Err((
                StatusCode::BAD_REQUEST,
                format!("cannot kick host")
            ));
        }
        if self.draft_state != DraftState::PENDING {
            return Err((
                StatusCode::PRECONDITION_FAILED,
                format!("cannot kick after draft starts")
            ));
        }

        self.db_writer.kick_draft(user).await?;
        self.teams.remove(&user_id);
        Ok(())
    }

    async fn resolve_auction(&mut self, completed_auction: AuctionResponse) -> Result<(), AppError> {
        if self.draft_state != DraftState::BIDDING {
            return Err((
                StatusCode::PRECONDITION_FAILED,
                format!("draft is not in the bidding state")
            ));
        }
        let current_auction = &self.auctions[self.current_auction];
        if current_auction.auction_id != completed_auction.auction_id {
            return Err((
                    StatusCode::PRECONDITION_FAILED,
                    format!("completed auction {}, different than current auction {}",
                        completed_auction.auction_id, current_auction.auction_id)
            ));
        }
        self.db_writer.resolve_auction(completed_auction.auction_id).await?;
        self.current_auction += 1;
        self.completed_auctions.push(completed_auction);
        Ok(())
    }

    async fn ready_up(&mut self, user_id: String) -> Result<(), AppError> {
        let Some(team) = self.teams.get_mut(&user_id) else {
            return Err((
                    StatusCode::BAD_REQUEST,
                    format!("user is not a participant in this draft")
            ));
        };

        team.ready = true;
        Ok(())
    }
}

impl From<&DraftActor> for DraftResponse {
    fn from(value: &DraftActor) -> Self {
        DraftResponse {
            draft_id: value.draft.draft_id.to_string(),
            draft_name: value.draft.draft_name.clone(),
            has_password: value.settings.password.is_some(),
            host: value.host.clone(),
            ranked: value.settings.ranked,
            total_teams: value.settings.num_teams,
            total_auctions: value.settings.num_auctions,
            teams: value.teams.values().cloned().collect(),
            draft_state: value.draft_state.clone(),
            current_auction: value.current_auction,
            completed_auctions: value.completed_auctions.clone(),
            current_server_time: Utc::now(),
        }
    }
}

impl From<&DraftActor> for DraftLobbyResponse {
    fn from(value: &DraftActor) -> Self {
        DraftLobbyResponse {
            draft_id: value.draft.draft_id,
            draft_name: value.draft.draft_name.clone(),
            has_password: value.settings.password.is_some(),
            ranked: value.settings.ranked,
            total_teams: value.settings.num_teams,
            total_auctions: value.settings.num_auctions,
            draft_state: value.draft_state.clone(),
            teams_joined: value.teams.len() as u32,
        }
    }
}
