use std::{
    sync::Arc,
    collections::HashMap,
};

use axum::extract::ws::WebSocket;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize)]
pub struct AuctionDraft{
    draft_id: String,
    host: String,
    spectators: HashMap<String, WebSocket>,
    state: DraftState,
    settings: DraftSettings,
    current_auction: u32,
    auctions: Vec<Auction>
}

#[derive(Clone, Debug, Serialize)]
pub struct Auction{
    pokemon_name: String,
    highest_bid: u32,
    highest_bidder: String,
}

#[derive(Clone, Debug, Serialize)]
enum DraftState {
    PENDING,
    RUNNING,
    PAUSED,
    COMPLETED,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct DraftSettings {
    teams: u8,
    starting_money: u32,
    pokemon_ids: String,
}

impl AuctionDraft {
    pub fn new(draft_id: String, host: String, settings: DraftSettings) -> AuctionDraft {
        AuctionDraft {
            draft_id: draft_id,
            host: host,
            spectators: HashMap<String, WebSocket>,
            state: DraftState::PENDING,
            settings: settings,
            current_auction: 0,
            auctions: vec![],
        }
    }
}
