use std::env;

use axum::{
    routing::{get, post},
    Router,
};

use backend::endpoints;

#[tokio::main]
async fn main() {
    let app = Router::new()
        .route("/", get(|| async {"blitz auction api"}))
        .route("/create_auction", post(endpoints::create_auction))
        .route("/join_auction/{auction_id}", get(endpoints::join_auction))
    ;

    let address = env::var("AXUM_SERVER_ADDR").unwrap_or_else(|_| "0.0.0.0:3000".into());
    let listener = tokio::net::TcpListener::bind(address).await.unwrap();
    axum::serve(listener, app).await.unwrap()
}
