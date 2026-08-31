use crate::{
    AppError, CSRF_STATE_KEY,
    contains_profanity,
    auction::AuctionResponse,
    draft::{Draft, DraftLobbyResponse, DraftResponse, DraftSettings, DraftState, AutoBidResponse},
    messages::{
        ChatMessage, ClientBidRequest, ClientBidResponse, ClientJoinResponse, ForfeitRequest,
        HallOfFamePokemon, PostSaveRequest, SaveData, ServerMessage, TrainerCardWin,
        get_trainer_name_by_id,
    },
    pokemon::{self, Pokemon},
    pokemon_data_updater::{self, KeyMoveCsvRecord, PokemonCsvRecord},
    server::ServerState,
    users::{AuthBackend, Credentials, DiscordCreds, User},
};
use axum::{
    Json,
    body::Body,
    debug_handler,
    extract::{
        Multipart, Path, Query, State, WebSocketUpgrade,
        ws::{Message, WebSocket, close_code::STATUS},
    },
    http::StatusCode,
    response::{Redirect, Response},
};
use axum_login::AuthSession;
use chrono::Utc;
use dashmap::mapref::entry;
use oauth2::CsrfToken;
use serde::{Deserialize, Serialize};
use sqlx::Row;
use std::{
    collections::{HashMap, HashSet},
    str::FromStr,
    sync::Arc,
};
use tokio::sync::{RwLock, broadcast};
use tower_sessions::Session;
use uuid::Uuid;

/// Returns the K-factor based on how many ranked races the user has participated in (including the current one).
fn get_k_factor(races_played_including_this_one: i32) -> f64 {
    if races_played_including_this_one <= 5 {
        40.0
    } else {
        20.0
    }
}

