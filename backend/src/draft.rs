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

use crate::{
    auction::{Auction, AuctionResponse},
    get_expiry_time_from_instant,
    messages::{ClientBidRequest, ServerMessage},
    pokemon::{self, Pokemon, PokemonStage},
    users::User,
};

#[derive(Debug)]
pub struct Draft {
    pub draft_id: String,
    pub draft_name: String,
    pub host: User,
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
    current_server_time: chrono::DateTime<Utc>,
}

#[derive(Clone, Debug, Serialize)]
pub struct DraftLobbyResponse {
    draft_id: String,
    draft_name: String,
    has_password: bool,
    ranked: bool,
    teams_joined: u32,
    total_teams: u32,
    total_auctions: u32,
    draft_state: DraftState,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, Display)]
enum DraftState {
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
    num_teams: u32,
    starting_money: u32,
    #[serde(default)]
    draft_name: String,
    #[serde(default)]
    ranked: bool,
    #[serde(default)]
    password: Option<String>,
    excluded_pokemon: Vec<ExcludedPokemon>,
    num_auctions: u32,
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
    fn new(
        draft_id: String,
        draft_name: String,
        host: User,
    ) -> Draft {
        Draft {
            draft_id: draft_id,
            draft_name,
            host: host,
        }
    }

    pub async fn build(
        host: User,
        mut settings: DraftSettings,
        pool: PgPool,
    ) -> Result<Draft, String> {
        
        let Some(mut pokemon) = pokemon::get_pokemon_data(&settings.excluded_pokemon) else {
            return Err(format!("error getting pokemon data",));
        };
        // always randomize order
        pokemon.shuffle(&mut rand::rng());
        for (i, p) in pokemon
            .iter()
            .filter(|p| p.stage == PokemonStage::base && p.obtain_method.as_deref() == Some(""))
            .enumerate() {
            
            let auction = Auction::build(h, draft_order, pokemon, tx)
        }

        let host_field = match host {
            User::DiscordUser(_) => "host_user_id",
            User::GuestUser(_) => "host_guest_id",
        };
        let host_id = host.get_user_id_string();
        for _ in 0..3 {
            let mut tx = pool.begin().await.map_err(|e| {
                let error_string = format!("failed to begin transaction: {}", e);
                error_string
            })?;

            let Some(draft_id) = petname(2, "_") else {
                continue;
            };
            let draft_name = if settings.draft_name.trim().is_empty() {
                draft_id.clone()
            } else {
                settings.draft_name.trim().to_string()
            };
            settings.password = settings.password.as_ref().and_then(|p| {
                let trimmed = p.trim();
                if trimmed.is_empty() {
                    None
                } else {
                    Some(trimmed.to_string())
                }
            });

            let Some(mut pokemon) = pokemon::get_pokemon_data(&settings.excluded_pokemon) else {
                return Err(format!("error getting pokemon data",));
            };
            // always randomize order
            pokemon.shuffle(&mut rand::rng());

            let query_string = format!(
                r#"
                INSERT INTO drafts (draft_id, draft_name, password, num_teams, starting_money, ranked, {})
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                "#,
                host_field,
            );

            let Ok(_) = sqlx::query(&query_string)
                .bind(&draft_id)
                .bind(&draft_name)
                .bind(&settings.password)
                .bind(settings.num_teams as i32)
                .bind(settings.starting_money as i32)
                .bind(settings.ranked)
                .bind(&host_id)
                .execute(&mut *tx)
                .await
            else {
                tx.rollback().await.expect("failed to abort transaction");
                continue;
            };

            let mut draft = Draft::new(draft_id, draft_name, host, pokemon);
            for (i, p) in draft
                .pokemon
                .iter()
                .filter(|p| p.stage == PokemonStage::base && p.obtain_method.as_deref() == Some(""))
                .enumerate()
            {
                let auction = Auction::build(draft.draft_id.clone(), i as u32, p.clone(), &mut tx)
                    .await
                    .map_err(|e| {
                        let error_str = format!("couldn't create auction: {}", e);
                        eprintln!("{}", error_str);
                        error_str
                    })?;
                draft.auctions.push(auction)
            }

            tx.commit().await.map_err(|e| {
                let error_string = format!("failed to commit transaction: {}", e);
                // eprintln!("{}", &error_string);
                error_string
            })?;

            return Ok(draft);
        }
        Err("Couldn't create auction in db".to_string())
    }

