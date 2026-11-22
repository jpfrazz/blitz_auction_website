use axum::{Json, extract::State};
use serde::Serialize;
use sqlx::{FromRow, Row};
use std::collections::HashMap;

use crate::{AppError, handlers::build_run_stats, server::ServerState};

#[derive(Serialize)]
pub struct StatsPageResponse {
    pub players: Vec<StatsPlayer>,
    pub teams: Vec<StatsTeam>,
    pub auctions: Vec<StatsAuction>,
    pub legacy: Vec<StatsLegacyPick>,
    /// One row per Pokémon in a winning run, used for Cost Breakdown's
    /// Average KOs column. The frontend matches these to drafted Pokémon.
    pub winning_run_kos: Vec<WinningRunKoSample>,
    /// One row per race that ended with a win over Steven or Wally, used for
    /// Cost Breakdown's Wins column. Unlike the KO samples this is present even
    /// when the team has no saved run stats.
    pub winning_races: Vec<WinningRace>,
}

#[derive(Serialize, FromRow)]
pub struct StatsPlayer {
    pub user_id: String,
    pub user_name: String,
    pub global_name: Option<String>,
    pub avatar: Option<String>,
    pub is_guest: bool,
    pub linked_user_id: Option<String>,
}

#[derive(Serialize, FromRow)]
pub struct StatsTeam {
    pub team_id: i64,
    pub user_id: Option<String>,
    pub guest_id: Option<String>,
    pub draft_id: uuid::Uuid,
    pub draft_name: String,
    pub host: Option<String>,
    pub ranked: bool,
    pub draft_type: String,
    pub season: i32,
    pub placement: Option<i32>,
    pub race_placement: Option<i32>,
    pub has_save: bool,
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
    pub season: i32,
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
pub struct WinningRunKoSample {
    pub team_id: i64,
    pub draft_id: uuid::Uuid,
    pub user_id: Option<String>,
    pub guest_id: Option<String>,
    pub draft_type: String,
    pub species_id: u16,
    pub ko_count: u16,
}

#[derive(Serialize)]
pub struct WinningRace {
    pub team_id: i64,
    pub draft_id: uuid::Uuid,
    pub user_id: Option<String>,
    pub guest_id: Option<String>,
    pub draft_type: String,
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

#[derive(Serialize)]
pub struct Season2LeaderboardEntry {
    pub user_id: String,
    pub username: String,
    pub global_name: Option<String>,
    pub avatar: Option<String>,
    pub win: i32,
    pub loss: i32,
    pub total_points: i32,
    pub races_played: i32,
    pub most_drafted_pokemon: Vec<LeaderboardPokemon>,
}

#[derive(FromRow)]
struct Season2UserRow {
    pub user_id: String,
    pub user_name: String,
    pub global_name: Option<String>,
    pub avatar: Option<String>,
    pub win: i32,
    pub loss: i32,
    pub total_points: i32,
    pub races_played: i32,
}

/// One row per Pokémon in each completed run that ended by beating Steven or
/// Wally. KOs are parsed from the stored save with the same helper that builds
/// the player profile's run stats.
async fn fetch_winning_run_kos(
    state: &ServerState,
) -> Result<Vec<WinningRunKoSample>, (axum::http::StatusCode, String)> {
    let rows = sqlx::query(
        r#"
        WITH winning_teams AS (
            SELECT DISTINCT ON (bbh.team_id)
                   t.team_id,
                   t.user_id,
                   t.guest_id,
                   t.draft_id,
                   d.draft_type,
                   t.save_data
            FROM boss_battle_history bbh
            JOIN drafts d ON d.draft_id = bbh.draft_id
            JOIN teams t ON t.team_id = bbh.team_id
            WHERE d.state = 'COMPLETED'
              AND bbh.trainer_id IN (804, 656)
              AND NOT bbh.is_loss
            ORDER BY bbh.team_id, bbh.hours DESC, bbh.minutes DESC, bbh.seconds DESC
        )
        SELECT team_id, user_id, guest_id, draft_id, draft_type, save_data
        FROM winning_teams
        "#,
    )
    .fetch_all(&state.db_pool)
    .await
    .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let mut samples = Vec::new();
    for row in rows {
        let team_id: i64 = row
            .try_get("team_id")
            .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        let draft_id: uuid::Uuid = row
            .try_get("draft_id")
            .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        let user_id: Option<String> = row
            .try_get("user_id")
            .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        let guest_id: Option<String> = row
            .try_get("guest_id")
            .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        let draft_type: String = row
            .try_get("draft_type")
            .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        let save_data: Option<serde_json::Value> = row
            .try_get("save_data")
            .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

        let mons = build_run_stats(save_data);

        for mon in mons {
            let Some(ko_count) = mon.ko_count else {
                continue;
            };
            samples.push(WinningRunKoSample {
                team_id,
                draft_id,
                user_id: user_id.clone(),
                guest_id: guest_id.clone(),
                draft_type: draft_type.clone(),
                species_id: mon.species_id,
                ko_count,
            });
        }
    }

    Ok(samples)
}

/// One row per completed race whose team beat Steven or Wally. This is kept
/// separate from the KO samples so a win still counts when the stored save has
/// no usable KO/turn data.
async fn fetch_winning_races(
    state: &ServerState,
) -> Result<Vec<WinningRace>, (axum::http::StatusCode, String)> {
    let rows = sqlx::query(
        r#"
        SELECT DISTINCT ON (bbh.team_id)
               t.team_id,
               t.user_id,
               t.guest_id,
               t.draft_id,
               d.draft_type
        FROM boss_battle_history bbh
        JOIN drafts d ON d.draft_id = bbh.draft_id
        JOIN teams t ON t.team_id = bbh.team_id
        WHERE d.state = 'COMPLETED'
          AND bbh.trainer_id IN (804, 656)
          AND NOT bbh.is_loss
        ORDER BY bbh.team_id, bbh.hours DESC, bbh.minutes DESC, bbh.seconds DESC
        "#,
    )
    .fetch_all(&state.db_pool)
    .await
    .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let mut races = Vec::with_capacity(rows.len());
    for row in rows {
        races.push(WinningRace {
            team_id: row
                .try_get("team_id")
                .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?,
            user_id: row
                .try_get("user_id")
                .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?,
            guest_id: row
                .try_get("guest_id")
                .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?,
            draft_id: row
                .try_get("draft_id")
                .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?,
            draft_type: row
                .try_get("draft_type")
                .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?,
        });
    }

    Ok(races)
}

pub async fn get_stats_page_data(
    State(state): State<ServerState>,
) -> Result<Json<StatsPageResponse>, AppError> {
    // Combine registered users and guests into a single player list
    let players = sqlx::query_as::<_, StatsPlayer>(
        "SELECT user_id, user_name, global_name, avatar, false AS is_guest, NULL::TEXT AS linked_user_id FROM users
         UNION ALL
         SELECT user_id, user_name, NULL AS global_name, NULL AS avatar, true AS is_guest, discord_user_id AS linked_user_id FROM guests",
    )
    .fetch_all(&state.db_pool)
    .await
    .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let teams =
        sqlx::query_as::<_, StatsTeam>(
            "SELECT t.team_id, t.user_id, t.guest_id, t.draft_id, t.placement, t.race_placement,
                    (t.save_data IS NOT NULL) AS has_save,
                    d.draft_name, COALESCE(d.host_user_id, d.host_guest_id) AS host, d.ranked, d.draft_type, d.season
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
            d.season,
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

    let winning_run_kos = fetch_winning_run_kos(&state).await?;
    let winning_races = fetch_winning_races(&state).await?;

    Ok(Json(StatsPageResponse {
        players,
        teams,
        auctions,
        legacy,
        winning_run_kos,
        winning_races,
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
              AND d.season = 1
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

pub async fn get_season2_leaderboard(
    State(state): State<ServerState>,
) -> Result<Json<Vec<Season2LeaderboardEntry>>, AppError> {
    let user_rows = sqlx::query_as::<_, Season2UserRow>(
        r#"
        WITH race_sizes AS (
            SELECT t.draft_id, COUNT(*)::INT AS n
            FROM teams t
            JOIN drafts d ON d.draft_id = t.draft_id
            WHERE d.season = 2
              AND d.state = 'COMPLETED'
            GROUP BY t.draft_id
        ),
        per_race AS (
            SELECT DISTINCT ON (COALESCE(t.user_id, g.discord_user_id), t.draft_id)
                COALESCE(t.user_id, g.discord_user_id) AS user_id,
                t.draft_id,
                (CASE
                    WHEN t.race_placement = 1 THEN 5
                    WHEN t.race_placement = 2 THEN 4
                    WHEN t.race_placement = 3 THEN 3
                    ELSE 0
                 END + (rs.n - t.race_placement))::INT AS points,
                (rs.n - t.race_placement)::INT AS wins,
                (t.race_placement - 1)::INT AS losses
            FROM teams t
            JOIN drafts d ON d.draft_id = t.draft_id
            JOIN race_sizes rs ON rs.draft_id = t.draft_id
                        LEFT JOIN guests g ON g.user_id = t.guest_id
            WHERE d.season = 2
              AND d.state = 'COMPLETED'
                            AND COALESCE(t.user_id, g.discord_user_id) IS NOT NULL
              AND t.race_placement IS NOT NULL
                        ORDER BY COALESCE(t.user_id, g.discord_user_id), t.draft_id,
                                         (t.user_id IS NULL), t.team_id
        ),
        best_performances AS (
            SELECT user_id, points,
                   ROW_NUMBER() OVER (
                       PARTITION BY user_id
                       ORDER BY points DESC, draft_id
                   ) AS rn
            FROM per_race
        ),
        totals AS (
            SELECT user_id, SUM(points)::INT AS total_points
            FROM best_performances
            WHERE rn <= 10
            GROUP BY user_id
        ),
        counts AS (
            SELECT user_id,
                   COUNT(*)::INT AS races_played,
                   SUM(wins)::INT AS win,
                   SUM(losses)::INT AS loss
            FROM per_race
            GROUP BY user_id
        )
        SELECT u.user_id, u.user_name, u.global_name, u.avatar,
               c.win, c.loss, t.total_points, c.races_played
        FROM counts c
        JOIN totals t ON t.user_id = c.user_id
        JOIN users u ON u.user_id = c.user_id
        ORDER BY t.total_points DESC, c.win DESC, u.user_name ASC
        "#,
    )
    .fetch_all(&state.db_pool)
    .await
    .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let pokemon_rows = sqlx::query_as::<_, UserPokemonRow>(
        r#"
        WITH user_pokemon_counts AS (
            SELECT
                COALESCE(a.winning_user_id, g.discord_user_id) as user_id,
                a.pokedex_id as id,
                p.name,
                COALESCE(a.form, '') as form,
                COUNT(*)::INT as count,
                                ROW_NUMBER() OVER(PARTITION BY COALESCE(a.winning_user_id, g.discord_user_id) ORDER BY COUNT(*) DESC, p.name ASC) as rank
            FROM auctions a
            JOIN pokemon p ON a.pokedex_id = p.pokedex_id AND COALESCE(a.form, '') = p.form
            JOIN drafts d ON d.draft_id = a.draft_id
                        LEFT JOIN guests g ON g.user_id = a.winning_guest_id
                        WHERE COALESCE(a.winning_user_id, g.discord_user_id) IS NOT NULL
              AND d.season = 2
              AND d.state = 'COMPLETED'
                        GROUP BY COALESCE(a.winning_user_id, g.discord_user_id), a.pokedex_id, p.name, a.form
        )
        SELECT user_id, id, name, form, count
        FROM user_pokemon_counts
        WHERE rank <= 8
          AND count >= 2
        "#,
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
            let user_id = u.user_id.clone();
            Season2LeaderboardEntry {
                user_id: u.user_id,
                username: u.user_name,
                global_name: u.global_name,
                avatar: u.avatar,
                win: u.win,
                loss: u.loss,
                total_points: u.total_points,
                races_played: u.races_played,
                most_drafted_pokemon: pokemon_map.remove(&user_id).unwrap_or_default(),
            }
        })
        .collect();

    Ok(Json(leaderboard))
}
