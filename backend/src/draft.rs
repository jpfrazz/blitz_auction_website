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
    pub broadcast_tx: broadcast::Sender<ServerMessage>,
    pub pokemon: Vec<Arc<Pokemon>>,
    pub created_at: chrono::DateTime<Utc>,
    actor_sender: mpsc::Sender<DraftCommand>,
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
    auction_length: u32,
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
    created_at: chrono::DateTime<Utc>,
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
    pub auction_length: u32,
}

#[derive(Clone, Debug, Serialize)]
struct Team {
    pub user_id: String,
    pub username: String,
    pub global_name: Option<String>,
    pub ready: bool,
    budget_remaining: u32,
    pub auctions_won: Vec<Arc<Pokemon>>,
}

impl Draft {
    fn new(
        draft_id: Uuid,
        draft_name: String,
        host: User,
        pokemon: Vec<Arc<Pokemon>>,
        actor_sender: mpsc::Sender<DraftCommand>,
        broadcast_tx: broadcast::Sender<ServerMessage>,
        created_at: chrono::DateTime<Utc>,
    ) -> Draft {
        Draft {
            draft_id,
            draft_name,
            host,
            pokemon,
            broadcast_tx,
            actor_sender,
            created_at,
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

        println!("pokemon len:, {}", pokemon.len());
        let auction_ids = db_writer
            .create_draft(host.clone(), settings.clone(), pokemon.clone())
            .await?;
        if !settings.ranked {
            db_writer.join_draft(host.clone()).await?;
        }
        let mut auctions = Vec::new();
        println!("auction_ids len, {}", auction_ids.len());

        for (id, p) in auction_ids.into_iter() {
            let auction = Auction::new(draft_id, id, p);
            auctions.push(auction);
        }
        let (actor_sender, actor_receiver) = mpsc::channel(1_000);
        let (broadcast_tx, _) = broadcast::channel(10_000);
        let created_at = Utc::now();
        let draft = Arc::new(Draft::new(
            draft_id,
            draft_name,
            host.clone(),
            pokemon,
            actor_sender,
            broadcast_tx.clone(),
            created_at,
        ));
        let actor_draft = draft.clone();

        tokio::spawn(async move {
            let actor = DraftActor::new(
                actor_draft,
                host,
                settings,
                auctions,
                db_writer,
                actor_receiver,
                broadcast_tx,
            );
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
        let _ = self.actor_sender.send(cmd).await.map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to send resolve auction cmd, {}", e),
            )
        })?;

        response_receiver.await.map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to listen to resolve auction response, {}", e),
            )
        })?
    }

    pub async fn resolve_auction(
        &self,
        completed_auction: AuctionResponse,
    ) -> Result<(), AppError> {
        let (response_sender, response_receiver) = oneshot::channel();
        let cmd = DraftCommand::ResolveAuction {
            response_sender,
            completed_auction,
        };
        let _ = self.actor_sender.send(cmd).await.map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to send resolve auction cmd, {}", e),
            )
        })?;

        response_receiver.await.map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to listen to resolve auction response, {}", e),
            )
        })?
    }

    pub async fn join_draft(&self, user: User, password: Option<String>) -> Result<(), AppError> {
        let (response_sender, response_receiver) = oneshot::channel();
        let cmd = DraftCommand::Join {
            response_sender,
            user,
            password,
        };
        let _ = self.actor_sender.send(cmd).await.map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to send join draft cmd, {}", e),
            )
        })?;

        response_receiver.await.map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to listen to join draft response, {}", e),
            )
        })?
    }

    pub async fn kick(&self, user: User) -> Result<(), AppError> {
        let (response_sender, response_receiver) = oneshot::channel();
        let cmd = DraftCommand::Kick {
            response_sender,
            user,
        };
        let _ = self.actor_sender.send(cmd).await.map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to send join draft cmd, {}", e),
            )
        })?;

        response_receiver.await.map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to listen to join draft response, {}", e),
            )
        })?
    }

    pub async fn bid(&self, auction_id: i64, bid_value: u32, user: User) -> Result<(), AppError> {
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
        let cmd = DraftCommand::ReadyUp {
            response_sender,
            user_id,
        };
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

    pub async fn claim_eeveelution(
        &self,
        user: User,
        pokedex_id: i32,
        form: Option<String>,
        target_user_id: Option<String>,
    ) -> Result<serde_json::Value, AppError> {
        let (response_sender, response_receiver) = oneshot::channel();
        let cmd = DraftCommand::ClaimEeveelution {
            response_sender,
            user,
            pokedex_id,
            form,
            target_user_id,
        };
        self.actor_sender.send(cmd).await.map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to send claim eeveelution to actor, {}", e),
            )
        })?;

        response_receiver.await.map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to wait for actor response, {}", e),
            )
        })?
    }

    pub async fn unclaim_eeveelution(
        &self,
        user: User,
        pokedex_id: i32,
        form: Option<String>,
        target_user_id: Option<String>,
    ) -> Result<serde_json::Value, AppError> {
        let (response_sender, response_receiver) = oneshot::channel();
        let cmd = DraftCommand::UnclaimEeveelution {
            response_sender,
            user,
            pokedex_id,
            form,
            target_user_id,
        };
        self.actor_sender.send(cmd).await.map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to send unclaim eeveelution to actor, {}", e),
            )
        })?;

        response_receiver.await.map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to wait for actor response, {}", e),
            )
        })?
    }

    pub async fn update_pending_settings(
        &self,
        user_id: String,
        num_teams: u32,
        num_auctions: u32,
        remove_team_ids: Vec<String>,
    ) -> Result<DraftResponse, AppError> {
        let (response_sender, response_receiver) = oneshot::channel();
        let cmd = DraftCommand::UpdatePendingSettings {
            response_sender,
            user_id,
            num_teams,
            num_auctions,
            remove_team_ids,
        };
        self.actor_sender.send(cmd).await.map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to send update pending settings cmd to actor, {}", e),
            )
        })?;

        response_receiver.await.map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to wait for response, {}", e),
            )
        })?
    }

    pub async fn update_user_name(&self, user_id: String, new_name: String) {
        let cmd = DraftCommand::UpdateUserName { user_id, new_name };
        let _ = self.actor_sender.send(cmd).await;
    }
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
    broadcast_tx: broadcast::Sender<ServerMessage>,
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
    ClaimEeveelution {
        response_sender: oneshot::Sender<Result<serde_json::Value, AppError>>,
        user: User,
        pokedex_id: i32,
        form: Option<String>,
        target_user_id: Option<String>,
    },
    UnclaimEeveelution {
        response_sender: oneshot::Sender<Result<serde_json::Value, AppError>>,
        user: User,
        pokedex_id: i32,
        form: Option<String>,
        target_user_id: Option<String>,
    },
    UpdatePendingSettings {
        response_sender: oneshot::Sender<Result<DraftResponse, AppError>>,
        user_id: String,
        num_teams: u32,
        num_auctions: u32,
        remove_team_ids: Vec<String>,
    },
    UpdateUserName {
        user_id: String,
        new_name: String,
    },
}

