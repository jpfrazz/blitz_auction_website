use axum::{Json, extract::State};
use serde::Serialize;
use sqlx::FromRow;
use std::collections::HashMap;

use crate::{AppError, server::ServerState};

#[derive(Serialize)]
pub struct StatsPageResponse {
    pub players: Vec<StatsPlayer>,
    pub teams: Vec<StatsTeam>,
    pub auctions: Vec<StatsAuction>,
    pub legacy: Vec<StatsLegacyPick>,
}

#[derive(Serialize, FromRow)]
pub struct StatsPlayer {
    pub user_id: String,
    pub user_name: String,
    pub global_name: Option<String>,
    pub avatar: Option<String>,
    pub is_guest: bool,
}

#[derive(Serialize, FromRow)]
pub struct StatsTeam {
    pub user_id: Option<String>,
    pub guest_id: Option<String>,
    pub draft_id: uuid::Uuid,
    pub draft_name: String,
    pub host: Option<String>,
    pub ranked: bool,
    pub draft_type: String,
    pub placement: Option<i32>,
    pub race_placement: Option<i32>,
}

#[derive(Serialize, FromRow)]
pub struct StatsAuction {
    pub auction_id: i64,
    pub draft_id: uuid::Uuid,
    pub pokedex_id: i32,
    pub draft_order: i32,
    pub name: String,
    pub form: Option<String>,
    pub winning_bid: Option<i32>,
    pub winning_user_id: Option<String>,
    pub winning_guest_id: Option<String>,
    pub draft_name: String,
    pub host: Option<String>,
    pub ranked: bool,
    pub draft_type: String,
    pub action: Option<String>,
    pub created_at: Option<chrono::DateTime<chrono::Utc>>,
}

#[derive(Serialize, FromRow)]
pub struct StatsLegacyPick {
    pub date: Option<chrono::NaiveDateTime>,
    pub pokemon: String,
    pub cost: String,
}

#[derive(Serialize)]
pub struct LeaderboardEntry {
    pub user_id: String,
    pub username: String,
    pub global_name: Option<String>,
    pub avatar: Option<String>,
    pub win: i32,
    pub loss: i32,
    pub mmr: i32,
    pub games_played: i32,
    pub most_drafted_pokemon: Vec<LeaderboardPokemon>,
}

#[derive(Serialize, FromRow)]
pub struct LeaderboardPokemon {
    pub id: i32,
    pub name: String,
    pub form: String,
    pub count: i32,
}

#[derive(FromRow)]
struct LeaderboardUserRow {
    pub user_id: String,
    pub user_name: String,
    pub global_name: Option<String>,
    pub avatar: Option<String>,
    pub wins: i32,
    pub losses: i32,
    pub mmr: i32,
}

#[derive(FromRow)]
struct UserPokemonRow {
    pub user_id: String,
    pub id: i32,
    pub name: String,
    pub form: String,
    pub count: i32,
}

