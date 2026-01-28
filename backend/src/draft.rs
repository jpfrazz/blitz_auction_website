use petname::petname;
use rand::seq::SliceRandom;
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use std::sync::Arc;
use tokio::{
    sync::broadcast,
    time::{Duration, Instant},
};
use uuid::Uuid;

use crate::{
    auction::Auction,
    draft_runner::DraftRunner,
    messages::ServerMessage,
    pokemon::{self, Pokemon},
};

#[derive(Clone, Debug)]
pub struct Draft {
    pub draft_id: String,
    pub host: String,
    pub draft_state: DraftState,
    settings: DraftSettings,
    pub current_auction: u32,
    pub pokemon: Vec<&'static Pokemon>,
    pub auctions: Vec<Auction>,
    pub teams: Vec<String>,
    pub spectators: Vec<Uuid>,
    pub tx: broadcast::Sender<ServerMessage>,
    pub db_pool: PgPool,
    draft_runner: Arc<DraftRunner>,
}

#[derive(Clone, Debug, Serialize)]
pub struct DraftResponse {
    draft_id: String,
    host: String,
    teams: Vec<String>,
    draft_state: DraftState,
    completed_auctions: Vec<Auction>,
    pokemon: Vec<&'static Pokemon>,
    patch_version: String,
}

impl From<Draft> for DraftResponse {
    fn from(draft: Draft) -> DraftResponse {
        DraftResponse {
            draft_id: draft.draft_id,
            host: draft.host,
            teams: draft.teams,
            draft_state: draft.draft_state,
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

#[derive(Clone, Debug, Serialize, Deserialize)]
pub enum DraftState {
    PENDING,
    BIDDING(u32),
    PAUSED(u32),
    COMPLETED,
}

impl Default for DraftState {
    fn default() -> DraftState {
        DraftState::PENDING
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct DraftSettings {
    num_teams: u32,
    starting_money: u32,
    excluded_pokemon: Vec<(u32, Option<String>)>,
    patch_version: String,
    num_auctions: u32,
    auction_length: Duration,
}

impl Draft {
    fn new(
        draft_id: String,
        host: String,
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
        host: String,
        settings: DraftSettings,
        pool: PgPool,
        draft_runner: Arc<DraftRunner>,
    ) -> Result<Draft, String> {
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

            let Ok(_) = sqlx::query!(
                r#"
                INSERT INTO drafts (draft_id, num_teams, starting_money, patch_version)
                VALUES ($1, $2, $3, $4)
                "#,
                draft_id,
                settings.num_teams as i32,
                settings.starting_money as i32,
                settings.patch_version,
            )
            .execute(&mut *tx)
            .await
            else {
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
                    .expect("No one won this auction"),
            })
            .map_err(|e| e.to_string())?;

        if self.current_auction < self.settings.num_auctions {
            self.auctions[self.current_auction as usize].expires_at =
                Some(Instant::now() + self.settings.auction_length);
            self.draft_runner
                .register_draft(
                    self.draft_id.clone(),
                    self.auctions[self.current_auction as usize]
                        .expires_at
                        .expect("auction expiry not given"),
                )
                .await
                .map_err(|e| e.to_string())?;
        }

        Ok(())
    }

    pub async fn add_player(&mut self, player_id: Uuid) -> Result<(), String> {
        todo!("add player func")
    }
}
