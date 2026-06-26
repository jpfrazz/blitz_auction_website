use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::{auction, draft, users::User};

/// Parsed save data sent by a player's emulator and stored in the teams table.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SaveIvs {
    pub hp: u8,
    pub atk: u8,
    pub def: u8,
    pub spa: u8,
    pub spd: u8,
    pub spe: u8,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SavePokemon {
    pub personality: u32,
    pub nickname: String,
    pub level: u8,
    pub hp: u16,
    pub max_hp: u16,
    pub species_id: u16,
    pub nature: String,
    pub ivs: SaveIvs,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SaveBoxPokemon {
    pub personality: u32,
    pub nickname: String,
    pub species_id: u16,
    pub nature: String,
    pub ivs: SaveIvs,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SaveData {
    pub trainer_name: String,
    pub money: u32,
    pub badge_count: u16,
    pub party: Vec<SavePokemon>,
    #[serde(default)]
    pub r#box: Vec<SaveBoxPokemon>,
}

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
    SaveUpdate {
        user_id: String,
        save_data: SaveData,
    },
    StateLoadNotification {
        user_id: String,
        display_name: String,
    },
    EeveelutionClaimed {
        user_name: String,
        eeveelution_name: String,
    },
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
