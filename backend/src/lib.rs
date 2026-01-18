use dashmap::DashMap;
use sqlx::PgPool;
use std::sync::Arc;

use crate::auction::Draft;

pub mod auction;
pub mod draft;
pub mod handlers;
mod messages;
mod pokemon;

#[derive(Clone)]
pub struct ServerState {
    pub db_pool: PgPool,
    pub drafts: Arc<DashMap<String, Draft>>,
}

pub async fn init_server_state(connection_string: &String) -> ServerState {
    let db_pool = PgPool::connect(connection_string)
        .await
        .expect("could not connect to db");
    let drafts = Arc::new(DashMap::<String, Draft>::new());

    ServerState { db_pool, drafts }
}
