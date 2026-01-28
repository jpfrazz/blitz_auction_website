use chrono;
use dashmap::DashMap;
use sqlx::PgPool;
use std::sync::Arc;
use tokio::{sync::RwLock, time::Instant};

use crate::{draft::Draft, draft_runner::DraftRunner};

pub mod auction;
pub mod draft;
pub mod draft_runner;
pub mod handlers;
pub mod messages;
pub mod pokemon;
pub mod users;

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
    let draft_runner = Arc::new(DraftRunner::new(drafts.clone()));

    ServerState {
        db_pool,
        drafts,
        draft_runner,
    }
}

pub fn get_expiry_time_from_instant(instant: Instant) -> chrono::DateTime<chrono::Utc> {
    let time_remaining = instant - Instant::now();
    chrono::Utc::now() + time_remaining
}
