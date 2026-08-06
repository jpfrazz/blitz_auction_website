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
    #[serde(default)]
    pub map_name: String,
    #[serde(default)]
    pub trainer_card_wins: Vec<TrainerCardWin>,
    #[serde(default)]
    pub most_recent_loss: Option<TrainerCardWin>,
    #[serde(default)]
    pub most_recent_loss_name: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TrainerCardWin {
    pub trainer_id: u16,
    pub hours: u16,
    pub minutes: u8,
    pub seconds: u8,
    pub is_loss: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<u8>,
}

/// A single Pokemon on a player's Hall of Fame team (the party saved at the
/// Lilycove Museum after beating the game). `name` is the display name and
/// `icon` is the exact MiniIcons file name (e.g. "mime-jr", "farfetch'd").
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct HallOfFamePokemon {
    pub name: String,
    pub icon: String,
}

/// Body of the `POST /api/drafts/{draft_id}/save` endpoint. The emulator sends
/// the parsed save data plus the Hall of Fame team on the first museum save.
#[derive(Clone, Debug, Deserialize)]
pub struct PostSaveRequest {
    #[serde(flatten)]
    pub save_data: SaveData,
    #[serde(default)]
    pub hall_of_fame_team: Option<Vec<HallOfFamePokemon>>,
}

/// Body of the `POST /api/drafts/{draft_id}/forfeit` endpoint. Records an
/// early concession as a loss against the chosen boss trainer without waiting
/// for the in-game wipe to finish.
#[derive(Clone, Debug, Deserialize)]
pub struct ForfeitRequest {
    pub trainer_id: u16,
    pub hours: u16,
    pub minutes: u8,
    pub seconds: u8,
}

/// Maps a boss trainer id to its display name (mirrors the frontend's
/// `TRAINER_ID_TO_NAME` so forfeits can set `most_recent_loss_name`).
pub fn get_trainer_name_by_id(trainer_id: u16) -> String {
    let name = match trainer_id {
        265 => "Roxanne",
        855 => "Viola",
        266 => "Brawly",
        267 => "Wattson",
        268 => "Flannery",
        269 => "Norman",
        270 => "Winona",
        271 => "Tate & Liza",
        272 => "Juan & Wallace",
        601 => "Maxie",
        34 => "Archie",
        261 => "Sidney",
        262 => "Phoebe",
        263 => "Glacia",
        264 => "Drake",
        806 => "Tucker",
        807 => "Spenser",
        810 => "Lucy",
        811 => "Brandon",
        804 => "Steven",
        656 => "Wally",
        _ => return format!("Trainer {}", trainer_id),
    };
    name.to_string()
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
    WipeNotification {
        username: String,
        trainer: String,
    },
    WinNotification {
        username: String,
        trainer: String,
    },
    EeveelutionClaimed {
        user_name: String,
        eeveelution_name: String,
        user_id: String,
        pokedex_id: u32,
        form: Option<String>,
    },
    EeveelutionUnclaimed {
        user_name: String,
        eeveelution_name: String,
        user_id: String,
        pokedex_id: u32,
        form: Option<String>,
    },
    ReadyToRace {
        user_id: String,
        user_name: String,
    },
    ReadyToRaceCancelled {
        user_id: String,
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
