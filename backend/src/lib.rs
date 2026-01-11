use moka::future::Cache;
use sqlx::{Pool, Postgres};

use crate::auction::Auction;

pub mod auction;
pub mod handlers;
pub mod pokemon;

#[derive(Clone)]
pub struct ServerState {
    pub db_pool: Pool<Postgres>,
    pub auctions: Cache<String, Auction>,
}
