use petname::petname;
use rand::{rng, seq::SliceRandom};
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Postgres, Transaction};
use tokio::sync::broadcast;
use uuid::Uuid;

use crate::{auction::Auction, messages::ServerMessage, pokemon::{self, Pokemon}};

#[derive(Clone, Debug)]
pub struct Draft {
    pub draft_id: String,
    pub host: String,
    pub draft_state: DraftState,
    settings: DraftSettings,
    pub current_auction: u32,
    pokemon: Vec<&'static Pokemon>,
    pub auctions: Vec<Auction>,
    pub teams: Vec<String>,
    pub spectators: Vec<Uuid>,
    pub tx: broadcast::Sender<ServerMessage>,
    db_pool: PgPool,
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
            completed_auctions: draft.auctions.into_iter().take(draft.current_auction as usize).collect(),
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
    num_players: i32,
    starting_money: i32,
    excluded_pokemon: Vec<(i32, String)>,
    patch_version: String,
}

impl Draft {
    fn new(draft_id: String, host: String, settings: DraftSettings, pokemon: Vec<&Pokemon>, pool: PgPool) -> Draft {
        let (tx, _rx) = broadcast::channel(1_000);
        Draft {
            draft_id: draft_id,
            host: host,
            db_pool: pool,
            teams: vec![],
            spectators: vec![],
            draft_state: DraftState::PENDING,
            pokemon: pokemon,
            settings: settings,
            current_auction: 0,
            auctions: vec![],
            tx: tx,
        }
    }

    pub async fn build(
        host: String,
        mut settings: DraftSettings,
        pool: PgPool,
    ) -> Result<Draft, String> {
        for _ in 0..3 {
            let mut tx = pool.begin().await.unwrap();
            let Some(draft_id) = petname(2, "_") else {
                continue;
            };
            let Some(pokemon) = pokemon::get_pokemon_data(&settings.patch_version, &settings.excluded_pokemon) else {
                return Err(format!("requested patch_version does not exist: {}", settings.patch_version));
            };


            let Ok(_) = sqlx::query!(
                r#"
                INSERT INTO drafts (draft_id, num_teams, starting_money, patch_version)
                VALUES ($1, $2, $3, $4)
                "#,
                draft_id,
                settings.num_players,
                settings.starting_money,
                settings.patch_version,
            )
            .execute(&mut *tx)
            .await
            else {
                continue;
            };

            let draft = Draft::new(draft_id, host, settings, pokemon, pool);
            draft.add_auctions_to_db(&mut tx).await;

            tx.commit().await.unwrap();
            return Ok(draft);
        }
        Err("Couldn't create auction in db".to_string())
    }

    async fn create_auctions(&self, tx: &mut Transaction<'_, Postgres>) -> Result<(), String> {
        todo!()
    }

    async fn add_auctions_to_db(&self, tx: &mut Transaction<'_, Postgres>) {
        for (i, pokemon) in self.pokemon.iter().enumerate() {
            let _res = sqlx::query!(
                r#"
                INSERT INTO auctions (draft_id, pokedex_id, draft_order, patch_version, form)
                VALUES ($1, $2, $3, $4, $5)
                "#,
                self.draft_id,
                pokemon.pokedex_id as i32,
                i as i32,
                pokemon.patch_version,
                pokemon.form,
            )
            .execute(&mut **tx)
            .await
            .unwrap();
        }
    }

    pub async fn add_player_to_db(self, player_id: Uuid) {
        todo!("add player to db")
    }
}
