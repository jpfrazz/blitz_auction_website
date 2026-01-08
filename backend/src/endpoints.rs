use axum::{Json, extract::Path};

pub async fn create_auction(Json<AuctionSettings>) {
    
}

pub async fn join_auction(Path(auction_id): Path<String>) {

}
