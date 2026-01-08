pub struct Auction {
    auction_id: String,
    host: String,
    state: AuctionState,
    settings: AuctionSettings,
}

enum AuctionState {
    PENDING,
    RUNNING,
    PAUSED,
    COMPLETED,
}

pub struct AuctionSettings {
    teams: u8,
    pokemon_data: Path
}
