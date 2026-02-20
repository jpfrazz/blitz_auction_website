use crate::{
    draft::{Draft, DraftResponse, DraftSettings, DraftState},
    messages::{ClientBidRequest, ClientBidResponse, ClientJoinResponse, ServerMessage},
    server::ServerState,
    users::{AuthBackend, CSRF_STATE_KEY, Credentials, DiscordCreds, User, UserId},
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
use oauth2::CsrfToken;
use serde::Deserialize;
use std::{sync::Arc, time::Duration};
use tokio::{
    sync::{RwLock, broadcast},
    time::Instant,
};
use tower_sessions::Session;

#[derive(Clone, Debug, Deserialize)]
pub struct JoinDraftRequest {
    pub password: Option<String>,
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
                    .join_draft(host.get_user_id_string(), None)
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
pub async fn join_draft(
    State(state): State<ServerState>,
    Path(draft_id): Path<String>,
    auth_session: AuthSession<AuthBackend>,
    join_request: Option<Json<JoinDraftRequest>>,
) -> Result<Json<ClientJoinResponse>, (StatusCode, String)> {
    let user = auth_session.user.expect("user should exist");
    let user_id = user.get_user_id_string();
    let password = join_request.and_then(|Json(req)| req.password);
    let Some(draft_lock) = state.drafts.get(&draft_id) else {
        return Err((StatusCode::NOT_FOUND, "draft does not exist".to_string()));
    };

    let mut draft = draft_lock.write().await;
    if let Err(e) = draft.join_draft(user_id, password).await {
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

    let Some(user) = auth_session.authenticate(creds).await.map_err(|e| e.to_string())? else {
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
