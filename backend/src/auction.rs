use petname::petname;
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use tokio::sync::broadcast;
use uuid::Uuid;

use crate::messages::ServerMessage;

#[derive(Clone, Debug, Serialize)]
pub enum AuctionState {
    PENDING,
    BIDDING
}

#[derive(Clone, Debug, Serialize)]
pub struct Auction {
    pokemon_id: u32,
    pokemon_name: String,
    highest_bid: u32,
    highest_bidder: String,
    auction_state: AuctionState,
}
