use axum_login::{AuthManagerLayer, tower_sessions::{MemoryStore, SessionManagerLayer}};
use chrono;
use dashmap::DashMap;
use oauth2::basic::BasicClient;
use sqlx::PgPool;
use tower_sessions::{Expiry, cookie::time::Duration};
use std::{sync::Arc};
use tokio::{sync::RwLock, time::Instant};

use crate::{draft::Draft, draft_runner::DraftRunner, users::AuthBackend};

pub mod auction;
pub mod draft;
pub mod draft_runner;
pub mod handlers;
pub mod messages;
pub mod pokemon;
pub mod users;
pub mod app;

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

pub fn init_auth_layer(pool: PgPool) {
    let session_store = MemoryStore::default();
    let session_layer = SessionManagerLayer::new(session_store)
        .with_expiry(Expiry::OnInactivity(Duration::hours(1)))
        .with_always_save(true);

    let backend = AuthBackend::new(pool, BasicClient::new());

}

pub fn get_expiry_time_from_instant(instant: Instant) -> chrono::DateTime<chrono::Utc> {
    let time_remaining = instant - Instant::now();
    chrono::Utc::now() + time_remaining
}