    pub async fn resolve_auction(&self, completed_auction: AuctionResponse) -> Result<(), String> {
        // let mut tx = self.db_pool.begin().await.map_err(|e| e.to_string())?;
        //
        // let _res = sqlx::query!(
        //     r#"
        //     UPDATE drafts
        //     SET pokemon_drafted = pokemon_drafted + 1
        //     WHERE draft_id = $1
        //     "#,
        //     self.draft_id,
        // )
        // .execute(&mut *tx)
        // .await
        // .map_err(|e| e.to_string())?;
        //
        // // change state to closed if all auctions are finished
        // if self.current_auction + 1 >= self.settings.num_auctions {
        //     let _ = sqlx::query!(
        //         r#"
        //         UPDATE drafts
        //         SET status = 'COMPLETED'
        //         WHERE draft_id = $1
        //         "#,
        //         self.draft_id,
        //     )
        //     .execute(&mut *tx)
        //     .await
        //     .map_err(|e| e.to_string())?;
        //
        //     self.draft_state = DraftState::COMPLETED;
        // }
        //
        // tx.commit().await.map_err(|e| e.to_string())?;

        self.current_auction += 1;
        let team: &mut Team = self
            .teams
            .get_mut(&completed_auction.highest_bidder.clone())
            .expect("auction winner should be on a team");

        team.auctions_won.push(completed_auction.pokemon.clone());
        team.budget_remaining -= completed_auction.highest_bid;

        // Broadcast full draft object to all websocket clients
        let draft_response = crate::draft::DraftResponse::from(self.clone());
        let _ = self
            .tx
            .send(crate::messages::ServerMessage::DraftUpdate(draft_response));

        Ok(())
    }

    pub async fn join_draft(&mut self, user: User, password: Option<String>) -> Result<(), String> {
        let user_id = user.get_user_id_string();
        if self.teams.len() >= self.settings.num_teams as usize {
            return Err("Draft is already full".to_string());
        }

        if self.teams.contains_key(&user_id) {
            return Err("User is already in draft".to_string());
        }

        let host_user_id = self.host.get_user_id_string();
        if user_id != host_user_id {
            if let Some(draft_password) = self.settings.password.as_ref() {
                let Some(password) = password
                    .as_ref()
                    .map(|p| p.trim().to_string())
                    .filter(|p| !p.is_empty())
                else {
                    return Err("Draft Password Required".to_string());
                };

                if password != *draft_password {
                    return Err("Draft Password is Incorrect".to_string());
                }
            }
        }

        let team = Team {
            user_id: user_id.clone(),
            username: user.get_user_name_string(),
            ready: user_id == host_user_id,
            budget_remaining: self.settings.starting_money,
            auctions_won: vec![],
        };

        match &user {
            User::DiscordUser(_) => {
                sqlx::query!(
                    r#"
                    INSERT INTO teams (user_id, draft_id, money_remaining)
                    VALUES ($1, $2, $3)
                    "#,
                    user_id,
                    self.draft_id,
                    self.settings.starting_money as i32,
                )
                .execute(&self.db_pool)
                .await
                .map_err(|e| format!("failed to persist team in db: {}", e))?;
            }
            User::GuestUser(_) => {
                sqlx::query!(
                    r#"
                    INSERT INTO teams (guest_id, draft_id, money_remaining)
                    VALUES ($1, $2, $3)
                    "#,
                    user_id,
                    self.draft_id,
                    self.settings.starting_money as i32,
                )
                .execute(&self.db_pool)
                .await
                .map_err(|e| format!("failed to persist team in db: {}", e))?;
            }
        }

        self.teams.insert(user_id, team);

        // Broadcast full draft object to all websocket clients
        let draft_response = crate::draft::DraftResponse::from(self.clone());
        let _ = self
            .tx
            .send(crate::messages::ServerMessage::DraftUpdate(draft_response));

        Ok(())
    }

