use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::auction::DraftState;

#[derive(Clone, Debug, Serialize)]
#[serde(tag = "type", content = "data")]
pub enum ServerMessage {
    AuctionStarted {
        pokemon_name: String,
        starting_bid: u32,
        ms_remaining: u64,
    },
    AuctionUpdate {
        pokemon_name: String,
        current_bid: u32,
        high_bidder: Option<String>,
        ms_remaining: u64,
    },
    AuctionResult {
        pokemon_name: String,
        winning_bid: u32,
        winner: String,
    },
    PlayerJoined(String),
    PlayerLeft(String),
    DraftStarted,
    DraftEnded,
    DraftState(DraftState),
}

#[derive(Clone, Debug, Deserialize)]
pub enum ClientMessage {
    CreateDraft {
        default_funds: u32,
        draft_name: String,
        excluded_pokemon: Vec<u32>,
        num_auctions: u32,
        num_teams: u8,
        password: Option<String>,
        ranked: bool,
        auction_length: u8,
    },
    JoinDraft {
        team_name: Option<String>,
    },
    Bid {
        value: u32,
    },
}

#[derive(Clone, Debug, Deserialize)]
pub struct ClientBidRequest {
    pub user_id: Uuid,
    pub auction_id: u32,
    pub value: u32,
}

#[derive(Clone, Debug, Serialize)]
pub struct ClientBidResponse {
    pub accepted: bool,
    #[serde(skip_serializing_if = "Options::is_none")]
    pub error: Option<String>,
}
