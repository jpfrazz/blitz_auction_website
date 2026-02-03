use crate::{
    draft::{Draft, DraftResponse, DraftSettings, DraftState},
    messages::{ClientBidRequest, ClientBidResponse, ClientJoinResponse, ServerMessage},
    server::ServerState,
    users::{AuthBackend, User},
};
use axum::{
    Json,
    body::Body,
    debug_handler,
    extract::{
        Path, State, WebSocketUpgrade,
        ws::{Message, WebSocket},
    },
    http::StatusCode,
    response::Response,
};
use axum_login::AuthSession;
use std::{sync::Arc, time::Duration};
use tokio::{
    sync::{RwLock, broadcast},
    time::Instant,
};

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
    let user_id = auth_session
        .user
        .expect("user should exist")
        .get_user_id_string();
    let draft_lock = state.drafts.get(&draft_id).ok_or((
        StatusCode::FORBIDDEN,
        "user does not have access to requested draft".to_string(),
    ))?;

    {
        let mut draft = draft_lock.write().await;

        validate_bid_request(draft.current_auction, &draft, &bid_request).map_err(|e| {
            eprintln!("Bid not valid: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Couldn't process bid".to_string(),
            )
        })?;

        let mut tx = state.db_pool.begin().await.map_err(|e| {
            eprintln!("Error starting db transaction: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Couldn't process bid".to_string(),
            )
        })?;

        // update auction in db
        let _ = sqlx::query!(
            r#"
            UPDATE auctions
            SET (winning_bid, drafted_by) = ($1, $2)
            WHERE auction_id = $3
            "#,
            bid_request.value as i32,
            user_id,
            bid_request
                .auction_id
                .parse::<i64>()
                .expect("auction id should be i64"),
        )
        .execute(&mut *tx)
        .await
        .map_err(|e| {
            eprintln!("failed writing to db: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "failed to write to db".to_string(),
            )
        })?;

        // update bid in db, maybe later
        // let _ = sqlx::query!(
        //     r#"
        //     UPDATE bids
        //     SET (auction_id, value) = ($1, $2)
        //     WHERE auction_id = ($3)
        //     "#,
        //     bid_request.value as i32,
        //     uuid::Uuid::new_v4(),
        //     bid_request.auction_id as i32,
        // )
        // .execute(&mut *tx)
        // .await
        // .map_err(|e| {
        //     eprintln!("failed writing to db: {}", e);
        //     return (StatusCode::INTERNAL_SERVER_ERROR, "failed to write to db".to_string());
        // })?;

        tx.commit().await.map_err(|e| {
            eprintln!("failed commiting transaction to db: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "failed to write to db".to_string(),
            )
        })?;

        let (pokedex_id, form, current_bid, high_bidder, expires_at) = {
            let current_auction = draft.current_auction as usize;
            let auction = &mut draft.auctions[current_auction];
            //update auction in memory
            auction.highest_bidder = Some("Test".to_string());
            auction.highest_bid = bid_request.value;
            auction.expires_at = Some(std::cmp::max(
                auction.expires_at.unwrap(),
                Instant::now() + Duration::from_secs(10),
            ));
            (
                auction.pokemon.pokedex_id,
                auction.pokemon.form.clone(),
                auction.highest_bid,
                auction.highest_bidder.clone(),
                crate::get_expiry_time_from_instant(auction.expires_at.unwrap()),
            )
        };

        let _ = draft.tx.send(ServerMessage::AuctionUpdate {
            pokedex_id,
            form,
            current_bid,
            high_bidder,
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
) -> Result<(), String> {
    let auction = &draft.auctions[auction_num as usize];
    if auction.auction_id != bid_request.auction_id {
        return Err(format!("auction is not active"));
    }
    if auction.highest_bid >= bid_request.value {
        return Err(format!("bid is not higher than current highest bid"));
    }
    if auction.highest_bidder == Some(bid_request.user_id.clone()) {
        return Err(format!("user is already the highest bidder"));
    }
    // check user has team in draft
    if !draft.teams.iter().any(|t| t.user_id == bid_request.user_id) {
        return Err(format!("user is not assigned to a team"));
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

pub async fn discord_login() -> Result<(), String> {
    todo!("implement oauth endpoint")
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
