use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize)]
pub struct Auction {
    auction_id: String,
    host: String,
    state: AuctionState,
    settings: AuctionSettings,
}

#[derive(Clone, Debug, Serialize)]
enum AuctionState {
    PENDING,
    RUNNING,
    PAUSED,
    COMPLETED,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct AuctionSettings {
    teams: u8,
    starting_money: u32,
    total_pokemon: u16,
}

impl Auction {
    pub fn new(auction_id: String, host: String, settings: AuctionSettings) -> Auction {
        Auction {
            auction_id: auction_id,
            host: host,
            state: AuctionState::PENDING,
            settings: settings
        }
    }
}
