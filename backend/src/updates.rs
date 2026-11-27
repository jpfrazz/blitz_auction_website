//! Persistent home-page "Blitz Updates" feed.
//!
//! Everything here is backed by Postgres so the feed survives backend
//! restarts/redeploys (the in-memory draft cache does not). Events are written
//! either at the source of the change (draft finish, Hall of Fame) or by
//! diffing a reported snapshot against the last persisted one (achievements,
//! cost rankings). Upcoming match posts are merged into the same feed and
//! pinned above the chronological history until their requested time passes.

use std::collections::HashMap;

use axum::{
    Json,
    extract::{Query, State},
    http::StatusCode,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sqlx::{PgPool, Row};
use uuid::Uuid;

use crate::{AppError, server::ServerState};

#[derive(Clone, Debug, Serialize, sqlx::FromRow)]
pub struct BlitzUpdate {
    pub id: i64,
    pub event_type: String,
    pub subject_key: String,
    pub payload: Value,
    pub created_at: DateTime<Utc>,
}

/// Insert an event unless the same subject was already reported in the last 24
/// hours. Returns the inserted id, or `None` when deduplicated.
pub async fn record_update(
    pool: &PgPool,
    event_type: &str,
    subject_key: &str,
    payload: Value,
) -> Result<Option<i64>, sqlx::Error> {
    let row = sqlx::query(
        r#"
        INSERT INTO blitz_updates (event_type, subject_key, payload)
        SELECT $1, $2, $3
        WHERE NOT EXISTS (
            SELECT 1
            FROM blitz_updates
            WHERE subject_key = $2
              AND created_at > now() - interval '24 hours'
        )
        RETURNING id
        "#,
    )
    .bind(event_type)
    .bind(subject_key)
    .bind(&payload)
    .fetch_optional(pool)
    .await?;

    Ok(row.map(|row| row.get::<i64, _>("id")))
}

pub async fn resolve_user_name(pool: &PgPool, user_id: &str) -> Option<String> {
    let row = sqlx::query(
        r#"
        SELECT COALESCE(
            (SELECT user_name FROM users WHERE user_id = $1),
            (SELECT user_name FROM guests WHERE user_id = $2)
        ) AS user_name
        "#,
    )
    .bind(user_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await
    .ok()??;

    row.get::<Option<String>, _>("user_name")
}

/// Called from the draft actor when a draft transitions to COMPLETED.
pub async fn record_draft_finished(
    pool: &PgPool,
    draft_id: Uuid,
    draft_name: &str,
    draft_type: &str,
    user_id: &str,
    user_name: &str,
) {
    let payload = json!({
        "draft_id": draft_id.to_string(),
        "draft_name": draft_name,
        "draft_type": draft_type,
        "user_id": user_id,
        "user_name": user_name,
    });
    if let Err(error) = record_update(
        pool,
        "draft_finished",
        &format!("draft:{}", draft_id),
        payload,
    )
    .await
    {
        eprintln!("[blitz-updates] failed to record finished draft: {error}");
    }
}

/// Called when a team's Hall of Fame team is set for the first time, both from
/// the automatic save path and from the referee admin editor.
pub async fn record_hall_of_fame(pool: &PgPool, user_id: &str, draft_id: Uuid) {
    let user_name = resolve_user_name(pool, user_id)
        .await
        .unwrap_or_else(|| user_id.to_string());
    let payload = json!({
        "user_id": user_id,
        "user_name": user_name,
        "draft_id": draft_id.to_string(),
    });
    if let Err(error) = record_update(
        pool,
        "hall_of_fame",
        &format!("hof:{}:{}", draft_id, user_id),
        payload,
    )
    .await
    {
        eprintln!("[blitz-updates] failed to record Hall of Fame: {error}");
    }
}

#[derive(Debug, Deserialize)]
pub struct UpdatesQuery {
    #[serde(default = "default_update_limit")]
    pub limit: i64,
}

fn default_update_limit() -> i64 {
    30
}

pub async fn get_blitz_updates(
    State(state): State<ServerState>,
    Query(query): Query<UpdatesQuery>,
) -> Result<Json<Vec<BlitzUpdate>>, AppError> {
    let limit = query.limit.clamp(1, 100);
    // Match posts use negative ids so they can share the feed with persisted
    // events without colliding on React keys. `created_at` is replaced with the
    // requested match time so the client can fade posts once that time passes.
    let updates = sqlx::query_as::<_, BlitzUpdate>(
        r#"
        WITH feed AS (
            SELECT
                id,
                event_type,
                subject_key,
                payload,
                created_at,
                false AS is_upcoming_match,
                created_at AS sort_at
            FROM blitz_updates

            UNION ALL

            SELECT
                -id AS id,
                'match_request' AS event_type,
                'match:' || id AS subject_key,
                jsonb_build_object(
                    'id', id,
                    'user_id', user_id,
                    'user_name', user_name,
                    'mode', mode,
                    'requested_at', requested_at
                ) AS payload,
                requested_at AS created_at,
                requested_at > now() AS is_upcoming_match,
                requested_at AS sort_at
            FROM match_requests
        )
        SELECT id, event_type, subject_key, payload, created_at
        FROM feed
        ORDER BY
            is_upcoming_match DESC,
            CASE WHEN is_upcoming_match THEN sort_at END ASC,
            CASE WHEN is_upcoming_match THEN NULL ELSE sort_at END DESC,
            id DESC
        LIMIT $1
        "#,
    )
    .bind(limit)
    .fetch_all(&state.db_pool)
    .await
    .map_err(|error| (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;

    Ok(Json(updates))
}

#[derive(Clone, Debug, Deserialize)]
pub struct AchievementReport {
    pub id: String,
    pub name: String,
    pub icon: String,
    pub earned: bool,
}

#[derive(Debug, Deserialize)]
pub struct AchievementSnapshotRequest {
    pub user_id: String,
    pub user_name: Option<String>,
    pub achievements: Vec<AchievementReport>,
}

/// Diff a player's computed achievements against the last snapshot we saw.
/// The first report only stores a baseline so historical achievements don't
/// all appear as "earned" at once.
pub async fn report_achievements(
    State(state): State<ServerState>,
    Json(mut payload): Json<AchievementSnapshotRequest>,
) -> Result<(), AppError> {
    if payload.achievements.len() > 200 {
        return Err((StatusCode::BAD_REQUEST, "too many achievements".to_string()));
    }
    payload.achievements.retain(|achievement| {
        crate::achievements::VALID_ACHIEVEMENT_IDS.contains(&achievement.id.as_str())
    });

    let current_earned: Vec<String> = payload
        .achievements
        .iter()
        .filter(|achievement| achievement.earned)
        .map(|achievement| achievement.id.clone())
        .collect();

    let existing = sqlx::query("SELECT earned_ids FROM achievement_earned_snapshots WHERE user_id = $1")
        .bind(&payload.user_id)
        .fetch_optional(&state.db_pool)
        .await
        .map_err(|error| (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;

    let earned_value = serde_json::to_value(&current_earned)
        .map_err(|error| (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;

    match existing {
        None => {
            sqlx::query(
                r#"
                INSERT INTO achievement_earned_snapshots (user_id, earned_ids)
                VALUES ($1, $2)
                ON CONFLICT (user_id) DO UPDATE SET earned_ids = EXCLUDED.earned_ids, updated_at = now()
                "#,
            )
            .bind(&payload.user_id)
            .bind(&earned_value)
            .execute(&state.db_pool)
            .await
            .map_err(|error| (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
            return Ok(());
        }
        Some(row) => {
            let previous: Vec<String> = row
                .get::<Value, _>("earned_ids")
                .as_array()
                .map(|values| {
                    values
                        .iter()
                        .filter_map(|value| value.as_str().map(str::to_string))
                        .collect()
                })
                .unwrap_or_default();

            let user_name = match payload.user_name.clone() {
                Some(name) => name,
                None => resolve_user_name(&state.db_pool, &payload.user_id)
                    .await
                    .unwrap_or_else(|| payload.user_id.clone()),
            };

            let mut new_achievements: Vec<&AchievementReport> = payload
                .achievements
                .iter()
                .filter(|achievement| achievement.earned && !previous.contains(&achievement.id))
                .collect();
            // A player can cross several thresholds at once; keep the feed readable.
            new_achievements.truncate(5);

            for achievement in new_achievements {
                let event_payload = json!({
                    "user_id": payload.user_id,
                    "user_name": user_name,
                    "achievement_id": achievement.id,
                    "achievement_name": achievement.name,
                    "achievement_icon": achievement.icon,
                });
                if let Err(error) = record_update(
                    &state.db_pool,
                    "achievement",
                    &format!("achievement:{}:{}", payload.user_id, achievement.id),
                    event_payload,
                )
                .await
                {
                    eprintln!("[blitz-updates] failed to record achievement: {error}");
                }
            }

            sqlx::query(
                "UPDATE achievement_earned_snapshots SET earned_ids = $1, updated_at = now() WHERE user_id = $2",
            )
            .bind(&earned_value)
            .bind(&payload.user_id)
            .execute(&state.db_pool)
            .await
            .map_err(|error| (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
        }
    }

    Ok(())
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct RankingEntry {
    pub key: String,
    pub name: String,
    pub rank: i64,
    pub avg_price: i64,
}

#[derive(Debug, Deserialize)]
pub struct RankingSnapshotRequest {
    pub rankings: Vec<RankingEntry>,
}

/// Pick the Pokémon that drove the ranking changes and build its event.
///
/// The largest rank move wins, so a Pokémon jumping two slots outranks the two
/// Pokémon that each dropped one. When both sides of a flip moved one slot, the
/// larger average-price change identifies the driver.
fn build_ranking_move_event(
    current: &[RankingEntry],
    previous: &[RankingEntry],
) -> Option<(String, Value)> {
    let previous_by_key: HashMap<&str, &RankingEntry> = previous
        .iter()
        .map(|entry| (entry.key.as_str(), entry))
        .collect();

    let mut movers: Vec<(&RankingEntry, &RankingEntry, i64, i64)> = current
        .iter()
        .filter_map(|entry| {
            let old = previous_by_key.get(entry.key.as_str())?;
            let rank_delta = old.rank - entry.rank;
            (rank_delta != 0).then_some((
                entry,
                *old,
                rank_delta,
                entry.avg_price - old.avg_price,
            ))
        })
        .collect();

    movers.sort_by(|a, b| {
        b.2.abs()
            .cmp(&a.2.abs())
            .then_with(|| b.3.abs().cmp(&a.3.abs()))
    });

    let (entry, old, rank_delta, price_delta) = movers.first()?;
    Some((
        format!("ranking:{}", entry.key),
        json!({
            "key": entry.key,
            "name": entry.name,
            "from_rank": old.rank,
            "to_rank": entry.rank,
            "direction": if *rank_delta > 0 { "up" } else { "down" },
            "avg_price": entry.avg_price,
            "prev_avg_price": old.avg_price,
            "price_delta": price_delta,
        }),
    ))
}

/// Diff the current all-time cost rankings against the last persisted
/// snapshot and emit an event for the Pokémon that drove the change.
pub async fn report_rankings(
    State(state): State<ServerState>,
    Json(payload): Json<RankingSnapshotRequest>,
) -> Result<(), AppError> {
    if payload.rankings.len() > 1_000 {
        return Err((StatusCode::BAD_REQUEST, "too many rankings".to_string()));
    }
    if payload.rankings.is_empty() {
        return Ok(());
    }

    let latest = sqlx::query(
        "SELECT captured_at, rankings FROM cost_ranking_snapshots ORDER BY captured_at DESC, id DESC LIMIT 1",
    )
    .fetch_optional(&state.db_pool)
    .await
    .map_err(|error| (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;

    if let Some(row) = latest {
        let captured_at: DateTime<Utc> = row.get("captured_at");
        // Many visitors can report the same rankings; only diff once per window.
        if (Utc::now() - captured_at).num_minutes() < 10 {
            return Ok(());
        }

        let previous: Vec<RankingEntry> = serde_json::from_value(row.get::<Value, _>("rankings"))
            .unwrap_or_default();

        if let Some((subject_key, event_payload)) =
            build_ranking_move_event(&payload.rankings, &previous)
        {
            if let Err(error) = record_update(
                &state.db_pool,
                "ranking_move",
                &subject_key,
                event_payload,
            )
            .await
            {
                eprintln!("[blitz-updates] failed to record ranking move: {error}");
            }
        }
    }

    let rankings_value = serde_json::to_value(&payload.rankings)
        .map_err(|error| (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    sqlx::query("INSERT INTO cost_ranking_snapshots (rankings) VALUES ($1)")
        .bind(&rankings_value)
        .execute(&state.db_pool)
        .await
        .map_err(|error| (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(key: &str, rank: i64, avg_price: i64) -> RankingEntry {
        RankingEntry {
            key: key.to_string(),
            name: key.to_string(),
            rank,
            avg_price,
        }
    }

    #[test]
    fn a_two_slot_jump_outranks_single_slot_drops() {
        let previous = vec![entry("a", 1, 10_000), entry("b", 2, 9_000), entry("c", 3, 8_000)];
        let current = vec![entry("c", 1, 9_500), entry("b", 2, 9_000), entry("a", 3, 9_900)];

        let (subject, payload) = build_ranking_move_event(&current, &previous).unwrap();
        assert_eq!(subject, "ranking:c");
        assert_eq!(payload["from_rank"], 3);
        assert_eq!(payload["to_rank"], 1);
        assert_eq!(payload["direction"], "up");
    }

    #[test]
    fn a_one_slot_flip_picks_the_pokemon_whose_price_changed() {
        let previous = vec![entry("a", 1, 10_000), entry("b", 2, 9_000)];
        let current = vec![entry("b", 1, 9_500), entry("a", 2, 10_000)];

        let (subject, payload) = build_ranking_move_event(&current, &previous).unwrap();
        assert_eq!(subject, "ranking:b");
        assert_eq!(payload["direction"], "up");
    }

    #[test]
    fn unchanged_rankings_produce_no_event() {
        let rankings = vec![entry("a", 1, 10_000), entry("b", 2, 9_000)];
        assert!(build_ranking_move_event(&rankings, &rankings).is_none());
    }
}
