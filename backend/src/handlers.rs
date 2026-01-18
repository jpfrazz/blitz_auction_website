use crate::{
    ServerState,
    auction::Auction,
    draft::{Draft, DraftResponse, DraftSettings},
    messages::ServerMessage,
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
use tokio::sync::broadcast;

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
            return Ok(draft.draft_id);
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
    let Some(draft) = state.drafts.get(&draft_id) else {
        return Err((
            StatusCode::NOT_FOUND,
            format!("draft {} not found", draft_id),
        ));
    };

    let draft_response: DraftResponse = draft.into();

    Ok(Json(draft_response))
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
pub async fn bid() {
    todo!("implement bid")
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
