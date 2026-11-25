use axum::{
    Json,
    extract::{Path, State},
};
use serde::Serialize;
use sqlx::{FromRow, Row};
use std::collections::{HashMap, HashSet};
use uuid::Uuid;

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
    /// Decisive rock-paper-scissors rounds won (including linked guest ids for
    /// registered users).
    pub rps_wins: i32,
    /// Decisive rock-paper-scissors rounds lost (including linked guest ids).
    pub rps_losses: i32,
}

#[derive(FromRow)]
struct RpsStatRow {
    account_id: String,
    wins: i32,
    losses: i32,
}

/// Apply raw per-account RPS totals to the profile list. Guest accounts never
/// contribute to RPS win rates, so rows keyed by a guest id are ignored even
/// if they were written before the write-side guest filter existed.
fn apply_rps_stats(players: &mut [StatsPlayer], rows: Vec<RpsStatRow>) {
    let guest_ids: HashSet<String> = players
        .iter()
        .filter(|player| player.is_guest)
        .map(|player| player.user_id.clone())
        .collect();

    let totals: HashMap<String, (i32, i32)> = rows
        .into_iter()
        .filter(|row| !guest_ids.contains(&row.account_id))
        .map(|row| (row.account_id, (row.wins, row.losses)))
        .collect();

    for player in players.iter_mut() {
        let (wins, losses) = totals.get(&player.user_id).copied().unwrap_or((0, 0));
        player.rps_wins = wins;
        player.rps_losses = losses;
    }
}

#[cfg(test)]
mod rps_stats_tests {
    use super::{apply_rps_stats, RpsStatRow, StatsPlayer};

    fn player(user_id: &str, is_guest: bool, linked_user_id: Option<&str>) -> StatsPlayer {
        StatsPlayer {
            user_id: user_id.to_string(),
            user_name: user_id.to_string(),
            global_name: None,
            avatar: None,
            is_guest,
            linked_user_id: linked_user_id.map(str::to_string),
            rps_wins: 0,
            rps_losses: 0,
        }
    }

    fn row(account_id: &str, wins: i32, losses: i32) -> RpsStatRow {
        RpsStatRow {
            account_id: account_id.to_string(),
            wins,
            losses,
        }
    }

    #[test]
    fn guest_rows_are_excluded_from_every_players_rate() {
        let mut players = vec![
            player("discord-1", false, None),
            player("guest-1", true, Some("discord-1")),
            player("discord-2", false, None),
        ];
        apply_rps_stats(
            &mut players,
            vec![
                row("discord-1", 2, 1),
                row("guest-1", 3, 4),
                row("discord-2", 1, 0),
            ],
        );
        assert_eq!((players[0].rps_wins, players[0].rps_losses), (2, 1));
        assert_eq!((players[1].rps_wins, players[1].rps_losses), (0, 0));
        assert_eq!((players[2].rps_wins, players[2].rps_losses), (1, 0));
    }

