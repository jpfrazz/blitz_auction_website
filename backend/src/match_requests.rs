//! Home-page race-finding posts.
//!
//! A signed-in user may keep one upcoming race request at a time. Posts join
//! the Blitz Updates feed in every viewer's timezone, and their owner can
//! delete them from that feed. A Postgres advisory lock keeps the one-upcoming
//! rule correct across reloads, tabs, and redeploys.

use axum::{
    Json,
    extract::{Path, Query, State},
    http::StatusCode,
};
use axum_login::AuthSession;
use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;

use crate::{
    AppError,
    server::ServerState,
    users::{AuthBackend, User},
};

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

    Ok(Json(MatchRequestsResponse {
        requests,
        current_user_id,
    }))
}

pub async fn create_match_request(
    State(state): State<ServerState>,
    auth_session: AuthSession<AuthBackend>,
    Json(payload): Json<CreateMatchRequest>,
) -> Result<StatusCode, AppError> {
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

    // Serialize the check-and-insert per user so two simultaneous posts can't
    // both create an upcoming request.
    let mut tx = state
        .db_pool
        .begin()
        .await
        .map_err(|error| (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;

    sqlx::query("SELECT pg_advisory_xact_lock(hashtext($1)::bigint)")
        .bind(&user_id)
        .execute(&mut *tx)
        .await
        .map_err(|error| (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;

    let has_upcoming: bool = sqlx::query_scalar(
        r#"
        SELECT EXISTS (
            SELECT 1
            FROM match_requests
            WHERE user_id = $1
              AND requested_at > now()
        )
        "#,
    )
    .bind(&user_id)
    .fetch_one(&mut *tx)
    .await
    .map_err(|error| (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;

    if has_upcoming {
        return Err((
            StatusCode::CONFLICT,
            "you already have an upcoming race request; delete it before posting another".to_string(),
        ));
    }

    sqlx::query(
        r#"
        INSERT INTO match_requests (user_id, user_name, mode, requested_at)
        VALUES ($1, $2, $3, $4)
        "#,
    )
    .bind(&user_id)
    .bind(&user_name)
    .bind(mode)
    .bind(payload.requested_at)
    .execute(&mut *tx)
    .await
    .map_err(|error| (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;

    tx.commit()
        .await
        .map_err(|error| (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;

    Ok(StatusCode::CREATED)
}

pub async fn delete_match_request(
    State(state): State<ServerState>,
    auth_session: AuthSession<AuthBackend>,
    Path(request_id): Path<i64>,
) -> Result<StatusCode, AppError> {
    let Some(user) = auth_session.user.as_ref() else {
        return Err((StatusCode::UNAUTHORIZED, "no user session".to_string()));
    };

    if matches!(user, User::GuestUser(_)) {
        return Err((
            StatusCode::FORBIDDEN,
            "log in with Discord to delete a race request".to_string(),
        ));
    }

    let user_id = user.get_user_id_string();
    let result = sqlx::query("DELETE FROM match_requests WHERE id = $1 AND user_id = $2")
        .bind(request_id)
        .bind(&user_id)
        .execute(&state.db_pool)
        .await
        .map_err(|error| (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;

    if result.rows_affected() == 0 {
        return Err((
            StatusCode::NOT_FOUND,
            "race request not found".to_string(),
        ));
    }

    Ok(StatusCode::NO_CONTENT)
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
