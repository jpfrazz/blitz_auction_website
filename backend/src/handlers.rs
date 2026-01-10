use axum::{debug_handler, Json, extract::{Path, State}, http::StatusCode};
use crate::{
    ServerState,
    auction::{Auction, AuctionSettings}
};
use nanoid::nanoid;

#[debug_handler]
pub async fn create_auction(Json(auction_settings): Json<AuctionSettings>) -> (StatusCode, String) {
    let auction_id = nanoid!(10);
    (StatusCode::OK, auction_id)
}

#[debug_handler]
pub async fn join_auction(State(state): State<ServerState>, Path(auction_id): Path<String>) -> (StatusCode, Json<Auction>) {
    if let Some(auction) = state.auctions.get(&auction_id).await {
        return (StatusCode::OK, Json(auction));
    }

    todo!()
}
