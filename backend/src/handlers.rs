use std::collections::HashMap;
use axum::{debug_handler, Json, extract::{Path, State}, http::StatusCode, response::IntoResponse};
use crate::{
    ServerState,
    auction::{Auction, Draft, DraftSettings}
};

#[debug_handler]
pub async fn create_draft(State(state): State<ServerState>, Json(draft_settings): Json<DraftSettings>) -> (StatusCode, String) {

    for _ in 0..3 {
        if let Ok(draft) = Draft::build(String::from("test host"), draft_settings.clone(), state.db_pool.clone()).await {
            return (StatusCode::OK, draft.draft_id.clone())
        }
    }

    (StatusCode::INTERNAL_SERVER_ERROR, "Could not create draft!".to_string())
}

#[debug_handler]
pub async fn get_draft(State(state): State<ServerState>, Path(draft_id): Path<String>)
-> (StatusCode, Json<String>) {
    let mut return_map = HashMap::new();
    dbg!(&draft_id);
    let Some(draft) = state.drafts.get(&draft_id).await else {
        return (StatusCode::NOT_FOUND, Json(format!("draft {} not found", draft_id)));
    };

    let mut players = String::new();
    for player in draft.players {
        players.push_str(&player.to_string());
    }
    return_map.insert("players".to_string(), players);

    (StatusCode::OK, Json("got draft".to_string()))
}

#[debug_handler]
pub async fn join_draft(State(state): State<ServerState>, Path(draft_id): Path<String>) -> (StatusCode, Json<Auction>) {
    // if let Some(draft) = state.drafts.get(&draft_id).await {
    //     return (StatusCode::OK, Json(draft));
    // }

    todo!()
}

#[debug_handler]
pub async fn bid() {
    todo!("implement bid")
}
