use axum::http::StatusCode;
use chrono::Utc;
use petname::petname;
use rand::seq::SliceRandom;
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use strum::Display;
use std::{collections::HashMap, sync::Arc};
use tokio::{
    sync::broadcast,
    time::{Duration, Instant},
};

use crate::{
    auction::{Auction, AuctionState},
    draft_runner::{self, DraftRunner},
    get_expiry_time_from_instant,
    messages::{ClientBidRequest, ClientBidResponse, ServerMessage},
    pokemon::{self, Pokemon, PokemonStage},
    users::User,
};

#[derive(Clone, Debug)]
pub struct Draft {
    pub draft_id: String,
    pub draft_name: String,
    pub host: User,
    pub draft_state: DraftState,
    pub settings: DraftSettings,
    pub current_auction: u32,
    pub pokemon: Vec<&'static Pokemon>,
    pub auctions: Vec<Auction>,
    pub teams: HashMap<String, Team>,
    pub spectators: Vec<User>,
    pub tx: broadcast::Sender<ServerMessage>,
    pub db_pool: PgPool,
    draft_runner: Arc<DraftRunner>,
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
    completed_auctions: Vec<Auction>,
    current_auction: Option<Auction>,
    current_auction_expires_at: Option<chrono::DateTime<Utc>>,
    pokemon: Vec<&'static Pokemon>,
    patch_version: String,
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

impl From<Draft> for DraftResponse {
    fn from(draft: Draft) -> DraftResponse {
        let current_auction = {
            match draft.draft_state {
                DraftState::BIDDING | DraftState::PAUSED(_) => {
                    Some(draft.auctions[draft.current_auction as usize].clone())
                }
                _ => None,
            }
        };

        let current_auction_expires_at = match current_auction {
            Some(ref auction) => match auction.expires_at {
                Some(expires_instant) => {
                    let expires_at = get_expiry_time_from_instant(expires_instant);
                    Some(expires_at)
                }
                None => None,
            },
            None => None,
        };

        DraftResponse {
            draft_id: draft.draft_id,
            draft_name: draft.draft_name,
            has_password: draft.settings.password.is_some(),
            host: draft.host.get_user_id_string(),
            ranked: draft.settings.ranked,
            total_teams: draft.settings.num_teams,
            total_auctions: draft.settings.num_auctions,
            teams: draft.teams.into_values().collect(),
            draft_state: draft.draft_state,
            current_auction,
            current_auction_expires_at,
            completed_auctions: draft
                .auctions
                .into_iter()
                .take(draft.current_auction as usize)
                .collect(),
            pokemon: draft.pokemon,
            patch_version: draft.settings.patch_version,
        }
    }
}

impl From<Draft> for DraftLobbyResponse {
    fn from(draft: Draft) -> DraftLobbyResponse {
        DraftLobbyResponse {
            draft_id: draft.draft_id,
            draft_name: draft.draft_name,
            has_password: draft.settings.password.is_some(),
            ranked: draft.settings.ranked,
            teams_joined: draft.teams.len() as u32,
            total_teams: draft.settings.num_teams,
            total_auctions: draft.settings.num_auctions,
            draft_state: draft.draft_state,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, Display)]
pub enum DraftState {
    PENDING,
    BIDDING,
    PAUSED(u32),
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
    patch_version: String,
    num_auctions: u32,
    pub auction_length: Duration,
}

#[derive(Clone, Debug, Serialize)]
pub struct Team {
    pub user_id: String,
    pub username: String,
    pub ready: bool,
    budget_remaining: u32,
    pub auctions_won: Vec<&'static Pokemon>,
}

impl Draft {
    fn new(
        draft_id: String,
        draft_name: String,
        host: User,
        settings: DraftSettings,
        pokemon: Vec<&'static Pokemon>,
        pool: PgPool,
        draft_runner: Arc<DraftRunner>,
    ) -> Draft {
        let (tx, _rx) = broadcast::channel(1_000);
        Draft {
            draft_id: draft_id,
            draft_name,
            host: host,
            db_pool: pool,
            teams: HashMap::new(),
            spectators: vec![],
            draft_state: DraftState::PENDING,
            pokemon,
            auctions: Vec::with_capacity(settings.num_auctions as usize),
            settings,
            current_auction: 0,
            tx,
            draft_runner,
        }
    }

