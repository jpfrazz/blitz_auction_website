use axum::{extract::State, Json};
use serde::Serialize;
use sqlx::FromRow;

use crate::{server::ServerState, AppError};

#[derive(Serialize)]
pub struct StatsPageResponse {
    pub players: Vec<StatsPlayer>,
    pub teams: Vec<StatsTeam>,
    pub auctions: Vec<StatsAuction>,
}

#[derive(Serialize, FromRow)]
pub struct StatsPlayer {
    pub user_id: String,
    pub user_name: String,
}

#[derive(Serialize, FromRow)]
pub struct StatsTeam {
    pub user_id: Option<String>,
    pub guest_id: Option<String>,
    pub draft_id: uuid::Uuid,
    pub placement: Option<i32>,
}

#[derive(Serialize, FromRow)]
pub struct StatsAuction {
    pub auction_id: i64,
    pub draft_id: uuid::Uuid,
    pub pokedex_id: i32,
    pub name: String,
    pub form: Option<String>,
    pub winning_bid: Option<i32>,
    pub winning_user_id: Option<String>,
    pub winning_guest_id: Option<String>,
    pub created_at: Option<chrono::DateTime<chrono::Utc>>,
}

pub async fn get_stats_page_data(
    State(state): State<ServerState>,
) -> Result<Json<StatsPageResponse>, AppError> {
    // Combine registered users and guests into a single player list
    let players = sqlx::query_as::<_, StatsPlayer>(
        "SELECT user_id, user_name FROM users UNION SELECT user_id, user_name FROM guests"
    )
    .fetch_all(&state.db_pool)
    .await
    .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let teams = sqlx::query_as::<_, StatsTeam>(
        "SELECT user_id, guest_id, draft_id, placement FROM teams"
    )
    .fetch_all(&state.db_pool)
    .await
    .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let auctions = sqlx::query_as::<_, StatsAuction>(
        r#"
        SELECT 
            auction_id, 
            draft_id, 
            a.pokedex_id, 
            p.name,
            a.form, 
            winning_bid, 
            winning_user_id, 
            winning_guest_id, 
            created_at 
        FROM auctions AS a
        JOIN pokemon AS p ON a.pokedex_id = p.pokedex_id AND COALESCE(a.form, '') = p.form
        WHERE winning_bid IS NOT NULL
        "#
    )
    .fetch_all(&state.db_pool)
    .await
    .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(StatsPageResponse {
        players,
        teams,
        auctions,
    }))
}