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

pub const DISCORD_GUILD_ID: u64 = 1436799517121843272;
pub const CSRF_STATE_KEY: &str = "oauth.csrf-state";
pub const DISCORD_AUTH_URL: &str = "https://discord.com/oauth2/authorize";
pub const DISCORD_TOKEN_URL: &str = "https://discord.com/api/oauth2/token";
pub const POKEMON_NATURES: [&str; 25] = [
    "Hardy", "Lonely", "Brave", "Adamant", "Naughty", "Bold", "Docile", "Relaxed", "Impish", "Lax",
    "Timid", "Hasty", "Serious", "Jolly", "Naive", "Modest", "Mild", "Quiet", "Bashful", "Rash",
    "Calm", "Gentle", "Sassy", "Careful", "Quirky",
];
