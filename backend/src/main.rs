use std::env;

use axum::{
    routing::{get, post},
    Router,
};

use backend::{ServerState, handlers};
use moka::future::Cache;
use sqlx::PgPool;

#[tokio::main]
async fn main() {
    let db_connection_string = env::var("DB_CONNECTION_STRING").unwrap_or_else(|_| "postgres://".into());
    let db_pool = PgPool::connect(&db_connection_string).await.unwrap();
    let auctions = Cache::new(10_000);

    let state = ServerState{
        db_pool: db_pool,
        auctions: auctions,
    };

    let app = Router::new()
        .route("/", get(|| async {"blitz auction api"}))
        .route("/create_auction", post(handlers::create_auction))
        .route("/join_auction/{auction_id}", get(handlers::join_auction))
        .with_state(state)
    ;

    let address = env::var("AXUM_SERVER_ADDR").unwrap_or_else(|_| "0.0.0.0:3000".into());
    let listener = tokio::net::TcpListener::bind(address).await.unwrap();
    axum::serve(listener, app).await.unwrap()
}