    pub async fn bid(
        &mut self,
        bid_request: ClientBidRequest,
        user: &User,
    ) -> Result<(), (StatusCode, String)> {
        let (response_sender, response_receiver) = oneshot::channel();
        let cmd = DraftCommand::Bid {
            response_sender,
            bid_request,
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
        })??
        // let mut tx = self.db_pool.begin().await.map_err(|e| {
        //     eprintln!("Error starting db transaction: {}", e);
        //     (
        //         StatusCode::INTERNAL_SERVER_ERROR,
        //         "Couldn't process bid".to_string(),
        //     )
        // })?;
        //
        // // update auction in db
        // let query_string = &format!(
        //     "
        //     UPDATE auctions
        //     SET (winning_bid, {}, status) = ({}, '{}', '{}')
        //     WHERE auction_id = {}
        //     ",
        //     user_field,
        //     bid_value,
        //     user_id,
        //     AuctionState::OPEN.to_string(),
        //     auction_id
        // );
        //
        // let _ = sqlx::query(query_string)
        //     .execute(&mut *tx)
        //     .await
        //     .map_err(|e| {
        //         eprintln!(
        //             "failed writing to db: {}\nquery_string: {}",
        //             e, query_string
        //         );
        //         (
        //             StatusCode::INTERNAL_SERVER_ERROR,
        //             "failed to write to db".to_string(),
        //         )
        //     })?;
        //
        // let user_field = match user {
        //     User::DiscordUser(_) => "user_id",
        //     User::GuestUser(_) => "guest_id",
        // };
        //
        // // insert bid in db
        // let query_string = &format!(
        //     "
        //     INSERT INTO bids (auction_id, {}, value, accepted, winning)
        //     VALUES ({}, '{}', {}, true, true)
        //     ",
        //     user_field, auction_id, user_id, bid_value
        // );
        //
        // let _ = sqlx::query(query_string)
        //     .execute(&mut *tx)
        //     .await
        //     .map_err(|e| {
        //         eprintln!("failed writing to db: {}", e);
        //         return (
        //             StatusCode::INTERNAL_SERVER_ERROR,
        //             "failed to write to db".to_string(),
        //         );
        //     })?;
        //
        // tx.commit().await.map_err(|e| {
        //     eprintln!("failed commiting transaction to db: {}", e);
        //     (
        //         StatusCode::INTERNAL_SERVER_ERROR,
        //         "failed to write to db".to_string(),
        //     )
        // })?;
    }

    pub async fn start(&mut self, user_id: String) -> Result<(), (StatusCode, String)> {
        // let _ = sqlx::query!(
        //     r#"
        //     UPDATE drafts
        //     SET status = $1
        //     WHERE draft_id = $2
        //     "#,
        //     DraftState::BIDDING.to_string(),
        //     self.draft_id
        // )
        // .execute(&self.db_pool)
        // .await
        // .map_err(|e| e.to_string())?;

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
        })??
    }

    pub async fn pause(&mut self, user_id: String) -> Result<(), (StatusCode, String)> {
        // sqlx::query!(
        //     r#"
        //     UPDATE drafts
        //     SET status = $1
        //     WHERE draft_id = $2
        //     "#,
        //     "PAUSED",
        //     self.draft_id,
        // )
        // .execute(&self.db_pool)
        // .await
        // .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

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
        })??
    }

    pub async fn resume(&mut self, user_id: String) -> Result<(), (StatusCode, String)> {
        // sqlx::query!(
        //     r#"
        //     UPDATE drafts
        //     SET status = $1
        //     WHERE draft_id = $2
        //     "#,
        //     DraftState::BIDDING.to_string(),
        //     self.draft_id,
        // )
        // .execute(&self.db_pool)
        // .await
        // .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

        let (response_sender, response_receiver) = oneshot::channel();
        let cmd = DraftCommand::Resume {
            response_sender,
            user_id,
        };
        self.actor_sender.send(cmd).await.map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to wait for actor response, {}", e),
            )
        })?;

        Ok(())
    }

    pub async fn update_pending_settings(
        &mut self,
        num_teams: u32,
        num_auctions: u32,
        remove_team_ids: Vec<String>,
    ) -> Result<(), (StatusCode, String)> {
        if self.draft_state != DraftState::PENDING {
            return Err((
                StatusCode::PRECONDITION_FAILED,
                "draft must be in PENDING state".to_string(),
            ));
        }

        if num_teams == 0 {
            return Err((
                StatusCode::BAD_REQUEST,
                "num_teams must be greater than 0".to_string(),
            ));
        }

        if num_auctions == 0 {
            return Err((
                StatusCode::BAD_REQUEST,
                "num_auctions must be greater than 0".to_string(),
            ));
        }

        let host_user_id = self.host.get_user_id_string();
        let mut unique_remove_ids: Vec<String> = Vec::new();
        for team_id in remove_team_ids {
            if unique_remove_ids.contains(&team_id) {
                continue;
            }

            if team_id == host_user_id {
                return Err((
                    StatusCode::BAD_REQUEST,
                    "host cannot be removed from draft".to_string(),
                ));
            }

            if !self.teams.contains_key(&team_id) {
                return Err((
                    StatusCode::BAD_REQUEST,
                    format!("team {} is not in this draft", team_id),
                ));
            }

            unique_remove_ids.push(team_id);
        }

        let teams_after_removal = self.teams.len().saturating_sub(unique_remove_ids.len()) as u32;
        if num_teams < teams_after_removal {
            return Err((
                StatusCode::BAD_REQUEST,
                "num_teams cannot be less than teams remaining after removals".to_string(),
            ));
        }

        let max_auctions = self.auctions.len() as u32;
        if num_auctions > max_auctions {
            return Err((
                StatusCode::BAD_REQUEST,
                format!("num_auctions cannot exceed {} for this draft", max_auctions),
            ));
        }

        let mut tx = self.db_pool.begin().await.map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to begin transaction: {}", e),
            )
        })?;

        for team_id in &unique_remove_ids {
            let _ = sqlx::query!(
                r#"
                DELETE FROM teams
                WHERE draft_id = $1
                  AND (user_id = $2 OR guest_id = $2)
                "#,
                self.draft_id,
                team_id,
            )
            .execute(&mut *tx)
            .await
            .map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("failed to remove team {}: {}", team_id, e),
                )
            })?;
        }

        let _ = sqlx::query!(
            r#"
            UPDATE drafts
            SET num_teams = $1
            WHERE draft_id = $2
            "#,
            num_teams as i32,
            self.draft_id
        )
        .execute(&mut *tx)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to update draft settings: {}", e),
            )
        })?;

        tx.commit().await.map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to commit draft settings update: {}", e),
            )
        })?;

        for team_id in unique_remove_ids {
            self.teams.remove(&team_id);
        }

        self.settings.num_teams = num_teams;
        self.settings.num_auctions = num_auctions;

        let draft_response = crate::draft::DraftResponse::from(self.clone());
        let _ = self
            .tx
            .send(crate::messages::ServerMessage::DraftUpdate(draft_response));

        Ok(())
    }

    pub fn all_teams_ready(&self) -> bool {
        self.teams.len() == self.settings.num_teams as usize
            && self.teams.values().all(|team| team.ready)
    }
}