    #[test]
    fn players_without_results_have_zero_counts() {
        let mut players = vec![player("discord-1", false, None)];
        apply_rps_stats(&mut players, vec![row("someone-else", 1, 0)]);
        assert_eq!((players[0].rps_wins, players[0].rps_losses), (0, 0));
    }
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
    /// Whether this team/draft has any boss battle rows. Cost Breakdown uses
    /// this to count only races where the Pokémon actually had a chance to win.
    pub has_boss_battles: bool,
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

/// Build the complete stats payload. Both the global stats endpoint and the
/// player profile endpoint reuse this so they agree on eligibility rules.
async fn build_stats_page_data(state: &ServerState) -> Result<StatsPageResponse, AppError> {
    // Combine registered users and guests into a single player list
    let mut players = sqlx::query_as::<_, StatsPlayer>(
        "SELECT user_id, user_name, global_name, avatar, false AS is_guest, NULL::TEXT AS linked_user_id, 0::INT AS rps_wins, 0::INT AS rps_losses FROM users
         UNION ALL
         SELECT user_id, user_name, NULL AS global_name, NULL AS avatar, true AS is_guest, discord_user_id AS linked_user_id, 0::INT AS rps_wins, 0::INT AS rps_losses FROM guests",
    )
    .fetch_all(&state.db_pool)
    .await
    .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // RPS stats live in their own tables; tolerate an environment where the
    // migration has not run yet instead of failing the whole stats page.
    let rps_rows = match sqlx::query_as::<_, RpsStatRow>(
        "SELECT account_id, wins, losses FROM rps_stats",
    )
    .fetch_all(&state.db_pool)
    .await
    {
        Ok(rows) => rows,
        Err(sqlx::Error::Database(db_err)) if db_err.code().as_deref() == Some("42P01") => Vec::new(),
        Err(e) => return Err((axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string())),
    };
    apply_rps_stats(&mut players, rps_rows);

    let teams =
        sqlx::query_as::<_, StatsTeam>(
            "SELECT t.team_id, t.user_id, t.guest_id, t.draft_id, t.placement, t.race_placement,
                    (t.save_data IS NOT NULL) AS has_save,
                    EXISTS (
                        SELECT 1 FROM boss_battle_history bbh
                        WHERE bbh.team_id = t.team_id AND bbh.draft_id = t.draft_id
                    ) AS has_boss_battles,
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

    Ok(StatsPageResponse {
        players,
        teams,
        auctions,
        legacy,
        winning_run_kos,
        winning_races,
    })
}

pub async fn get_stats_page_data(
    State(state): State<ServerState>,
) -> Result<Json<StatsPageResponse>, AppError> {
    Ok(Json(build_stats_page_data(&state).await?))
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
                    WHEN COALESCE(t.placement, t.race_placement) = 1 THEN 5
                    WHEN COALESCE(t.placement, t.race_placement) = 2 THEN 4
                    WHEN COALESCE(t.placement, t.race_placement) = 3 THEN 3
                    ELSE 0
                 END + (rs.n - COALESCE(t.placement, t.race_placement)))::INT AS points,
                (rs.n - COALESCE(t.placement, t.race_placement))::INT AS wins,
                (COALESCE(t.placement, t.race_placement) - 1)::INT AS losses
            FROM teams t
            JOIN drafts d ON d.draft_id = t.draft_id
            JOIN race_sizes rs ON rs.draft_id = t.draft_id
                        LEFT JOIN guests g ON g.user_id = t.guest_id
            WHERE d.season = 2
              AND d.state = 'COMPLETED'
                            AND COALESCE(t.user_id, g.discord_user_id) IS NOT NULL
              AND COALESCE(t.placement, t.race_placement) IS NOT NULL
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

// ---------------------------------------------------------------------------
// Player profile endpoint
//
// A profile needs a few values that are inherently global (average sale price
// per Pokémon, the pool as of a given date, and price history). Recomputing
// those in the browser used to require the entire `/stats` payload. The
// helpers below compute them once on the server and send compact aggregates,
// while the rest of the response is narrowed to drafts the player joined.
// ---------------------------------------------------------------------------

const KNOWN_FORMS: [&str; 4] = ["Alola", "Galar", "Hisui", "Paldea"];

struct PokemonIdentity {
    name: String,
    form: String,
    key: String,
}

/// Mirror of the frontend's `resolvePokemonIdentity` so server-side aggregates
/// line up with the identity rows the profile UI renders.
fn resolve_pokemon_identity(name: &str, form: &str) -> PokemonIdentity {
    let mut current_name = name.to_string();
    let mut current_form = form.to_string();

    for known in KNOWN_FORMS {
        let suffix = format!("-{known}");
        if current_name.ends_with(&suffix) {
            current_name.truncate(current_name.len() - suffix.len());
            current_form = known.to_string();
            break;
        }
    }

    let override_form = match current_name.as_str() {
        "Wooper" => Some("Paldea"),
        "Vulpix" => Some("Alola"),
        "Voltorb" => Some("Hisui"),
        "Farfetch'd" => Some("Galar"),
        "Sandshrew" => Some("Alola"),
        "Meowth" => Some("Galar"),
        "Slowpoke" => Some("Galar"),
        "Zigzagoon" => Some("Galar"),
        _ => None,
    };
    if (current_form.is_empty() || current_form == "base") && override_form.is_some() {
        let form = override_form.unwrap().to_string();
        let key = format!("{current_name}-{form}");
        return PokemonIdentity {
            name: current_name,
            form,
            key,
        };
    }

    let effective_form = if current_form.is_empty() || current_form == "base" {
        String::new()
    } else {
        current_form
    };
    let key = if effective_form.is_empty() {
        current_name.clone()
    } else {
        format!("{current_name}-{effective_form}")
    };
    PokemonIdentity {
        name: current_name,
        form: effective_form,
        key,
    }
}

fn pokemon_identity_key(name: &str, form: &str) -> String {
    resolve_pokemon_identity(name, form).key
}

fn calculate_quantile(sorted: &[i64], q: f64) -> f64 {
    if sorted.is_empty() {
        return 0.0;
    }
    let pos = (sorted.len() as f64 - 1.0) * q;
    let base = pos.floor() as usize;
    let rest = pos - base as f64;
    if sorted.len() > base + 1 {
        sorted[base] as f64 + rest * (sorted[base + 1] - sorted[base]) as f64
    } else {
        sorted[base] as f64
    }
}

#[derive(Serialize)]
pub struct PoolEntry {
    pub date: String,
    pub key: String,
}

#[derive(Serialize)]
pub struct PricePoint {
    pub date: String,
    pub total: i64,
    pub count: i32,
}

#[derive(Serialize)]
pub struct PlayerIdLookup {
    pub user_id: String,
}

/// Resolve a legacy `/Stats/PlayerProfiles/:username` URL (which has no
/// `?userId=`) to the stable id the profile endpoint needs.
pub async fn get_player_id_by_name(
    State(state): State<ServerState>,
    Path(username): Path<String>,
) -> Result<Json<PlayerIdLookup>, AppError> {
    let user_id: Option<String> = sqlx::query_scalar(
        r#"
        SELECT user_id FROM (
            SELECT user_id, user_name, global_name, 0 AS priority FROM users
            UNION ALL
            SELECT user_id, user_name, NULL::TEXT AS global_name, 2 AS priority FROM guests
        ) candidates
        WHERE LOWER(TRIM(user_name)) = LOWER(TRIM($1))
           OR LOWER(TRIM(COALESCE(global_name, ''))) = LOWER(TRIM($1))
        ORDER BY CASE
            WHEN LOWER(TRIM(user_name)) = LOWER(TRIM($1)) THEN priority
            ELSE priority + 1
        END
        LIMIT 1
        "#,
    )
    .bind(&username)
    .fetch_optional(&state.db_pool)
    .await
    .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    match user_id {
        Some(user_id) => Ok(Json(PlayerIdLookup { user_id })),
        None => Err((axum::http::StatusCode::NOT_FOUND, "Player not found.".to_string())),
    }
}

#[derive(Serialize)]
pub struct PokemonKeyRow {
    pub key: String,
    pub name: String,
    pub form: String,
}

#[derive(Serialize)]
pub struct PlayerProfileResponse {
    /// Stats narrowed to the drafts this player took part in.
    pub stats: StatsPageResponse,
    /// Average sale price per identity key across every valid draft + legacy
    /// rows, after the same outlier filter the profile used to run locally.
    pub global_prices: HashMap<String, i64>,
    /// `(date, identity key)` for every sale in a valid draft, sorted by date.
    pub pool_entries: Vec<PoolEntry>,
    /// Cumulative `total`/`count` per date for each identity key, used to
    /// freeze the "worth every penny" average at the date of a win.
    pub price_history: HashMap<String, Vec<PricePoint>>,
    /// Draft ids passing the site's validity rules (needed for `isNonCasualRace`).
    pub valid_draft_ids: Vec<String>,
    /// Every Pokémon identity seen in a valid draft, so the "all Pokémon"
    /// table keeps its full row set even though auctions are scoped.
    pub global_pokemon_keys: Vec<PokemonKeyRow>,
}

/// Recreate the frontend's `validDraftIds` / `casualOneVOneDraftIds` sets from
/// the full stats payload.
fn compute_draft_validity(all: &StatsPageResponse) -> (HashSet<Uuid>, HashSet<Uuid>) {
    #[derive(Default)]
    struct DraftStat {
        total: i32,
        min_bid_count: i32,
        team_count: i32,
        max_bid: i32,
    }

    let mut draft_stats: HashMap<Uuid, DraftStat> = HashMap::new();
    for team in &all.teams {
        draft_stats.entry(team.draft_id).or_default().team_count += 1;
    }
    for auction in &all.auctions {
        if let Some(bid) = auction.winning_bid {
            let stat = draft_stats.entry(auction.draft_id).or_default();
            stat.total += 1;
            if bid == 100 {
                stat.min_bid_count += 1;
            }
            if bid > stat.max_bid {
                stat.max_bid = bid;
            }
        }
    }

    let valid_draft_ids = draft_stats
        .into_iter()
        .filter(|(_, stat)| {
            stat.total >= 40
                && stat.min_bid_count <= 3
                && stat.total == 8 * stat.team_count
                && stat.max_bid <= 12_000
        })
        .map(|(id, _)| id)
        .collect();

    let mut casual_1v1_draft_ids = HashSet::new();
    let mut leftover_orders: HashMap<Uuid, i32> = HashMap::new();
    for auction in &all.auctions {
        if auction.draft_type != "1v1" || auction.action.as_deref() != Some("LEFTOVER") {
            continue;
        }
        let previous = leftover_orders
            .get(&auction.draft_id)
            .copied()
            .unwrap_or(i32::MAX);
        if auction.draft_order < previous {
            leftover_orders.insert(auction.draft_id, auction.draft_order);
        }
    }
    for (draft_id, order) in leftover_orders {
        if order > 29 {
            casual_1v1_draft_ids.insert(draft_id);
        }
    }

    (valid_draft_ids, casual_1v1_draft_ids)
}

fn compute_global_prices(
    all: &StatsPageResponse,
    valid_draft_ids: &HashSet<Uuid>,
) -> HashMap<String, i64> {
    let mut grouped: HashMap<String, Vec<i64>> = HashMap::new();

    for auction in &all.auctions {
        let Some(bid) = auction.winning_bid else {
            continue;
        };
        if !valid_draft_ids.contains(&auction.draft_id) {
            continue;
        }
        let key = pokemon_identity_key(&auction.name, auction.form.as_deref().unwrap_or(""));
        grouped.entry(key).or_default().push(bid as i64);
    }

    for legacy in &all.legacy {
        let normalized = legacy.cost.trim().replace(',', "");
        if normalized.is_empty() || !normalized.bytes().all(|b| b.is_ascii_digit()) {
            continue;
        }
        let Ok(bid) = normalized.parse::<i64>() else {
            continue;
        };
        let key = pokemon_identity_key(&legacy.pokemon, "");
        grouped.entry(key).or_default().push(bid);
    }

    let mut prices = HashMap::new();
    for (key, bids) in grouped {
        let mut filtered: Vec<i64> = bids.into_iter().filter(|bid| *bid != 100).collect();
        if filtered.len() > 1 {
            filtered.sort_unstable();
            let q1 = calculate_quantile(&filtered, 0.25);
            let q3 = calculate_quantile(&filtered, 0.75);
            let iqr = q3 - q1;
            let lower = q1 - 1.5 * iqr;
            let upper = q3 + 2.0 * iqr;
            filtered.retain(|bid| (*bid as f64) >= lower && (*bid as f64) <= upper);
        }
        if filtered.is_empty() {
            continue;
        }
        let sum: i64 = filtered.iter().sum();
        let avg = (sum as f64 / filtered.len() as f64).round() as i64;
        if avg > 100 {
            prices.insert(key, avg);
        }
    }
    prices
}

fn compute_pool_and_price_history(
    all: &StatsPageResponse,
    valid_draft_ids: &HashSet<Uuid>,
) -> (Vec<PoolEntry>, HashMap<String, Vec<PricePoint>>) {
    let date_of = |created_at: Option<&chrono::DateTime<chrono::Utc>>| {
        created_at.map(|dt| dt.format("%Y-%m-%d").to_string())
    };

    let mut pool_entries: Vec<PoolEntry> = all
        .auctions
        .iter()
        .filter(|auction| valid_draft_ids.contains(&auction.draft_id))
        .filter_map(|auction| {
            let date = date_of(auction.created_at.as_ref())?;
            let key = pokemon_identity_key(&auction.name, auction.form.as_deref().unwrap_or(""));
            Some(PoolEntry { date, key })
        })
        .collect();
    pool_entries.sort_by(|a, b| a.date.cmp(&b.date));

    // "Worth every penny" compares each winning sale against the average price
    // up to that sale's date. Only non-casual auction sales qualify.
    let mut by_key: HashMap<String, HashMap<String, (i64, i32)>> = HashMap::new();
    for auction in &all.auctions {
        if auction.winning_bid.is_none() || auction.draft_type == "1v1" {
            continue;
        }
        if matches!(auction.action.as_deref(), Some("BAN") | Some("LEFTOVER")) {
            continue;
        }
        if !valid_draft_ids.contains(&auction.draft_id) {
            continue;
        }
        let Some(date) = date_of(auction.created_at.as_ref()) else {
            continue;
        };
        let key = pokemon_identity_key(&auction.name, auction.form.as_deref().unwrap_or(""));
        let by_date = by_key.entry(key).or_default();
        let point = by_date.entry(date).or_insert((0, 0));
        point.0 += auction.winning_bid.unwrap_or(0) as i64;
        point.1 += 1;
    }

    let price_history = by_key
        .into_iter()
        .map(|(key, by_date)| {
            let mut dates: Vec<_> = by_date.into_iter().collect();
            dates.sort_by(|a, b| a.0.cmp(&b.0));
            let mut total = 0i64;
            let mut count = 0i32;
            let points = dates
                .into_iter()
                .map(|(date, (day_total, day_count))| {
                    total += day_total;
                    count += day_count;
                    PricePoint {
                        date,
                        total,
                        count,
                    }
                })
                .collect();
            (key, points)
        })
        .collect();

    (pool_entries, price_history)
}

/// `GET /api/stats/player/{user_id}` — everything a single profile needs,
/// without shipping the global stats payload to the browser.
pub async fn get_player_profile_stats(
    State(state): State<ServerState>,
    Path(user_id): Path<String>,
) -> Result<Json<PlayerProfileResponse>, AppError> {
    let all = build_stats_page_data(&state).await?;
    let (valid_draft_ids, _casual_1v1_draft_ids) = compute_draft_validity(&all);
    let global_prices = compute_global_prices(&all, &valid_draft_ids);
    let (pool_entries, price_history) = compute_pool_and_price_history(&all, &valid_draft_ids);

    // A registered user's linked guest accounts count as the same player.
    let linked_guest_ids: Vec<String> =
        sqlx::query_scalar("SELECT user_id FROM guests WHERE discord_user_id = $1")
            .bind(&user_id)
            .fetch_all(&state.db_pool)
            .await
            .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let mut account_ids: HashSet<String> = HashSet::new();
    account_ids.insert(user_id.clone());
    for guest_id in linked_guest_ids {
        account_ids.insert(guest_id);
    }

    let player_draft_ids: HashSet<Uuid> = all
        .teams
        .iter()
        .filter(|team| {
            team.user_id
                .as_ref()
                .is_some_and(|id| account_ids.contains(id))
                || team
                    .guest_id
                    .as_ref()
                    .is_some_and(|id| account_ids.contains(id))
        })
        .map(|team| team.draft_id)
        .collect();

    let mut key_rows: HashMap<String, PokemonKeyRow> = HashMap::new();
    for auction in &all.auctions {
        if !valid_draft_ids.contains(&auction.draft_id) {
            continue;
        }
        let identity = resolve_pokemon_identity(&auction.name, auction.form.as_deref().unwrap_or(""));
        key_rows.entry(identity.key.clone()).or_insert(PokemonKeyRow {
            key: identity.key,
            name: identity.name,
            form: identity.form,
        });
    }

    let stats = StatsPageResponse {
        players: all.players,
        teams: all
            .teams
            .into_iter()
            .filter(|team| player_draft_ids.contains(&team.draft_id))
            .collect(),
        auctions: all
            .auctions
            .into_iter()
            .filter(|auction| player_draft_ids.contains(&auction.draft_id))
            .collect(),
        legacy: all.legacy,
        winning_run_kos: all
            .winning_run_kos
            .into_iter()
            .filter(|sample| player_draft_ids.contains(&sample.draft_id))
            .collect(),
        winning_races: all
            .winning_races
            .into_iter()
            .filter(|race| player_draft_ids.contains(&race.draft_id))
            .collect(),
    };

    Ok(Json(PlayerProfileResponse {
        stats,
        global_prices,
        pool_entries,
        price_history,
        valid_draft_ids: valid_draft_ids
            .into_iter()
            .map(|id| id.to_string())
            .collect(),
        global_pokemon_keys: key_rows.into_values().collect(),
    }))
}

#[cfg(test)]
mod profile_aggregate_tests {
    use super::*;
    use chrono::{TimeZone, Utc};

    fn auction(
        draft_id: Uuid,
        name: &str,
        form: Option<&str>,
        bid: i32,
        day: u32,
    ) -> StatsAuction {
        StatsAuction {
            auction_id: 1,
            draft_id,
            pokedex_id: 1,
            draft_order: 1,
            name: name.to_string(),
            form: form.map(str::to_string),
            winning_bid: Some(bid),
            winning_user_id: None,
            winning_guest_id: None,
            draft_name: String::new(),
            host: None,
            ranked: false,
            draft_type: "auction".to_string(),
            season: 1,
            action: None,
            created_at: Some(Utc.with_ymd_and_hms(2026, 1, day, 12, 0, 0).unwrap()),
        }
    }

    fn empty_response() -> StatsPageResponse {
        StatsPageResponse {
            players: Vec::new(),
            teams: Vec::new(),
            auctions: Vec::new(),
            legacy: Vec::new(),
            winning_run_kos: Vec::new(),
            winning_races: Vec::new(),
        }
    }

    #[test]
    fn identity_keys_match_the_frontend_normalisation() {
        let bare = resolve_pokemon_identity("Pikachu", "");
        assert_eq!((bare.name.as_str(), bare.form.as_str(), bare.key.as_str()), ("Pikachu", "", "Pikachu"));

        let suffixed = resolve_pokemon_identity("Vulpix-Alola", "");
        assert_eq!((suffixed.name.as_str(), suffixed.form.as_str(), suffixed.key.as_str()), ("Vulpix", "Alola", "Vulpix-Alola"));

        let override_form = resolve_pokemon_identity("Wooper", "base");
        assert_eq!(override_form.key, "Wooper-Paldea");

        let farfetchd = resolve_pokemon_identity("Farfetch'd", "");
        assert_eq!(farfetchd.key, "Farfetch'd-Galar");
    }

    #[test]
    fn quantile_interpolates_between_neighbours() {
        let values = vec![10, 20, 30, 40];
        assert_eq!(calculate_quantile(&values, 0.25), 17.5);
        assert_eq!(calculate_quantile(&values, 0.75), 32.5);
    }

    #[test]
    fn draft_validity_uses_the_site_rules() {
        let draft_id = Uuid::nil();
        let mut all = empty_response();
        for _ in 0..8 {
            all.teams.push(StatsTeam {
                team_id: 1,
                user_id: None,
                guest_id: None,
                draft_id,
                draft_name: String::new(),
                host: None,
                ranked: true,
                draft_type: "auction".to_string(),
                season: 1,
                placement: None,
                race_placement: None,
                has_save: false,
                has_boss_battles: false,
            });
        }
        // A valid auction draft sells exactly 8 Pokémon per team: 8 * 8 = 64.
        for i in 0..64 {
            all.auctions.push(auction(draft_id, "Pikachu", None, 500 + i, 1));
        }
        let (valid, casual) = compute_draft_validity(&all);
        assert!(valid.contains(&draft_id));
        assert!(casual.is_empty());
    }

    #[test]
    fn global_prices_drop_the_100_floor_and_outliers() {
        let draft_id = Uuid::nil();
        let mut all = empty_response();
        // 20 normal sales plus one extreme outlier and one minimum-bid sale.
        for i in 0..20 {
            all.auctions.push(auction(draft_id, "Pikachu", None, 1000 + i, 1));
        }
        all.auctions.push(auction(draft_id, "Pikachu", None, 100, 1));
        all.auctions.push(auction(draft_id, "Pikachu", None, 99_999, 1));
        let valid: HashSet<Uuid> = [draft_id].into_iter().collect();
        let prices = compute_global_prices(&all, &valid);
        assert_eq!(prices.get("Pikachu"), Some(&1010));
    }

    #[test]
    fn price_history_freezes_running_totals_by_date() {
        let draft_id = Uuid::nil();
        let mut all = empty_response();
        all.auctions.push(auction(draft_id, "Pikachu", None, 1000, 1));
        all.auctions.push(auction(draft_id, "Pikachu", None, 2000, 2));
        let valid: HashSet<Uuid> = [draft_id].into_iter().collect();
        let (pool, history) = compute_pool_and_price_history(&all, &valid);
        assert_eq!(pool.len(), 2);
        let points = &history["Pikachu"];
        assert_eq!(points[0].total, 1000);
        assert_eq!(points[0].count, 1);
        assert_eq!(points[1].total, 3000);
        assert_eq!(points[1].count, 2);
    }
}
