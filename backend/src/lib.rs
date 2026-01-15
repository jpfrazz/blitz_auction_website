use moka::future::Cache;
use sqlx::PgPool;

use crate::auction::{Draft};

mod auction;
pub mod handlers;
mod pokemon;
mod messages;

#[derive(Clone)]
pub struct ServerState {
    pub db_pool: PgPool,
    pub drafts: Cache<String, Draft>,
}