    pub async fn build(
        host: User,
        mut settings: DraftSettings,
        pool: PgPool,
        draft_runner: Arc<DraftRunner>,
    ) -> Result<Draft, String> {
        let host_field = match host {
            User::DiscordUser(_) => "host_user_id",
            User::GuestUser(_) => "host_guest_id",
        };
        let host_id = host.get_user_id_string();
        for _ in 0..3 {
            let mut tx = pool.begin().await.map_err(|e| {
                let error_string = format!("failed to begin transaction: {}", e);
                // eprintln!("{}", &error_string);
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

            let Some(mut pokemon) =
                pokemon::get_pokemon_data(&settings.patch_version, &settings.excluded_pokemon)
            else {
                return Err(format!(
                    "requested patch_version does not exist: {}",
                    settings.patch_version
                ));
            };
            // always randomize order
            pokemon.shuffle(&mut rand::rng());

            let query_string = format!(
                r#"
                INSERT INTO drafts (draft_id, draft_name, password, num_teams, starting_money, patch_version, ranked, {})
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                "#,
                host_field,
            );

            let Ok(_) = sqlx::query(&query_string)
                .bind(&draft_id)
                .bind(&draft_name)
                .bind(&settings.password)
                .bind(settings.num_teams as i32)
                .bind(settings.starting_money as i32)
                .bind(&settings.patch_version)
                .bind(settings.ranked)
                .bind(&host_id)
                .execute(&mut *tx)
                .await
            else {
                tx.rollback().await.expect("failed to abort transaction");
                continue;
            };

            let mut draft = Draft::new(
                draft_id,
                draft_name,
                host,
                settings,
                pokemon,
                pool,
                draft_runner,
            );
            for (i, p) in draft.pokemon.iter().filter(|p| p.stage == PokemonStage::base && !p.is_baby).enumerate() {
                let auction = Auction::build(draft.draft_id.clone(), i as u32, p, &mut tx)
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

    pub async fn resolve_auction(&mut self) -> Result<(), String> {
        let completed_auction = &mut self.auctions[self.current_auction as usize];

        let mut tx = self.db_pool.begin().await.map_err(|e| e.to_string())?;

        let _res = sqlx::query!(
            r#"
            UPDATE drafts
            SET pokemon_drafted = pokemon_drafted + 1
            WHERE draft_id = $1
            "#,
            self.draft_id,
        )
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

        completed_auction
            .resolve(&mut tx)
            .await
            .map_err(|e| e.to_string())?;

        // change state to closed if all auctions are finished
        if self.current_auction + 1 >= self.settings.num_auctions {
            let _ = sqlx::query!(
                r#"
                UPDATE drafts
                SET status = 'COMPLETED'
                WHERE draft_id = $1
                "#,
                self.draft_id,
            )
            .execute(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;

            self.draft_state = DraftState::COMPLETED;
        }

        tx.commit().await.map_err(|e| e.to_string())?;

        self.current_auction += 1;
        let team: &mut Team = self.teams
            .get_mut(
                &completed_auction
                    .highest_bidder
                    .clone()
                    .expect("auction should have winner")
                    .get_user_id_string(),
            )
            .expect("auction winner should be on a team");

        team.auctions_won.push(completed_auction.pokemon);
        team.budget_remaining -= completed_auction.highest_bid;

        // update websocket
        // self.tx
        //     .send(ServerMessage::AuctionResult {
        //         pokedex_id: completed_auction.pokemon.pokedex_id,
        //         form: completed_auction.pokemon.form.clone(),
        //         winning_bid: completed_auction.highest_bid,
        //         winner: completed_auction
        //             .highest_bidder
        //             .as_ref()
        //             .expect("No one won this auction")
        //             .get_user_id_string(),
        //     })
        //     .map_err(|e| {
        //         eprintln!("failed sending result to channel");
        //         e.to_string()
        //     })?;

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
                    return Err("draft password required".to_string());
                };

                if password != *draft_password {
                    return Err("draft password is incorrect".to_string());
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

        self.teams.insert(user_id, team);
        Ok(())
    }

    pub async fn bid(
        &mut self,
        bid_request: &ClientBidRequest,
        user: &User,
    ) -> Result<ClientBidResponse, (StatusCode, String)> {
        let (user_field, auction_id, bid_value) = match self.validate_bid_request(bid_request, user)
        {
            Ok(res) => res,
            Err(e) => {
                eprintln!("Bid not valid: {}", e);
                return Ok(ClientBidResponse {
                    accepted: false,
                    error: Some(e),
                });
            }
        };
        let user_id = user.get_user_id_string();

        let mut tx = self.db_pool.begin().await.map_err(|e| {
            eprintln!("Error starting db transaction: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Couldn't process bid".to_string(),
            )
        })?;

        // update auction in db
        let query_string = &format!(
            "
            UPDATE auctions
            SET (winning_bid, {}, status) = ({}, '{}', '{}')
            WHERE auction_id = {}
            ",
            user_field,
            bid_value,
            user_id,
            AuctionState::OPEN.to_string(),
            auction_id
        );

        let _ = sqlx::query(query_string)
            .execute(&mut *tx)
            .await
            .map_err(|e| {
                eprintln!(
                    "failed writing to db: {}\nquery_string: {}",
                    e, query_string
                );
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "failed to write to db".to_string(),
                )
            })?;

        let user_field = match user {
            User::DiscordUser(_) => "user_id",
            User::GuestUser(_) => "guest_id",
        };

        // insert bid in db
        let query_string = &format!(
            "
            INSERT INTO bids (auction_id, {}, value, accepted, winning)
            VALUES ({}, '{}', {}, true, true)
            ",
            user_field, auction_id, user_id, bid_value
        );

        let _ = sqlx::query(query_string)
            .execute(&mut *tx)
            .await
            .map_err(|e| {
                eprintln!("failed writing to db: {}", e);
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "failed to write to db".to_string(),
                );
            })?;

        tx.commit().await.map_err(|e| {
            eprintln!("failed commiting transaction to db: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "failed to write to db".to_string(),
            )
        })?;

        // register draft if this is the first bid
        if self.auctions[self.current_auction as usize].status == AuctionState::PENDING {
            let draft_runner = self.draft_runner.clone();
            let expires_at = Instant::now() + self.settings.auction_length;
            draft_runner
                .register_draft(self, expires_at)
                .await
                .map_err(|e| {
                    eprintln!("failed to register draft: {}", e);
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        "failed to process bid".to_string(),
                    )
                })?;
        }

        // update auction in memory
        let (pokedex_id, form, winning_bid, winning_bidder, expires_at) = {
            let current_auction = self.current_auction as usize;
            let auction = &mut self.auctions[current_auction];
            auction.highest_bidder = Some(user.clone());
            auction.highest_bid = bid_request.value;
            auction.expires_at = Some(std::cmp::max(
                auction.expires_at.unwrap(),
                Instant::now() + Duration::from_secs(10),
            ));
            if auction.status == AuctionState::PENDING {
                auction.status = AuctionState::OPEN;
            }
            (
                auction.pokemon.pokedex_id,
                auction.pokemon.form.clone(),
                auction.highest_bid,
                user,
                crate::get_expiry_time_from_instant(auction.expires_at.unwrap()),
            )
        };

        // send update to ws
        // let _ = draft.tx.send(ServerMessage::AuctionUpdate {
        //     pokedex_id,
        //     form,
        //     winning_bid,
        //     winning_bidder: Some(winning_bidder.get_user_id_string()),
        //     expires_at,
        // });

        Ok(ClientBidResponse {
            accepted: true,
            error: None,
        })
    }

    fn validate_bid_request(
        &self,
        bid_request: &ClientBidRequest,
        user: &User,
    ) -> Result<(String, i64, i32), String> {
        if self.draft_state != DraftState::BIDDING {
            return Err("draft is not accepting bids".to_string());
        }

        let auction = &self.auctions[self.current_auction as usize];
        if auction.auction_id != bid_request.auction_id {
            return Err(format!("auction is not active"));
        }
        if auction.highest_bid >= bid_request.value {
            return Err(format!("bid is not higher than current highest bid"));
        }
        if bid_request.value % 100 != 0 {
            return Err(format!("bid must be multiple of 100"));
        }
        if auction.highest_bidder == Some(user.clone()) {
            return Err(format!("user is already the highest bidder"));
        }
        // check user has team in draft
        let Some(team) = self.teams.get(&user.get_user_id_string()) else {
            return Err(format!("user is not assigned to a team"));
        };

        if team.budget_remaining < bid_request.value {
            return Err(format!("user is too brokie"));
        }

        let user_field = match user {
            User::DiscordUser(_) => "winning_user_id",
            User::GuestUser(_) => "winning_guest_id",
        };

        let auction_id = bid_request
            .auction_id
            .parse::<i64>()
            .expect(format!("auction id should be i64, is {}", bid_request.auction_id).as_str());

        let bid_value = bid_request.value as i32;

        Ok((user_field.to_string(), auction_id, bid_value))
    }

    pub async fn start_draft(&mut self) -> Result<(), String> {
        if self.teams.len() < self.settings.num_teams as usize {
            return Err("all teams must join before the draft can start".to_string());
        }

        if self.teams.values().any(|team| !team.ready) {
            return Err("all teams must ready up before the draft can start".to_string());
        }

        let _ = sqlx::query!(
            r#"
            UPDATE drafts
            SET status = $1
            WHERE draft_id = $2
            "#,
            DraftState::BIDDING.to_string(),
            self.draft_id
        )
        .execute(&self.db_pool)
        .await
        .map_err(|e| {
            e.to_string()
        })?;

        self.draft_state = DraftState::BIDDING;
        Ok(())
    }

    pub fn all_teams_ready(&self) -> bool {
        self.teams.len() == self.settings.num_teams as usize
            && self.teams.values().all(|team| team.ready)
    }
}
