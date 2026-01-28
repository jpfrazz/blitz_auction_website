use crate::{
    ServerState,
    auction::Auction,
    draft::{Draft, DraftResponse, DraftSettings},
    messages::{ClientBidRequest, ClientBidResponse, ServerMessage},
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
use std::{sync::Arc, time::Duration};
use tokio::{
    sync::{RwLock, broadcast},
    time::Instant,
};

#[debug_handler]
pub async fn create_draft(
    State(state): State<ServerState>,
    Json(draft_settings): Json<DraftSettings>,
) -> Result<String, (StatusCode, String)> {
    for _ in 0..3 {
        if let Ok(draft) = Draft::build(
            String::from("test host"),
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
) -> (StatusCode, Json<Auction>) {
    todo!()
}

#[debug_handler]
pub async fn bid(
    State(state): State<ServerState>,
    Path(draft_id): Path<String>,
    Json(bid_request): Json<ClientBidRequest>,
) -> Result<Json<ClientBidResponse>, (StatusCode, String)> {
    let draft_lock = state.drafts.get(&draft_id).ok_or((
        StatusCode::FORBIDDEN,
        "user does not have access to requested draft".to_string(),
    ))?;

    {
        let draft = draft_lock.write().await;
        let auction = &draft.auctions[draft.current_auction.clone() as usize];

        validate_bid_request(auction, &draft, &bid_request).map_err(|e| {
            eprintln!("Error starting db transaction: {}", e);
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
            uuid::Uuid::new_v4(),
            bid_request.auction_id as i32,
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

        //update auction in memory
        auction.highest_bidder = Some(todo!());
        auction.highest_bid = bid_request.value;
        auction.expires_at = Some(std::cmp::max(
            auction.expires_at.unwrap(),
            Instant::now() + Duration::from_secs(10),
        ));
        let pokemon = auction.pokemon;

        let _ = draft.tx.send(ServerMessage::AuctionUpdate {
            pokedex_id: pokemon.pokedex_id,
            form: pokemon.form,
            current_bid: auction.highest_bid,
            high_bidder: auction.highest_bidder,
            expires_at: crate::get_expiry_time_from_instant(
                auction.expires_at.expect("auction expiry not set"),
            ),
        });
    }

    Ok(Json(ClientBidResponse {
        accepted: true,
        error: None,
    }))
}

fn validate_bid_request(
    auction: &Auction,
    draft: &Draft,
    bid_request: &ClientBidRequest,
) -> Result<(), String> {
    if auction.auction_id != bid_request.auction_id {
        return Err(format!("auction is not active"));
    }
    if auction.highest_bid >= bid_request.value {
        return Err(format!("bid is not higher than current highest bid"));
    }
    if auction.highest_bidder == todo!() {
        return Err(format!("user is already the highest bidder"));
    }
    // check user has team in draft
    if !draft.teams.contains(todo!()) {
        return Err(format!("user is not assigned to a team"));
    }

    Ok(())
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
