use axum::{debug_handler, Json, extract::{Path, State}, http::StatusCode};
use crate::{
    ServerState,
    auction::{Auction, AuctionDraft, DraftSettings}
};
use nanoid::nanoid;

#[debug_handler]
pub async fn create_lobby(State(state): State<ServerState>, Json(draft_settings): Json<DraftSettings>) -> (StatusCode, String) {
    for _ in 0..3 {
        if let Ok(auction_draft) = AuctionDraft::build(String::from("test host"), draft_settings, state.db_pool.clone()) {
            return (StatusCode::OK, "tesT".to_string())
        }
    }

    (StatusCode::INTERNAL_SERVER_ERROR, "Could not create draft!".to_string())
}

#[debug_handler]
pub async fn join_lobby(State(state): State<ServerState>, Path(auction_id): Path<String>) -> (StatusCode, Json<Auction>) {
    if let Some(auction) = state.auctions.get(&auction_id).await {
        return (StatusCode::OK, Json(auction));
    }

    todo!()
}