impl DraftActor {
    pub fn new(
        draft: Arc<Draft>,
        host: User,
        settings: DraftSettings,
        auctions: Vec<Auction>,
        db_writer: DbWriter,
        receiver: mpsc::Receiver<DraftCommand>,
        broadcast_tx: broadcast::Sender<ServerMessage>,
    ) -> Self {
        let host_id = host.get_user_id_string();
        let mut teams = HashMap::new();
        if !settings.ranked {
            teams.insert(
                host_id.clone(),
                Team {
                    user_id: host_id.clone(),
                    username: host.get_user_name_string(),
                    global_name: host.get_global_name(),
                    ready: true,
                    budget_remaining: settings.starting_money,
                    auctions_won: vec![],
                },
            );
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

    fn broadcast(&self) {
        let data = DraftResponse::from(self);
        let _ = self.broadcast_tx.send(ServerMessage::DraftUpdate(data));
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
                        let ok = res.is_ok();
                        let _ = response_sender.send(res);
                        if ok {
                            self.broadcast();
                        };
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
                        let ok = res.is_ok();
                        let _ = response_sender.send(res);
                        if ok {
                            self.broadcast();
                        };
                    }
                    DraftCommand::Kick {
                        response_sender,
                        user,
                    } => {
                        let res = self.kick(user).await;
                        let ok = res.is_ok();
                        let _ = response_sender.send(res);
                        if ok {
                            self.broadcast();
                        };
                    }
                    DraftCommand::Get(response_sender) => {
                        let _ = response_sender.send(Ok(DraftResponse::from(&self)));
                    }
                    DraftCommand::GetLobby(response_sender) => {
                        let _ = response_sender.send(Ok(DraftLobbyResponse::from(&self)));
                    }
                    DraftCommand::ResolveAuction {
                        response_sender,
                        completed_auction,
                    } => {
                        let res = self.resolve_auction(completed_auction).await;
                        let ok = res.is_ok();
                        let _ = response_sender.send(res);
                        if ok {
                            self.broadcast();
                        };
                    }
                    DraftCommand::ReadyUp {
                        response_sender,
                        user_id,
                    } => {
                        let res = self.ready_up(user_id).await;
                        let ok = res.is_ok();
                        let _ = response_sender.send(res);
                        if ok {
                            self.broadcast();
                        };
                    }
                    DraftCommand::GetCurrentAuction(response_sender) => {
                        let res = self.get_current_auction().await;
                        let _ = response_sender.send(res);
                    }
                    DraftCommand::ClaimEeveelution {
                        response_sender,
                        user,
                        pokedex_id,
                        form,
                        target_user_id,
                    } => {
                        let res = self.claim_eeveelution(user, pokedex_id, form, target_user_id).await;
                        let _ = response_sender.send(res);
                    }
                    DraftCommand::UnclaimEeveelution {
                        response_sender,
                        user,
                        pokedex_id,
                        form,
                        target_user_id,
                    } => {
                        let res = self.unclaim_eeveelution(user, pokedex_id, form, target_user_id).await;
                        let _ = response_sender.send(res);
                    }
                    DraftCommand::UpdatePendingSettings {
                        response_sender,
                        user_id,
                        num_teams,
                        num_auctions,
                        remove_team_ids,
                    } => {
                        let res = self
                            .update_pending_settings(
                                user_id,
                                num_teams,
                                num_auctions,
                                remove_team_ids,
                            )
                            .await;
                        let _ = response_sender.send(res);
                    }
                    DraftCommand::UpdateUserName { user_id, new_name } => {
                        if let Some(team) = self.teams.get_mut(&user_id) {
                            team.username = new_name;
                            self.broadcast();
                        }
                    }
                }
            }
        }
    }

    async fn get_current_auction(&self) -> Result<Option<AuctionResponse>, AppError> {
        if self.draft_state == DraftState::PENDING || self.draft_state == DraftState::COMPLETED {
            return Ok(None);
        }
        let auction = &self.auctions[self.current_auction];
        auction.get().await.map(|ok| Some(ok))
    }

    async fn bid(&self, auction_id: i64, bid_value: u32, user: User) -> Result<(), AppError> {
        if self.draft_state != DraftState::BIDDING {
            return Err((
                StatusCode::PRECONDITION_FAILED,
                format!("draft is not accepting bids"),
            ));
        }
        let auction = &self.auctions[self.current_auction];
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

        auction.bid(bid_value, user.clone()).await?;
        self.db_writer.write_bid(auction_id, bid_value, user).await;

        Ok(())
    }

    async fn start(&mut self, user_id: String) -> Result<(), AppError> {
        if user_id != self.host {
            return Err((
                StatusCode::PRECONDITION_FAILED,
                format!("user is not the host"),
            ));
        }
        if self.draft_state != DraftState::PENDING {
            return Err((
                StatusCode::PRECONDITION_FAILED,
                format!("draft is not pending"),
            ));
        }
        if self.teams.len() < self.settings.num_teams as usize {
            return Err((
                StatusCode::PRECONDITION_FAILED,
                format!(
                    "only {} of {} teams have joined the draft",
                    self.teams.len(),
                    self.settings.num_teams
                ),
            ));
        }
        if self.teams.values().any(|t| !t.ready) {
            return Err((
                StatusCode::PRECONDITION_FAILED,
                format!("not all teams are ready"),
            ));
        }

        self.db_writer.start_draft().await?;

        let auction = &self.auctions[self.current_auction];
        auction
            .start(self.draft.clone(), self.settings.auction_length)
            .await?;

        self.draft_state = DraftState::BIDDING;

        Ok(())
    }

    async fn resume(&self, user_id: String) -> Result<(), AppError> {
        if user_id != self.host {
            return Err((StatusCode::UNAUTHORIZED, format!("user is not the host")));
        }
        if self.draft_state != DraftState::BIDDING {
            return Err((
                StatusCode::PRECONDITION_FAILED,
                format!("draft is not in bidding state"),
            ));
        }

        let auction = &self.auctions[self.current_auction];
        self.db_writer.resume_auction(auction.auction_id).await?;
        auction.resume().await
    }

    async fn pause(&self, user_id: String) -> Result<(), AppError> {
        if user_id != self.host {
            return Err((StatusCode::UNAUTHORIZED, format!("user is not the host")));
        }
        if self.draft_state != DraftState::BIDDING {
            return Err((
                StatusCode::PRECONDITION_FAILED,
                format!("draft is not in bidding state"),
            ));
        }

        let auction = &self.auctions[self.current_auction];
        let time_remaining = auction.pause().await?;
        self.db_writer
            .pause_auction(auction.auction_id, time_remaining)
            .await
    }

    async fn join(&mut self, user: User, password: Option<String>) -> Result<(), AppError> {
        let user_id = user.get_user_id_string();
        if self.teams.iter().any(|(u_id, _)| *u_id == user_id) {
            return Err((
                StatusCode::PRECONDITION_FAILED,
                format!("user is already in this draft"),
            ));
        }
        if self.teams.len() >= self.settings.num_teams as usize {
            return Err((
                StatusCode::PRECONDITION_FAILED,
                format!("draft is already full"),
            ));
        }

        if user_id != self.host {
            if let Some(draft_password) = self.settings.password.as_ref() {
                let Some(password) = password
                    .as_ref()
                    .map(|p| p.trim().to_string())
                    .filter(|p| !p.is_empty())
                else {
                    return Err((StatusCode::BAD_REQUEST, format!("password required")));
                };

                if password != *draft_password {
                    return Err((StatusCode::BAD_REQUEST, format!("password is incorrect")));
                }
            }
        }

        let team = Team {
            user_id: user_id.clone(),
            username: user.get_user_name_string(),
            global_name: user.get_global_name(),
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
                format!("user is not in draft"),
            ));
        }
        if user_id == self.host {
            return Err((StatusCode::BAD_REQUEST, format!("cannot kick host")));
        }
        if self.draft_state != DraftState::PENDING {
            return Err((
                StatusCode::PRECONDITION_FAILED,
                format!("cannot kick after draft starts"),
            ));
        }

        self.db_writer.kick_draft(user).await?;
        self.teams.remove(&user_id);
        Ok(())
    }

    async fn resolve_auction(
        &mut self,
        completed_auction: AuctionResponse,
    ) -> Result<(), AppError> {
        if self.draft_state != DraftState::BIDDING {
            return Err((
                StatusCode::PRECONDITION_FAILED,
                format!("draft is not in the bidding state"),
            ));
        }
        let current_auction = &self.auctions[self.current_auction];
        if current_auction.auction_id != completed_auction.auction_id {
            return Err((
                StatusCode::PRECONDITION_FAILED,
                format!(
                    "completed auction {}, different than current auction {}",
                    completed_auction.auction_id, current_auction.auction_id
                ),
            ));
        }
        self.db_writer
            .resolve_auction(completed_auction.auction_id)
            .await?;

        if let Some(winner) = &completed_auction.highest_bidder {
            if let Some(team) = self.teams.get_mut(&winner.get_user_id_string()) {
                team.auctions_won.push(current_auction.pokemon.clone());
                team.budget_remaining = team
                    .budget_remaining
                    .saturating_sub(completed_auction.highest_bid);
            }
        }
        self.current_auction += 1;
        self.completed_auctions.push(completed_auction);
        if let Some(auction) = self.auctions.get(self.current_auction) {
            let _ = auction
                .start(self.draft.clone(), self.settings.auction_length)
                .await;
        } else {
            if let Ok(_) = self.db_writer.finish_draft().await {
                self.draft_state = DraftState::COMPLETED;
                self.broadcast();
            }
        }

        Ok(())
    }

    async fn ready_up(&mut self, user_id: String) -> Result<(), AppError> {
        let Some(team) = self.teams.get_mut(&user_id) else {
            return Err((
                StatusCode::BAD_REQUEST,
                format!("user is not a participant in this draft"),
            ));
        };

        team.ready = true;
        Ok(())
    }

    async fn claim_eeveelution(
        &mut self,
        user: User,
        pokedex_id: i32,
        form: Option<String>,
        target_user_id: Option<String>,
    ) -> Result<serde_json::Value, AppError> {
        if self.draft_state != DraftState::COMPLETED {
            return Err((
                StatusCode::PRECONDITION_FAILED,
                "draft must be completed".to_string(),
            ));
        }

        let eeveelutions = [133, 134, 135, 136, 196, 197, 470, 471, 700];
        if !eeveelutions.contains(&pokedex_id) {
            return Err((
                StatusCode::BAD_REQUEST,
                "Only Eeveelutions can be claimed through this method".to_string(),
            ));
        }

        let is_ref = user.has_role_name("Referee") || user.has_role_name("Admin");
        let actual_user_id = if let Some(tid) = target_user_id {
            if is_ref { tid } else { user.get_user_id_string() }
        } else {
            user.get_user_id_string()
        };

        if let Some(team) = self.teams.get(&actual_user_id) {
            if team
                .auctions_won
                .iter()
                .any(|p| eeveelutions.contains(&(p.pokedex_id as i32)))
            {
                return Ok(serde_json::json!({
                    "success": false,
                    "error": if actual_user_id == user.get_user_id_string() {
                        "You have already claimed an Eeveelution".to_string()
                    } else {
                        format!("{} has already claimed an Eeveelution", team.username)
                    }
                }));
            }
        }

        let target_pokemon = self
            .draft
            .pokemon
            .iter()
            .find(|p| p.pokedex_id as i32 == pokedex_id && p.form == form)
            .cloned();
        let target_pokemon = match target_pokemon {
            Some(p) => p,
            None => {
                return Err((
                    StatusCode::NOT_FOUND,
                    "pokemon not found in draft".to_string(),
                ));
            }
        };

        // Check if claimed
        let already_claimed_by =
            self.teams.values().find_map(|team| {
                if team.auctions_won.iter().any(|p| {
                    p.pokedex_id == target_pokemon.pokedex_id && p.form == target_pokemon.form
                }) {
                    Some(team.username.clone())
                } else {
                    None
                }
            });

        if let Some(claimer_name) = already_claimed_by {
            return Ok(serde_json::json!({
                "success": false,
                "error": format!("Already claimed by {}", claimer_name),
                "claimed_by": claimer_name
            }));
        }

        if let Some(team) = self.teams.get_mut(&actual_user_id) {
            team.auctions_won.push(target_pokemon.clone());
            self.broadcast();
            Ok(serde_json::json!({
                "success": true,
                "claimed_by": actual_user_id,
                "pokemon": {
                    "pokedex_id": target_pokemon.pokedex_id,
                    "name": target_pokemon.name,
                    "form": target_pokemon.form
                }
            }))
        } else {
            Err((StatusCode::NOT_FOUND, "team not found".to_string()))
        }
    }

    async fn unclaim_eeveelution(
        &mut self,
        user: User,
        pokedex_id: i32,
        form: Option<String>,
        target_user_id: Option<String>,
    ) -> Result<serde_json::Value, AppError> {
        if self.draft_state != DraftState::COMPLETED {
            return Err((
                StatusCode::PRECONDITION_FAILED,
                "draft must be completed".to_string(),
            ));
        }

        let eeveelutions = [133, 134, 135, 136, 196, 197, 470, 471, 700];
        if !eeveelutions.contains(&pokedex_id) {
            return Err((
                StatusCode::BAD_REQUEST,
                "Only Eeveelutions can be unclaimed through this method".to_string(),
            ));
        }

        let target_pokemon = self
            .draft
            .pokemon
            .iter()
            .find(|p| p.pokedex_id as i32 == pokedex_id && p.form == form)
            .cloned();
        let target_pokemon = match target_pokemon {
            Some(p) => p,
            None => {
                return Err((
                    StatusCode::NOT_FOUND,
                    "pokemon not found in draft".to_string(),
                ));
            }
        };

        let is_ref = user.has_role_name("Referee") || user.has_role_name("Admin");
        let actual_user_id = if let Some(tid) = target_user_id {
            if is_ref { tid } else { user.get_user_id_string() }
        } else {
            user.get_user_id_string()
        };

        let team_status = self.teams.get(&actual_user_id).map(|team| {
            (
                team.username.clone(),
                team.auctions_won.iter().any(|p| {
                    p.pokedex_id == target_pokemon.pokedex_id && p.form == target_pokemon.form
                }),
            )
        });

        match team_status {
            Some((_, true)) => {
                let team = self.teams.get_mut(&actual_user_id).unwrap();
                let index = team.auctions_won.iter().position(|p| {
                    p.pokedex_id == target_pokemon.pokedex_id && p.form == target_pokemon.form
                }).unwrap();
                team.auctions_won.remove(index);
                self.broadcast();
                Ok(serde_json::json!({
                    "success": true,
                    "unclaimed_by": actual_user_id,
                    "pokemon": {
                        "pokedex_id": target_pokemon.pokedex_id,
                        "name": target_pokemon.name,
                        "form": target_pokemon.form
                    }
                }))
            }
            Some((username, false)) => {
                let claimed_by_other = self.teams.values().find_map(|other_team| {
                    if other_team.user_id != actual_user_id
                        && other_team.auctions_won.iter().any(|p| {
                            p.pokedex_id == target_pokemon.pokedex_id && p.form == target_pokemon.form
                        })
                    {
                        Some(other_team.username.clone())
                    } else {
                        None
                    }
                });

                if let Some(owner_name) = claimed_by_other {
                    return Err((StatusCode::FORBIDDEN, format!("eeveelution is claimed by {}", owner_name)));
                }

                let error_msg = if actual_user_id == user.get_user_id_string() {
                    "you have not claimed this eeveelution".to_string()
                } else {
                    format!("{} has not claimed this eeveelution", username)
                };
                Err((StatusCode::NOT_FOUND, error_msg))
            }
            None => Err((StatusCode::NOT_FOUND, "team not found".to_string())),
        }
    }

    async fn update_pending_settings(
        &mut self,
        user_id: String,
        num_teams: u32,
        num_auctions: u32,
        remove_team_ids: Vec<String>,
    ) -> Result<DraftResponse, AppError> {
        if self.draft_state != DraftState::PENDING {
            return Err((
                StatusCode::PRECONDITION_FAILED,
                "draft must be in PENDING state".to_string(),
            ));
        }
        if user_id != self.host {
            return Err((StatusCode::FORBIDDEN, "user is not host".to_string()));
        }
        if num_teams == 0 || num_auctions == 0 {
            return Err((StatusCode::BAD_REQUEST, "invalid settings".to_string()));
        }

        let mut unique_remove_ids = Vec::new();
        for team_id in remove_team_ids {
            if unique_remove_ids.contains(&team_id) {
                continue;
            }
            if team_id == self.host {
                return Err((
                    StatusCode::BAD_REQUEST,
                    "host cannot be removed".to_string(),
                ));
            }
            if !self.teams.contains_key(&team_id) {
                return Err((
                    StatusCode::BAD_REQUEST,
                    format!("team {} not in draft", team_id),
                ));
            }
            unique_remove_ids.push(team_id);
        }

        let teams_after = self.teams.len().saturating_sub(unique_remove_ids.len()) as u32;
        if num_teams < teams_after {
            return Err((
                StatusCode::BAD_REQUEST,
                "num_teams less than remaining teams".to_string(),
            ));
        }

        let current_auctions_len = self.auctions.len() as u32;
        let mut new_auctions_data = Vec::new();
        let mut truncate_to = None;

        if num_auctions > current_auctions_len {
            let needed = num_auctions - current_auctions_len;
            let mut count_suitable = 0;
            for p in self.draft.pokemon.iter() {
                if p.stage == pokemon::PokemonStage::base && p.obtain_method.is_none()
                {
                    if count_suitable >= current_auctions_len {
                        new_auctions_data.push((p.clone(), count_suitable as i32));
                        if new_auctions_data.len() == needed as usize {
                            break;
                        }
                    }
                    count_suitable += 1;
                }
            }

            if new_auctions_data.len() < needed as usize {
                return Err((
                    StatusCode::BAD_REQUEST,
                    format!(
                        "Not enough suitable pokemon to increase auctions to {}",
                        num_auctions
                    ),
                ));
            }
        } else if num_auctions < current_auctions_len {
            truncate_to = Some(num_auctions);
        }

        // Update DB
        let new_ids = self
            .db_writer
            .update_draft_settings(
                num_teams,
                unique_remove_ids.clone(),
                new_auctions_data.clone(),
                truncate_to,
            )
            .await?;

        // Update state
        for team_id in unique_remove_ids {
            self.teams.remove(&team_id);
        }
        self.settings.num_teams = num_teams;
        self.settings.num_auctions = num_auctions;
        self.auctions.truncate(num_auctions as usize); // Remove excess auctions if any

        // Add new auctions if any
        for (id, (p, _)) in new_ids.into_iter().zip(new_auctions_data.into_iter()) {
            let auction = Auction::new(self.draft.draft_id, id, p);
            self.auctions.push(auction);
        }

        self.broadcast();
        Ok(DraftResponse::from(&*self))
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
            auction_length: value.settings.auction_length,
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
            created_at: value.draft.created_at,
        }
    }
}
