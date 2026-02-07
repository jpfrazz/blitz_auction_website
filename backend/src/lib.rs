use axum_login::tower_sessions::{MemoryStore, SessionManagerLayer};
use chrono;
use sqlx::PgPool;
use tokio::time::Instant;
use tower_sessions::{Expiry, cookie::time::Duration};

use crate::{draft::Draft, draft_runner::DraftRunner};

pub mod auction;
pub mod draft;
pub mod draft_runner;
pub mod handlers;
pub mod messages;
pub mod pokemon;
pub mod server;
pub mod users;

pub fn init_auth_layer(pool: PgPool) {
    let session_store = MemoryStore::default();
    let session_layer = SessionManagerLayer::new(session_store)
        .with_expiry(Expiry::OnInactivity(Duration::hours(1)))
        .with_always_save(true);

    // let backend = AuthBackend::new(pool, BasicClient::new());
}

pub fn get_expiry_time_from_instant(instant: Instant) -> chrono::DateTime<chrono::Utc> {
    let time_remaining = instant - Instant::now();
    chrono::Utc::now() + time_remaining
}
