use crate::{
    AppError, CSRF_STATE_KEY, auction::AuctionResponse, draft::{Draft, DraftLobbyResponse, DraftResponse, DraftSettings, DraftState}, messages::{ClientBidRequest, ClientBidResponse, ClientJoinResponse, ServerMessage}, pokemon::{self, Pokemon}, server::ServerState, users::{AuthBackend, Credentials, DiscordCreds, User}
};
use axum::{
    Json,
    body::Body,
    debug_handler,
    extract::{
        Path, Query, State, WebSocketUpgrade,
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
use uuid::Uuid;
use std::{
    collections::{HashMap, HashSet}, str::FromStr, sync::Arc
};
use tokio::sync::{RwLock, broadcast};
use tower_sessions::Session;

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

fn default_ready_true() -> bool {
    true
}

#[derive(Clone, Debug, Deserialize, serde::Serialize)]
pub struct ClaimEeveelutionRequest {
    pub pokedex_id: i32,
    pub form: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct ChatMessage {
    pub chat_id: i64,
    pub draft_id: String,
    pub user_id: String,
    pub user_name: String,
    pub message: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
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
    pub form: String,
    pub draft_id: String,
    pub draft_order: i32,
    pub state: String,
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
    pub money_remaining: i32,
    pub pokemon_drafted: Vec<MatchHistoryAuction>,
    pub placement: Option<i32>,
    pub pre_match_mmr: Option<i32>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Clone, Debug, Serialize)]
pub struct MatchHistoryTeamRow {
    pub team_id: i64,
    pub user_id: Option<String>,
    pub guest_id: Option<String>,
    pub draft_id: String,
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
        None => Err((StatusCode::UNAUTHORIZED, "user not authenticated".to_string())),
    }
}

async fn get_user_won_auctions_for_draft(
    state: &ServerState,
    draft_id: Uuid,
    user_id: &str,
) -> Result<Vec<MatchHistoryAuction>, AppError> {
    let auction_rows = sqlx::query(
        "SELECT auction_id, pokedex_id, form, draft_id, draft_order, state,
                paused_time_remaining, winning_bid, winning_user_id, winning_guest_id,
                updated_at, created_at
         FROM auctions
         WHERE draft_id = $1
           AND winning_user_id = $2
         ORDER BY draft_order ASC",
    )
    .bind(draft_id)
    .bind(user_id)
    .fetch_all(&state.db_pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

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
pub async fn get_draft(
    State(state): State<ServerState>,
    Path(draft_id): Path<String>,
) -> Result<Json<DraftResponse>, AppError> {
    let draft_uuid = Uuid::from_str(&draft_id)
        .map_err(|e| (
                StatusCode::BAD_REQUEST,
                format!("requested draft does not exist")
        ))?;
    let Some(draft) = state.drafts.get(&draft_uuid) else {
        return Err((
                StatusCode::BAD_REQUEST,
                format!("requested draft does not exist")
        ));
    };

    let res = draft.get().await?;

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
pub async fn get_rental_pokemon() -> Result<Json<Vec<Arc<pokemon::Pokemon>>>, AppError>
{
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
        "SELECT user_id, user_name, wins, losses, mmr
         FROM users
         ORDER BY mmr DESC, wins DESC, losses ASC, user_name ASC",
    )
    .fetch_all(&state.db_pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let games_rows = sqlx::query(
        "SELECT t.user_id, COUNT(*)::INT AS games_played
         FROM teams t
         JOIN drafts d ON d.draft_id = t.draft_id
         WHERE t.user_id IS NOT NULL
           AND d.status = 'COMPLETED'
           AND d.ranked = TRUE
         GROUP BY t.user_id",
    )
    .fetch_all(&state.db_pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

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
           AND d.status = 'COMPLETED'
           AND d.ranked = TRUE
         GROUP BY a.winning_user_id, a.pokedex_id, p.name, a.form
         ORDER BY a.winning_user_id, drafted_count DESC, p.name ASC",
    )
    .fetch_all(&state.db_pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

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
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

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
        "SELECT t.team_id, t.user_id, t.guest_id, t.draft_id, t.money_remaining,
                t.pokemon_drafted, t.placement, t.pre_match_mmr, t.updated_at, t.created_at
         FROM teams t
         JOIN drafts d ON d.draft_id = t.draft_id
         WHERE d.state = 'COMPLETED'
           AND EXISTS (
                SELECT 1
                FROM auctions a
                WHERE a.draft_id = t.draft_id
                  AND a.winning_bid IS NOT NULL
           )
         ORDER BY t.created_at DESC",
    )
    .fetch_all(&state.db_pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

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
        "SELECT a.auction_id, a.pokedex_id, a.form, a.draft_id, a.draft_order, a.state,
                a.paused_time_remaining, a.winning_bid, a.winning_user_id, a.winning_guest_id,
                a.updated_at, a.created_at
         FROM auctions a
         JOIN drafts d ON d.draft_id = a.draft_id
         WHERE d.state = 'COMPLETED'
           AND a.winning_bid IS NOT NULL
         ORDER BY a.created_at DESC",
    )
    .fetch_all(&state.db_pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

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
        "SELECT team_id, user_id, guest_id, draft_id, money_remaining, placement,
                pre_match_mmr, updated_at, created_at
         FROM teams
         WHERE user_id = $1 OR guest_id = $1
         ORDER BY created_at DESC",
    )
    .bind(&user_id)
    .fetch_all(&state.db_pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let mut history: Vec<MatchHistoryTeam> = Vec::with_capacity(team_rows.len());
    for row in team_rows {
        let draft_uuid: Uuid = row
            .try_get("draft_id")
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        let auctions_won = get_user_won_auctions_for_draft(&state, draft_uuid, &user_id).await?;

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
    let draft_uuid = Uuid::from_str(&draft_id)
        .map_err(|e| (
                StatusCode::BAD_REQUEST,
                format!("requested draft does not exist")
        ))?;
    let Some(draft) = state.drafts.get(&draft_uuid) else {
        return Err((
                StatusCode::BAD_REQUEST,
                format!("requested draft does not exist")
        ));
    };

    draft.join_draft(user, password).await
}

#[debug_handler]
pub async fn get_draft_pokemon (
    State(state): State<ServerState>,
    Path(draft_id): Path<String>,
) -> Result<Json<Vec<Arc<Pokemon>>>, AppError> {
    let draft_uuid = Uuid::from_str(&draft_id)
        .map_err(|_e| (
                StatusCode::BAD_REQUEST,
                format!("requested draft does not exist")
        ))?;
    let Some(draft) = state.drafts.get(&draft_uuid) else {
        return Err((
                StatusCode::BAD_REQUEST,
                format!("requested draft does not exist")
        ));
    };

    Ok(Json(draft.get_pokemon()))
}

#[debug_handler]
pub async fn get_current_auction (
    State(state): State<ServerState>,
    Path(draft_id): Path<String>,
) -> Result<Json<Option<AuctionResponse>>, AppError> {
    let draft_uuid = Uuid::from_str(&draft_id)
        .map_err(|_e| (
                StatusCode::BAD_REQUEST,
                format!("requested draft does not exist")
        ))?;
    let Some(draft) = state.drafts.get(&draft_uuid) else {
        return Err((
                StatusCode::BAD_REQUEST,
                format!("requested draft does not exist")
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

    let draft_uuid = Uuid::from_str(&draft_id)
        .map_err(|e| (
                StatusCode::BAD_REQUEST,
                format!("requested draft does not exist")
        ))?;
    let Some(draft) = state.drafts.get(&draft_uuid) else {
        return Err((
                StatusCode::BAD_REQUEST,
                format!("requested draft does not exist")
        ));
    };

    draft.ready_up(user.get_user_id_string()).await
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
    let draft_uuid = Uuid::from_str(&draft_id)
        .map_err(|e| (
                StatusCode::BAD_REQUEST,
                format!("requested draft does not exist")
        ))?;
    let Some(draft) = state.drafts.get(&draft_uuid) else {
        return Err((
                StatusCode::BAD_REQUEST,
                format!("requested draft does not exist")
        ));
    };
    draft.bid(auction_id, bid_request.value, user).await
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
                format!("requested draft does not exist")
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
                format!("requested draft does not exist")
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
                format!("requested draft does not exist")
        ));
    };

    let Some(draft) = state.drafts.get(&draft_id) else {
        return Err((StatusCode::NOT_FOUND, "draft does not exist".to_string()));
    };

    draft.resume(user.get_user_id_string()).await
}

// #[debug_handler]
// pub async fn submit_race_results(
//     State(state): State<ServerState>,
//     Path(draft_id): Path<String>,
//     auth_session: AuthSession<AuthBackend>,
//     Json(placements): Json<HashMap<String, u32>>,
// ) -> Result<(), (StatusCode, String)> {
//     let Some(user) = auth_session.user else {
//         return Err((StatusCode::FORBIDDEN, "user is not logged in".to_string()));
//     };
//
//     if !user.has_role_name("Referee") {
//         return Err((
//             StatusCode::FORBIDDEN,
//             "user must have Referee role".to_string(),
//         ));
//     }
//
//     let Some(draft_lock) = state.drafts.get(&draft_id) else {
//         return Err((StatusCode::NOT_FOUND, "draft does not exist".to_string()));
//     };
//
//     let draft = draft_lock.read().await;
//
//     if draft.draft_state != DraftState::COMPLETED {
//         return Err((
//             StatusCode::PRECONDITION_FAILED,
//             "draft must be completed before submitting results".to_string(),
//         ));
//     }
//
//     if !draft.is_ranked() {
//         return Err((
//             StatusCode::PRECONDITION_FAILED,
//             "results submission only applies to ranked drafts".to_string(),
//         ));
//     }
//
//     let team_user_ids: Vec<String> = draft
//         .teams
//         .values()
//         .map(|team| team.user_id.clone())
//         .collect();
//     let team_count = team_user_ids.len();
//
//     if team_count == 0 {
//         return Err((StatusCode::BAD_REQUEST, "draft has no teams".to_string()));
//     }
//
//     if placements.len() != team_count {
//         return Err((
//             StatusCode::BAD_REQUEST,
//             "placements must be provided for every team".to_string(),
//         ));
//     }
//
//     let mut seen_places: HashSet<u32> = HashSet::new();
//     for user_id in &team_user_ids {
//         let Some(place) = placements.get(user_id) else {
//             return Err((
//                 StatusCode::BAD_REQUEST,
//                 format!("missing placement for team {}", user_id),
//             ));
//         };
//
//         if *place == 0 || *place > team_count as u32 {
//             return Err((
//                 StatusCode::BAD_REQUEST,
//                 "placements must be between 1 and number of teams".to_string(),
//             ));
//         }
//
//         if !seen_places.insert(*place) {
//             return Err((
//                 StatusCode::BAD_REQUEST,
//                 "placements must be unique".to_string(),
//             ));
//         }
//     }
//
//     let mmr_rows = sqlx::query("SELECT user_id, mmr FROM users WHERE user_id = ANY($1)")
//         .bind(&team_user_ids)
//         .fetch_all(&state.db_pool)
//         .await
//         .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
//
//     let mut mmr_by_user: HashMap<String, i32> = HashMap::with_capacity(mmr_rows.len());
//     for row in mmr_rows {
//         let user_id: String = row
//             .try_get("user_id")
//             .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
//         let mmr: i32 = row
//             .try_get("mmr")
//             .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
//         mmr_by_user.insert(user_id, mmr);
//     }
//
//     if mmr_by_user.len() != team_count {
//         return Err((
//             StatusCode::BAD_REQUEST,
//             "all submitted teams must map to users with MMR".to_string(),
//         ));
//     }
//
//     let mut updates: HashMap<String, (i32, i32, i32)> = HashMap::with_capacity(team_count);
//     for user_id in &team_user_ids {
//         let user_rating = *mmr_by_user
//             .get(user_id)
//             .ok_or((StatusCode::BAD_REQUEST, "missing user MMR".to_string()))?;
//         let user_place = *placements
//             .get(user_id)
//             .ok_or((StatusCode::BAD_REQUEST, "missing placement".to_string()))?;
//
//         let mut wins = 0_i32;
//         let mut losses = 0_i32;
//         let mut mmr_delta = 0.0_f64;
//
//         for opponent_id in &team_user_ids {
//             if opponent_id == user_id {
//                 continue;
//             }
//
//             let opponent_rating = *mmr_by_user
//                 .get(opponent_id)
//                 .ok_or((StatusCode::BAD_REQUEST, "missing opponent MMR".to_string()))?;
//             let opponent_place = *placements.get(opponent_id).ok_or((
//                 StatusCode::BAD_REQUEST,
//                 "missing opponent placement".to_string(),
//             ))?;
//
//             let result = if user_place < opponent_place {
//                 wins += 1;
//                 1.0
//             } else {
//                 losses += 1;
//                 0.0
//             };
//
//             let expected = expected_score(user_rating, opponent_rating);
//             mmr_delta += 20.0 * (result - expected);
//         }
//
//         updates.insert(user_id.clone(), (mmr_delta.round() as i32, wins, losses));
//     }
//
//     let mut tx = state
//         .db_pool
//         .begin()
//         .await
//         .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
//
//     for user_id in &team_user_ids {
//         let Some((mmr_delta, wins, losses)) = updates.get(user_id) else {
//             return Err((
//                 StatusCode::INTERNAL_SERVER_ERROR,
//                 "missing computed update".to_string(),
//             ));
//         };
//
//         sqlx::query(
//             "UPDATE users
//              SET mmr = mmr + $1,
//                  wins = wins + $2,
//                  losses = losses + $3
//              WHERE user_id = $4",
//         )
//         .bind(*mmr_delta)
//         .bind(*wins)
//         .bind(*losses)
//         .bind(user_id)
//         .execute(&mut *tx)
//         .await
//         .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
//     }
//
//     for user_id in &team_user_ids {
//         let Some(place) = placements.get(user_id) else {
//             return Err((StatusCode::BAD_REQUEST, "missing placement".to_string()));
//         };
//         let Some(original_mmr) = mmr_by_user.get(user_id) else {
//             return Err((StatusCode::BAD_REQUEST, "missing user MMR".to_string()));
//         };
//
//         sqlx::query(
//             "UPDATE teams
//              SET placement = $1,
//                  pre_result_mmr = $2
//                          WHERE draft_id = $3
//                              AND user_id = $4",
//         )
//         .bind(*place as i32)
//         .bind(*original_mmr)
//         .bind(&draft_id)
//         .bind(user_id)
//         .execute(&mut *tx)
//         .await
//         .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
//     }
//
//     tx.commit()
//         .await
//         .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
//
//     Ok(())
// }

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

    let draft_uuid = Uuid::from_str(&draft_id)
        .map_err(|e| (
                StatusCode::BAD_REQUEST,
                format!("requested draft does not exist")
        ))?;
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

    let draft_uuid = Uuid::from_str(&draft_id)
        .map_err(|e| (
                StatusCode::BAD_REQUEST,
                format!("requested draft does not exist")
        ))?;
    let draft = state.drafts.get(&draft_uuid).map(|d| d.value().clone());
    let Some(draft) = draft else {
        return Err((StatusCode::NOT_FOUND, "draft not found".to_string()));
    };

    let result = draft.claim_eeveelution(user, claim_request.pokedex_id, claim_request.form).await?;
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

    let draft_uuid = Uuid::from_str(&draft_id)
        .map_err(|e| (
                StatusCode::BAD_REQUEST,
                format!("requested draft does not exist")
        ))?;
    let draft = state.drafts.get(&draft_uuid).map(|d| d.value().clone());
    let Some(draft) = draft else {
        return Err((StatusCode::NOT_FOUND, "draft not found".to_string()));
    };

    let result = draft.unclaim_eeveelution(user, claim_request.pokedex_id, claim_request.form).await?;
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
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let chats = rows
        .into_iter()
        .map(|row| {
            Ok(ChatMessage {
                chat_id: row.try_get("chat_id")?,
                draft_id: row.try_get("draft_id")?,
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
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let chat_id = row
        .try_get("chat_id")
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let draft_id = row
        .try_get("draft_id")
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

    Ok(Json(ChatMessage {
        chat_id,
        draft_id,
        user_id,
        user_name,
        message,
        created_at,
    }))
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

#[debug_handler]
pub async fn websocket_handler(
    State(state): State<ServerState>,
    Path(draft_id): Path<String>,
    ws: WebSocketUpgrade,
) -> Result<Response<Body>, (StatusCode, String)> {
    let draft_uuid = Uuid::from_str(&draft_id)
        .map_err(|e| (
                StatusCode::BAD_REQUEST,
                format!("requested draft does not exist")
        ))?;
    let Some(draft) = state.drafts.get(&draft_uuid) else {
        return Err((
                StatusCode::BAD_REQUEST,
                format!("requested draft does not exist")
        ));
    };
    let tx = draft.broadcast_tx.clone();
    Ok(ws.on_upgrade(move |socket| handle_websocket(socket, tx)))
}

async fn handle_websocket(mut socket: WebSocket, tx: broadcast::Sender<ServerMessage>) {
    let mut rx = tx.subscribe();
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
            }
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

// #[debug_handler]
// pub async fn change_guest_name(
//     mut auth_session: AuthSession<AuthBackend>,
//     State(state): State<ServerState>,
//     Json(req): Json<ChangeGuestNameRequest>,
// ) -> Result<Json<String>, (StatusCode, String)> {
//     let user_id = match auth_session.user {
//         Some(User::GuestUser(ref guest)) => guest.user_id.clone(),
//         _ => {
//             return Err((
//                 StatusCode::FORBIDDEN,
//                 "Only guests can change their name".to_string(),
//             ));
//         }
//     };
//     let new_name = req.new_name.trim();
//     if new_name.is_empty() || new_name.len() > 32 {
//         return Err((
//             StatusCode::BAD_REQUEST,
//             "Name must be 1-32 characters".to_string(),
//         ));
//     }
//     let res = sqlx::query!(
//         "UPDATE guests SET user_name = $1 WHERE user_id = $2",
//         new_name,
//         user_id
//     )
//     .execute(&state.db_pool)
//     .await;
//     match res {
//         Ok(_) => {
//             // Update the auth session with the new name
//             if let Some(User::GuestUser(guest)) = auth_session.user.as_mut() {
//                 guest.user_name = new_name.to_string();
//             }
//             // Update all teams in active drafts for this guest
//             for draft_ref in state.drafts.iter() {
//                 let draft_lock = draft_ref.value().clone();
//                 let mut draft = draft_lock.write().await;
//                 if let Some(team) = draft.teams.get_mut(&user_id) {
//                     team.username = new_name.to_string();
//                     // Optionally broadcast update to websocket clients
//                     let draft_response = crate::draft::DraftResponse::from(draft.clone());
//                     let _ = draft
//                         .tx
//                         .send(crate::messages::ServerMessage::DraftUpdate(draft_response));
//                 }
//             }
//             Ok(Json(new_name.to_string()))
//         }
//         Err(e) => Err((
//             StatusCode::INTERNAL_SERVER_ERROR,
//             format!("DB error: {}", e),
//         )),
//     }
// }
