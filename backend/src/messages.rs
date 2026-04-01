use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::{auction, draft, users::User};

#[derive(Clone, Debug, Serialize)]
#[serde(tag = "type", content = "data")]
pub enum ServerMessage {
    DraftUpdate(draft::DraftResponse),
    AuctionUpdate(auction::AuctionResponse),
    AuctionResult {
        pokedex_id: u32,
        form: Option<String>,
        winning_bid: u32,
        winner: String,
    },
    PlayerJoined(User),
    PlayerLeft(User),
    DraftStarted,
    DraftEnded,
    DraftState(draft::DraftState),
    NewMessage(ChatMessage),
}

#[derive(Clone, Debug, Deserialize)]
pub struct ClientBidRequest {
    pub auction_id: i64,
    pub value: u32,
}

#[derive(Clone, Debug, Serialize)]
pub struct ClientBidResponse {
    pub accepted: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct ChatMessage {
    pub chat_id: i64,
    pub draft_id: String,
    pub user_id: String,
    pub user_name: String,
    pub message: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Serialize)]
pub struct ClientJoinResponse {
    pub joined: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}
