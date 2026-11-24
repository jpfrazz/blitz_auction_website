use axum::{Json, extract::Path, extract::State, http::StatusCode};
use axum_login::AuthSession;
use serde::{Deserialize, Serialize};

use crate::{AppError, server::ServerState, users::AuthBackend};

/// Keep in sync with `frontend/src/pages/Stats/achievements.ts`.
const VALID_ACHIEVEMENT_IDS: &[&str] = &[
    "early-bird",
    "grand-prix-racer",
    "250-club",
    "100-club",
    "25-club",
    "10-club",
    "true-love",
    "blitz-legend",
    "blitz-champion",
    "blitz-hero",
    "back-to-back",
    "impressive-host",
    "winner",
    "moneyballer",
    "worth-every-penny",
    "impatient",
    "sub-100-club",
    "sub-90-club",
    "sub-80-club",
    "sub-70-club",
    "sub-hour-club",
    "stingy",
    "speed-freak",
    "easy-as-pie",
    "who-are-you",
    "the-chosen-one",
    "type-loyalist",
    "pokemon-professor",
    "old-head",
    "clutch-master",
    "untiltable",
    "deathless",
    "hard-carried",
    "schoolin-on-em",
    "old-faithful",
    "artisan",
    "criminal",
    "good-as-new",
    "rainbow-warrior",
    "appliance-master",
    "doctors-worst-nightmare",
    "natural-born-gambler",
    "big-year",
    "night-owl",
    "elite-mind",
    "seen-it-all",
    "stream-legend",
    "close-combatant",
    "rps-champion",
    "infinite-wisdom",
    "traitor",
    "around-the-world",
    "true-nuzlocker",
    "against-all-odds",
];

#[derive(Clone, Debug, Serialize, sqlx::FromRow)]
pub struct ManualAchievementOverride {
    pub achievement_id: String,
    pub earned: bool,
}

#[derive(Clone, Debug, Deserialize)]
pub struct ManualAchievementUpdate {
    pub achievement_id: String,
    pub earned: bool,
}

pub async fn get_manual_achievements(
    State(state): State<ServerState>,
    Path(user_id): Path<String>,
) -> Result<Json<Vec<ManualAchievementOverride>>, AppError> {
    let rows = sqlx::query_as::<_, ManualAchievementOverride>(
        "SELECT achievement_id, earned FROM manual_achievements WHERE user_id = $1",
    )
    .bind(&user_id)
    .fetch_all(&state.db_pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(rows))
}

pub async fn set_manual_achievement(
    State(state): State<ServerState>,
    Path(user_id): Path<String>,
    auth_session: AuthSession<AuthBackend>,
    Json(request): Json<ManualAchievementUpdate>,
) -> Result<(), AppError> {
    let user = auth_session
        .user
        .ok_or((StatusCode::UNAUTHORIZED, "user not authenticated".to_string()))?;
    if !user.is_site_admin() {
        return Err((
            StatusCode::FORBIDDEN,
            "only the site owner can edit achievements".to_string(),
        ));
    }

    if !VALID_ACHIEVEMENT_IDS.contains(&request.achievement_id.as_str()) {
        return Err((
            StatusCode::BAD_REQUEST,
            "unknown achievement id".to_string(),
        ));
    }

    let updated_by = user.get_user_id_string();
    sqlx::query(
        "INSERT INTO manual_achievements (user_id, achievement_id, earned, updated_by)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id, achievement_id) DO UPDATE
         SET earned = EXCLUDED.earned,
             updated_by = EXCLUDED.updated_by,
             updated_at = now()",
    )
    .bind(&user_id)
    .bind(&request.achievement_id)
    .bind(request.earned)
    .bind(&updated_by)
    .execute(&state.db_pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(())
}
