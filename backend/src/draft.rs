use petname::petname;
use rand::seq::SliceRandom;
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use std::sync::Arc;
use tokio::{
    sync::broadcast,
    time::{Duration, Instant},
};

use crate::{
    auction::Auction,
    draft_runner::DraftRunner,
    messages::ServerMessage,
    pokemon::{self, Pokemon},
    users::User,
};

#[derive(Clone, Debug)]
pub struct Draft {
    pub draft_id: String,
    pub host: User,
    pub draft_state: DraftState,
    settings: DraftSettings,
    pub current_auction: u32,
    pub pokemon: Vec<&'static Pokemon>,
    pub auctions: Vec<Auction>,
    pub teams: Vec<Team>,
    pub spectators: Vec<User>,
    pub tx: broadcast::Sender<ServerMessage>,
    pub db_pool: PgPool,
    draft_runner: Arc<DraftRunner>,
}

#[derive(Clone, Debug, Serialize)]
pub struct DraftResponse {
    draft_id: String,
    host: String,
    teams: Vec<Team>,
    draft_state: DraftState,
    completed_auctions: Vec<Auction>,
    current_auction: Option<Auction>,
    pokemon: Vec<&'static Pokemon>,
    patch_version: String,
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
        DraftResponse {
            draft_id: draft.draft_id,
            host: draft.host.get_user_id_string(),
            teams: draft.teams,
            draft_state: draft.draft_state,
            current_auction,
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

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
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
    excluded_pokemon: Vec<ExcludedPokemon>,
    patch_version: String,
    num_auctions: u32,
    auction_length: Duration,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct Team {
    pub user_id: String,
    budget_remaining: u32,
    auctions_won: Vec<String>,
}

impl Draft {
    fn new(
        draft_id: String,
        host: User,
        settings: DraftSettings,
        pokemon: Vec<&'static Pokemon>,
        pool: PgPool,
        draft_runner: Arc<DraftRunner>,
    ) -> Draft {
        let (tx, _rx) = broadcast::channel(1_000);
        Draft {
            draft_id: draft_id,
            host: host,
            db_pool: pool,
            teams: Vec::with_capacity(settings.num_teams as usize),
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
        settings: DraftSettings,
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
                "
                INSERT INTO drafts (draft_id, num_teams, starting_money, patch_version, {})
                VALUES ({}, {}, {}, {}, {})
                ",
                host_field,
                draft_id,
                settings.num_teams as i32,
                settings.starting_money as i32,
                settings.patch_version,
                host_id,
            );

            let Ok(_) = sqlx::query(&query_string).execute(&mut *tx).await else {
                tx.rollback().await.expect("failed to abort transaction");
                continue;
            };

            let mut draft = Draft::new(draft_id, host, settings, pokemon, pool, draft_runner);
            for (i, p) in draft.pokemon.iter().enumerate() {
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
        let completed_auction = &self.auctions[self.current_auction as usize];

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
        tx.commit().await.map_err(|e| e.to_string())?;

        self.current_auction += 1;
        self.tx
            .send(ServerMessage::AuctionResult {
                pokedex_id: completed_auction.pokemon.pokedex_id,
                form: completed_auction.pokemon.form.clone(),
                winning_bid: completed_auction.highest_bid,
                winner: completed_auction
                    .highest_bidder
                    .as_ref()
                    .expect("No one won this auction")
                    .get_user_id_string(),
            })
            .map_err(|e| e.to_string())?;

        if self.current_auction < self.settings.num_auctions {
            let expires_at = Instant::now() + self.settings.auction_length;
            let draft_runner = self.draft_runner.clone();
            draft_runner
                .register_draft(self, expires_at)
                .await
                .map_err(|e| e.to_string())?;
        }

        Ok(())
    }

    pub async fn join_draft(&mut self, user_id: String) -> Result<(), String> {
        if self.teams.len() >= self.settings.num_teams as usize {
            return Err("Draft is already full".to_string());
        }

        if self.teams.iter().map(|e| &e.user_id).any(|e| *e == user_id) {
            return Err("User is already in draft".to_string());
        }

        let team = Team {
            user_id: user_id,
            budget_remaining: self.settings.starting_money,
            auctions_won: vec![],
        };

        self.teams.push(team);
        Ok(())
    }

    pub async fn start_draft(&mut self) -> Result<(), String> {
        self.draft_state = DraftState::BIDDING;
        let draft_runner = self.draft_runner.clone();
        draft_runner
            .register_draft(self, Instant::now() + self.settings.auction_length)
            .await?;

        Ok(())
    }
}
