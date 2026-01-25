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
    response::{Response},
};
use tokio::sync::{broadcast, RwLock};
use std::sync::Arc;

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
        )
        .await
        {
            let draft_id = draft.draft_id.clone();
            state.drafts.insert(draft_id.clone(), Arc::new(RwLock::new(draft)));
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
    let draft_lock = state.drafts
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
    // if let Some(draft) = state.drafts.get(&draft_id).await {
    //     return (StatusCode::OK, Json(draft));
    // }

    todo!()
}

#[debug_handler]
pub async fn bid(
    State(state): State<ServerState>,
    Path(draft_id): Path<String>,
    Json(bid_request): Json<ClientBidRequest>
) -> Result<Json<ClientBidResponse>, (StatusCode, String)> {
    let draft_lock = state.drafts
        .get(&draft_id)
        .map(|d| d.value().clone())
        .ok_or((StatusCode::FORBIDDEN, "user does not have access to requested draft".to_string()))?;


    {
        let mut draft = draft_lock.write().await;
        let auction = &draft.auctions[draft.current_auction.clone() as usize];
        if auction.auction_id != bid_request.auction_id {
            let error_msg = format!("auction is not active");
            return Ok(Json(ClientBidResponse { accepted: false, error: Some(error_msg) }))
        }
        if auction.highest_bid >= bid_request.value {
            let error_msg = format!("bid is not higher than current highest bid");
            return Ok(Json(ClientBidResponse { accepted: false, error: Some(error_msg) }))
        }
        if auction.highest_bidder == todo!() {
            let error_msg = format!("user is already the highest bidder");
            return Ok(Json(ClientBidResponse { accepted: false, error: Some(error_msg) }))
        }
        // check user has team in draft

    }


    Ok(Json(ClientBidResponse{
        accepted: true,
        error: None
    }))
}

#[debug_handler]
pub async fn websocket_handler(
    State(state): State<ServerState>,
    Path(draft_id): Path<String>,
    ws: WebSocketUpgrade,
) -> Result<Response<Body>, (StatusCode, String)> {
    let tx = {
        let Some(draft) = state.drafts.get(&draft_id) else {
            return Err((StatusCode::NOT_FOUND, "Draft does not exist".to_string()));
        };
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