pub async fn get_stats_page_data(
    State(state): State<ServerState>,
) -> Result<Json<StatsPageResponse>, AppError> {
    // Combine registered users and guests into a single player list
    let players = sqlx::query_as::<_, StatsPlayer>(
        "SELECT user_id, user_name, global_name, avatar, false AS is_guest FROM users
         UNION ALL
         SELECT user_id, user_name, NULL AS global_name, NULL AS avatar, true AS is_guest FROM guests",
    )
    .fetch_all(&state.db_pool)
    .await
    .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let teams =
        sqlx::query_as::<_, StatsTeam>(
            "SELECT t.user_id, t.guest_id, t.draft_id, t.placement, t.race_placement, d.draft_name, COALESCE(d.host_user_id, d.host_guest_id) AS host, d.ranked, d.draft_type
             FROM teams t
             JOIN drafts d ON t.draft_id = d.draft_id
             WHERE d.state = 'COMPLETED'"
        )
            .fetch_all(&state.db_pool)
            .await
            .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // Note: The `created_at` field is not directly available in StatsAuction, but it's used in the frontend's draftSummary.
    // It's currently being pulled from the auction table, but for consistency with draft_name, it might be better to get it from the drafts table.

    let auctions = sqlx::query_as::<_, StatsAuction>(
        r#"
        SELECT 
            a.auction_id, 
            a.draft_id, 
            a.pokedex_id,
            a.draft_order,
            p.name,
            a.form, 
            winning_bid, 
            winning_user_id, 
            winning_guest_id, 
            a.created_at,
            d.draft_name,
            COALESCE(d.host_user_id, d.host_guest_id) AS host,
            d.ranked,
            d.draft_type,
            a.action
        FROM auctions AS a
        JOIN pokemon AS p ON a.pokedex_id = p.pokedex_id AND COALESCE(a.form, '') = p.form
        JOIN drafts AS d ON a.draft_id = d.draft_id
        WHERE d.state = 'COMPLETED'
          AND (a.winning_bid IS NOT NULL
               OR d.draft_type = '1v1')
        ORDER BY a.draft_id, a.draft_order ASC
        "#,
    )
    .fetch_all(&state.db_pool)
    .await
    .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // If legacy migrations have not been applied in an environment yet,
    // serve stats without legacy rows instead of failing the whole endpoint.
    let legacy = match sqlx::query_as::<_, StatsLegacyPick>(
        "SELECT date, pokemon, cost FROM legacy_pokemon_costs ORDER BY date DESC NULLS LAST",
    )
    .fetch_all(&state.db_pool)
    .await
    {
        Ok(rows) => rows,
        Err(sqlx::Error::Database(db_err)) if db_err.code().as_deref() == Some("42P01") => {
            Vec::new()
        }
        Err(e) => {
            return Err((axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()));
        }
    };

    Ok(Json(StatsPageResponse {
        players,
        teams,
        auctions,
        legacy,
    }))
}

pub async fn get_leaderboard(
    State(state): State<ServerState>,
) -> Result<Json<Vec<LeaderboardEntry>>, AppError> {
    let user_rows = sqlx::query_as::<_, LeaderboardUserRow>(
        "SELECT user_id, user_name, global_name, avatar, wins, losses, mmr FROM users WHERE (wins + losses) > 0 ORDER BY mmr DESC"
    )
    .fetch_all(&state.db_pool)
    .await
    .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let pokemon_rows = sqlx::query_as::<_, UserPokemonRow>(
        r#"
        WITH user_pokemon_counts AS (
            SELECT 
                a.winning_user_id as user_id, 
                a.pokedex_id as id, 
                p.name, 
                COALESCE(a.form, '') as form, 
                COUNT(*)::INT as count,
                ROW_NUMBER() OVER(PARTITION BY a.winning_user_id ORDER BY COUNT(*) DESC, p.name ASC) as rank
            FROM auctions a
            JOIN pokemon p ON a.pokedex_id = p.pokedex_id AND COALESCE(a.form, '') = p.form
            JOIN drafts d ON d.draft_id = a.draft_id
            WHERE a.winning_user_id IS NOT NULL
              AND d.ranked = TRUE
              AND d.state = 'COMPLETED'
            GROUP BY a.winning_user_id, a.pokedex_id, p.name, a.form
        )
        SELECT user_id, id, name, form, count
        FROM user_pokemon_counts
        WHERE rank <= 10
        "#
    )
    .fetch_all(&state.db_pool)
    .await
    .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let mut pokemon_map: HashMap<String, Vec<LeaderboardPokemon>> = HashMap::new();
    for row in pokemon_rows {
        pokemon_map
            .entry(row.user_id)
            .or_default()
            .push(LeaderboardPokemon {
                id: row.id,
                name: row.name,
                form: row.form,
                count: row.count,
            });
    }

    let leaderboard = user_rows
        .into_iter()
        .map(|u| {
            let games_played = u.wins + u.losses;
            let user_id = u.user_id.clone();
            LeaderboardEntry {
                user_id: u.user_id,
                username: u.user_name,
                global_name: u.global_name,
                avatar: u.avatar,
                win: u.wins,
                loss: u.losses,
                mmr: u.mmr,
                games_played,
                most_drafted_pokemon: pokemon_map.remove(&user_id).unwrap_or_default(),
            }
        })
        .collect();

    Ok(Json(leaderboard))
}
