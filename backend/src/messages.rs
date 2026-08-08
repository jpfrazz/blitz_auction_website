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
    /// Personalities of Pokemon that have been seen fainted. Persisted with each
    /// save so boxed fainted Pokemon keep their grayed-out look after a reload.
    #[serde(default)]
    pub fainted_pids: Vec<u32>,
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
/// the parsed save data plus the Hall of Fame team on the first save that
/// carries a "Beat Steven" (804) or "Beat Wally" (656) trainer-card win.
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
        // Gym Leader Rematches (Versions 2 - 5)
        770 => "Roxanne 2",
        771 => "Roxanne 3",
        772 => "Roxanne 4",
        773 => "Roxanne 5",
        774 => "Brawly 2",
        775 => "Brawly 3",
        776 => "Brawly 4",
        777 => "Brawly 5",
        778 => "Wattson 2",
        779 => "Wattson 3",
        780 => "Wattson 4",
        781 => "Wattson 5",
        782 => "Flannery 2",
        783 => "Flannery 3",
        784 => "Flannery 4",
        785 => "Flannery 5",
        786 => "Norman 2",
        787 => "Norman 3",
        788 => "Norman 4",
        789 => "Norman 5",
        790 => "Winona 2",
        791 => "Winona 3",
        792 => "Winona 4",
        793 => "Winona 5",
        794 => "Tate & Liza 2",
        795 => "Tate & Liza 3",
        796 => "Tate & Liza 4",
        797 => "Tate & Liza 5",
        798 => "Juan & Wallace 2",
        799 => "Juan & Wallace 3",
        800 => "Juan & Wallace 4",
        801 => "Juan & Wallace 5",
        // Gym Leader Rematches (Versions 6 - 8)
        812 => "Roxanne 6",
        813 => "Roxanne 7",
        814 => "Roxanne 8",
        815 => "Brawly 6",
        816 => "Brawly 7",
        817 => "Brawly 8",
        818 => "Wattson 6",
        819 => "Wattson 7",
        820 => "Wattson 8",
        821 => "Flannery 6",
        822 => "Flannery 7",
        823 => "Flannery 8",
        824 => "Norman 6",
        825 => "Norman 7",
        826 => "Norman 8",
        827 => "Winona 6",
        828 => "Winona 7",
        829 => "Winona 8",
        830 => "Tate & Liza 6",
        831 => "Tate & Liza 7",
        832 => "Tate & Liza 8",
        833 => "Juan & Wallace 6",
        834 => "Juan & Wallace 7",
        835 => "Juan & Wallace 8",
        856 => "Viola 2",
        857 => "Viola 3",
        858 => "Viola 4",
        859 => "Viola 5",
        860 => "Viola 6",
        861 => "Viola 7",
        862 => "Viola 8",
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
