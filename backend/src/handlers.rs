use crate::{
    CSRF_STATE_KEY,
    draft::{Draft, DraftLobbyResponse, DraftResponse, DraftSettings, DraftState},
    messages::{ClientBidRequest, ClientBidResponse, ClientJoinResponse, ServerMessage},
    pokemon,
    server::ServerState,
    users::{AuthBackend, Credentials, DiscordCreds, User},
};
use axum::{
    Json,
    body::Body,
    debug_handler,
    extract::{
        Path, Query, State, WebSocketUpgrade,
        ws::{Message, WebSocket},
    },
    http::StatusCode,
    response::{Redirect, Response},
};
use axum_login::AuthSession;
use chrono::Utc;
use oauth2::CsrfToken;
use serde::{Deserialize, Serialize};
use sqlx::Row;
use std::{
    sync::Arc,
    collections::HashMap
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

#[debug_handler]
pub async fn create_draft(
    State(state): State<ServerState>,
    auth_session: AuthSession<AuthBackend>,
    Json(draft_settings): Json<DraftSettings>,
) -> Result<String, (StatusCode, String)> {
    let host = auth_session.user.clone().expect("user should exist");
    for _ in 0..3 {
        match Draft::build(
            host.clone(),
            draft_settings.clone(),
            state.db_pool.clone(),
            state.draft_runner.clone(),
        )
        .await
        {
            Ok(mut draft) => {
                let draft_id = draft.draft_id.clone();
                draft
                    .join_draft(host.clone(), None)
                    .await
                    .expect("host should be able to join draft");
                state
                    .drafts
                    .insert(draft_id.clone(), Arc::new(RwLock::new(draft)));
                return Ok(draft_id);
            }
            Err(e) => {
                eprintln!("failed to create draft: {}", e);
            }
        }
    }

    Err((
        StatusCode::INTERNAL_SERVER_ERROR,
        "Could not create draft!".to_string(),
    ))
}

#[debug_handler]
pub async fn list_open_drafts(
    State(state): State<ServerState>,
) -> Result<Json<Vec<DraftLobbyResponse>>, (StatusCode, String)> {
    let mut open_drafts: Vec<DraftLobbyResponse> = vec![];

    for draft_ref in state.drafts.iter() {
        let draft_lock = draft_ref.value().clone();
        let draft = draft_lock.read().await.clone();
        if draft.draft_state == DraftState::COMPLETED || draft.expires_at < Utc::now() {
            continue;
        }
        open_drafts.push(draft.into());
    }

    Ok(Json(open_drafts))
}

#[debug_handler]
pub async fn get_draft(
    State(state): State<ServerState>,
    Path(draft_id): Path<String>,
) -> Result<Json<DraftResponse>, (StatusCode, String)> {
    let draft_lock = state
        .drafts
        .get(&draft_id)
        .map(|d| d.value().clone())
        .ok_or((StatusCode::NOT_FOUND, "draft not found".to_string()))?;

    let draft = draft_lock.read().await.clone();

    Ok(Json(draft.into()))
}

#[debug_handler]
pub async fn get_pokemon() -> Result<Json<Vec<Arc<pokemon::Pokemon>>>, (StatusCode, String)> {
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
pub async fn get_rental_pokemon(
) -> Result<Json<Vec<Arc<pokemon::Pokemon>>>, (StatusCode, String)> {
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
) -> Result<Json<Vec<LeaderboardEntry>>, (StatusCode, String)> {
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
) -> Result<Json<ClientJoinResponse>, (StatusCode, String)> {
    let user = auth_session.user.expect("user should exist");
    let password = join_request.and_then(|Json(req)| req.password);
    let Some(draft_lock) = state.drafts.get(&draft_id) else {
        return Err((StatusCode::NOT_FOUND, "draft does not exist".to_string()));
    };

    let mut draft = draft_lock.write().await;
    if let Err(e) = draft.join_draft(user, password).await {
        return Ok(Json(ClientJoinResponse {
            joined: false,
            error: Some(e),
        }));
    }

    Ok(Json(ClientJoinResponse {
        joined: true,
        error: None,
    }))
}

#[debug_handler]
pub async fn ready_up(
    State(state): State<ServerState>,
    Path(draft_id): Path<String>,
    auth_session: AuthSession<AuthBackend>,
    ready_request: Option<Json<ReadyUpRequest>>,
) -> Result<Json<ReadyUpResponse>, (StatusCode, String)> {
    let user = auth_session.user.expect("user should exist");
    let ready = ready_request.map(|Json(req)| req.ready).unwrap_or(true);

    let Some(draft_lock) = state.drafts.get(&draft_id) else {
        return Err((StatusCode::NOT_FOUND, "draft does not exist".to_string()));
    };

    let mut draft = draft_lock.write().await;

    if draft.draft_state != DraftState::PENDING {
        return Err((
            StatusCode::PRECONDITION_FAILED,
            "draft is no longer pending".to_string(),
        ));
    }

    let user_id = user.get_user_id_string();
    let Some(team) = draft.teams.get_mut(&user_id) else {
        return Err((
            StatusCode::FORBIDDEN,
            "user is not assigned to a team".to_string(),
        ));
    };

    team.ready = ready;

    // Broadcast full draft object to all websocket clients
    let draft_response = crate::draft::DraftResponse::from(draft.clone());
    let _ = draft
        .tx
        .send(crate::messages::ServerMessage::DraftUpdate(draft_response));

    // Removed automatic draft start when all teams are ready
    let draft_started = false;

    Ok(Json(ReadyUpResponse {
        ready,
        draft_started,
    }))
}

#[debug_handler]
pub async fn bid(
    State(state): State<ServerState>,
    Path(draft_id): Path<String>,
    auth_session: AuthSession<AuthBackend>,
    Json(bid_request): Json<ClientBidRequest>,
) -> Result<Json<ClientBidResponse>, (StatusCode, String)> {
    let user = auth_session.user.expect("user should exist");
    let draft_lock = state.drafts.get(&draft_id).ok_or((
        StatusCode::FORBIDDEN,
        "user does not have access to requested draft".to_string(),
    ))?;

    let mut draft = draft_lock.write().await;
    draft.bid(&bid_request, &user).await.map(|ok| Json(ok))
}

pub async fn start_draft(
    auth_session: AuthSession<AuthBackend>,
    Path(draft_id): Path<String>,
    State(state): State<ServerState>,
) -> Result<(), (StatusCode, String)> {
    let Some(user) = auth_session.user else {
        return Err((StatusCode::FORBIDDEN, "user is not logged in".to_string()));
    };

    let Some(draft_lock) = state.drafts.get(&draft_id) else {
        return Err((StatusCode::NOT_FOUND, "draft does not exist".to_string()));
    };

    {
        let mut draft = draft_lock.write().await;
        if draft.host != user {
            return Err((StatusCode::FORBIDDEN, "user is not host".to_string()));
        }

        if draft.draft_state != DraftState::PENDING {
            return Err((
                StatusCode::PRECONDITION_FAILED,
                "draft must be in PENDING state".to_string(),
            ));
        }

        let Ok(_) = draft.start_draft().await else {
            return Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                "draft failed to start".to_string(),
            ));
        };
    }

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

    let Some(draft_lock) = state.drafts.get(&draft_id) else {
        return Err((StatusCode::NOT_FOUND, "draft does not exist".to_string()));
    };

    let mut draft = draft_lock.write().await;

    if draft.host != user {
        return Err((StatusCode::FORBIDDEN, "user is not host".to_string()));
    }

    draft
        .update_pending_settings(
            update_request.num_teams,
            update_request.num_auctions,
            update_request.remove_team_ids,
        )
        .await?;

    Ok(Json(DraftResponse::from(draft.clone())))
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

    let Some(draft_lock) = state.drafts.get(&draft_id) else {
        return Err((StatusCode::NOT_FOUND, "draft not found".to_string()));
    };

    let mut draft = draft_lock.write().await;
    if draft.draft_state != DraftState::COMPLETED {
        return Err((
            StatusCode::PRECONDITION_FAILED,
            "draft must be completed".to_string(),
        ));
    }

    // Check if the pokemon exists in the draft
    let target_pokemon = draft
        .pokemon
        .iter()
        .find(|p| p.pokedex_id == claim_request.pokedex_id as u32 && p.form == claim_request.form)
        .ok_or((
            StatusCode::NOT_FOUND,
            "pokemon not found in draft".to_string(),
        ))?
        .clone();

    // Check if this pokemon was already claimed by someone else
    let already_claimed_by = draft.teams.values().find_map(|team| {
        if team
            .auctions_won
            .iter()
            .any(|p| p.pokedex_id == target_pokemon.pokedex_id && p.form == target_pokemon.form)
        {
            Some(team.username.clone())
        } else {
            None
        }
    });

    if let Some(claimer_name) = already_claimed_by {
        return Ok(Json(serde_json::json!({
            "success": false,
            "error": format!("Already claimed by {}", claimer_name),
            "claimed_by": claimer_name
        })));
    }

    // Add the eeveelution to the user's team
    let user_id = user.get_user_id_string();
    if let Some(team) = draft.teams.get_mut(&user_id) {
        team.auctions_won.push(target_pokemon.clone());

        // Broadcast full draft object to all websocket clients
        let draft_response = crate::draft::DraftResponse::from(draft.clone());
        let _ = draft
            .tx
            .send(crate::messages::ServerMessage::DraftUpdate(draft_response));

        Ok(Json(serde_json::json!({
            "success": true,
            "claimed_by": user_id,
            "pokemon": {
                "pokedex_id": target_pokemon.pokedex_id,
                "name": target_pokemon.name,
                "form": target_pokemon.form
            }
        })))
    } else {
        Err((StatusCode::NOT_FOUND, "team not found".to_string()))
    }
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

    let Some(draft_lock) = state.drafts.get(&draft_id) else {
        return Err((StatusCode::NOT_FOUND, "draft not found".to_string()));
    };

    let mut draft = draft_lock.write().await;
    if draft.draft_state != DraftState::COMPLETED {
        return Err((
            StatusCode::PRECONDITION_FAILED,
            "draft must be completed".to_string(),
        ));
    }

    let target_pokemon = draft
        .pokemon
        .iter()
        .find(|p| p.pokedex_id == claim_request.pokedex_id as u32 && p.form == claim_request.form)
        .ok_or((
            StatusCode::NOT_FOUND,
            "pokemon not found in draft".to_string(),
        ))?
        .clone();

    let user_id = user.get_user_id_string();
    let Some(team) = draft.teams.get_mut(&user_id) else {
        return Err((StatusCode::NOT_FOUND, "team not found".to_string()));
    };

    let maybe_index = team
        .auctions_won
        .iter()
        .position(|p| p.pokedex_id == target_pokemon.pokedex_id && p.form == target_pokemon.form);

    if let Some(index) = maybe_index {
        team.auctions_won.remove(index);

        let draft_response = crate::draft::DraftResponse::from(draft.clone());
        let _ = draft
            .tx
            .send(crate::messages::ServerMessage::DraftUpdate(draft_response));

        return Ok(Json(serde_json::json!({
            "success": true,
            "unclaimed_by": user_id,
            "pokemon": {
                "pokedex_id": target_pokemon.pokedex_id,
                "name": target_pokemon.name,
                "form": target_pokemon.form
            }
        })));
    }

    let claimed_by_other = draft
        .teams
        .values()
        .find(|other_team| {
            other_team.user_id != user_id
                && other_team.auctions_won.iter().any(|p| {
                    p.pokedex_id == target_pokemon.pokedex_id && p.form == target_pokemon.form
                })
        })
        .map(|team| team.username.clone());

    if let Some(owner_name) = claimed_by_other {
        return Err((
            StatusCode::FORBIDDEN,
            format!("eeveelution is claimed by {}", owner_name),
        ));
    }

    Err((
        StatusCode::NOT_FOUND,
        "you have not claimed this eeveelution".to_string(),
    ))
}

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
    let tx = {
        let Some(draft_lock) = state.drafts.get(&draft_id) else {
            return Err((StatusCode::NOT_FOUND, "Draft does not exist".to_string()));
        };
        let draft = draft_lock.read().await;

        draft.tx.clone()
    };
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
    let res = sqlx::query!(
        "UPDATE guests SET user_name = $1 WHERE user_id = $2",
        new_name,
        user_id
    )
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
                let draft_lock = draft_ref.value().clone();
                let mut draft = draft_lock.write().await;
                if let Some(team) = draft.teams.get_mut(&user_id) {
                    team.username = new_name.to_string();
                    // Optionally broadcast update to websocket clients
                    let draft_response = crate::draft::DraftResponse::from(draft.clone());
                    let _ = draft
                        .tx
                        .send(crate::messages::ServerMessage::DraftUpdate(draft_response));
                }
            }
            Ok(Json(new_name.to_string()))
        }
        Err(e) => Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("DB error: {}", e),
        )),
    }
}
