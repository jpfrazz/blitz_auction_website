use dashmap::DashMap;
use sqlx::PgPool;
use std::sync::Arc;
use tokio::sync::RwLock;

use crate::{auction_manager::DraftRunner, draft::Draft};

pub mod auction;
pub mod draft;
pub mod handlers;
mod messages;
mod pokemon;
mod draft_runner;
mod users;

#[derive(Clone)]
pub struct ServerState {
    pub db_pool: PgPool,
    pub drafts: Arc<DashMap<String, Arc<RwLock<Draft>>>>,
    pub draft_runner: Arc<DraftRunner>,
}

pub async fn init_server_state(connection_string: &String) -> ServerState {
    let db_pool = PgPool::connect(connection_string)
        .await
        .expect("could not connect to db");
    let drafts = Arc::new(DashMap::<String, Arc<RwLock<Draft>>>::new());
    let draft_runner = Arc::new(DraftRunner::new(db_pool.clone()));

    ServerState { db_pool, drafts, draft_runner }
}
