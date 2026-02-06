use crate::{
    draft::{Draft, DraftResponse, DraftSettings, DraftState},
    messages::{ClientBidRequest, ClientBidResponse, ClientJoinResponse, ServerMessage},
    server::ServerState,
    users::{AuthBackend, CSRF_STATE_KEY, Credentials, DiscordCreds, User},
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

#[debug_handler]
pub async fn create_draft(
    State(state): State<ServerState>,
    auth_session: AuthSession<AuthBackend>,
    Json(draft_settings): Json<DraftSettings>,
) -> Result<String, (StatusCode, String)> {
    let host = auth_session
        .user
        .expect("user should exist")
        .get_user_id_string();
    for _ in 0..3 {
        if let Ok(draft) = Draft::build(
            host.clone(),
            draft_settings.clone(),
            state.db_pool.clone(),
            state.draft_runner.clone(),
        )
        .await
        {
            let draft_id = draft.draft_id.clone();
            state
                .drafts
                .insert(draft_id.clone(), Arc::new(RwLock::new(draft)));
            return Ok(draft_id);
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
) -> Result<Json<ClientJoinResponse>, (StatusCode, String)> {
    let user = auth_session.user.expect("user should exist");
    let user_id = user.get_user_id_string();
    let Some(draft_lock) = state.drafts.get(&draft_id) else {
        return Err((StatusCode::NOT_FOUND, "draft does not exist".to_string()));
    };

    let mut draft = draft_lock.write().await;
    if let Err(e) = draft.join_draft(user_id).await {
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
    let user_id = user.get_user_id_string();
    let draft_lock = state.drafts.get(&draft_id).ok_or((
        StatusCode::FORBIDDEN,
        "user does not have access to requested draft".to_string(),
    ))?;

    {
        let mut draft = draft_lock.write().await;

        let (user_field, auction_id, bid_value) =
            validate_bid_request(draft.current_auction, &draft, &bid_request, &user).map_err(
                |e| {
                    eprintln!("Bid not valid: {}", e);
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        "Couldn't process bid".to_string(),
                    )
                },
            )?;

        let mut tx = state.db_pool.begin().await.map_err(|e| {
            eprintln!("Error starting db transaction: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Couldn't process bid".to_string(),
            )
        })?;

        // update auction in db
        let query_string = &format!(
            "
            UPDATE auctions
            SET (winning_bid, {}) = ({}, {})
            WHERE auction_id = {}
            ",
            user_field, bid_value, user_id, auction_id,
        );

        let _ = sqlx::query(query_string)
            .execute(&mut *tx)
            .await
            .map_err(|e| {
                eprintln!(
                    "failed writing to db: {}\nquery_string: {}",
                    e, query_string
                );
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "failed to write to db".to_string(),
                )
            })?;

        let query_string = &format!(
            "
            UPDATE bids
            SET (auction_id, {}, value, accepted, winning) = ({}, {}, {}, true, true)
            WHERE auction_id = ($3)
            ",
            user_field, auction_id, user_id, bid_value
        );

        // update bid in db, maybe later
        let _ = sqlx::query(query_string)
            .execute(&mut *tx)
            .await
            .map_err(|e| {
                eprintln!("failed writing to db: {}", e);
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "failed to write to db".to_string(),
                );
            })?;

        tx.commit().await.map_err(|e| {
            eprintln!("failed commiting transaction to db: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "failed to write to db".to_string(),
            )
        })?;

        let (pokedex_id, form, winning_bid, winning_bidder, expires_at) = {
            let current_auction = draft.current_auction as usize;
            let auction = &mut draft.auctions[current_auction];
            //update auction in memory
            auction.highest_bidder = Some(user.clone());
            auction.highest_bid = bid_request.value;
            auction.expires_at = Some(std::cmp::max(
                auction.expires_at.unwrap(),
                Instant::now() + Duration::from_secs(10),
            ));
            (
                auction.pokemon.pokedex_id,
                auction.pokemon.form.clone(),
                auction.highest_bid,
                user,
                crate::get_expiry_time_from_instant(auction.expires_at.unwrap()),
            )
        };

        let _ = draft.tx.send(ServerMessage::AuctionUpdate {
            pokedex_id,
            form,
            winning_bid,
            winning_bidder: Some(winning_bidder.get_user_id_string()),
            expires_at,
        });
    }

    Ok(Json(ClientBidResponse {
        accepted: true,
        error: None,
    }))
}

fn validate_bid_request(
    auction_num: u32,
    draft: &Draft,
    bid_request: &ClientBidRequest,
    user: &User,
) -> Result<(String, i64, i32), String> {
    if draft.draft_state != DraftState::BIDDING {
        return Err("draft is not accepting bids".to_string());
    }

    let auction = &draft.auctions[auction_num as usize];
    if auction.auction_id != bid_request.auction_id {
        return Err(format!("auction is not active"));
    }
    if auction.highest_bid >= bid_request.value {
        return Err(format!("bid is not higher than current highest bid"));
    }
    if auction.highest_bidder == Some(user.clone()) {
        return Err(format!("user is already the highest bidder"));
    }
    // check user has team in draft
    if !draft.teams.iter().any(|t| t.user_id == bid_request.user_id) {
        return Err(format!("user is not assigned to a team"));
    }

    let user_field = match user {
        User::DiscordUser(_) => "winning_user_id",
        User::GuestUser(_) => "winning_guest_id",
    };

    let auction_id = bid_request
        .auction_id
        .parse::<i64>()
        .expect(format!("auction id should be i64, is {}", bid_request.auction_id).as_str());

    let bid_value = bid_request.value as i32;

    Ok((user_field.to_string(), auction_id, bid_value))
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
        if draft.host != user.get_user_id_string() {
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

    let Ok(Some(user)) = auth_session.authenticate(creds).await else {
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
