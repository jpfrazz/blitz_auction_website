//! Home-page match-finding posts.
//!
//! A signed-in user picks a mode and a time up to 48 hours ahead, and the post
//! joins the Blitz Updates feed in every viewer's timezone. The 20-minute
//! cooldown is enforced in Postgres so it still applies across reloads, tabs,
//! and redeploys.

use axum::{
    Json,
    extract::{Query, State},
    http::StatusCode,
};
use axum_login::AuthSession;
use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, Row};

use crate::{
    AppError,
    server::ServerState,
    users::{AuthBackend, User},
};

const COOLDOWN_MINUTES: i64 = 20;

#[derive(Clone, Debug, Serialize, FromRow)]
pub struct MatchRequest {
    pub id: i64,
    pub user_id: String,
    pub user_name: String,
    pub mode: String,
    pub requested_at: DateTime<Utc>,
    pub created_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Serialize)]
pub struct MatchRequestsResponse {
    pub requests: Vec<MatchRequest>,
    pub current_user_id: String,
    pub next_allowed_at: Option<DateTime<Utc>>,
}

#[derive(Clone, Debug, Serialize)]
pub struct CreateMatchRequestResponse {
    pub next_allowed_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct MatchRequestsQuery {
    #[serde(default = "default_limit")]
    pub limit: i64,
}

fn default_limit() -> i64 {
    20
}

#[derive(Debug, Deserialize)]
pub struct CreateMatchRequest {
    pub mode: String,
    pub requested_at: DateTime<Utc>,
}

fn normalize_mode(mode: &str) -> Option<&'static str> {
    match mode.trim().to_lowercase().as_str() {
        "1v1" => Some("1v1"),
        "booster" => Some("Booster"),
        "draft" => Some("Draft"),
        _ => None,
    }
}

fn validate_requested_at(
    requested_at: DateTime<Utc>,
    now: DateTime<Utc>,
) -> Result<(), AppError> {
    if requested_at < now {
        return Err((
            StatusCode::BAD_REQUEST,
            "choose a time now or in the future".to_string(),
        ));
    }
    if requested_at > now + Duration::hours(48) {
        return Err((
            StatusCode::BAD_REQUEST,
            "choose a time within the next 48 hours".to_string(),
        ));
    }
    Ok(())
}

pub async fn list_match_requests(
    State(state): State<ServerState>,
    auth_session: AuthSession<AuthBackend>,
    Query(query): Query<MatchRequestsQuery>,
) -> Result<Json<MatchRequestsResponse>, AppError> {
    let limit = query.limit.clamp(1, 50);
    let requests = sqlx::query_as::<_, MatchRequest>(
        r#"
        SELECT id, user_id, user_name, mode, requested_at, created_at
        FROM match_requests
        ORDER BY created_at DESC, id DESC
        LIMIT $1
        "#,
    )
    .bind(limit)
    .fetch_all(&state.db_pool)
    .await
    .map_err(|error| (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;

    let current_user_id = auth_session
        .user
        .as_ref()
        .map(User::get_user_id_string)
        .unwrap_or_default();

    let next_allowed_at = if current_user_id.is_empty() {
        None
    } else {
        sqlx::query(
            r#"
            SELECT created_at + interval '20 minutes' AS next_allowed_at
            FROM match_requests
            WHERE user_id = $1
            ORDER BY created_at DESC, id DESC
            LIMIT 1
            "#,
        )
        .bind(&current_user_id)
        .fetch_optional(&state.db_pool)
        .await
        .map_err(|error| (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?
        .map(|row| row.get::<DateTime<Utc>, _>("next_allowed_at"))
    };

    Ok(Json(MatchRequestsResponse {
        requests,
        current_user_id,
        next_allowed_at,
    }))
}

pub async fn create_match_request(
    State(state): State<ServerState>,
    auth_session: AuthSession<AuthBackend>,
    Json(payload): Json<CreateMatchRequest>,
) -> Result<(StatusCode, Json<CreateMatchRequestResponse>), AppError> {
    let Some(user) = auth_session.user.as_ref() else {
        return Err((StatusCode::UNAUTHORIZED, "no user session".to_string()));
    };

    if matches!(user, User::GuestUser(_)) {
        return Err((
            StatusCode::FORBIDDEN,
            "log in with Discord to post a race request".to_string(),
        ));
    }

    let Some(mode) = normalize_mode(&payload.mode) else {
        return Err((
            StatusCode::BAD_REQUEST,
            "mode must be 1v1, Booster, or Draft".to_string(),
        ));
    };

    validate_requested_at(payload.requested_at, Utc::now())?;

    let user_id = user.get_user_id_string();
    let user_name = user.get_user_name_string();
    let row = sqlx::query(
        r#"
        INSERT INTO match_requests (user_id, user_name, mode, requested_at)
        SELECT $1, $2, $3, $4
        WHERE NOT EXISTS (
            SELECT 1
            FROM match_requests
            WHERE user_id = $1
              AND created_at > now() - interval '20 minutes'
        )
        RETURNING created_at
        "#,
    )
    .bind(&user_id)
    .bind(&user_name)
    .bind(mode)
    .bind(payload.requested_at)
    .fetch_optional(&state.db_pool)
    .await
    .map_err(|error| (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;

    let Some(row) = row else {
        return Err((
            StatusCode::TOO_MANY_REQUESTS,
            "you can post one race request every 20 minutes".to_string(),
        ));
    };

    let created_at = row.get::<DateTime<Utc>, _>("created_at");
    Ok((
        StatusCode::CREATED,
        Json(CreateMatchRequestResponse {
            next_allowed_at: created_at + Duration::minutes(COOLDOWN_MINUTES),
        }),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn now() -> DateTime<Utc> {
        "2026-11-27T00:00:00Z".parse().unwrap()
    }

    #[test]
    fn rejects_past_match_times() {
        let error = validate_requested_at(now() - Duration::seconds(1), now()).unwrap_err();
        assert_eq!(error.0, StatusCode::BAD_REQUEST);
        assert_eq!(error.1, "choose a time now or in the future");
    }

    #[test]
    fn rejects_match_times_more_than_48_hours_ahead() {
        let error = validate_requested_at(now() + Duration::hours(48) + Duration::minutes(1), now())
            .unwrap_err();
        assert_eq!(error.0, StatusCode::BAD_REQUEST);
        assert_eq!(error.1, "choose a time within the next 48 hours");
    }

    #[test]
    fn accepts_match_times_inside_the_window() {
        assert!(validate_requested_at(now(), now()).is_ok());
        assert!(validate_requested_at(now() + Duration::hours(48), now()).is_ok());
    }
}