struct DraftActor {
    draft: Arc<Draft>,
    host: String,
    draft_state: DraftState,
    settings: DraftSettings,
    current_auction: usize,
    auctions: Vec<Auction>,
    teams: HashMap<String, Team>,
    spectators: Vec<User>,
    receiver: mpsc::Receiver<DraftCommand>,
}

enum DraftCommand {
    Start {
        response_sender: oneshot::Sender<Result<(), String>>,
        user_id: String,
    },
    Resume {
        response_sender: oneshot::Sender<Result<(), String>>,
        user_id: String,
    },
    Pause {
        response_sender: oneshot::Sender<Result<(), String>>,
        user_id: String,
    },
    Get(oneshot::Sender<Result<DraftResponse, String>>),
    Join {
        response_sender: oneshot::Sender<Result<(), String>>,
        user: User,
        password: Option<String>,
    },
    Kick {
        response_sender: oneshot::Sender<Result<(), String>>,
        user: User,
    },
    Bid {
        response_sender: oneshot::Sender<Result<(), String>>,
        bid_request: ClientBidRequest,
    },
    ResolveAuction {
        response_sender: oneshot::Sender<Result<(), String>>,
        completed_auction: AuctionResponse,
    },
}

impl DraftActor {
    pub async fn run(mut self) {
        loop {
            if let Some(cmd) = self.receiver.recv().await {
                match cmd {
                    DraftCommand::Bid {
                        response_sender,
                        bid_request,
                    } => {
                        let res = self.bid(bid_request).await;
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
                    }
                    DraftCommand::Get(response_sender) => {
                        let _ = response_sender.send(Ok(DraftResponse::from(&self)));
                    }
                    DraftCommand::ResolveAuction {
                        response_sender,
                        completed_auction,
                    } => {
                        let res = self.resolve_auction(completed_auction).await;
                        let _ = response_sender.send(res);
                    }
                }
            }
        }
    }

