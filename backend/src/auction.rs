use std::{
    sync::Arc,
    collections::HashMap,
};

use axum::extract::ws::WebSocket;
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use tokio::sync::broadcast;
use nanoid::nanoid;

use crate::messages::ServerMessage;

#[derive(Debug)]
pub struct AuctionDraft{
    draft_id: String,
    host: String,
    players: HashMap<String, WebSocket>,
    spectators: HashMap<String, WebSocket>,
    state: DraftState,
    settings: DraftSettings,
    current_auction: u32,
    auctions: Vec<Auction>,
    broadcast: broadcast::Sender<ServerMessage>
}

#[derive(Clone, Debug, Serialize)]
pub struct Auction{
    pokemon_name: String,
    highest_bid: u32,
    highest_bidder: String,
}

#[derive(Clone, Debug, Serialize)]
pub enum DraftState {
    PENDING,
    SELECTING,
    BIDDING,
    PAUSED(u32),
    COMPLETED,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct DraftSettings {
    teams: u8,
    starting_money: u32,
    pokemon_ids: String,
}

impl AuctionDraft {
    fn new(draft_id: String, host: String, settings: DraftSettings) -> AuctionDraft{
        let (tx, _rx) = broadcast::channel(1_000);
        AuctionDraft {
            draft_id: draft_id,
            host: host,
            players: HashMap::<String, WebSocket>::new(),
            spectators: HashMap::<String, WebSocket>::new(),
            state: DraftState::PENDING,
            settings: settings,
            current_auction: 0,
            auctions: vec![],
            broadcast: tx,
        }
    }

    pub async fn build(host: String, settings: DraftSettings, pool: PgPool) -> Result<AuctionDraft, String> {
        for _ in 0..3 {
            let draft_id = nanoid!(12);
            let draft = sqlx::query_as!(
                AuctionDraft,
                r#"
                INSERT INTO auctions (id, )
                "#,
            )
            .fetch_one(pool)
            .await;

            if draft.is_ok() {
                
            }
        }

        Err("Couldn't create auction in db".to_string())
    }
}

