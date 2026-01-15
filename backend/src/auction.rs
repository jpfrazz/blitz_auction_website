use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use tokio::sync::broadcast;
use petname::petname;
use uuid::Uuid;

use crate::messages::ServerMessage;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Draft{
    pub draft_id: String,
    pub host: String,
    pub state: DraftState,
    settings: DraftSettings,
    pub current_auction: u32,

    #[serde(skip)]
    auctions: Vec<Auction>,
    #[serde(skip)]
    pub players: Vec<Uuid>,
    #[serde(skip)]
    spectators: Vec<Uuid>,
    #[serde(skip)]
    broadcast: Option<broadcast::Sender<ServerMessage>>,
    #[serde(skip)]
    db_pool: Option<PgPool>,
}

#[derive(Clone, Debug, Serialize)]
pub struct Auction{
    pokemon_name: String,
    highest_bid: u32,
    highest_bidder: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub enum DraftState {
    PENDING,
    SELECTING,
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
pub struct DraftSettings {
    num_players: i32,
    starting_money: i32,
    pokemon_ids: Vec<i32>,
    patch_version: String,
}

impl Draft {
    fn new(draft_id: String, host: String, settings: DraftSettings, pool: PgPool) -> Draft{
        let (tx, _rx) = broadcast::channel(1_000);
        Draft {
            draft_id: draft_id,
            host: host,
            db_pool: Some(pool),
            players: vec![],
            spectators: vec![],
            state: DraftState::PENDING,
            settings: settings,
            current_auction: 0,
            auctions: vec![],
            broadcast: Some(tx),
        }
    }

    pub async fn build(host: String, settings: DraftSettings, pool: PgPool) -> Result<Draft, String> {
        for _ in 0..3 {
            let Some(draft_id) = petname(2, "_") else { continue };

            let Ok(_) = sqlx::query!(
                r#"
                INSERT INTO drafts (draft_id, num_players, starting_money, patch_version)
                VALUES ($1, $2, $3, $4)
                "#,
                draft_id,
                settings.num_players,
                settings.starting_money,
                settings.patch_version,
            ).execute(&pool).await
            else {
                continue
            };

            let draft = Draft::new(draft_id, host, settings, pool);
            draft.add_auctions_to_db().await;
            return Ok(draft);
        }
        Err("Couldn't create auction in db".to_string())
    }

    async fn add_auctions_to_db(&self) {
        let mut tx = self.db_pool.as_ref().expect("Draft created without db_pool").begin().await.unwrap();
        for id in &self.settings.pokemon_ids {
            let _res = sqlx::query!(
                r#"
                INSERT INTO auctions (draft_id, pokemon_id)
                VALUES ($1, $2)
                "#,
                self.draft_id,
                id
            )
            .execute(&mut *tx)
            .await
            .unwrap();
        }
        tx.commit().await.unwrap();
    }

    pub async fn add_player_to_db(self, player_id: Uuid) {
        todo!()
    }
}