    async fn bid(&self, bid_request: ClientBidRequest) -> Result<(), String> {
        let auction = &self.auctions[self.current_auction];
        if self.draft_state != DraftState::BIDDING {
            return Err("draft is not accepting bids".to_string());
        }
        if auction.auction_id != bid_request.auction_id {
            return Err(format!("auction is not active"));
        }
        if bid_request.value % 100 != 0 {
            return Err(format!("bid must be multiple of 100"));
        }
        let Some(team) = self.teams.get(&bid_request.user_id) else {
            return Err(format!("user is not assigned to a team"));
        };

        if team.budget_remaining < bid_request.value {
            return Err(format!("user is too brokie"));
        }

        auction.bid(bid_request).await?;
        todo!("add db write");

        Ok(())
    }

    async fn start(&mut self, user_id: String) -> Result<(), String> {
        if user_id != self.host {
            return Err(format!("user is not the host"));
        }
        if self.draft_state != DraftState::PENDING {
            return Err(format!("draft is not pending"));
        }
        if self.teams.len() < self.settings.num_teams as usize {
            return Err(format!(
                "only {} of {} teams have joined the draft",
                self.teams.len(),
                self.settings.num_teams
            ));
        }
        if self.teams.values().any(|t| !t.ready) {
            return Err(format!("all teams must ready up"));
        }

        let auction = &self.auctions[self.current_auction];
        auction
            .start(
                self.draft.clone(),
                self.settings.auction_length.as_secs() as u32,
            )
            .await?;

        todo!("self.db_handle.start()");

        self.draft_state = DraftState::BIDDING;

        Ok(())
    }

    async fn resume(&self, user_id: String) -> Result<(), String> {
        if user_id != self.host {
            return Err(format!("user is not the host"));
        }

        self.auctions[self.current_auction].resume().await?;

        todo!("self.db_actor.resume()");

        Ok(())
    }

    async fn pause(&self, user_id: String) -> Result<(), String> {
        if user_id != self.host {
            return Err(format!("user is not the host"));
        }

        self.auctions[self.current_auction].pause().await?;

        todo!("self.db_actor.pause()");

        Ok(())
    }

    async fn join(&mut self, user: User, password: Option<String>) -> Result<(), String> {
        let user_id = user.get_user_id_string();
        if self.teams.iter().any(|(u_id, _)| *u_id == user_id) {
            return Err(format!("user is already in this draft"));
        }
        if self.teams.len() >= self.settings.num_teams as usize {
            return Err("draft is already full".to_string());
        }

        if user_id != self.host {
            if let Some(draft_password) = self.settings.password.as_ref() {
                let Some(password) = password
                    .as_ref()
                    .map(|p| p.trim().to_string())
                    .filter(|p| !p.is_empty())
                else {
                    return Err("Draft Password Required".to_string());
                };

                if password != *draft_password {
                    return Err("Draft Password is Incorrect".to_string());
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

        todo!("self.db_actor.join()");

        Ok(())
    }

    async fn kick(&mut self, user: User) -> Result<(), String> {
        let user_id = user.get_user_id_string();
        if !self.teams.iter().any(|(u_id, _)| *u_id == user_id) {
            return Err(format!("user is not in this draft"));
        }
        if user_id == self.host {
            return Err(format!("cannot kick host"));
        }
        if self.draft_state != DraftState::PENDING {
            return Err(format!("cannot kick after draft starts"));
        }

        self.teams.remove(&user_id);

        todo!("self.db_actor.kick");

        Ok(())
    }

    async fn resolve_auction(&mut self, completed_auction: AuctionResponse) -> Result<(), String> {
        if self.draft_state != DraftState::BIDDING {
            return Err(format!("draft is not in the bidding state"));
        }
        let current_auction = &self.auctions[self.current_auction];
        if current_auction.auction_id != completed_auction.auction_id {
            return Err(format!(
                "comleted auction {}, different than current auction {}",
                completed_auction.auction_id, current_auction.auction_id
            ));
        }
        self.current_auction += 1;
        todo!("self.db_actor.resolve_auction(completed_auction)");

        Ok(())
    }
}

impl From<&DraftActor> for DraftResponse {
    fn from(value: &DraftActor) -> Self {
        DraftResponse {
            draft_id: value.draft.draft_id.clone(),
            draft_name: value.draft.draft_name.clone(),
            has_password: value.settings.password.is_some(),
            host: value.host.clone(),
            ranked: value.settings.ranked,
            total_teams: value.settings.num_teams,
            total_auctions: value.settings.num_auctions,
            teams: value.teams.values().cloned().collect(),
            draft_state: value.draft_state.clone(),
            current_auction: value.current_auction,
            current_server_time: Utc::now(),
        }
    }
}
