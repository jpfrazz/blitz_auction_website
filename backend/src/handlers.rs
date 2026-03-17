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
) -> Result<Json<AuctionResponse>, AppError> {
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
    let auction_id = bid_request.auction_id.parse::<i64>()
        .map_err(|e| (
                StatusCode::BAD_REQUEST,
                format!("failed to parse auction_id as i64, {}", e)
        ))?;
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

// #[debug_handler]
// pub async fn update_pending_draft_settings(
//     State(state): State<ServerState>,
//     Path(draft_id): Path<String>,
//     auth_session: AuthSession<AuthBackend>,
//     Json(update_request): Json<UpdatePendingDraftSettingsRequest>,
// ) -> Result<Json<DraftResponse>, (StatusCode, String)> {
//     let Some(user) = auth_session.user else {
//         return Err((StatusCode::FORBIDDEN, "user is not logged in".to_string()));
//     };
//
//     let Some(draft_lock) = state.drafts.get(&draft_id) else {
//         return Err((StatusCode::NOT_FOUND, "draft does not exist".to_string()));
//     };
//
//     let mut draft = draft_lock.write().await;
//
//     if draft.host != user {
//         return Err((StatusCode::FORBIDDEN, "user is not host".to_string()));
//     }
//
//     draft
//         .update_pending_settings(
//             update_request.num_teams,
//             update_request.num_auctions,
//             update_request.remove_team_ids,
//         )
//         .await?;
//
//     Ok(Json(DraftResponse::from(draft.clone())))
// }

// #[debug_handler]
// pub async fn claim_eeveelution(
//     State(state): State<ServerState>,
//     Path(draft_id): Path<String>,
//     auth_session: AuthSession<AuthBackend>,
//     Json(claim_request): Json<ClaimEeveelutionRequest>,
// ) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
//     let user = auth_session.user.ok_or((
//         StatusCode::UNAUTHORIZED,
//         "user not authenticated".to_string(),
//     ))?;
//
//     let Some(draft_lock) = state.drafts.get(&draft_id) else {
//         return Err((StatusCode::NOT_FOUND, "draft not found".to_string()));
//     };
//
//     let mut draft = draft_lock.write().await;
//     if draft.draft_state != DraftState::COMPLETED {
//         return Err((
//             StatusCode::PRECONDITION_FAILED,
//             "draft must be completed".to_string(),
//         ));
//     }
//
//     // Check if the pokemon exists in the draft
//     let target_pokemon = draft
//         .pokemon
//         .iter()
//         .find(|p| p.pokedex_id == claim_request.pokedex_id as u32 && p.form == claim_request.form)
//         .ok_or((
//             StatusCode::NOT_FOUND,
//             "pokemon not found in draft".to_string(),
//         ))?
//         .clone();
//
//     // Check if this pokemon was already claimed by someone else
//     let already_claimed_by = draft.teams.values().find_map(|team| {
//         if team
//             .auctions_won
//             .iter()
//             .any(|p| p.pokedex_id == target_pokemon.pokedex_id && p.form == target_pokemon.form)
//         {
//             Some(team.username.clone())
//         } else {
//             None
//         }
//     });
//
//     if let Some(claimer_name) = already_claimed_by {
//         return Ok(Json(serde_json::json!({
//             "success": false,
//             "error": format!("Already claimed by {}", claimer_name),
//             "claimed_by": claimer_name
//         })));
//     }
//
//     // Add the eeveelution to the user's team
//     let user_id = user.get_user_id_string();
//     if let Some(team) = draft.teams.get_mut(&user_id) {
//         team.auctions_won.push(target_pokemon.clone());
//
//         // Broadcast full draft object to all websocket clients
//         let draft_response = crate::draft::DraftResponse::from(draft.clone());
//         let _ = draft
//             .tx
//             .send(crate::messages::ServerMessage::DraftUpdate(draft_response));
//
//         Ok(Json(serde_json::json!({
//             "success": true,
//             "claimed_by": user_id,
//             "pokemon": {
//                 "pokedex_id": target_pokemon.pokedex_id,
//                 "name": target_pokemon.name,
//                 "form": target_pokemon.form
//             }
//         })))
//     } else {
//         Err((StatusCode::NOT_FOUND, "team not found".to_string()))
//     }
// }

// #[debug_handler]
// pub async fn unclaim_eeveelution(
//     State(state): State<ServerState>,
//     Path(draft_id): Path<String>,
//     auth_session: AuthSession<AuthBackend>,
//     Json(claim_request): Json<ClaimEeveelutionRequest>,
// ) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
//     let user = auth_session.user.ok_or((
//         StatusCode::UNAUTHORIZED,
//         "user not authenticated".to_string(),
//     ))?;
//
//     let Some(draft_lock) = state.drafts.get(&draft_id) else {
//         return Err((StatusCode::NOT_FOUND, "draft not found".to_string()));
//     };
//
//     let mut draft = draft_lock.write().await;
//     if draft.draft_state != DraftState::COMPLETED {
//         return Err((
//             StatusCode::PRECONDITION_FAILED,
//             "draft must be completed".to_string(),
//         ));
//     }
//
//     let target_pokemon = draft
//         .pokemon
//         .iter()
//         .find(|p| p.pokedex_id == claim_request.pokedex_id as u32 && p.form == claim_request.form)
//         .ok_or((
//             StatusCode::NOT_FOUND,
//             "pokemon not found in draft".to_string(),
//         ))?
//         .clone();
//
//     let user_id = user.get_user_id_string();
//     let Some(team) = draft.teams.get_mut(&user_id) else {
//         return Err((StatusCode::NOT_FOUND, "team not found".to_string()));
//     };
//
//     let maybe_index = team
//         .auctions_won
//         .iter()
//         .position(|p| p.pokedex_id == target_pokemon.pokedex_id && p.form == target_pokemon.form);
//
//     if let Some(index) = maybe_index {
//         team.auctions_won.remove(index);
//
//         let draft_response = crate::draft::DraftResponse::from(draft.clone());
//         let _ = draft
//             .tx
//             .send(crate::messages::ServerMessage::DraftUpdate(draft_response));
//
//         return Ok(Json(serde_json::json!({
//             "success": true,
//             "unclaimed_by": user_id,
//             "pokemon": {
//                 "pokedex_id": target_pokemon.pokedex_id,
//                 "name": target_pokemon.name,
//                 "form": target_pokemon.form
//             }
//         })));
//     }
//
//     let claimed_by_other = draft
//         .teams
//         .values()
//         .find(|other_team| {
//             other_team.user_id != user_id
//                 && other_team.auctions_won.iter().any(|p| {
//                     p.pokedex_id == target_pokemon.pokedex_id && p.form == target_pokemon.form
//                 })
//         })
//         .map(|team| team.username.clone());
//
//     if let Some(owner_name) = claimed_by_other {
//         return Err((
//             StatusCode::FORBIDDEN,
//             format!("eeveelution is claimed by {}", owner_name),
//         ));
//     }
//
//     Err((
//         StatusCode::NOT_FOUND,
//         "you have not claimed this eeveelution".to_string(),
//     ))
// }

#[debug_handler]
pub async fn get_draft_chats(
    State(state): State<ServerState>,
    Path(draft_id): Path<String>,
) -> Result<Json<Vec<ChatMessage>>, (StatusCode, String)> {
    let rows = sqlx::query(
        "SELECT c.chat_id, c.draft_id, c.user_id, COALESCE(u.user_name, c.user_id) AS user_name, c.message, c.created_at
         FROM chats c
         LEFT JOIN users u ON u.user_id = c.user_id
         WHERE c.draft_id = $1
         ORDER BY c.created_at ASC",
    )
    .bind(&draft_id)
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
    .bind(&draft_id)
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
    let rx = draft.broadcast_rx.resubscribe();
    Ok(ws.on_upgrade(move |socket| handle_websocket(socket, rx)))
}

async fn handle_websocket(mut socket: WebSocket, mut rx: broadcast::Receiver<ServerMessage>) {
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