#[derive(Clone, Debug, Deserialize)]
pub struct JoinDraftRequest {
    pub password: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct ReadyUpRequest {
    #[serde(default = "default_ready_true")]
    pub ready: bool,
}

#[derive(Clone, Debug, Serialize)]
pub struct ReadyUpResponse {
    pub ready: bool,
    pub draft_started: bool,
}

#[derive(Clone, Debug, Deserialize)]
pub struct UpdatePendingDraftSettingsRequest {
    pub num_teams: u32,
    pub num_auctions: u32,
    #[serde(default)]
    pub remove_team_ids: Vec<String>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct SetAutoBidRequest {
    pub value: u32,
    pub enabled: bool,
}

#[derive(Clone, Debug, Deserialize)]
pub struct OneVOnePickBanRequest {
    pub pokedex_id: u32,
    pub form: Option<String>,
}

fn default_ready_true() -> bool {
    true
}

#[derive(Clone, Debug, Deserialize, serde::Serialize)]
pub struct ClaimEeveelutionRequest {
    pub pokedex_id: i32,
    pub form: Option<String>,
    pub target_user_id: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct LeaderboardPokemon {
    pub pokedex_id: i32,
    pub name: String,
    pub form: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
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

#[derive(Clone, Debug, Serialize)]
pub struct MatchHistoryAuction {
    pub auction_id: i64,
    pub pokedex_id: i32,
    pub name: String,
    pub form: String,
    pub draft_id: String,
    pub draft_order: i32,
    pub state: String,
    pub action: Option<String>,
    pub paused_time_remaining: Option<i32>,
    pub winning_bid: Option<i32>,
    pub winning_user_id: Option<String>,
    pub winning_guest_id: Option<String>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Clone, Debug, Serialize)]
pub struct MatchHistoryTeam {
    pub team_id: i64,
    pub user_id: Option<String>,
    pub guest_id: Option<String>,
    pub draft_id: String,
    pub ranked: bool,
    pub draft_type: String,
    pub team_count: i32,
    pub money_remaining: i32,
    pub pokemon_drafted: Vec<MatchHistoryAuction>,
    pub placement: Option<i32>,
    pub pre_match_mmr: Option<i32>,
    pub hall_of_fame_team: Option<Vec<HallOfFamePokemon>>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Clone, Debug, Serialize)]
pub struct MatchHistoryTeamRow {
    pub team_id: i64,
    pub user_id: Option<String>,
    pub guest_id: Option<String>,
    pub draft_id: String,
    pub ranked: bool,
    pub money_remaining: i32,
    pub pokemon_drafted: i32,
    pub placement: Option<i32>,
    pub pre_match_mmr: Option<i32>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Clone, Debug, Serialize)]
pub struct StatsPageResponse {
    pub players: Vec<StatsPagePlayer>,
    pub teams: Vec<MatchHistoryTeamRow>,
    pub auctions: Vec<MatchHistoryAuction>,
}

#[derive(Clone, Debug, Serialize)]
pub struct StatsPagePlayer {
    pub user_id: String,
    pub user_name: String,
    pub is_guest: bool,
}

#[derive(Clone, Debug, Deserialize)]
pub struct CreateChatRequest {
    pub message: String,
}

#[derive(Clone, Debug, Deserialize)]
pub struct ChangeGuestNameRequest {
    pub new_name: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct AdminDraftSummary {
    pub draft_id: String,
    pub draft_name: String,
    pub ranked: bool,
    pub state: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Clone, Debug, Serialize)]
pub struct AdminDraftTeamPlacement {
    pub team_id: i64,
    pub draft_id: String,
    pub user_id: Option<String>,
    pub guest_id: Option<String>,
    pub user_name: Option<String>,
    pub placement: Option<i32>,
    pub pre_match_mmr: Option<i32>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct AdminTeamPlacementUpdate {
    pub team_id: i64,
    pub placement: i32,
    pub pre_match_mmr: i32,
}

#[derive(Clone, Debug, Deserialize)]
pub struct AdminUpdateDraftPlacementsRequest {
    pub placements: Vec<AdminTeamPlacementUpdate>,
}

#[derive(Clone, Debug, Serialize)]
pub struct AdminDiscordUser {
    pub user_id: String,
    pub user_name: String,
    pub discriminator: String,
    pub global_name: Option<String>,
    pub avatar: Option<String>,
    pub wins: i32,
    pub losses: i32,
    pub mmr: i32,
    pub updated_at: chrono::DateTime<chrono::Utc>,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct AdminUpdateDiscordUserRequest {
    pub mmr: i32,
    pub wins: i32,
    pub losses: i32,
}

#[derive(serde::Serialize, serde::Deserialize)]
pub struct AdminUpdateBossBattleTrainerRequest {
    pub trainer_id: i32,
    pub version: Option<i32>,
}

fn expected_score(player_rating: i32, opponent_rating: i32) -> f64 {
    1.0 / (1.0 + 10f64.powf((opponent_rating - player_rating) as f64 / 400.0))
}

fn require_non_guest_user_id(user: Option<User>) -> Result<String, AppError> {
    match user {
        Some(User::DiscordUser(user)) => Ok(user.user_id),
        Some(User::GuestUser(_)) => Err((
            StatusCode::FORBIDDEN,
            "guests cannot access match history".to_string(),
        )),
        None => Err((
            StatusCode::UNAUTHORIZED,
            "user not authenticated".to_string(),
        )),
    }
}

fn require_referee_user(user: Option<User>) -> Result<User, AppError> {
    let Some(user) = user else {
        return Err((
            StatusCode::UNAUTHORIZED,
            "user not authenticated".to_string(),
        ));
    };

    if !user.has_role_name("Website Dev") {
        return Err((
            StatusCode::FORBIDDEN,
            "user must have Referee role".to_string(),
        ));
    }

    Ok(user)
}

async fn get_user_won_auctions_for_draft(
    state: &ServerState,
    draft_id: Uuid,
    user_id: &str,
) -> Result<Vec<MatchHistoryAuction>, AppError> {
    let auction_rows = sqlx::query(
        "SELECT a.auction_id, a.pokedex_id, p.name, a.form, a.draft_id, a.draft_order, a.state,
                a.action, a.paused_time_remaining, a.winning_bid, a.winning_user_id, a.winning_guest_id,
                a.updated_at, a.created_at
         FROM auctions a
         JOIN pokemon p ON p.pokedex_id = a.pokedex_id AND p.form = a.form
         WHERE a.draft_id = $1
           AND a.winning_user_id = $2
         ORDER BY a.draft_order ASC",
    )
    .bind(draft_id)
    .bind(user_id)
    .fetch_all(&state.db_pool)
    .await
    .map_err(|e: sqlx::Error| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let mut auctions: Vec<MatchHistoryAuction> = Vec::with_capacity(auction_rows.len());
    for row in auction_rows {
        let draft_uuid: Uuid = row
            .try_get("draft_id")
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

        auctions.push(MatchHistoryAuction {
            auction_id: row
                .try_get("auction_id")
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?,
            pokedex_id: row
                .try_get("pokedex_id")
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?,
            name: row
                .try_get("name")
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?,
            form: row
                .try_get("form")
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?,
            draft_id: draft_uuid.to_string(),
            draft_order: row
                .try_get("draft_order")
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?,
            state: row
                .try_get("state")
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?,
            action: row
                .try_get("action")
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?,
            paused_time_remaining: row
                .try_get("paused_time_remaining")
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?,
            winning_bid: row
                .try_get("winning_bid")
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?,
            winning_user_id: row
                .try_get("winning_user_id")
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?,
            winning_guest_id: row
                .try_get("winning_guest_id")
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?,
            updated_at: row
                .try_get("updated_at")
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?,
            created_at: row
                .try_get("created_at")
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?,
        });
    }

    Ok(auctions)
}

#[debug_handler]
pub async fn create_draft(
    State(state): State<ServerState>,
    auth_session: AuthSession<AuthBackend>,
    Json(draft_settings): Json<DraftSettings>,
) -> Result<String, AppError> {
    if contains_profanity(&draft_settings.draft_name) {
        return Err((
            StatusCode::BAD_REQUEST,
            "Draft name contains prohibited language".to_string(),
        ));
    }

    let host = auth_session.user.expect("user should exist");
    let draft = Draft::build(host, draft_settings, state.db_pool.clone()).await?;
    let draft_id = draft.draft_id;
    state.drafts.insert(draft_id, draft);
    Ok(draft_id.to_string())
}

#[debug_handler]
pub async fn list_open_drafts(
    State(state): State<ServerState>,
) -> Result<Json<Vec<DraftLobbyResponse>>, AppError> {
    let drafts = state.drafts;

    let mut open_drafts = vec![];
    for entry in drafts.iter() {
        open_drafts.push(entry.value().get_lobby().await?);
    }

    Ok(Json(open_drafts))
}

#[debug_handler]
pub async fn delete_draft(
    State(state): State<ServerState>,
    Path(draft_id): Path<String>,
    auth_session: AuthSession<AuthBackend>,
) -> Result<(), AppError> {
    let Some(user) = auth_session.user else {
        return Err((StatusCode::UNAUTHORIZED, "User not logged in".to_string()));
    };

    let draft_uuid = Uuid::from_str(&draft_id).map_err(|_| {
        (StatusCode::BAD_REQUEST, "Invalid draft ID".to_string())
    })?;

    let is_host = if let Some(draft) = state.drafts.get(&draft_uuid) {
        draft.host.get_user_id_string() == user.get_user_id_string()
    } else {
        return Err((StatusCode::NOT_FOUND, "Draft not found".to_string()));
    };

    if !is_host {
        return Err((StatusCode::FORBIDDEN, "Only the host can remove this lobby".to_string()));
    }

    if let Some((_, draft)) = state.drafts.remove(&draft_uuid) {
        draft.shutdown().await;
    }

    Ok(())
}

#[debug_handler]
pub async fn get_draft(
    State(state): State<ServerState>,
    Path(draft_id): Path<String>,
) -> Result<Json<DraftResponse>, AppError> {
    let draft_uuid = Uuid::from_str(&draft_id).map_err(|e| {
        (
            StatusCode::BAD_REQUEST,
            format!("requested draft does not exist"),
        )
    })?;
    let Some(draft) = state.drafts.get(&draft_uuid) else {
        return Err((
            StatusCode::BAD_REQUEST,
            format!("requested draft does not exist"),
        ));
    };

    let mut res = draft.get().await?;

    // Attach the last persisted save for every team so a freshly loaded page
    // (spectator or emulator after refresh) sees each player's latest save even
    // when that player has stopped broadcasting live SaveUpdate messages.
    let save_rows = sqlx::query(
        "SELECT COALESCE(user_id, guest_id) AS user_key, save_data
         FROM teams
         WHERE draft_id = $1",
    )
    .bind(draft_uuid)
    .fetch_all(&state.db_pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("db error: {}", e)))?;

    let mut saves: HashMap<String, Option<serde_json::Value>> = HashMap::new();
    for row in save_rows {
        let user_key: Option<String> = row.get("user_key");
        let save_data: Option<serde_json::Value> = row.get("save_data");
        if let Some(key) = user_key {
            saves.insert(key, save_data);
        }
    }
    res.attach_saves(saves);

    Ok(Json(res))
}

#[debug_handler]
pub async fn get_pokemon() -> Result<Json<Vec<Arc<pokemon::Pokemon>>>, AppError> {
    let Some(pokemon) = pokemon::get_pokemon_data(&Vec::new()) else {
        return Err((
            StatusCode::NOT_FOUND,
            "no pokemon data available".to_string(),
        ));
    };

    let non_rental_pokemon = pokemon
        .into_iter()
        .filter(|p| p.obtain_method.as_deref() != Some("Rental"))
        .collect();

    Ok(Json(non_rental_pokemon))
}

#[debug_handler]
pub async fn get_rental_pokemon() -> Result<Json<Vec<Arc<pokemon::Pokemon>>>, AppError> {
    let Some(pokemon) = pokemon::get_pokemon_data(&Vec::new()) else {
        return Err((
            StatusCode::NOT_FOUND,
            "no pokemon data available".to_string(),
        ));
    };

    let rental_pokemon = pokemon
        .into_iter()
        .filter(|p| p.obtain_method.as_deref() == Some("Rental"))
        .collect();

    Ok(Json(rental_pokemon))
}

#[debug_handler]
pub async fn get_leaderboard(
    State(state): State<ServerState>,
) -> Result<Json<Vec<LeaderboardEntry>>, AppError> {
    let user_rows = sqlx::query(
        "SELECT user_id, user_name, global_name, avatar, wins, losses, mmr
         FROM users
         ORDER BY mmr DESC, wins DESC, losses ASC, user_name ASC",
    )
    .fetch_all(&state.db_pool)
    .await
    .map_err(|e: sqlx::Error| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let games_rows = sqlx::query(
        "SELECT t.user_id, COUNT(*)::INT AS games_played
         FROM teams t
         JOIN drafts d ON d.draft_id = t.draft_id
         WHERE t.user_id IS NOT NULL
           AND d.state = 'COMPLETED'
           AND d.ranked = TRUE
         GROUP BY t.user_id",
    )
    .fetch_all(&state.db_pool)
    .await
    .map_err(|e: sqlx::Error| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let mut games_played_by_user: HashMap<String, i32> = HashMap::new();
    for row in games_rows {
        let user_id: String = row
            .try_get("user_id")
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        let games_played: i32 = row
            .try_get("games_played")
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        games_played_by_user.insert(user_id, games_played);
    }

    let pokemon_rows = sqlx::query(
        "SELECT
            a.winning_user_id AS user_id,
            a.pokedex_id,
            p.name,
            NULLIF(a.form, '') AS form,
            COUNT(*)::INT AS drafted_count
         FROM auctions a
         JOIN drafts d ON d.draft_id = a.draft_id
         JOIN pokemon p ON p.pokedex_id = a.pokedex_id AND p.form = a.form
         WHERE a.winning_user_id IS NOT NULL
           AND d.state = 'COMPLETED'
           AND d.ranked = TRUE
         GROUP BY a.winning_user_id, a.pokedex_id, p.name, a.form
         ORDER BY a.winning_user_id, drafted_count DESC, p.name ASC",
    )
    .fetch_all(&state.db_pool)
    .await
    .map_err(|e: sqlx::Error| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let mut most_drafted_by_user: HashMap<String, Vec<LeaderboardPokemon>> = HashMap::new();
    for row in pokemon_rows {
        let user_id: String = row
            .try_get("user_id")
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

        let entry = most_drafted_by_user.entry(user_id).or_default();
        if entry.len() >= 5 {
            continue;
        }

        let pokedex_id: i32 = row
            .try_get("pokedex_id")
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        let name: String = row
            .try_get("name")
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        let form: Option<String> = row
            .try_get("form")
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

        entry.push(LeaderboardPokemon {
            pokedex_id,
            name,
            form,
        });
    }

    let mut leaderboard: Vec<LeaderboardEntry> = Vec::with_capacity(user_rows.len());
    for row in user_rows {
        let user_id: String = row
            .try_get("user_id")
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        let username: String = row
            .try_get("user_name")
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        let global_name: Option<String> = row
            .try_get("global_name")
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        let avatar: Option<String> = row
            .try_get("avatar")
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        let win: i32 = row
            .try_get("wins")
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        let loss: i32 = row
            .try_get("losses")
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        let mmr: i32 = row
            .try_get("mmr")
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

        let games_played = games_played_by_user.get(&user_id).copied().unwrap_or(0);
        let most_drafted_pokemon = most_drafted_by_user.remove(&user_id).unwrap_or_default();

        leaderboard.push(LeaderboardEntry {
            user_id,
            username,
            global_name,
            avatar,
            win,
            loss,
            mmr,
            games_played,
            most_drafted_pokemon,
        });
    }

    Ok(Json(leaderboard))
}

#[debug_handler]
pub async fn get_stats_page_data(
    State(state): State<ServerState>,
) -> Result<Json<StatsPageResponse>, AppError> {
    let player_rows = sqlx::query(
        "SELECT DISTINCT
                COALESCE(t.user_id, t.guest_id) AS user_id,
                COALESCE(u.user_name, g.user_name) AS user_name,
                (t.guest_id IS NOT NULL) AS is_guest
         FROM teams t
         JOIN drafts d ON d.draft_id = t.draft_id
         LEFT JOIN users u ON u.user_id = t.user_id
         LEFT JOIN guests g ON g.user_id = t.guest_id
         WHERE d.state = 'COMPLETED'
           AND EXISTS (
                SELECT 1
                FROM auctions a
                WHERE a.draft_id = t.draft_id
                  AND a.winning_bid IS NOT NULL
           )
         ORDER BY COALESCE(u.user_name, g.user_name) ASC",
    )
    .fetch_all(&state.db_pool)
    .await
    .map_err(|e: sqlx::Error| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let mut players: Vec<StatsPagePlayer> = Vec::with_capacity(player_rows.len());
    for row in player_rows {
        players.push(StatsPagePlayer {
            user_id: row
                .try_get("user_id")
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?,
            user_name: row
                .try_get("user_name")
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?,
            is_guest: row
                .try_get("is_guest")
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?,
        });
    }

    let team_rows = sqlx::query(
        "SELECT t.team_id, t.user_id, t.guest_id, t.draft_id, d.ranked, t.money_remaining,
                t.pokemon_drafted, t.placement, t.pre_match_mmr, t.updated_at, d.created_at
         FROM teams t
         JOIN drafts d ON d.draft_id = t.draft_id
         WHERE d.state = 'COMPLETED'
           AND EXISTS (
                SELECT 1
                FROM auctions a
                WHERE a.draft_id = t.draft_id
                  AND a.winning_bid IS NOT NULL
           )
         ORDER BY d.created_at DESC",
    )
    .fetch_all(&state.db_pool)
    .await
    .map_err(|e: sqlx::Error| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let mut teams: Vec<MatchHistoryTeamRow> = Vec::with_capacity(team_rows.len());
    for row in team_rows {
        let draft_uuid: Uuid = row
            .try_get("draft_id")
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

        teams.push(MatchHistoryTeamRow {
            team_id: row
                .try_get("team_id")
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?,
            user_id: row
                .try_get("user_id")
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?,
            guest_id: row
                .try_get("guest_id")
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?,
            draft_id: draft_uuid.to_string(),
            ranked: row
                .try_get("ranked")
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?,
            money_remaining: row
                .try_get("money_remaining")
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?,
            pokemon_drafted: row
                .try_get("pokemon_drafted")
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?,
            placement: row
                .try_get("placement")
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?,
            pre_match_mmr: row
                .try_get("pre_match_mmr")
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?,
            updated_at: row
                .try_get("updated_at")
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?,
            created_at: row
                .try_get("created_at")
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?,
        });
    }

    let auction_rows = sqlx::query(
        "SELECT a.auction_id, a.pokedex_id, p.name, a.form, a.draft_id, a.draft_order, a.state,
                a.action, a.paused_time_remaining, a.winning_bid, a.winning_user_id, a.winning_guest_id,
                a.updated_at, d.created_at
         FROM auctions a
         JOIN drafts d ON d.draft_id = a.draft_id
         JOIN pokemon p ON p.pokedex_id = a.pokedex_id AND p.form = a.form
         WHERE d.state = 'COMPLETED'
           AND a.winning_bid IS NOT NULL
         ORDER BY d.created_at DESC, a.draft_order ASC",
    )
    .fetch_all(&state.db_pool)
    .await
    .map_err(|e: sqlx::Error| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let mut auctions: Vec<MatchHistoryAuction> = Vec::with_capacity(auction_rows.len());
    for row in auction_rows {
        let draft_uuid: Uuid = row
            .try_get("draft_id")
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

        auctions.push(MatchHistoryAuction {
            auction_id: row
                .try_get("auction_id")
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?,
            pokedex_id: row
                .try_get("pokedex_id")
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?,
            name: row
                .try_get("name")
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?,
            form: row
                .try_get("form")
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?,
            draft_id: draft_uuid.to_string(),
            draft_order: row
                .try_get("draft_order")
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?,
            state: row
                .try_get("state")
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?,
            action: row
                .try_get("action")
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?,
            paused_time_remaining: row
                .try_get("paused_time_remaining")
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?,
            winning_bid: row
                .try_get("winning_bid")
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?,
            winning_user_id: row
                .try_get("winning_user_id")
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?,
            winning_guest_id: row
                .try_get("winning_guest_id")
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?,
            updated_at: row
                .try_get("updated_at")
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?,
            created_at: row
                .try_get("created_at")
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?,
        });
    }

    Ok(Json(StatsPageResponse {
        players,
        teams,
        auctions,
    }))
}

#[debug_handler]
pub async fn get_match_history_by_user_id(
    State(state): State<ServerState>,
    Path(user_id): Path<String>,
) -> Result<Json<Vec<MatchHistoryTeam>>, AppError> {
    let team_rows = sqlx::query(
        "SELECT t.team_id, t.user_id, t.guest_id, t.draft_id,
                d.ranked, d.draft_type, (SELECT COUNT(*)::INT FROM teams team_counts WHERE team_counts.draft_id = t.draft_id) AS team_count,
                t.money_remaining, t.placement,
                t.pre_match_mmr, t.hall_of_fame_team, t.updated_at, d.created_at
         FROM teams t
          JOIN drafts d ON d.draft_id = t.draft_id
                 WHERE (t.user_id = $1 OR t.guest_id = $1)
            AND d.state = 'COMPLETED'
         ORDER BY d.created_at DESC",
    )
    .bind(&user_id)
    .fetch_all(&state.db_pool)
    .await
    .map_err(|e: sqlx::Error| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let mut history: Vec<MatchHistoryTeam> = Vec::with_capacity(team_rows.len());
    for row in team_rows {
        let draft_uuid: Uuid = row
            .try_get("draft_id")
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        let auctions_won = get_user_won_auctions_for_draft(&state, draft_uuid, &user_id).await?;

        let hall_of_fame_value: Option<serde_json::Value> = row
            .try_get("hall_of_fame_team")
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        let hall_of_fame_team = hall_of_fame_value
            .and_then(|v| serde_json::from_value::<Vec<HallOfFamePokemon>>(v).ok());
        history.push(MatchHistoryTeam {
            team_id: row
                .try_get("team_id")
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?,
            user_id: row
                .try_get("user_id")
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?,
            guest_id: row
                .try_get("guest_id")
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?,
            draft_id: draft_uuid.to_string(),
            ranked: row
                .try_get("ranked")
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?,
            draft_type: row
                .try_get("draft_type")
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?,
            team_count: row
                .try_get("team_count")
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?,
            money_remaining: row
                .try_get("money_remaining")
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?,
            pokemon_drafted: auctions_won,
            placement: row
                .try_get("placement")
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?,
            pre_match_mmr: row
                .try_get("pre_match_mmr")
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?,
            hall_of_fame_team,
            updated_at: row
                .try_get("updated_at")
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?,
            created_at: row
                .try_get("created_at")
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?,
        });
    }

    Ok(Json(history))
}

#[debug_handler]
pub async fn join_draft(
    State(state): State<ServerState>,
    Path(draft_id): Path<String>,
    auth_session: AuthSession<AuthBackend>,
    join_request: Option<Json<JoinDraftRequest>>,
) -> Result<(), AppError> {
    let user = auth_session.user.expect("user should exist");
    let password = join_request.and_then(|Json(req)| req.password);
    let draft_uuid = Uuid::from_str(&draft_id).map_err(|e| {
        (
            StatusCode::BAD_REQUEST,
            format!("requested draft does not exist"),
        )
    })?;
    let Some(draft) = state.drafts.get(&draft_uuid) else {
        return Err((
            StatusCode::BAD_REQUEST,
            format!("requested draft does not exist"),
        ));
    };

    draft.join_draft(user, password).await
}

#[debug_handler]
pub async fn get_draft_pokemon(
    State(state): State<ServerState>,
    Path(draft_id): Path<String>,
) -> Result<Json<Vec<Arc<Pokemon>>>, AppError> {
    let draft_uuid = Uuid::from_str(&draft_id).map_err(|_e| {
        (
            StatusCode::BAD_REQUEST,
            format!("requested draft does not exist"),
        )
    })?;
    let Some(draft) = state.drafts.get(&draft_uuid) else {
        return Err((
            StatusCode::BAD_REQUEST,
            format!("requested draft does not exist"),
        ));
    };

    Ok(Json(draft.get_pokemon()))
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct BossBattleHistoryEntry {
    pub trainer_id: i32,
    pub version: Option<i32>,
    pub hours: i32,
    pub minutes: i32,
    pub seconds: i32,
    pub is_loss: bool,
}

#[debug_handler]
pub async fn get_boss_battle_history(
    State(state): State<ServerState>,
    Path(draft_id): Path<String>,
    Query(params): Query<std::collections::HashMap<String, String>>,
) -> Result<Json<Vec<BossBattleHistoryEntry>>, (StatusCode, String)> {
    let draft_uuid = Uuid::from_str(&draft_id).map_err(|_e| {
        (
            StatusCode::BAD_REQUEST,
            format!("invalid draft id"),
        )
    })?;

    // Check if draft exists
    let draft_exists = sqlx::query(
        "SELECT 1 FROM drafts WHERE draft_id = $1"
    )
    .bind(draft_uuid)
    .fetch_optional(&state.db_pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("db error: {}", e)))?;

    if draft_exists.is_none() {
        return Err((StatusCode::NOT_FOUND, "draft not found".to_string()));
    }

    // If user_id is provided, filter by that user
    let user_id_filter = params.get("user_id");
    let query = if let Some(uid) = user_id_filter {
        sqlx::query_as::<_, BossBattleHistoryEntry>(
            "SELECT bbh.trainer_id, bbh.version, bbh.hours, bbh.minutes, bbh.seconds, bbh.is_loss
             FROM boss_battle_history bbh
             JOIN teams t ON bbh.team_id = t.team_id
             WHERE bbh.draft_id = $1 AND (t.user_id = $2 OR t.guest_id = $2)
             ORDER BY bbh.hours ASC, bbh.minutes ASC, bbh.seconds ASC"
        )
        .bind(draft_uuid)
        .bind(uid)
    } else {
        sqlx::query_as::<_, BossBattleHistoryEntry>(
            "SELECT trainer_id, version, hours, minutes, seconds, is_loss
             FROM boss_battle_history
             WHERE draft_id = $1
             ORDER BY hours ASC, minutes ASC, seconds ASC"
        )
        .bind(draft_uuid)
    };

    let history = query
        .fetch_all(&state.db_pool)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("db error: {}", e)))?;

    Ok(Json(history))
}

#[derive(serde::Serialize)]
pub struct AdminHallOfFameTeamEntry {
    pub team_id: i64,
    pub draft_id: String,
    pub draft_name: String,
    pub user_name: Option<String>,
    pub hall_of_fame_team: Vec<HallOfFamePokemon>,
}

#[derive(serde::Serialize, serde::Deserialize, sqlx::FromRow)]
pub struct AdminBossBattleHistoryEntry {
    pub id: i64,
    pub team_id: i64,
    pub draft_id: String,
    pub user_id: Option<String>,
    pub guest_id: Option<String>,
    pub user_name: Option<String>,
    pub trainer_id: i32,
    pub version: Option<i32>,
    pub hours: i32,
    pub minutes: i32,
    pub seconds: i32,
    pub is_loss: bool,
    pub created_at: String,
}

#[debug_handler]
pub async fn get_admin_boss_battle_history(
    State(state): State<ServerState>,
) -> Result<Json<Vec<AdminBossBattleHistoryEntry>>, (StatusCode, String)> {
    let history = sqlx::query_as::<_, AdminBossBattleHistoryEntry>(
        "SELECT bbh.id, bbh.team_id, bbh.draft_id::text, t.user_id, t.guest_id,
                COALESCE(u.user_name, g.user_name) as user_name,
                bbh.trainer_id, bbh.version, bbh.hours, bbh.minutes, bbh.seconds, bbh.is_loss,
                bbh.created_at::text
         FROM boss_battle_history bbh
         JOIN teams t ON bbh.team_id = t.team_id
         LEFT JOIN users u ON t.user_id = u.user_id
         LEFT JOIN guests g ON t.guest_id = g.user_id
         ORDER BY bbh.created_at DESC"
    )
    .fetch_all(&state.db_pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("db error: {}", e)))?;

    Ok(Json(history))
}

#[debug_handler]
pub async fn get_admin_hall_of_fame_teams(
    State(state): State<ServerState>,
    auth_session: AuthSession<AuthBackend>,
) -> Result<Json<Vec<AdminHallOfFameTeamEntry>>, AppError> {
    let _ = require_referee_user(auth_session.user)?;

    let rows = sqlx::query(
        "SELECT t.team_id, t.draft_id, d.draft_name,
                COALESCE(u.user_name, g.user_name) AS user_name,
                t.hall_of_fame_team
         FROM teams t
         JOIN drafts d ON d.draft_id = t.draft_id
         LEFT JOIN users u ON u.user_id = t.user_id
         LEFT JOIN guests g ON g.user_id = t.guest_id
         WHERE d.state = 'COMPLETED'
           AND t.hall_of_fame_team IS NOT NULL
           AND jsonb_array_length(COALESCE(t.hall_of_fame_team::jsonb, '[]'::jsonb)) > 0
         ORDER BY d.created_at DESC, COALESCE(u.user_name, g.user_name) ASC, t.team_id ASC",
    )
    .fetch_all(&state.db_pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let mut entries = Vec::with_capacity(rows.len());
    for row in rows {
        let draft_uuid: Uuid = row
            .try_get("draft_id")
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        let hall_of_fame_value: Option<serde_json::Value> = row
            .try_get("hall_of_fame_team")
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        let hall_of_fame_team = hall_of_fame_value
            .and_then(|value| serde_json::from_value::<Vec<HallOfFamePokemon>>(value).ok())
            .filter(|team| !team.is_empty())
            .unwrap_or_default();

        if hall_of_fame_team.is_empty() {
            continue;
        }

        entries.push(AdminHallOfFameTeamEntry {
            team_id: row
                .try_get("team_id")
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?,
            draft_id: draft_uuid.to_string(),
            draft_name: row
                .try_get("draft_name")
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?,
            user_name: row
                .try_get("user_name")
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?,
            hall_of_fame_team,
        });
    }

    Ok(Json(entries))
}

/// A user/race combination that qualifies for a Hall of Fame team because the
/// player beat Steven (804) or Wally (656), i.e. their run ended with a win.
/// `hours`/`minutes`/`seconds` are the in-game timestamp of the beat.
#[derive(Clone, Debug, Serialize)]
pub struct AdminHallOfFameEligibleEntry {
    pub team_id: i64,
    pub draft_id: String,
    pub draft_name: String,
    pub draft_type: String,
    pub user_id: Option<String>,
    pub user_name: Option<String>,
    pub trainer_id: i32,
    pub beat_name: String,
    pub hours: i32,
    pub minutes: i32,
    pub seconds: i32,
    pub beat_date: chrono::DateTime<chrono::Utc>,
    pub hall_of_fame_team: Vec<HallOfFamePokemon>,
}

fn hall_of_fame_beat_name(trainer_id: i32) -> String {
    match trainer_id {
        804 => "Steven".to_string(),
        656 => "Wally".to_string(),
        _ => get_trainer_name_by_id(trainer_id as u16),
    }
}

/// Lists every user/race combination where the run ended with a win over
/// Steven (804) or Wally (656). When a team has more than one such win, only
/// the latest one (the run it actually ended with) is kept.
async fn fetch_hall_of_fame_eligible(
    state: &ServerState,
) -> Result<Vec<AdminHallOfFameEligibleEntry>, (StatusCode, String)> {
    let rows = sqlx::query(
        "SELECT team_id, draft_id, draft_name, draft_type, user_id, user_name, trainer_id, hours, minutes, seconds, beat_date, hall_of_fame_team
         FROM (
             SELECT DISTINCT ON (bbh.team_id)
                    bbh.team_id, bbh.draft_id, bbh.trainer_id,
                    bbh.hours, bbh.minutes, bbh.seconds,
                    bbh.created_at AS beat_date,
                    d.draft_name, d.draft_type, d.created_at,
                    COALESCE(u.user_id, g.user_id) AS user_id,
                    COALESCE(u.user_name, g.user_name) AS user_name,
                    t.hall_of_fame_team
             FROM boss_battle_history bbh
             JOIN drafts d ON d.draft_id = bbh.draft_id
             JOIN teams t ON t.team_id = bbh.team_id
             LEFT JOIN users u ON u.user_id = t.user_id
             LEFT JOIN guests g ON g.user_id = t.guest_id
             WHERE bbh.trainer_id IN (804, 656)
               AND NOT bbh.is_loss
             ORDER BY bbh.team_id, bbh.hours DESC, bbh.minutes DESC, bbh.seconds DESC
         ) wins
         ORDER BY created_at DESC, user_name ASC, team_id ASC",
    )
    .fetch_all(&state.db_pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let mut entries = Vec::with_capacity(rows.len());
    for row in rows {
        let draft_uuid: Uuid = row
            .try_get("draft_id")
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        let trainer_id: i32 = row
            .try_get("trainer_id")
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        let hall_of_fame_value: Option<serde_json::Value> = row
            .try_get("hall_of_fame_team")
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        let hall_of_fame_team = hall_of_fame_value
            .and_then(|value| serde_json::from_value::<Vec<HallOfFamePokemon>>(value).ok())
            .unwrap_or_default();

        entries.push(AdminHallOfFameEligibleEntry {
            team_id: row
                .try_get("team_id")
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?,
            draft_id: draft_uuid.to_string(),
            draft_name: row
                .try_get("draft_name")
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?,
            draft_type: row
                .try_get("draft_type")
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?,
            user_id: row
                .try_get("user_id")
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?,
            user_name: row
                .try_get("user_name")
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?,
            trainer_id,
            beat_name: hall_of_fame_beat_name(trainer_id),
            hours: row
                .try_get("hours")
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?,
            minutes: row
                .try_get("minutes")
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?,
            seconds: row
                .try_get("seconds")
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?,
            beat_date: row
                .try_get("beat_date")
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?,
            hall_of_fame_team,
        });
    }

    Ok(entries)
}

#[debug_handler]
pub async fn get_admin_hall_of_fame_eligible(
    State(state): State<ServerState>,
    auth_session: AuthSession<AuthBackend>,
) -> Result<Json<Vec<AdminHallOfFameEligibleEntry>>, AppError> {
    let _ = require_referee_user(auth_session.user)?;

    let entries = fetch_hall_of_fame_eligible(&state).await?;
    Ok(Json(entries))
}

#[debug_handler]
pub async fn get_hall_of_fame(
    State(state): State<ServerState>,
) -> Result<Json<Vec<AdminHallOfFameEligibleEntry>>, AppError> {
    let entries = fetch_hall_of_fame_eligible(&state).await?;
    Ok(Json(entries))
}

#[derive(Debug, Deserialize)]
pub struct AdminHallOfFameTeamUpdate {
    pub hall_of_fame_team: Vec<HallOfFamePokemon>,
}

/// Manually sets (or clears) the Hall of Fame team for a user/race
/// combination. Only teams with a recorded win over Steven (804) or Wally
/// (656) may have a Hall of Fame team.
#[debug_handler]
pub async fn update_admin_hall_of_fame_team(
    State(state): State<ServerState>,
    Path(team_id): Path<i64>,
    auth_session: AuthSession<AuthBackend>,
    Json(payload): Json<AdminHallOfFameTeamUpdate>,
) -> Result<(), AppError> {
    let _ = require_referee_user(auth_session.user)?;

    let team_exists = sqlx::query("SELECT 1 FROM teams WHERE team_id = $1")
        .bind(team_id)
        .fetch_optional(&state.db_pool)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    if team_exists.is_none() {
        return Err((
            StatusCode::NOT_FOUND,
            format!("team {} does not exist", team_id),
        ));
    }

    // Only user/race combinations where the player beat the game (Steven or
    // Wally) can have a Hall of Fame team.
    let beat_win = sqlx::query(
        "SELECT 1 FROM boss_battle_history
         WHERE team_id = $1
           AND trainer_id IN (804, 656)
           AND NOT is_loss
         LIMIT 1",
    )
    .bind(team_id)
    .fetch_optional(&state.db_pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    if beat_win.is_none() {
        return Err((
            StatusCode::BAD_REQUEST,
            "only teams that beat Steven or Wally can have a Hall of Fame team".to_string(),
        ));
    }

    let mut hall_of_fame_team: Vec<HallOfFamePokemon> = payload
        .hall_of_fame_team
        .into_iter()
        .take(6)
        .collect();
    for mon in &mut hall_of_fame_team {
        mon.name = mon.name.trim().to_string();
        if mon.name.is_empty() {
            return Err((
                StatusCode::BAD_REQUEST,
                "Hall of Fame pokemon names cannot be empty".to_string(),
            ));
        }
        mon.icon = mon.icon.trim().to_string();
        if mon.icon.is_empty() {
            mon.icon = mon.name.to_lowercase().replace('\'', "");
        }
    }

    if hall_of_fame_team.is_empty() {
        sqlx::query("UPDATE teams SET hall_of_fame_team = NULL WHERE team_id = $1")
            .bind(team_id)
            .execute(&state.db_pool)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        return Ok(());
    }

    let hall_of_fame_value = serde_json::to_value(&hall_of_fame_team).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("failed to serialize hall of fame team: {}", e),
        )
    })?;
    sqlx::query("UPDATE teams SET hall_of_fame_team = $1 WHERE team_id = $2")
        .bind(&hall_of_fame_value)
        .bind(team_id)
        .execute(&state.db_pool)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(())
}

#[derive(Clone, Debug, Serialize)]
pub struct AdminRaceResultTeam {
    pub team_id: i64,
    pub user_name: Option<String>,
    pub result: String,
    pub detail: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct AdminRaceResult {
    pub draft_id: String,
    pub draft_name: String,
    pub teams: Vec<AdminRaceResultTeam>,
}

#[derive(Debug, sqlx::FromRow)]
struct AdminRaceDraftRow {
    draft_id: Uuid,
    draft_name: String,
}

#[derive(Debug, sqlx::FromRow)]
struct AdminRaceTeamRow {
    team_id: i64,
    map_name: Option<String>,
    updated_at: chrono::DateTime<chrono::Utc>,
    user_name: Option<String>,
}

#[derive(Clone, Debug, sqlx::FromRow)]
struct AdminRaceHistoryRow {
    team_id: i64,
    trainer_id: i32,
    version: Option<i32>,
    hours: i32,
    minutes: i32,
    seconds: i32,
    is_loss: bool,
}

fn format_battle_time(hours: i32, minutes: i32, seconds: i32) -> String {
    if hours > 0 {
        format!("{}h {}m {}s", hours, minutes, seconds)
    } else if minutes > 0 {
        format!("{}m {}s", minutes, seconds)
    } else {
        format!("{}s", seconds)
    }
}

fn boss_trainer_name(trainer_id: i32, version: Option<i32>) -> String {
    let base = get_trainer_name_by_id(trainer_id as u16);
    // If the name already encodes the version (e.g. "Brawly 3"), don't append it again.
    if base.chars().last().is_some_and(|c| c.is_ascii_digit()) {
        return base;
    }
    match version {
        Some(v) if v > 0 => format!("{} {}", base, v),
        _ => base,
    }
}

fn most_recent_save_result(
    map_name: Option<String>,
    updated_at: chrono::DateTime<chrono::Utc>,
) -> (String, Option<String>) {
    match map_name {
        Some(map) if !map.trim().is_empty() => (
            "In Progress".to_string(),
            Some(format!(
                "Last save: {} ({})",
                map.replace('_', " "),
                updated_at.format("%Y-%m-%d %H:%M:%S UTC")
            )),
        ),
        _ => ("No Save".to_string(), None),
    }
}

#[debug_handler]
pub async fn get_admin_race_results(
    State(state): State<ServerState>,
    auth_session: AuthSession<AuthBackend>,
) -> Result<Json<Vec<AdminRaceResult>>, AppError> {
    let _ = require_referee_user(auth_session.user)?;

    let drafts = sqlx::query_as::<_, AdminRaceDraftRow>(
        "SELECT d.draft_id, d.draft_name
         FROM drafts d
         WHERE EXISTS (SELECT 1 FROM teams t WHERE t.draft_id = d.draft_id)
         ORDER BY d.created_at DESC",
    )
    .fetch_all(&state.db_pool)
    .await
    .map_err(|e: sqlx::Error| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let mut results = Vec::with_capacity(drafts.len());

    for draft in drafts {
        let teams = sqlx::query_as::<_, AdminRaceTeamRow>(
            "SELECT t.team_id, t.save_data->>'map_name' AS map_name, t.updated_at,
                    COALESCE(u.user_name, g.user_name) AS user_name
             FROM teams t
             LEFT JOIN users u ON u.user_id = t.user_id
             LEFT JOIN guests g ON g.user_id = t.guest_id
             WHERE t.draft_id = $1
             ORDER BY COALESCE(u.user_name, g.user_name) ASC",
        )
        .bind(draft.draft_id)
        .fetch_all(&state.db_pool)
        .await
        .map_err(|e: sqlx::Error| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

        let history_rows = sqlx::query_as::<_, AdminRaceHistoryRow>(
            "SELECT team_id, trainer_id, version, hours, minutes, seconds, is_loss
             FROM boss_battle_history
             WHERE draft_id = $1
             ORDER BY hours ASC, minutes ASC, seconds ASC",
        )
        .bind(draft.draft_id)
        .fetch_all(&state.db_pool)
        .await
        .map_err(|e: sqlx::Error| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

        let mut history_by_team: HashMap<i64, Vec<AdminRaceHistoryRow>> = HashMap::new();
        for row in history_rows {
            history_by_team.entry(row.team_id).or_default().push(row);
        }

        let mut result_teams = Vec::with_capacity(teams.len());
        for team in teams {
            let (result, detail) = match history_by_team.get(&team.team_id) {
                Some(battles) => {
                    if let Some(win) = battles
                        .iter()
                        .find(|b| (b.trainer_id == 804 || b.trainer_id == 656) && !b.is_loss)
                    {
                        (
                            format!("Beat {}", boss_trainer_name(win.trainer_id, win.version)),
                            Some(format_battle_time(win.hours, win.minutes, win.seconds)),
                        )
                    } else if let Some(loss) = battles.iter().filter(|b| b.is_loss).last() {
                        (
                            format!("Wiped to {}", boss_trainer_name(loss.trainer_id, loss.version)),
                            Some(format_battle_time(loss.hours, loss.minutes, loss.seconds)),
                        )
                    } else {
                        most_recent_save_result(team.map_name.clone(), team.updated_at)
                    }
                }
                None => most_recent_save_result(team.map_name.clone(), team.updated_at),
            };

            result_teams.push(AdminRaceResultTeam {
                team_id: team.team_id,
                user_name: team.user_name,
                result,
                detail,
            });
        }

        results.push(AdminRaceResult {
            draft_id: draft.draft_id.to_string(),
            draft_name: draft.draft_name,
            teams: result_teams,
        });
    }

    Ok(Json(results))
}

#[derive(Clone, Debug, Serialize)]
pub struct RaceResultTeam {
    pub team_id: i64,
    pub user_id: Option<String>,
    pub guest_id: Option<String>,
    pub user_name: Option<String>,
    pub placement: Option<i32>,
    pub wipe_trainer: Option<String>,
    pub result: String,
    pub detail: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct DraftRaceResults {
    pub draft_id: String,
    pub draft_name: String,
    pub ranked: bool,
    pub can_edit: bool,
    pub teams: Vec<RaceResultTeam>,
}

#[derive(Debug, sqlx::FromRow)]
struct RaceResultTeamRow {
    team_id: i64,
    user_id: Option<String>,
    guest_id: Option<String>,
    user_name: Option<String>,
    race_placement: Option<i32>,
    race_wipe_trainer: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct RaceResultsUpdate {
    pub teams: Vec<RaceResultUpdateTeam>,
}

#[derive(Debug, Deserialize)]
pub struct RaceResultUpdateTeam {
    pub team_id: i64,
    pub placement: Option<i32>,
    pub wipe_trainer: Option<String>,
}

fn format_battle_time_colon(hours: i32, minutes: i32, seconds: i32) -> String {
    format!("{}:{:02}:{:02}", hours, minutes, seconds)
}

/// Computes the human-readable result summary for a team in a race.
/// Wins on Steven (804) or Wally (656) become "Beat Steven!" / "Beat Wally!",
/// otherwise the most recent wipe (auto-recorded or manually entered) is used.
fn race_result_summary(
    battles: &[AdminRaceHistoryRow],
    wipe_trainer: &Option<String>,
) -> (String, Option<String>) {
    if let Some(win) = battles
        .iter()
        .find(|b| (b.trainer_id == 804 || b.trainer_id == 656) && !b.is_loss)
    {
        return (
            format!("Beat {}!", boss_trainer_name(win.trainer_id, win.version)),
            Some(format_battle_time_colon(win.hours, win.minutes, win.seconds)),
        );
    }

    if let Some(trainer) = wipe_trainer {
        let trainer = trainer.trim();
        if !trainer.is_empty() {
            return (format!("Wiped to {}", trainer), None);
        }
    }

    if let Some(loss) = battles.iter().filter(|b| b.is_loss).last() {
        return (
            format!("Wiped to {}", boss_trainer_name(loss.trainer_id, loss.version)),
            None,
        );
    }

    (String::new(), None)
}

fn user_is_draft_host(user: &User, host_user_id: &Option<String>, host_guest_id: &Option<String>) -> bool {
    let (user_id, guest_id) = user.get_user_and_guest_id();
    match host_user_id {
        Some(host) if Some(host) == user_id.as_ref() => true,
        _ => match host_guest_id {
            Some(host) if Some(host) == guest_id.as_ref() => true,
            _ => false,
        },
    }
}

#[debug_handler]
pub async fn get_draft_race_results(
    State(state): State<ServerState>,
    Path(draft_id): Path<String>,
    auth_session: AuthSession<AuthBackend>,
) -> Result<Json<DraftRaceResults>, AppError> {
    let draft_uuid = Uuid::from_str(&draft_id).map_err(|_| {
        (
            StatusCode::BAD_REQUEST,
            "requested draft does not exist".to_string(),
        )
    })?;

    let draft_row = sqlx::query(
        "SELECT d.draft_name, d.ranked, d.host_user_id, d.host_guest_id
         FROM drafts d
         WHERE d.draft_id = $1",
    )
    .bind(draft_uuid)
    .fetch_optional(&state.db_pool)
    .await
    .map_err(|e: sqlx::Error| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    .ok_or((StatusCode::NOT_FOUND, "draft does not exist".to_string()))?;

    let draft_name: String = draft_row
        .try_get("draft_name")
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let ranked: bool = draft_row
        .try_get("ranked")
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let host_user_id: Option<String> = draft_row
        .try_get("host_user_id")
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let host_guest_id: Option<String> = draft_row
        .try_get("host_guest_id")
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let teams = sqlx::query_as::<_, RaceResultTeamRow>(
        "SELECT t.team_id, t.user_id, t.guest_id, t.race_placement, t.race_wipe_trainer,
                COALESCE(u.user_name, g.user_name) AS user_name
         FROM teams t
         LEFT JOIN users u ON u.user_id = t.user_id
         LEFT JOIN guests g ON g.user_id = t.guest_id
         WHERE t.draft_id = $1
         ORDER BY t.race_placement ASC NULLS LAST, COALESCE(u.user_name, g.user_name) ASC",
    )
    .bind(draft_uuid)
    .fetch_all(&state.db_pool)
    .await
    .map_err(|e: sqlx::Error| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let history_rows = sqlx::query_as::<_, AdminRaceHistoryRow>(
        "SELECT team_id, trainer_id, version, hours, minutes, seconds, is_loss
         FROM boss_battle_history
         WHERE draft_id = $1
         ORDER BY hours ASC, minutes ASC, seconds ASC",
    )
    .bind(draft_uuid)
    .fetch_all(&state.db_pool)
    .await
    .map_err(|e: sqlx::Error| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let mut history_by_team: HashMap<i64, Vec<AdminRaceHistoryRow>> = HashMap::new();
    for row in history_rows {
        history_by_team.entry(row.team_id).or_default().push(row);
    }

    let user = auth_session
        .user
        .ok_or((StatusCode::UNAUTHORIZED, "user not authenticated".to_string()))?;
    let can_edit = user.has_role_name("Website Dev")
        || user.is_race_results_editor()
        || user_is_draft_host(&user, &host_user_id, &host_guest_id);

    let result_teams = teams
        .into_iter()
        .map(|team| {
            let battles = history_by_team.get(&team.team_id).cloned().unwrap_or_default();
            let (result, detail) = race_result_summary(&battles, &team.race_wipe_trainer);
            RaceResultTeam {
                team_id: team.team_id,
                user_id: team.user_id,
                guest_id: team.guest_id,
                user_name: team.user_name,
                placement: team.race_placement,
                wipe_trainer: team.race_wipe_trainer,
                result,
                detail,
            }
        })
        .collect();

    Ok(Json(DraftRaceResults {
        draft_id: draft_uuid.to_string(),
        draft_name,
        ranked,
        can_edit,
        teams: result_teams,
    }))
}

#[debug_handler]
pub async fn update_draft_race_results(
    State(state): State<ServerState>,
    Path(draft_id): Path<String>,
    auth_session: AuthSession<AuthBackend>,
    Json(payload): Json<RaceResultsUpdate>,
) -> Result<(), AppError> {
    let Some(user) = auth_session.user else {
        return Err((StatusCode::UNAUTHORIZED, "user not authenticated".to_string()));
    };

    let draft_uuid = Uuid::from_str(&draft_id).map_err(|_| {
        (
            StatusCode::BAD_REQUEST,
            "requested draft does not exist".to_string(),
        )
    })?;

    let draft_row = sqlx::query(
        "SELECT host_user_id, host_guest_id
         FROM drafts
         WHERE draft_id = $1",
    )
    .bind(draft_uuid)
    .fetch_optional(&state.db_pool)
    .await
    .map_err(|e: sqlx::Error| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    .ok_or((StatusCode::NOT_FOUND, "draft does not exist".to_string()))?;

    let host_user_id: Option<String> = draft_row
        .try_get("host_user_id")
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let host_guest_id: Option<String> = draft_row
        .try_get("host_guest_id")
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    if !user.has_role_name("Website Dev")
        && !user.is_race_results_editor()
        && !user_is_draft_host(&user, &host_user_id, &host_guest_id)
    {
        return Err((
            StatusCode::FORBIDDEN,
            "only the host of the race or an admin can edit race results".to_string(),
        ));
    }

    let team_rows = sqlx::query("SELECT team_id FROM teams WHERE draft_id = $1")
        .bind(draft_uuid)
        .fetch_all(&state.db_pool)
        .await
        .map_err(|e: sqlx::Error| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let mut valid_team_ids: HashSet<i64> = HashSet::new();
    for row in &team_rows {
        valid_team_ids.insert(
            row.try_get("team_id")
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?,
        );
    }
    let team_count = valid_team_ids.len();
    if team_count == 0 {
        return Err((StatusCode::BAD_REQUEST, "draft has no teams".to_string()));
    }

    let submitted = payload.teams;
    if submitted.len() != team_count {
        return Err((
            StatusCode::BAD_REQUEST,
            "placements must be provided for every team".to_string(),
        ));
    }

    let mut seen_team_ids: HashSet<i64> = HashSet::with_capacity(team_count);
    let mut seen_places: HashSet<i32> = HashSet::with_capacity(team_count);
    for team in &submitted {
        if !valid_team_ids.contains(&team.team_id) {
            return Err((
                StatusCode::BAD_REQUEST,
                format!("submitted results for team not in this draft: {}", team.team_id),
            ));
        }
        if !seen_team_ids.insert(team.team_id) {
            return Err((
                StatusCode::BAD_REQUEST,
                format!("duplicate team in results: {}", team.team_id),
            ));
        }
        if let Some(place) = team.placement {
            if place < 1 || place > team_count as i32 {
                return Err((
                    StatusCode::BAD_REQUEST,
                    "placements must be between 1 and number of teams".to_string(),
                ));
            }
            if !seen_places.insert(place) {
                return Err((
                    StatusCode::BAD_REQUEST,
                    "placements must be unique".to_string(),
                ));
            }
        }
        if let Some(wipe) = &team.wipe_trainer {
            if wipe.trim().len() > 100 {
                return Err((
                    StatusCode::BAD_REQUEST,
                    "wipe trainer name is too long".to_string(),
                ));
            }
        }
    }

    if seen_team_ids.len() != team_count {
        return Err((
            StatusCode::BAD_REQUEST,
            "results must be provided for every team".to_string(),
        ));
    }

    let mut tx = state
        .db_pool
        .begin()
        .await
        .map_err(|e: sqlx::Error| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    for team in &submitted {
        let wipe = team
            .wipe_trainer
            .as_ref()
            .map(|w| w.trim().to_string())
            .filter(|w| !w.is_empty());

        sqlx::query(
            "UPDATE teams
             SET race_placement = $1,
                 race_wipe_trainer = $2
             WHERE team_id = $3
               AND draft_id = $4",
        )
        .bind(team.placement)
        .bind(wipe)
        .bind(team.team_id)
        .bind(draft_uuid)
        .execute(&mut *tx)
        .await
        .map_err(|e: sqlx::Error| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    }

    tx.commit()
        .await
        .map_err(|e: sqlx::Error| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(())
}

#[debug_handler]
pub async fn get_current_auction(
    State(state): State<ServerState>,
    Path(draft_id): Path<String>,
) -> Result<Json<Option<AuctionResponse>>, AppError> {
    let draft_uuid = Uuid::from_str(&draft_id).map_err(|_e| {
        (
            StatusCode::BAD_REQUEST,
            format!("requested draft does not exist"),
        )
    })?;
    let Some(draft) = state.drafts.get(&draft_uuid) else {
        return Err((
            StatusCode::BAD_REQUEST,
            format!("requested draft does not exist"),
        ));
    };

    Ok(Json(draft.get_current_auction().await?))
}

#[debug_handler]
pub async fn ready_up(
    State(state): State<ServerState>,
    Path(draft_id): Path<String>,
    auth_session: AuthSession<AuthBackend>,
    ready_request: Option<Json<ReadyUpRequest>>,
) -> Result<(), AppError> {
    let user = auth_session.user.expect("user should exist");
    let ready = ready_request.map(|Json(req)| req.ready).unwrap_or(true);

    let draft_uuid = Uuid::from_str(&draft_id).map_err(|e| {
        (
            StatusCode::BAD_REQUEST,
            format!("requested draft does not exist"),
        )
    })?;
    let Some(draft) = state.drafts.get(&draft_uuid) else {
        return Err((
            StatusCode::BAD_REQUEST,
            format!("requested draft does not exist"),
        ));
    };

    draft.ready_up(user.get_user_id_string()).await
}

#[debug_handler]
pub async fn get_auto_bid(
    State(state): State<ServerState>,
    Path(draft_id): Path<String>,
    auth_session: AuthSession<AuthBackend>,
) -> Result<Json<AutoBidResponse>, AppError> {
    let user = auth_session
        .user
        .ok_or((StatusCode::UNAUTHORIZED, "user not authenticated".to_string()))?;

    let draft_uuid = Uuid::from_str(&draft_id).map_err(|_e| {
        (
            StatusCode::BAD_REQUEST,
            format!("requested draft does not exist"),
        )
    })?;
    let Some(draft) = state.drafts.get(&draft_uuid) else {
        return Err((
            StatusCode::BAD_REQUEST,
            format!("requested draft does not exist"),
        ));
    };

    let res = draft.get_auto_bid(user.get_user_id_string()).await?;

    Ok(Json(res))
}

#[debug_handler]
pub async fn set_auto_bid(
    State(state): State<ServerState>,
    Path(draft_id): Path<String>,
    auth_session: AuthSession<AuthBackend>,
    Json(request): Json<SetAutoBidRequest>,
) -> Result<Json<AutoBidResponse>, AppError> {
    let user = auth_session
        .user
        .ok_or((StatusCode::UNAUTHORIZED, "user not authenticated".to_string()))?;

    let draft_uuid = Uuid::from_str(&draft_id).map_err(|_e| {
        (
            StatusCode::BAD_REQUEST,
            format!("requested draft does not exist"),
        )
    })?;
    let Some(draft) = state.drafts.get(&draft_uuid) else {
        return Err((
            StatusCode::BAD_REQUEST,
            format!("requested draft does not exist"),
        ));
    };

    let res = draft
        .set_auto_bid(user.get_user_id_string(), request.value, request.enabled)
        .await?;

    Ok(Json(res))
}

#[debug_handler]
pub async fn bid(
    State(state): State<ServerState>,
    Path(draft_id): Path<String>,
    auth_session: AuthSession<AuthBackend>,
    Json(bid_request): Json<ClientBidRequest>,
) -> Result<(), AppError> {
    let user = auth_session.user.expect("user should exist");
    let auction_id = bid_request.auction_id;
    let draft_uuid = Uuid::from_str(&draft_id).map_err(|e| {
        (
            StatusCode::BAD_REQUEST,
            format!("requested draft does not exist"),
        )
    })?;
    let Some(draft) = state.drafts.get(&draft_uuid) else {
        return Err((
            StatusCode::BAD_REQUEST,
            format!("requested draft does not exist"),
        ));
    };
    draft.bid(auction_id, bid_request.value, user).await
}

#[debug_handler]
pub async fn one_v_one_pick(
    State(state): State<ServerState>,
    Path(draft_id): Path<String>,
    auth_session: AuthSession<AuthBackend>,
    Json(request): Json<OneVOnePickBanRequest>,
) -> Result<(), AppError> {
    let user = auth_session.user.expect("user should exist");
    let draft_uuid = Uuid::from_str(&draft_id).map_err(|_| {
        (
            StatusCode::BAD_REQUEST,
            format!("requested draft does not exist"),
        )
    })?;
    let Some(draft) = state.drafts.get(&draft_uuid) else {
        return Err((
            StatusCode::BAD_REQUEST,
            format!("requested draft does not exist"),
        ));
    };
    draft
        .one_v_one_pick(user, request.pokedex_id, request.form)
        .await
}

#[debug_handler]
pub async fn one_v_one_ban(
    State(state): State<ServerState>,
    Path(draft_id): Path<String>,
    auth_session: AuthSession<AuthBackend>,
    Json(request): Json<OneVOnePickBanRequest>,
) -> Result<(), AppError> {
    let user = auth_session.user.expect("user should exist");
    let draft_uuid = Uuid::from_str(&draft_id).map_err(|_| {
        (
            StatusCode::BAD_REQUEST,
            format!("requested draft does not exist"),
        )
    })?;
    let Some(draft) = state.drafts.get(&draft_uuid) else {
        return Err((
            StatusCode::BAD_REQUEST,
            format!("requested draft does not exist"),
        ));
    };
    draft
        .one_v_one_ban(user, request.pokedex_id, request.form)
        .await
}

#[debug_handler]
pub async fn one_v_one_toggle_timer(
    State(state): State<ServerState>,
    Path(draft_id): Path<String>,
    auth_session: AuthSession<AuthBackend>,
) -> Result<(), AppError> {
    let user = auth_session.user.expect("user should exist");
    let draft_uuid = Uuid::from_str(&draft_id).map_err(|_| {
        (
            StatusCode::BAD_REQUEST,
            format!("requested draft does not exist"),
        )
    })?;
    let Some(draft) = state.drafts.get(&draft_uuid) else {
        return Err((
            StatusCode::BAD_REQUEST,
            format!("requested draft does not exist"),
        ));
    };
    draft.one_v_one_toggle_timer(user.get_user_id_string()).await
}

#[debug_handler]
pub async fn post_player_save(
    auth_session: AuthSession<AuthBackend>,
    Path(draft_id): Path<String>,
    State(state): State<ServerState>,
    Json(request): Json<PostSaveRequest>,
) -> Result<(), AppError> {
    let PostSaveRequest {
        save_data,
        hall_of_fame_team,
    } = request;
    let Some(user) = auth_session.user else {
        return Err((StatusCode::FORBIDDEN, "user is not logged in".to_string()));
    };
    let Ok(draft_uuid) = Uuid::from_str(&draft_id) else {
        return Err((
            StatusCode::BAD_REQUEST,
            "invalid draft id".to_string(),
        ));
    };

    let user_id = user.get_user_id_string();
    let (user_db_id, guest_db_id) = user.get_user_and_guest_id();

    // Persist to the teams table
    let json_value = serde_json::to_value(&save_data).map_err(|e| {
        (StatusCode::INTERNAL_SERVER_ERROR, format!("failed to serialize save data: {}", e))
    })?;
    sqlx::query(
        "UPDATE teams SET save_data = $1, updated_at = now()
         WHERE draft_id = $2
           AND (user_id = $3 OR guest_id = $4)"
    )
    .bind(&json_value)
    .bind(draft_uuid)
    .bind(&user_db_id)
    .bind(&guest_db_id)
    .execute(&state.db_pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("db error: {}", e)))?;

    // Record the Hall of Fame team on the first save that carries a
    // "Beat Steven" (804) or "Beat Wally" (656) trainer-card win, i.e. the
    // first save after the player has actually beaten the game. A champion
    // win only appears on the trainer card after beating the game, so gym
    // leader wins and early museum visits can never trigger it. The save
    // with the new win can arrive before the warp to the museum or after the
    // player has left it, so the map is not a reliable signal. Only the
    // first team is kept per team, so a later save can never clear or
    // replace it. A party is at most 6 Pokemon, so cap it there.
    if let Some(hall_of_fame_team) = hall_of_fame_team {
        let hall_of_fame_team: Vec<HallOfFamePokemon> =
            hall_of_fame_team.into_iter().take(6).collect();
        let beat_champion = save_data
            .trainer_card_wins
            .iter()
            .any(|win| !win.is_loss && (win.trainer_id == 804 || win.trainer_id == 656));
        if !hall_of_fame_team.is_empty() && beat_champion
        {
            let hall_of_fame_value = serde_json::to_value(&hall_of_fame_team).map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("failed to serialize hall of fame team: {}", e),
                )
            })?;
            sqlx::query(
                "UPDATE teams SET hall_of_fame_team = $1
                 WHERE draft_id = $2
                   AND (user_id = $3 OR guest_id = $4)
                   AND hall_of_fame_team IS NULL"
            )
            .bind(&hall_of_fame_value)
            .bind(draft_uuid)
            .bind(&user_db_id)
            .bind(&guest_db_id)
            .execute(&state.db_pool)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("db error: {}", e)))?;
        }
    }

    // Store boss battle history
    // Get the team ID
    let team_row = sqlx::query(
        "SELECT team_id FROM teams WHERE draft_id = $1 AND (user_id = $2 OR guest_id = $3)"
    )
    .bind(draft_uuid)
    .bind(&user_db_id)
    .bind(&guest_db_id)
    .fetch_optional(&state.db_pool)
    .await;

    let boss_battles_saved = if let Ok(Some(row)) = team_row {
        let team_id: i64 = row.get("team_id");

        // Sort trainer card wins by time to maintain chronological order
        let mut sorted_wins = save_data.trainer_card_wins.clone();
        sorted_wins.sort_by(|a, b| {
            let a_total = a.hours as u64 * 3600 + a.minutes as u64 * 60 + a.seconds as u64;
            let b_total = b.hours as u64 * 3600 + b.minutes as u64 * 60 + b.seconds as u64;
            a_total.cmp(&b_total)
        });

        // Recalculate version numbers for gym leaders based on chronological order
        let gym_leader_ids: std::collections::HashSet<i32> = [265, 855, 266, 267, 268, 269, 270, 271, 272].iter().copied().collect();
        let mut gym_leader_version = 0u32;
        for win in &mut sorted_wins {
            if gym_leader_ids.contains(&(win.trainer_id as i32)) {
                gym_leader_version += 1;
                win.version = Some(gym_leader_version as u8);
            } else {
                win.version = None;
            }
        }

        // Use a transaction to prevent race conditions from concurrent saves
        let mut tx = match state.db_pool.begin().await {
            Ok(tx) => tx,
            Err(e) => {
                eprintln!("[post_player_save] Failed to begin transaction: {}", e);
                return Err((StatusCode::INTERNAL_SERVER_ERROR, format!("db error: {}", e)).into());
            }
        };

        // Delete existing boss battle history for this team/draft
        let _ = sqlx::query(
            "DELETE FROM boss_battle_history WHERE team_id = $1 AND draft_id = $2"
        )
        .bind(team_id)
        .bind(draft_uuid)
        .execute(&mut *tx)
        .await;

        // Insert new boss battle records with deduplication
        let mut count = 0;
        let mut seen_entries = std::collections::HashSet::new();
        for win in &sorted_wins {
            // Create a unique key to detect duplicates within the same submission
            let entry_key = (
                win.trainer_id,
                win.hours,
                win.minutes,
                win.seconds,
                win.is_loss,
            );

            if seen_entries.contains(&entry_key) {
                continue; // Skip duplicate within the same submission
            }
            seen_entries.insert(entry_key);

            let result = sqlx::query(
                "INSERT INTO boss_battle_history (team_id, draft_id, trainer_id, version, hours, minutes, seconds, is_loss)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)"
            )
            .bind(team_id)
            .bind(draft_uuid)
            .bind(win.trainer_id as i32)
            .bind(win.version.map(|v| v as i32))
            .bind(win.hours as i32)
            .bind(win.minutes as i32)
            .bind(win.seconds as i32)
            .bind(win.is_loss)
            .execute(&mut *tx)
            .await;
            if result.is_ok() {
                count += 1;
            }
        }

        if let Err(e) = tx.commit().await {
            eprintln!("[post_player_save] Failed to commit transaction: {}", e);
            return Err((StatusCode::INTERNAL_SERVER_ERROR, format!("db error: {}", e)).into());
        }

        Some(count)
    } else {
        None
    };

    // Broadcast to all WebSocket subscribers so other players update live
    if let Some(draft) = state.drafts.get(&draft_uuid) {
        let _ = draft.broadcast_tx.send(crate::messages::ServerMessage::SaveUpdate {
            user_id: user_id.clone(),
            save_data: save_data.clone(),
        });
    }

    Ok(())
}

#[debug_handler]
pub async fn post_player_forfeit(
    auth_session: AuthSession<AuthBackend>,
    Path(draft_id): Path<String>,
    State(state): State<ServerState>,
    Json(request): Json<ForfeitRequest>,
) -> Result<(), AppError> {
    let Some(user) = auth_session.user else {
        return Err((StatusCode::FORBIDDEN, "user is not logged in".to_string()));
    };
    let Ok(draft_uuid) = Uuid::from_str(&draft_id) else {
        return Err((StatusCode::BAD_REQUEST, "invalid draft id".to_string()));
    };

    let user_id = user.get_user_id_string();
    let (user_db_id, guest_db_id) = user.get_user_and_guest_id();

    // Look up the team and its current stored save data
    let row = sqlx::query(
        "SELECT team_id, save_data FROM teams WHERE draft_id = $1 AND (user_id = $2 OR guest_id = $3)",
    )
    .bind(draft_uuid)
    .bind(&user_db_id)
    .bind(&guest_db_id)
    .fetch_optional(&state.db_pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("db error: {}", e)))?;

    let Some(row) = row else {
        return Err((
            StatusCode::NOT_FOUND,
            "team not found in draft".to_string(),
        ));
    };
    let team_id: i64 = row.get("team_id");
    let save_json: Option<serde_json::Value> = row.get("save_data");

    let mut save_data: SaveData = match save_json {
        Some(value) => serde_json::from_value(value).map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to parse save data: {}", e),
            )
        })?,
        None => SaveData {
            trainer_name: String::new(),
            money: 0,
            badge_count: 0,
            party: Vec::new(),
            r#box: Vec::new(),
            map_name: String::new(),
            trainer_card_wins: Vec::new(),
            most_recent_loss: None,
            most_recent_loss_name: None,
            fainted_pids: Vec::new(),
        },
    };

    let gym_leader_ids: std::collections::HashSet<i32> = [265, 855, 266, 267, 268, 269, 270, 271, 272].iter().copied().collect();
    let gym_leader_wins = save_data
        .trainer_card_wins
        .iter()
        .filter(|w| gym_leader_ids.contains(&(w.trainer_id as i32)) && !w.is_loss)
        .count();

    let loss = TrainerCardWin {
        trainer_id: request.trainer_id,
        hours: request.hours,
        minutes: request.minutes,
        seconds: request.seconds,
        is_loss: true,
        version: if gym_leader_ids.contains(&(request.trainer_id as i32)) {
            Some((gym_leader_wins + 1) as u8)
        } else {
            None
        },
    };
    save_data.trainer_card_wins.push(loss.clone());
    save_data.most_recent_loss = Some(loss.clone());
    save_data.most_recent_loss_name = Some(get_trainer_name_by_id(request.trainer_id));

    // Persist the forfeit loss into the team's save data
    let json_value = serde_json::to_value(&save_data).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("failed to serialize save data: {}", e),
        )
    })?;
    sqlx::query(
        "UPDATE teams SET save_data = $1, updated_at = now()
         WHERE draft_id = $2
           AND (user_id = $3 OR guest_id = $4)",
    )
    .bind(&json_value)
    .bind(draft_uuid)
    .bind(&user_db_id)
    .bind(&guest_db_id)
    .execute(&state.db_pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("db error: {}", e)))?;

    // Record the forfeit loss in boss battle history
    sqlx::query(
        "INSERT INTO boss_battle_history (team_id, draft_id, trainer_id, version, hours, minutes, seconds, is_loss)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
    )
    .bind(team_id)
    .bind(draft_uuid)
    .bind(request.trainer_id as i32)
    .bind(loss.version.map(|v| v as i32))
    .bind(request.hours as i32)
    .bind(request.minutes as i32)
    .bind(request.seconds as i32)
    .bind(true)
    .execute(&state.db_pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("db error: {}", e)))?;

    // Broadcast the updated save so other players see the forfeit live
    if let Some(draft) = state.drafts.get(&draft_uuid) {
        let _ = draft.broadcast_tx.send(crate::messages::ServerMessage::SaveUpdate {
            user_id: user_id.clone(),
            save_data: save_data.clone(),
        });
    }

    Ok(())
}

#[debug_handler]
pub async fn post_state_load_notification(
    auth_session: AuthSession<AuthBackend>,
    Path(draft_id): Path<String>,
    State(state): State<ServerState>,
) -> Result<(), AppError> {
    let Some(user) = auth_session.user else {
        return Err((StatusCode::FORBIDDEN, "user is not logged in".to_string()));
    };
    let Ok(draft_uuid) = Uuid::from_str(&draft_id) else {
        return Err((StatusCode::BAD_REQUEST, "invalid draft id".to_string()));
    };

    let display_name = user.get_global_name()
        .filter(|n| !n.trim().is_empty())
        .unwrap_or_else(|| user.get_user_name_string());

    if let Some(draft) = state.drafts.get(&draft_uuid) {
        let _ = draft.broadcast_tx.send(crate::messages::ServerMessage::StateLoadNotification {
            user_id: user.get_user_id_string(),
            display_name,
        });
    }

    Ok(())
}

pub async fn start_draft(
    auth_session: AuthSession<AuthBackend>,
    Path(draft_id): Path<String>,
    State(state): State<ServerState>,
) -> Result<(), (StatusCode, String)> {
    let Some(user) = auth_session.user else {
        return Err((StatusCode::FORBIDDEN, "user is not logged in".to_string()));
    };

    let Ok(draft_id) = Uuid::from_str(&draft_id) else {
        return Err((
            StatusCode::BAD_REQUEST,
            format!("requested draft does not exist"),
        ));
    };

    let Some(draft) = state.drafts.get(&draft_id) else {
        return Err((StatusCode::NOT_FOUND, "draft does not exist".to_string()));
    };

    draft.start(user.get_user_id_string()).await
}

pub async fn pause_draft(
    auth_session: AuthSession<AuthBackend>,
    Path(draft_id): Path<String>,
    State(state): State<ServerState>,
) -> Result<(), (StatusCode, String)> {
    let Some(user) = auth_session.user else {
        return Err((StatusCode::FORBIDDEN, "user is not logged in".to_string()));
    };

    let Ok(draft_id) = Uuid::from_str(&draft_id) else {
        return Err((
            StatusCode::BAD_REQUEST,
            format!("requested draft does not exist"),
        ));
    };

    let Some(draft) = state.drafts.get(&draft_id) else {
        return Err((StatusCode::NOT_FOUND, "draft does not exist".to_string()));
    };

    draft.pause(user.get_user_id_string()).await
}

pub async fn unpause_draft(
    auth_session: AuthSession<AuthBackend>,
    Path(draft_id): Path<String>,
    State(state): State<ServerState>,
) -> Result<(), (StatusCode, String)> {
    let Some(user) = auth_session.user else {
        return Err((StatusCode::FORBIDDEN, "user is not logged in".to_string()));
    };

    let Ok(draft_id) = Uuid::from_str(&draft_id) else {
        return Err((
            StatusCode::NOT_FOUND,
            format!("requested draft does not exist"),
        ));
    };

    let Some(draft) = state.drafts.get(&draft_id) else {
        return Err((StatusCode::NOT_FOUND, "draft does not exist".to_string()));
    };

    draft.resume(user.get_user_id_string()).await
}

#[debug_handler]
pub async fn submit_race_results(
    State(state): State<ServerState>,
    Path(draft_id): Path<String>,
    auth_session: AuthSession<AuthBackend>,
    Json(placements): Json<HashMap<String, u32>>,
) -> Result<(), (StatusCode, String)> {
    let Some(user) = auth_session.user else {
        return Err((StatusCode::FORBIDDEN, "user is not logged in".to_string()));
    };

    if !user.has_role_name("Website Dev") {
        return Err((
            StatusCode::FORBIDDEN,
            "user must have Referee role".to_string(),
        ));
    }

    let draft_uuid = Uuid::from_str(&draft_id).map_err(|_| {
        (
            StatusCode::BAD_REQUEST,
            "requested draft does not exist".to_string(),
        )
    })?;

    let draft_row = sqlx::query(
        "SELECT state, ranked
         FROM drafts
         WHERE draft_id = $1",
    )
    .bind(draft_uuid)
    .fetch_optional(&state.db_pool)
    .await
    .map_err(|e: sqlx::Error| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    .ok_or((StatusCode::NOT_FOUND, "draft does not exist".to_string()))?;

    let draft_state: String = draft_row
        .try_get("state")
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let is_ranked: bool = draft_row
        .try_get("ranked")
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    if draft_state != DraftState::COMPLETED.to_string() {
        return Err((
            StatusCode::PRECONDITION_FAILED,
            "draft must be completed before submitting results".to_string(),
        ));
    }

    if !is_ranked {
        return Err((
            StatusCode::PRECONDITION_FAILED,
            "results submission only applies to ranked drafts".to_string(),
        ));
    }

    let team_rows = sqlx::query(
        "SELECT user_id
         FROM teams
         WHERE draft_id = $1",
    )
    .bind(draft_uuid)
    .fetch_all(&state.db_pool)
    .await
    .map_err(|e: sqlx::Error| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let mut team_user_ids: Vec<String> = Vec::with_capacity(team_rows.len());
    for row in team_rows {
        let team_user_id: Option<String> = row
            .try_get("user_id")
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        let Some(team_user_id) = team_user_id else {
            return Err((
                StatusCode::BAD_REQUEST,
                "ranked draft teams must map to registered users".to_string(),
            ));
        };
        team_user_ids.push(team_user_id);
    }

    let team_count = team_user_ids.len();
    if team_count == 0 {
        return Err((StatusCode::BAD_REQUEST, "draft has no teams".to_string()));
    }

    if placements.len() != team_count {
        return Err((
            StatusCode::BAD_REQUEST,
            "placements must be provided for every team".to_string(),
        ));
    }

    let team_user_id_set: HashSet<String> = team_user_ids.iter().cloned().collect();
    for submitted_user_id in placements.keys() {
        if !team_user_id_set.contains(submitted_user_id) {
            return Err((
                StatusCode::BAD_REQUEST,
                format!(
                    "submitted placement for non-draft user {}",
                    submitted_user_id
                ),
            ));
        }
    }

    let mut seen_places: HashSet<u32> = HashSet::new();
    for user_id in &team_user_ids {
        let Some(place) = placements.get(user_id) else {
            return Err((
                StatusCode::BAD_REQUEST,
                format!("missing placement for team {}", user_id),
            ));
        };

        if *place == 0 || *place > team_count as u32 {
            return Err((
                StatusCode::BAD_REQUEST,
                "placements must be between 1 and number of teams".to_string(),
            ));
        }

        if !seen_places.insert(*place) {
            return Err((
                StatusCode::BAD_REQUEST,
                "placements must be unique".to_string(),
            ));
        }
    }

    let mmr_rows = sqlx::query("SELECT user_id, mmr FROM users WHERE user_id = ANY($1)")
        .bind(&team_user_ids)
        .fetch_all(&state.db_pool)
        .await
        .map_err(|e: sqlx::Error| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let mut mmr_by_user: HashMap<String, i32> = HashMap::with_capacity(mmr_rows.len());
    for row in mmr_rows {
        let user_id: String = row
            .try_get("user_id")
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        let mmr: i32 = row
            .try_get("mmr")
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        mmr_by_user.insert(user_id, mmr);
    }

    if mmr_by_user.len() != team_count {
        return Err((
            StatusCode::BAD_REQUEST,
            "all submitted teams must map to users with MMR".to_string(),
        ));
    }

    // Fetch how many ranked races each user has completed (including this one)
    let race_counts_rows = sqlx::query(
        "SELECT t.user_id, COUNT(d.draft_id)::INT as count
         FROM teams t
         JOIN drafts d ON d.draft_id = t.draft_id
         WHERE t.user_id = ANY($1)
           AND d.state = 'COMPLETED'
           AND d.ranked = TRUE
         GROUP BY t.user_id"
    )
    .bind(&team_user_ids)
    .fetch_all(&state.db_pool)
    .await
    .map_err(|e: sqlx::Error| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let race_counts: HashMap<String, i32> = race_counts_rows.into_iter().map(|r| {
        (r.get::<String, _>("user_id"), r.get::<i32, _>("count"))
    }).collect();

    let mut updates: HashMap<String, (i32, i32, i32)> = HashMap::with_capacity(team_count);
    for user_id in &team_user_ids {
        let user_rating = *mmr_by_user
            .get(user_id)
            .ok_or((StatusCode::BAD_REQUEST, "missing user MMR".to_string()))?;
        let user_place = *placements
            .get(user_id)
            .ok_or((StatusCode::BAD_REQUEST, "missing placement".to_string()))?;

        let mut mmr_delta = 0.0_f64;
        let mut wins = 0_i32;
        let mut losses = 0_i32;
        let k_factor = get_k_factor(*race_counts.get(user_id).unwrap_or(&1));

        for opponent_id in &team_user_ids {
            if opponent_id == user_id {
                continue;
            }

            let opponent_rating = *mmr_by_user
                .get(opponent_id)
                .ok_or((StatusCode::BAD_REQUEST, "missing opponent MMR".to_string()))?;
            let opponent_place = *placements.get(opponent_id).ok_or((
                StatusCode::BAD_REQUEST,
                "missing opponent placement".to_string(),
            ))?;

            let result = if user_place < opponent_place {
                wins += 1;
                1.0
            } else {
                losses += 1;
                0.0
            };

            let expected = expected_score(user_rating, opponent_rating);
            mmr_delta += k_factor * (result - expected);
        }

        updates.insert(user_id.clone(), (mmr_delta.round() as i32, wins, losses));
    }

    let mut tx = state
        .db_pool
        .begin()
        .await
        .map_err(|e: sqlx::Error| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    for user_id in &team_user_ids {
        let Some((mmr_delta, wins, losses)) = updates.get(user_id) else {
            return Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                "missing computed update".to_string(),
            ));
        };

        sqlx::query(
            "UPDATE users
             SET mmr = mmr + $1,
                 wins = wins + $2,
                 losses = losses + $3
             WHERE user_id = $4",
        )
        .bind(*mmr_delta)
        .bind(*wins)
        .bind(*losses)
        .bind(user_id)
        .execute(&mut *tx)
        .await
        .map_err(|e: sqlx::Error| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    }

    for user_id in &team_user_ids {
        let Some(place) = placements.get(user_id) else {
            return Err((StatusCode::BAD_REQUEST, "missing placement".to_string()));
        };
        let Some(original_mmr) = mmr_by_user.get(user_id) else {
            return Err((StatusCode::BAD_REQUEST, "missing user MMR".to_string()));
        };

        sqlx::query(
            "UPDATE teams
             SET placement = $1,
                 pre_match_mmr = $2
             WHERE draft_id = $3
               AND user_id = $4",
        )
        .bind(*place as i32)
        .bind(*original_mmr)
        .bind(draft_uuid)
        .bind(user_id)
        .execute(&mut *tx)
        .await
        .map_err(|e: sqlx::Error| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    }

    tx.commit()
        .await
        .map_err(|e: sqlx::Error| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(())
}

#[debug_handler]
pub async fn get_admin_completed_drafts(
    State(state): State<ServerState>,
    auth_session: AuthSession<AuthBackend>,
) -> Result<Json<Vec<AdminDraftSummary>>, AppError> {
    let _ = require_referee_user(auth_session.user)?;

    let rows = sqlx::query(
        "SELECT draft_id, draft_name, ranked, state, created_at
         FROM drafts
         WHERE state = 'COMPLETED'
           AND ranked = TRUE
         ORDER BY created_at DESC",
    )
    .fetch_all(&state.db_pool)
    .await
    .map_err(|e: sqlx::Error| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let mut drafts = Vec::with_capacity(rows.len());
    for row in rows {
        drafts.push(AdminDraftSummary {
            draft_id: row
                .try_get::<Uuid, _>("draft_id")
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
                .to_string(),
            draft_name: row
                .try_get("draft_name")
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?,
            ranked: row
                .try_get("ranked")
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?,
            state: row
                .try_get("state")
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?,
            created_at: row
                .try_get("created_at")
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?,
        });
    }

    Ok(Json(drafts))
}

#[debug_handler]
pub async fn get_admin_draft_team_placements(
    State(state): State<ServerState>,
    Path(draft_id): Path<String>,
    auth_session: AuthSession<AuthBackend>,
) -> Result<Json<Vec<AdminDraftTeamPlacement>>, AppError> {
    let _ = require_referee_user(auth_session.user)?;

    let draft_uuid = Uuid::from_str(&draft_id)
        .map_err(|_| (StatusCode::BAD_REQUEST, "invalid draft id".to_string()))?;

    let rows = sqlx::query(
        "SELECT t.team_id, t.draft_id, t.user_id, t.guest_id,
                COALESCE(u.user_name, g.user_name) AS user_name,
                t.placement, t.pre_match_mmr
         FROM teams t
          JOIN drafts d ON d.draft_id = t.draft_id
         LEFT JOIN users u ON u.user_id = t.user_id
         LEFT JOIN guests g ON g.user_id = t.guest_id
         WHERE t.draft_id = $1
            AND d.state = 'COMPLETED'
            AND d.ranked = TRUE
         ORDER BY COALESCE(t.placement, 9999) ASC, COALESCE(u.user_name, g.user_name) ASC",
    )
    .bind(draft_uuid)
    .fetch_all(&state.db_pool)
    .await
    .map_err(|e: sqlx::Error| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let mut teams = Vec::with_capacity(rows.len());
    for row in rows {
        teams.push(AdminDraftTeamPlacement {
            team_id: row
                .try_get("team_id")
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?,
            draft_id: row
                .try_get::<Uuid, _>("draft_id")
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
                .to_string(),
            user_id: row
                .try_get("user_id")
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?,
            guest_id: row
                .try_get("guest_id")
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?,
            user_name: row
                .try_get("user_name")
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?,
            placement: row
                .try_get("placement")
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?,
            pre_match_mmr: row
                .try_get("pre_match_mmr")
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?,
        });
    }

    Ok(Json(teams))
}

#[debug_handler]
pub async fn update_admin_draft_team_placements(
    State(state): State<ServerState>,
    Path(draft_id): Path<String>,
    auth_session: AuthSession<AuthBackend>,
    Json(request): Json<AdminUpdateDraftPlacementsRequest>,
) -> Result<(), AppError> {
    let _ = require_referee_user(auth_session.user)?;

    let draft_uuid = Uuid::from_str(&draft_id)
        .map_err(|_| (StatusCode::BAD_REQUEST, "invalid draft id".to_string()))?;

    let draft_row = sqlx::query(
        "SELECT state, ranked
         FROM drafts
         WHERE draft_id = $1",
    )
    .bind(draft_uuid)
    .fetch_optional(&state.db_pool)
    .await
    .map_err(|e: sqlx::Error| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    .ok_or((StatusCode::NOT_FOUND, "draft does not exist".to_string()))?;

    let draft_state: String = draft_row
        .try_get("state")
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let is_ranked: bool = draft_row
        .try_get("ranked")
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    if draft_state != DraftState::COMPLETED.to_string() {
        return Err((
            StatusCode::PRECONDITION_FAILED,
            "only completed drafts can be edited".to_string(),
        ));
    }

    if !is_ranked {
        return Err((
            StatusCode::PRECONDITION_FAILED,
            "only ranked drafts can be edited here".to_string(),
        ));
    }

    let team_rows = sqlx::query(
        "SELECT team_id, user_id, placement
         FROM teams
         WHERE draft_id = $1",
    )
    .bind(draft_uuid)
    .fetch_all(&state.db_pool)
    .await
    .map_err(|e: sqlx::Error| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let team_count = team_rows.len();
    if team_count == 0 {
        return Err((StatusCode::BAD_REQUEST, "draft has no teams".to_string()));
    }

    if request.placements.len() != team_count {
        return Err((
            StatusCode::BAD_REQUEST,
            "placements must be provided for every team".to_string(),
        ));
    }

    // Map old state for win/loss correction and validation
    let mut old_team_data = HashMap::new();
    for row in &team_rows {
        let tid: i64 = row
            .try_get("team_id")
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        let uid: Option<String> = row
            .try_get("user_id")
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        let place: Option<i32> = row
            .try_get("placement")
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        old_team_data.insert(tid, (uid, place));
    }

    // For manual updates, we need to know what "Race Number" this was for each user at the time it was created
    let race_numbers_rows = sqlx::query(
        "SELECT t.user_id, COUNT(past_drafts.draft_id)::INT as count
         FROM teams t
         JOIN drafts current_draft ON t.draft_id = current_draft.draft_id
         JOIN teams past_teams ON t.user_id = past_teams.user_id
         JOIN drafts past_drafts ON past_teams.draft_id = past_drafts.draft_id
         WHERE t.draft_id = $1
           AND past_drafts.ranked = TRUE
           AND past_drafts.state = 'COMPLETED'
           AND past_drafts.created_at <= current_draft.created_at
         GROUP BY t.user_id"
    )
    .bind(draft_uuid)
    .fetch_all(&state.db_pool)
    .await
    .map_err(|e: sqlx::Error| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let race_numbers: HashMap<String, i32> = race_numbers_rows.into_iter().map(|r| {
        (r.get::<String, _>("user_id"), r.get::<i32, _>("count"))
    }).collect();

    let valid_team_ids: HashSet<i64> = old_team_data.keys().cloned().collect();

    let mut seen_team_ids: HashSet<i64> = HashSet::new();
    let mut seen_places: HashSet<i32> = HashSet::new();
    for entry in &request.placements {
        if !valid_team_ids.contains(&entry.team_id) {
            return Err((
                StatusCode::BAD_REQUEST,
                format!("team {} does not belong to this draft", entry.team_id),
            ));
        }

        if !seen_team_ids.insert(entry.team_id) {
            return Err((
                StatusCode::BAD_REQUEST,
                "duplicate team ids submitted".to_string(),
            ));
        }

        if entry.placement <= 0 || entry.placement > team_count as i32 {
            return Err((
                StatusCode::BAD_REQUEST,
                "placements must be between 1 and number of teams".to_string(),
            ));
        }

        if !seen_places.insert(entry.placement) {
            return Err((
                StatusCode::BAD_REQUEST,
                "placements must be unique".to_string(),
            ));
        }
    }

    // Calculate MMR changes using multiplayer ELO logic
    let mut user_updates = HashMap::new();
    for entry_i in &request.placements {
        let (uid_opt, old_place_opt) = old_team_data.get(&entry_i.team_id).unwrap();
        let Some(user_id) = uid_opt else {
            continue;
        };

        let old_place = old_place_opt.unwrap_or(0);

        let mut mmr_delta = 0.0;
        let mut new_wins = 0;
        let mut new_losses = 0;
        let k_factor = get_k_factor(*race_numbers.get(user_id).unwrap_or(&1));

        for entry_j in &request.placements {
            if entry_i.team_id == entry_j.team_id {
                continue;
            }

            let expected = expected_score(entry_i.pre_match_mmr, entry_j.pre_match_mmr);
            let result = if entry_i.placement < entry_j.placement {
                new_wins += 1;
                1.0
            } else {
                new_losses += 1;
                0.0
            };
            mmr_delta += k_factor * (result - expected);
        }

        // Calculate what the OLD delta was to find the net change
        let mut old_mmr_delta = 0.0;
        let mut old_wins = 0;
        let mut old_losses = 0;
        for entry_j in &request.placements {
            if entry_i.team_id == entry_j.team_id {
                continue;
            }
            let expected = expected_score(entry_i.pre_match_mmr, entry_j.pre_match_mmr);
            let other_old_place = old_team_data.get(&entry_j.team_id).unwrap().1.unwrap_or(99);
            let old_result = if old_place != 0 && old_place < other_old_place {
                old_wins += 1;
                1.0
            } else {
                if old_place != 0 { old_losses += 1; }
                0.0
            };
            old_mmr_delta += k_factor * (old_result - expected);
        }

        let net_mmr_adjustment = (mmr_delta - old_mmr_delta).round() as i32;
        let wins_adj = new_wins - old_wins;
        let losses_adj = new_losses - old_losses;

        user_updates.insert(
            user_id.clone(),
            (
                net_mmr_adjustment,
                wins_adj,
                losses_adj,
                entry_i.pre_match_mmr,
            ),
        );
    }

    let mut tx = state
        .db_pool
        .begin()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    for entry in &request.placements {
        // 1. Update teams table
        sqlx::query(
            "UPDATE teams
             SET placement = $1,
                 pre_match_mmr = $2
             WHERE team_id = $3
               AND draft_id = $4",
        )
        .bind(entry.placement)
        .bind(entry.pre_match_mmr)
        .bind(entry.team_id)
        .bind(draft_uuid)
        .execute(&mut *tx)
        .await
        .map_err(|e: sqlx::Error| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

        // 2. Update users table with new MMR and win/loss tallies
        if let (Some(uid), _) = old_team_data.get(&entry.team_id).unwrap() {
            if let Some((net_adjustment, w_adj, l_adj, _pre_mmr)) = user_updates.get(uid) {
                sqlx::query(
                    "UPDATE users
                     SET mmr = mmr + $1,
                         wins = wins + $2,
                         losses = losses + $3
                     WHERE user_id = $4",
                )
                .bind(net_adjustment)
                .bind(w_adj)
                .bind(l_adj)
                .bind(uid)
                .execute(&mut *tx)
                .await
                .map_err(|e: sqlx::Error| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
            }
        }
    }

    tx.commit()
        .await
        .map_err(|e: sqlx::Error| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(())
}

#[debug_handler]
pub async fn remove_admin_draft_team(
    State(state): State<ServerState>,
    Path((draft_id, team_id)): Path<(String, i64)>,
    auth_session: AuthSession<AuthBackend>,
) -> Result<(), AppError> {
    let _ = require_referee_user(auth_session.user)?;

    let draft_uuid = Uuid::from_str(&draft_id)
        .map_err(|_| (StatusCode::BAD_REQUEST, "invalid draft id".to_string()))?;

    let draft_row = sqlx::query(
        "SELECT state, ranked, num_teams
         FROM drafts
         WHERE draft_id = $1",
    )
    .bind(draft_uuid)
    .fetch_optional(&state.db_pool)
    .await
    .map_err(|e: sqlx::Error| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    .ok_or((StatusCode::NOT_FOUND, "draft does not exist".to_string()))?;

    let draft_state: String = draft_row
        .try_get("state")
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let is_ranked: bool = draft_row
        .try_get("ranked")
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let mut current_num_teams: i32 = draft_row
        .try_get("num_teams")
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    if draft_state != DraftState::COMPLETED.to_string() {
        return Err((
            StatusCode::PRECONDITION_FAILED,
            "only completed drafts can be edited".to_string(),
        ));
    }

    if !is_ranked {
        return Err((
            StatusCode::PRECONDITION_FAILED,
            "only ranked drafts can be edited here".to_string(),
        ));
    }

    let team_rows = sqlx::query(
        "SELECT team_id, user_id, placement, pre_match_mmr
         FROM teams
         WHERE draft_id = $1",
    )
    .bind(draft_uuid)
    .fetch_all(&state.db_pool)
    .await
    .map_err(|e: sqlx::Error| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    if team_rows.is_empty() {
        return Err((StatusCode::BAD_REQUEST, "draft has no teams".to_string()));
    }

    let team_to_remove = team_rows
        .iter()
        .find(|r| r.try_get::<i64, _>("team_id").map_or(false, |id| id == team_id))
        .ok_or((StatusCode::NOT_FOUND, "team not found in this draft".to_string()))?;

    let removed_user_id: Option<String> = team_to_remove
        .try_get("user_id")
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let removed_placement: i32 = team_to_remove
        .try_get::<Option<i32>, _>("placement")
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .unwrap_or(0);
    let removed_pre_mmr: i32 = team_to_remove
        .try_get::<Option<i32>, _>("pre_match_mmr")
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .unwrap_or(1500);

    let mut old_team_data: HashMap<i64, (Option<String>, i32, i32)> = HashMap::new();
    for row in &team_rows {
        let tid: i64 = row
            .try_get("team_id")
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        let uid: Option<String> = row
            .try_get("user_id")
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        let place: i32 = row
            .try_get::<Option<i32>, _>("placement")
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
            .unwrap_or(0);
        let mmr: i32 = row
            .try_get::<Option<i32>, _>("pre_match_mmr")
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
            .unwrap_or(1500);
        old_team_data.insert(tid, (uid, place, mmr));
    }

    let all_team_ids: Vec<i64> = old_team_data.keys().cloned().collect();
    let remaining_team_ids: Vec<i64> = all_team_ids
        .iter()
        .filter(|tid| **tid != team_id)
        .cloned()
        .collect();

    if remaining_team_ids.is_empty() {
        return Err((StatusCode::BAD_REQUEST, "cannot remove the last team from a draft".to_string()));
    }

    let race_numbers_rows = sqlx::query(
        "SELECT t.user_id, COUNT(past_drafts.draft_id)::INT as count
         FROM teams t
         JOIN drafts current_draft ON t.draft_id = current_draft.draft_id
         JOIN teams past_teams ON t.user_id = past_teams.user_id
         JOIN drafts past_drafts ON past_teams.draft_id = past_drafts.draft_id
         WHERE t.draft_id = $1
           AND past_drafts.ranked = TRUE
           AND past_drafts.state = 'COMPLETED'
           AND past_drafts.created_at <= current_draft.created_at
         GROUP BY t.user_id",
    )
    .bind(draft_uuid)
    .fetch_all(&state.db_pool)
    .await
    .map_err(|e: sqlx::Error| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let race_numbers: HashMap<String, i32> = race_numbers_rows
        .into_iter()
        .map(|r| (r.get::<String, _>("user_id"), r.get::<i32, _>("count")))
        .collect();

    let any_placement_set = old_team_data.values().any(|(_, place, _)| *place != 0);

    let mut user_adjustments: HashMap<String, (i32, i32, i32)> = HashMap::new();

    if any_placement_set {
        for tid in &remaining_team_ids {
        let (uid_opt, old_place, pre_mmr) = old_team_data.get(tid).unwrap();
        let Some(user_id) = uid_opt else {
            continue;
        };
        let k_factor = get_k_factor(*race_numbers.get(user_id).unwrap_or(&1));

        let expected = expected_score(*pre_mmr, removed_pre_mmr);
        let old_result = if *old_place != 0 && *old_place < removed_placement {
            1.0
        } else {
            0.0
        };

        let net_mmr_delta = -(k_factor * (old_result - expected)).round() as i32;
        let wins_adj = if old_result == 1.0 { -1 } else { 0 };
        let losses_adj = if old_result == 0.0 && *old_place != 0 { -1 } else { 0 };

        user_adjustments.insert(
            user_id.clone(),
            (
                user_adjustments.get(user_id).map_or(net_mmr_delta, |(m, _, _)| m + net_mmr_delta),
                user_adjustments.get(user_id).map_or(wins_adj, |(_, w, _)| w + wins_adj),
                user_adjustments.get(user_id).map_or(losses_adj, |(_, _, l)| l + losses_adj),
            ),
        );
    }

    if let Some(uid) = &removed_user_id {
        let k_factor = get_k_factor(*race_numbers.get(uid).unwrap_or(&1));

        let mut reversed_mmr = 0.0_f64;
        let mut reversed_wins = 0_i32;
        let mut reversed_losses = 0_i32;

        for other_tid in &all_team_ids {
            if *other_tid == team_id {
                continue;
            }
            let (_, other_place, other_mmr) = old_team_data.get(other_tid).unwrap();
            let expected = expected_score(removed_pre_mmr, *other_mmr);
            if removed_placement != 0 && removed_placement < *other_place {
                reversed_wins += 1;
                reversed_mmr += k_factor * (1.0 - expected);
            } else if removed_placement != 0 {
                reversed_losses += 1;
                reversed_mmr += k_factor * (0.0 - expected);
            }
        }

        user_adjustments.insert(
            uid.clone(),
            (
                -(reversed_mmr.round() as i32),
                -reversed_wins,
                -reversed_losses,
            ),
        );
    }
    }

    let old_placement_map: HashMap<i64, i32> = old_team_data
        .iter()
        .map(|(tid, (_, place, _))| (*tid, *place))
        .collect();

    let mut remaining_with_place: Vec<(i64, i32)> = remaining_team_ids
        .iter()
        .map(|tid| (*tid, *old_placement_map.get(tid).unwrap_or(&9999)))
        .collect();
    remaining_with_place.sort_by_key(|(_, place)| *place);

    let new_placements: HashMap<i64, i32> = remaining_with_place
        .iter()
        .enumerate()
        .map(|(i, (tid, _))| (*tid, (i + 1) as i32))
        .collect();

    let mut tx = state
        .db_pool
        .begin()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    for (uid, (mmr_adj, wins_adj, losses_adj)) in &user_adjustments {
        sqlx::query(
            "UPDATE users
             SET mmr = mmr + $1,
                 wins = wins + $2,
                 losses = losses + $3
             WHERE user_id = $4",
        )
        .bind(mmr_adj)
        .bind(wins_adj)
        .bind(losses_adj)
        .bind(uid)
        .execute(&mut *tx)
        .await
        .map_err(|e: sqlx::Error| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    }

    for tid in &remaining_team_ids {
        let new_place = new_placements.get(tid).unwrap();
        let (_, _, pre_mmr) = old_team_data.get(tid).unwrap();
        sqlx::query(
            "UPDATE teams
             SET placement = $1,
                 pre_match_mmr = $2
             WHERE team_id = $3
               AND draft_id = $4",
        )
        .bind(new_place)
        .bind(pre_mmr)
        .bind(tid)
        .bind(draft_uuid)
        .execute(&mut *tx)
        .await
        .map_err(|e: sqlx::Error| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    }

    sqlx::query("DELETE FROM teams WHERE team_id = $1 AND draft_id = $2")
        .bind(team_id)
        .bind(draft_uuid)
        .execute(&mut *tx)
        .await
        .map_err(|e: sqlx::Error| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    current_num_teams -= 1;
    sqlx::query("UPDATE drafts SET num_teams = $1 WHERE draft_id = $2")
        .bind(current_num_teams)
        .bind(draft_uuid)
        .execute(&mut *tx)
        .await
        .map_err(|e: sqlx::Error| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    tx.commit()
        .await
        .map_err(|e: sqlx::Error| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(())
}

#[debug_handler]
pub async fn admin_recalculate_all_stats(
    State(state): State<ServerState>,
    auth_session: AuthSession<AuthBackend>,
) -> Result<(), AppError> {
    let _ = require_referee_user(auth_session.user.clone())?;

    let mut tx = state.db_pool.begin().await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("failed to start transaction: {}", e),
        )
    })?;

    // 1. Reset all users to base stats
    sqlx::query("UPDATE users SET mmr = 1500, wins = 0, losses = 0")
        .execute(&mut *tx)
        .await
        .map_err(|e: sqlx::Error| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // 2. Fetch all completed ranked drafts in chronological order
    let drafts = sqlx::query(
        "SELECT draft_id FROM drafts WHERE state = 'COMPLETED' AND ranked = TRUE ORDER BY created_at ASC"
    )
    .fetch_all(&mut *tx)
    .await
    .map_err(|e: sqlx::Error| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let mut user_race_counts: HashMap<String, i32> = HashMap::new();

    for draft_row in drafts {
        let draft_id = draft_row.get::<Uuid, _>("draft_id");

        // 3. Fetch team placements for this draft
        let teams = sqlx::query(
            "SELECT user_id, placement FROM teams WHERE draft_id = $1 AND user_id IS NOT NULL AND placement IS NOT NULL",
        )
        .bind(draft_id)
        .fetch_all(&mut *tx)
        .await
        .map_err(|e: sqlx::Error| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

        if teams.len() < 5 {
            continue;
        }

        let team_user_ids: Vec<String> = teams.iter().map(|t| t.get::<String, _>("user_id")).collect();

        // Fetch current user ratings from DB (these reflect the results of all previous drafts in loop)
        let mmr_rows = sqlx::query(
            "SELECT user_id, mmr FROM users WHERE user_id = ANY($1)",
        )
        .bind(&team_user_ids)
        .fetch_all(&mut *tx)
        .await
        .map_err(|e: sqlx::Error| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

        let mmr_by_user: HashMap<String, i32> = mmr_rows.into_iter().map(|r| (r.get::<String, _>("user_id"), r.get::<i32, _>("mmr"))).collect();
        let placements: HashMap<String, i32> = teams.into_iter().map(|t| (t.get::<String, _>("user_id"), t.get::<Option<i32>, _>("placement").unwrap_or(0))).collect();

        let mut draft_updates = HashMap::new();

        for user_id in &team_user_ids {
            let user_rating = *mmr_by_user.get(user_id).unwrap();
            let user_place = *placements.get(user_id).unwrap();

            let count = user_race_counts.entry(user_id.clone()).or_insert(0);
            *count += 1;
            let k_factor = get_k_factor(*count);

            let mut mmr_delta = 0.0;
            let mut wins = 0;
            let mut losses = 0;
            for opponent_id in &team_user_ids {
                if opponent_id == user_id { continue; }
                let opponent_rating = *mmr_by_user.get(opponent_id).unwrap();
                let opponent_place = *placements.get(opponent_id).unwrap();

                let result = if user_place < opponent_place {
                    wins += 1;
                    1.0
                } else {
                    losses += 1;
                    0.0
                };
                let expected = expected_score(user_rating, opponent_rating);
                mmr_delta += k_factor * (result - expected);
            }

            draft_updates.insert(user_id.clone(), (mmr_delta.round() as i32, wins, losses, user_rating));
        }

        for (uid, (delta, w, l, pre_mmr)) in draft_updates {
            sqlx::query(
                "UPDATE users SET mmr = mmr + $1, wins = wins + $2, losses = losses + $3 WHERE user_id = $4",
            )
            .bind(delta)
            .bind(w)
            .bind(l)
            .bind(uid.clone())
            .execute(&mut *tx).await.map_err(|e: sqlx::Error| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
            
            sqlx::query(
                "UPDATE teams SET pre_match_mmr = $1 WHERE draft_id = $2 AND user_id = $3",
            )
            .bind(pre_mmr)
            .bind(draft_id)
            .bind(uid)
            .execute(&mut *tx).await.map_err(|e: sqlx::Error| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        }
    }

    tx.commit().await.map_err(|e: sqlx::Error| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(())
}

#[debug_handler]
pub async fn get_admin_discord_users(
    State(state): State<ServerState>,
    auth_session: AuthSession<AuthBackend>,
) -> Result<Json<Vec<AdminDiscordUser>>, AppError> {
    let _ = require_referee_user(auth_session.user)?;

    let rows = sqlx::query(
        "SELECT user_id, user_name, discriminator, global_name, avatar,
                wins, losses, mmr, updated_at, created_at
         FROM users
         ORDER BY mmr DESC, user_name ASC",
    )
    .fetch_all(&state.db_pool)
    .await
    .map_err(|e: sqlx::Error| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let mut users = Vec::with_capacity(rows.len());
    for row in rows {
        users.push(AdminDiscordUser {
            user_id: row
                .try_get("user_id")
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?,
            user_name: row
                .try_get("user_name")
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?,
            discriminator: row
                .try_get("discriminator")
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?,
            global_name: row
                .try_get("global_name")
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?,
            avatar: row
                .try_get("avatar")
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?,
            wins: row
                .try_get("wins")
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?,
            losses: row
                .try_get("losses")
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?,
            mmr: row
                .try_get("mmr")
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?,
            updated_at: row
                .try_get("updated_at")
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?,
            created_at: row
                .try_get("created_at")
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?,
        });
    }

    Ok(Json(users))
}

#[debug_handler]
pub async fn update_admin_discord_user(
    State(state): State<ServerState>,
    Path(user_id): Path<String>,
    auth_session: AuthSession<AuthBackend>,
    Json(request): Json<AdminUpdateDiscordUserRequest>,
) -> Result<(), AppError> {
    let _ = require_referee_user(auth_session.user)?;

    sqlx::query(
        "UPDATE users
         SET mmr = $1,
             wins = $2,
             losses = $3
         WHERE user_id = $4",
    )
    .bind(request.mmr)
    .bind(request.wins)
    .bind(request.losses)
    .bind(&user_id)
    .execute(&state.db_pool)
    .await
    .map_err(|e: sqlx::Error| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(())
}

#[debug_handler]
pub async fn update_admin_boss_battle_trainer(
    State(state): State<ServerState>,
    Path(id): Path<i64>,
    auth_session: AuthSession<AuthBackend>,
    Json(request): Json<AdminUpdateBossBattleTrainerRequest>,
) -> Result<(), AppError> {
    let _ = require_referee_user(auth_session.user)?;

    sqlx::query(
        "UPDATE boss_battle_history
         SET trainer_id = $1,
             version = $2
         WHERE id = $3",
    )
    .bind(request.trainer_id)
    .bind(request.version)
    .bind(id)
    .execute(&state.db_pool)
    .await
    .map_err(|e: sqlx::Error| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(())
}

#[debug_handler]
pub async fn update_pending_draft_settings(
    State(state): State<ServerState>,
    Path(draft_id): Path<String>,
    auth_session: AuthSession<AuthBackend>,
    Json(update_request): Json<UpdatePendingDraftSettingsRequest>,
) -> Result<Json<DraftResponse>, (StatusCode, String)> {
    let Some(user) = auth_session.user else {
        return Err((StatusCode::FORBIDDEN, "user is not logged in".to_string()));
    };

    let draft_uuid = Uuid::from_str(&draft_id).map_err(|e| {
        (
            StatusCode::BAD_REQUEST,
            format!("requested draft does not exist"),
        )
    })?;
    let draft = state.drafts.get(&draft_uuid).map(|d| d.value().clone());
    let Some(draft) = draft else {
        return Err((StatusCode::NOT_FOUND, "draft does not exist".to_string()));
    };

    let response = draft
        .update_pending_settings(
            user.get_user_id_string(),
            update_request.num_teams,
            update_request.num_auctions,
            update_request.remove_team_ids,
        )
        .await?;

    Ok(Json(response))
}

#[debug_handler]
pub async fn claim_eeveelution(
    State(state): State<ServerState>,
    Path(draft_id): Path<String>,
    auth_session: AuthSession<AuthBackend>,
    Json(claim_request): Json<ClaimEeveelutionRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let user = auth_session.user.ok_or((
        StatusCode::UNAUTHORIZED,
        "user not authenticated".to_string(),
    ))?;

    let draft_uuid = Uuid::from_str(&draft_id).map_err(|e| {
        (
            StatusCode::BAD_REQUEST,
            format!("requested draft does not exist"),
        )
    })?;
    let draft = state.drafts.get(&draft_uuid).map(|d| d.value().clone());
    let Some(draft) = draft else {
        return Err((StatusCode::NOT_FOUND, "draft not found".to_string()));
    };

    let result = draft
        .claim_eeveelution(
            user,
            claim_request.pokedex_id,
            claim_request.form,
            claim_request.target_user_id,
        )
        .await?;
    Ok(Json(result))
}

#[debug_handler]
pub async fn unclaim_eeveelution(
    State(state): State<ServerState>,
    Path(draft_id): Path<String>,
    auth_session: AuthSession<AuthBackend>,
    Json(claim_request): Json<ClaimEeveelutionRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let user = auth_session.user.ok_or((
        StatusCode::UNAUTHORIZED,
        "user not authenticated".to_string(),
    ))?;

    let draft_uuid = Uuid::from_str(&draft_id).map_err(|e| {
        (
            StatusCode::BAD_REQUEST,
            format!("requested draft does not exist"),
        )
    })?;
    let draft = state.drafts.get(&draft_uuid).map(|d| d.value().clone());
    let Some(draft) = draft else {
        return Err((StatusCode::NOT_FOUND, "draft not found".to_string()));
    };

    let result = draft
        .unclaim_eeveelution(
            user,
            claim_request.pokedex_id,
            claim_request.form,
            claim_request.target_user_id,
        )
        .await?;
    Ok(Json(result))
}

#[debug_handler]
pub async fn get_draft_chats(
    State(state): State<ServerState>,
    Path(draft_id): Path<String>,
) -> Result<Json<Vec<ChatMessage>>, (StatusCode, String)> {
    let draft_uuid = Uuid::from_str(&draft_id)
        .map_err(|_| (StatusCode::BAD_REQUEST, "invalid draft id".to_string()))?;

    let rows = sqlx::query(
        "SELECT c.chat_id, c.draft_id, c.user_id, COALESCE(u.user_name, c.user_id) AS user_name, c.message, c.created_at
         FROM chats c
         LEFT JOIN users u ON u.user_id = c.user_id
         WHERE c.draft_id = $1
         ORDER BY c.created_at ASC",
    )
    .bind(draft_uuid)
    .fetch_all(&state.db_pool)
    .await
    .map_err(|e: sqlx::Error| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let chats = rows
        .into_iter()
        .map(|row| {
            Ok(ChatMessage {
                chat_id: row.try_get("chat_id")?,
                draft_id: row.try_get::<Uuid, _>("draft_id")?.to_string(),
                user_id: row.try_get("user_id")?,
                user_name: row.try_get("user_name")?,
                message: row.try_get("message")?,
                created_at: row.try_get("created_at")?,
            })
        })
        .collect::<Result<Vec<_>, sqlx::Error>>()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(chats))
}

#[debug_handler]
pub async fn create_draft_chat(
    State(state): State<ServerState>,
    Path(draft_id): Path<String>,
    auth_session: AuthSession<AuthBackend>,
    Json(request): Json<CreateChatRequest>,
) -> Result<Json<ChatMessage>, (StatusCode, String)> {
    let draft_uuid = Uuid::from_str(&draft_id)
        .map_err(|_| (StatusCode::BAD_REQUEST, "invalid draft id".to_string()))?;

    let user = auth_session.user.ok_or((
        StatusCode::UNAUTHORIZED,
        "user not authenticated".to_string(),
    ))?;

    if matches!(user, User::GuestUser(_)) {
        return Err((
            StatusCode::FORBIDDEN,
            "guests cannot send messages".to_string(),
        ));
    }

    let message = request.message.trim();
    if message.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            "message cannot be empty".to_string(),
        ));
    }

    if contains_profanity(message) {
        return Err((
            StatusCode::BAD_REQUEST,
            "Message contains prohibited language".to_string(),
        ));
    }

    let user_id = user.get_user_id_string();
    let row = sqlx::query(
        "WITH inserted AS (
            INSERT INTO chats (draft_id, user_id, message)
            VALUES ($1, $2, $3)
            RETURNING chat_id, draft_id, user_id, message, created_at
        )
        SELECT i.chat_id, i.draft_id, i.user_id, COALESCE(u.user_name, i.user_id) AS user_name, i.message, i.created_at
        FROM inserted i
        LEFT JOIN users u ON u.user_id = i.user_id",
    )
    .bind(draft_uuid)
    .bind(&user_id)
    .bind(message)
    .fetch_one(&state.db_pool)
    .await
    .map_err(|e: sqlx::Error| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let chat_id = row
        .try_get("chat_id")
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let user_id = row
        .try_get("user_id")
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let user_name = row
        .try_get("user_name")
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let message = row
        .try_get("message")
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let created_at = row
        .try_get("created_at")
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let chat_message = ChatMessage {
        chat_id,
        draft_id: draft_id.clone(),
        user_id,
        user_name,
        message,
        created_at,
    };

    if let Some(draft) = state.drafts.get(&draft_uuid) {
        let _ = draft
            .broadcast_tx
            .send(ServerMessage::NewMessage(chat_message.clone()));
    }

    Ok(Json(chat_message))
}
pub async fn discord_oauth_redirect(
    auth_session: AuthSession<AuthBackend>,
    session: Session,
) -> Redirect {
    let (auth_url, csrf_state) = auth_session.backend.authorize_url();

    session
        .insert(CSRF_STATE_KEY, csrf_state.secret())
        .await
        .expect("serialization should not fail");

    Redirect::to(auth_url.as_str())
}

#[derive(Clone, Debug, Deserialize)]
pub struct AuthResponse {
    code: String,
    state: CsrfToken,
}

#[debug_handler]
pub async fn discord_callback(
    mut auth_session: AuthSession<AuthBackend>,
    session: Session,
    Query(AuthResponse {
        code,
        state: new_state,
    }): Query<AuthResponse>,
) -> Result<Redirect, String> {
    let Ok(Some(old_state)) = session.get(CSRF_STATE_KEY).await else {
        return Err("missing csrf state".to_string());
    };

    let creds = Credentials::Discord(DiscordCreds {
        code,
        old_state,
        new_state,
    });

    let Some(user) = auth_session
        .authenticate(creds)
        .await
        .map_err(|e| e.to_string())?
    else {
        return Err("failed to authenticate".to_string());
    };

    if auth_session.login(&user).await.is_err() {
        return Err("failed to login".to_string());
    }

    Ok(Redirect::to("/"))
}

#[debug_handler]
pub async fn me(auth_session: AuthSession<AuthBackend>) -> Result<Json<User>, String> {
    match auth_session.user {
        Some(user) => Ok(Json(user)),
        None => return Err("user is not logged in".to_string()),
    }
}

#[derive(Debug, Deserialize)]
pub struct ControlBindingsRequest {
    pub control_bindings: serde_json::Value,
}

#[debug_handler]
pub async fn save_control_bindings(
    State(state): State<ServerState>,
    auth_session: AuthSession<AuthBackend>,
    Json(req): Json<ControlBindingsRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let user = auth_session.user.ok_or((
        StatusCode::UNAUTHORIZED,
        "user is not logged in".to_string(),
    ))?;

    let user_id = user.get_user_id_string();

    let (table_name, query) = match user {
        User::DiscordUser(_) => (
            "users",
            sqlx::query("UPDATE users SET control_bindings = $1 WHERE user_id = $2")
        ),
        User::GuestUser(_) => (
            "guests",
            sqlx::query("UPDATE guests SET control_bindings = $1 WHERE user_id = $2")
        ),
    };

    query
        .bind(req.control_bindings)
        .bind(&user_id)
        .execute(&state.db_pool)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to save control bindings: {}", e)))?;

    Ok(Json(serde_json::json!({ "success": true })))
}

#[debug_handler]
pub async fn get_control_bindings(
    State(state): State<ServerState>,
    auth_session: AuthSession<AuthBackend>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let user = auth_session.user.ok_or((
        StatusCode::UNAUTHORIZED,
        "user is not logged in".to_string(),
    ))?;

    let user_id = user.get_user_id_string();

    let query = match user {
        User::DiscordUser(_) => sqlx::query("SELECT control_bindings FROM users WHERE user_id = $1"),
        User::GuestUser(_) => sqlx::query("SELECT control_bindings FROM guests WHERE user_id = $1"),
    };

    let row = query
        .bind(&user_id)
        .fetch_optional(&state.db_pool)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to fetch control bindings: {}", e)))?;

    let control_bindings = row
        .and_then(|r| r.try_get::<serde_json::Value, _>(0).ok());

    Ok(Json(control_bindings.unwrap_or(serde_json::json!(null))))
}

#[debug_handler]
pub async fn websocket_handler(
    State(state): State<ServerState>,
    Path(draft_id): Path<String>,
    ws: WebSocketUpgrade,
) -> Result<Response<Body>, (StatusCode, String)> {
    let draft_uuid = Uuid::from_str(&draft_id).map_err(|e| {
        (
            StatusCode::BAD_REQUEST,
            format!("requested draft does not exist"),
        )
    })?;
    let Some(draft) = state.drafts.get(&draft_uuid) else {
        return Err((
            StatusCode::BAD_REQUEST,
            format!("requested draft does not exist"),
        ));
    };
    let tx = draft.broadcast_tx.clone();
    let presence = draft.presence.clone();
    Ok(ws.on_upgrade(move |socket| handle_websocket(socket, tx, presence)))
}

async fn handle_websocket(
    mut socket: WebSocket,
    tx: broadcast::Sender<ServerMessage>,
    presence: Arc<dashmap::DashMap<String, usize>>,
) {
    let mut rx = tx.subscribe();
    // The player user_id this socket registered itself as (via PresenceRegister).
    // Only the emulator page sends that message, so spectators stay anonymous.
    let mut registered_user: Option<String> = None;

    // Tell a freshly connected client who is already online so it can render
    // connected/disconnected state immediately instead of waiting for events.
    let connected: Vec<String> = presence
        .iter()
        .filter(|e| *e.value() > 0)
        .map(|e| e.key().clone())
        .collect();
    if let Ok(json_text) = serde_json::to_string(&ServerMessage::PresenceSnapshot {
        user_ids: connected,
    }) {
        if socket
            .send(Message::Text(json_text.into()))
            .await
            .is_err()
        {
            return;
        }
    }

    loop {
        tokio::select! {
            Ok(msg) = rx.recv() => {
                match serde_json::to_string(&msg) {
                    Ok(json_text) => {
                        if socket.send(Message::Text(json_text.into())).await.is_err() {
                            break;
                        }
                    },
                    Err(e) => eprintln!("Failed to serialize message: {}", e),
                }
            }
            Some(result) = socket.recv() => {
                if result.is_err() {
                    break;
                }
                if let Ok(Message::Text(text)) = result {
                    // Handle incoming messages from clients
                    if let Ok(client_msg) = serde_json::from_str::<serde_json::Value>(&text) {
                        if let Some(msg_type) = client_msg.get("type").and_then(|v| v.as_str()) {
                            if msg_type == "PresenceRegister" {
                                if let Some(user_id) = client_msg
                                    .get("data")
                                    .and_then(|d| d.get("user_id"))
                                    .and_then(|v| v.as_str())
                                {
                                    let user_id = user_id.to_string();
                                    // Multiple emulator tabs for the same player
                                    // are fine: only the 0 -> 1 transition means
                                    // they were offline and are now online.
                                    let was_offline = {
                                        let mut count = presence
                                            .entry(user_id.clone())
                                            .or_insert(0);
                                        *count += 1;
                                        *count == 1
                                    };
                                    registered_user = Some(user_id.clone());
                                    if was_offline {
                                        let _ = tx.send(ServerMessage::PlayerConnected { user_id });
                                    }
                                }
                            }
                            if msg_type == "WipeNotification" {
                                if let Some(data) = client_msg.get("data") {
                                    if let (Some(username), Some(trainer)) = (
                                        data.get("username").and_then(|v| v.as_str()),
                                        data.get("trainer").and_then(|v| v.as_str())
                                    ) {
                                        let _ = tx.send(ServerMessage::WipeNotification {
                                            username: username.to_string(),
                                            trainer: trainer.to_string(),
                                        });
                                    }
                                }
                            }
                            if msg_type == "WinNotification" {
                                if let Some(data) = client_msg.get("data") {
                                    if let (Some(username), Some(trainer)) = (
                                        data.get("username").and_then(|v| v.as_str()),
                                        data.get("trainer").and_then(|v| v.as_str())
                                    ) {
                                        let _ = tx.send(ServerMessage::WinNotification {
                                            username: username.to_string(),
                                            trainer: trainer.to_string(),
                                        });
                                    }
                                }
                            }
                            if msg_type == "ReadyToRace" {
                                if let Some(data) = client_msg.get("data") {
                                    if let (Some(user_id), Some(user_name)) = (
                                        data.get("user_id").and_then(|v| v.as_str()),
                                        data.get("user_name").and_then(|v| v.as_str())
                                    ) {
                                        let _ = tx.send(ServerMessage::ReadyToRace {
                                            user_id: user_id.to_string(),
                                            user_name: user_name.to_string(),
                                        });
                                    }
                                }
                            }
                            if msg_type == "ReadyToRaceCancelled" {
                                if let Some(data) = client_msg.get("data") {
                                    if let Some(user_id) = data.get("user_id").and_then(|v| v.as_str()) {
                                        let _ = tx.send(ServerMessage::ReadyToRaceCancelled {
                                            user_id: user_id.to_string(),
                                        });
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // The socket dropped (tab closed, page navigated away, network blip that
    // didn't recover). Release this socket's presence registration and tell the
    // lobby the player left once their last connection is gone.
    if let Some(user_id) = registered_user {
        let remaining = match presence.entry(user_id.clone()) {
            entry::Entry::Occupied(mut e) => {
                *e.get_mut() = e.get().saturating_sub(1);
                let remaining = *e.get();
                if remaining == 0 {
                    e.remove();
                }
                remaining
            }
            entry::Entry::Vacant(_) => 0,
        };
        if remaining == 0 {
            let _ = tx.send(ServerMessage::PlayerDisconnected { user_id });
        }
    }
}

#[debug_handler]
pub async fn logout(
    mut auth_session: AuthSession<AuthBackend>,
    session: Session,
) -> Result<Redirect, String> {
    // Log out the user
    if let Err(_e) = auth_session.logout().await {
        return Err("failed to logout".to_string());
    }
    // Clear the session
    session.clear().await;
    Ok(Redirect::to("/"))
}

#[debug_handler]
pub async fn change_guest_name(
    mut auth_session: AuthSession<AuthBackend>,
    State(state): State<ServerState>,
    Json(req): Json<ChangeGuestNameRequest>,
) -> Result<Json<String>, (StatusCode, String)> {
    let user_id = match auth_session.user {
        Some(User::GuestUser(ref guest)) => guest.user_id.clone(),
        _ => {
            return Err((
                StatusCode::FORBIDDEN,
                "Only guests can change their name".to_string(),
            ));
        }
    };
    let new_name = req.new_name.trim();
    if new_name.is_empty() || new_name.len() > 32 {
        return Err((
            StatusCode::BAD_REQUEST,
            "Name must be 1-32 characters".to_string(),
        ));
    }

    if contains_profanity(new_name) {
        return Err((
            StatusCode::BAD_REQUEST,
            "Guest name contains prohibited language".to_string(),
        ));
    }

    let res = sqlx::query("UPDATE guests SET user_name = $1 WHERE user_id = $2")
        .bind(new_name)
        .bind(&user_id)
        .execute(&state.db_pool)
        .await;
    match res {
        Ok(_) => {
            // Update the auth session with the new name
            if let Some(User::GuestUser(guest)) = auth_session.user.as_mut() {
                guest.user_name = new_name.to_string();
            }
            // Update all teams in active drafts for this guest
            for draft_ref in state.drafts.iter() {
                let draft = draft_ref.value();
                draft
                    .update_user_name(user_id.clone(), new_name.to_string())
                    .await;
            }
            Ok(Json(new_name.to_string()))
        }
        Err(e) => Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("DB error: {}", e),
        )),
    }
}

#[debug_handler]
pub async fn post_pokemon_data(
    auth_session: AuthSession<AuthBackend>,
    State(state): State<ServerState>,
    mut multipart: Multipart,
) -> Result<(), AppError> {
    let Some(user) = auth_session.user else {
        return Err((StatusCode::UNAUTHORIZED, format!("user must be logged in")));
    };
    if !user.has_role_name("Website Dev") {
        return Err((StatusCode::UNAUTHORIZED, format!("user must be a dev")));
    }

    while let Some(field) = multipart.next_field().await.map_err(|e| {
        (
            StatusCode::BAD_REQUEST,
            format!("failed to parse multipart payload, {}", e),
        )
    })? {
        if field.name() == Some("file") {
            let data = field.bytes().await.map_err(|e| {
                (
                    StatusCode::BAD_REQUEST,
                    format!("failed to parse file, {}", e),
                )
            })?;
            let mut rdr = csv::Reader::from_reader(data.as_ref());

            let mut records = Vec::new();

            for result in rdr.deserialize() {
                let record: PokemonCsvRecord = result.map_err(|e| {
                    (
                        StatusCode::BAD_REQUEST,
                        format!("failed to parse multipart payload, {}", e),
                    )
                })?;
                records.push(record);
            }

            return pokemon_data_updater::update_pokemon_data(state.db_pool.clone(), records).await;
        }
    }

    Err((StatusCode::BAD_REQUEST, format!("missing csv file")))
}

#[debug_handler]
pub async fn post_pokemon_key_moves_data(
    auth_session: AuthSession<AuthBackend>,
    State(state): State<ServerState>,
    mut multipart: Multipart,
) -> Result<(), AppError> {
    let Some(user) = auth_session.user else {
        return Err((StatusCode::UNAUTHORIZED, format!("user must be logged in")));
    };
    if !user.has_role_name("Website Dev") {
        return Err((StatusCode::UNAUTHORIZED, format!("user must be a dev")));
    }

    while let Some(field) = multipart.next_field().await.map_err(|e| {
        (
            StatusCode::BAD_REQUEST,
            format!("failed to parse multipart payload, {}", e),
        )
    })? {
        if field.name() == Some("file") {
            let data = field.bytes().await.map_err(|e| {
                (
                    StatusCode::BAD_REQUEST,
                    format!("failed to parse file, {}", e),
                )
            })?;
            let mut rdr = csv::Reader::from_reader(data.as_ref());

            let mut records = Vec::new();

            for result in rdr.deserialize() {
                let record: KeyMoveCsvRecord = result.map_err(|e| {
                    (
                        StatusCode::BAD_REQUEST,
                        format!("failed to parse multipart payload, {}", e),
                    )
                })?;
                records.push(record);
            }

            return pokemon_data_updater::update_pokemon_key_moves_data(
                state.db_pool.clone(),
                records,
            )
            .await;
        }
    }

    Err((StatusCode::BAD_REQUEST, format!("missing csv file")))
}

#[debug_handler]
pub async fn get_admin_metrics(
    auth_session: AuthSession<AuthBackend>,
    State(state): State<ServerState>,
) -> Result<Json<Vec<crate::metrics::AggregateMetricSummary>>, AppError> {
    let Some(user) = auth_session.user else {
        return Err((StatusCode::UNAUTHORIZED, "user must be logged in".to_string()));
    };
    if !user.has_role_name("Website Dev") {
        return Err((StatusCode::UNAUTHORIZED, "user must be a dev".to_string()));
    }

    let metrics = crate::metrics::get_aggregate_metrics(&state.db_pool)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("failed to fetch metrics: {}", e)))?;

    Ok(Json(metrics))
}

