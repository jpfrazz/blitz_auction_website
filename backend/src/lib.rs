use axum::http::StatusCode;
use axum_login::tower_sessions::{MemoryStore, SessionManagerLayer};
use censor::*;
use chrono;
use sqlx::PgPool;
use tokio::time::Instant;
use tower_sessions::{Expiry, cookie::time::Duration};

use crate::draft::Draft;

pub mod achievements;
pub mod auction;
pub mod db_writer;
pub mod draft;
pub mod handlers;
pub mod messages;
pub mod metrics;
pub mod pokemon;
pub mod pokemon_data_updater;
pub mod server;
pub mod stats;
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

/// Returns true if any whitespace-delimited word in the text is a banned word.
///
/// Matching is whole-word: fragments of a longer word (for example the "s" in
/// "Flareon's" followed by "ex" in "Exclusive") are not treated as profanity.
/// Punctuation inside a word is ignored (`f!u!c!k`), repeated letters are
/// collapsed (`fuuuuck`), and censor's character aliases are applied (`s3x`).
pub fn contains_profanity(text: &str) -> bool {
    // Combine Standard and Sex sets, add specific slurs, and remove "ass" and "shit".
    // Removing "ass" prevents "grass" from being flagged even with whole-word matching.
    let filter = Standard + Sex + "nigga" - "ass" - "shit" - "twat";

    text.to_lowercase().split_whitespace().any(|word| {
        let mut normalized = String::with_capacity(word.len());
        let mut previous: Option<char> = None;
        for c in word.chars() {
            if !c.is_alphanumeric() {
                continue;
            }
            if previous != Some(c) {
                normalized.push(c);
            }
            previous = Some(c);
        }
        filter.contains(&normalized)
    })
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

pub type AppError = (StatusCode, String);
