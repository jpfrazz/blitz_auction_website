use crate::auction::DraftState;

#[derive(Clone, Debug)]
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
