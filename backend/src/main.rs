use std::env;

use axum::{
    Router,
    routing::{any, get, post},
};

use backend::{ServerState, handlers};
use moka::future::Cache;
use sqlx::PgPool;

#[tokio::main]
async fn main() {
    let db_connection_string = env::var("DATABASE_URL").unwrap_or_else(|_| {
        return "postgres://postgres:password@localhost:5432/auction_db".to_string();
    });
    println!("{db_connection_string}");
    let db_pool = PgPool::connect(&db_connection_string).await.unwrap();
    let drafts = Cache::new(10_000);

    let state = ServerState {
        db_pool: db_pool,
        drafts: drafts,
    };

    let app = Router::new()
        .route("/", get(|| async { "blitz auction api" }))
        .route("/drafts", post(handlers::create_draft))
        .route("/drafts/{draft_id}/join", post(handlers::join_draft))
        .route("/drafts/{draft_id}", get(handlers::get_draft))
        .route("/drafts/{draft_id}/bid", post(handlers::bid))
        .route("/ws/{draft_id}", any(handlers::websocket_handler))
        .with_state(state);

    let address = env::var("AXUM_SERVER_ADDR").unwrap_or_else(|_| "0.0.0.0:3000".into());
    let listener = tokio::net::TcpListener::bind(address.clone())
        .await
        .unwrap();
    println!("listening on {}", address);
    axum::serve(listener, app).await.unwrap()
}
