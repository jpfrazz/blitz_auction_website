use crate::{Draft, DraftRunner, PgPool, handlers, server};
use std::{env, sync::Arc};
use axum::{Router, routing::{any, get, post}};
use tokio::sync::RwLock;
use dashmap::DashMap;


type DraftCache = Arc<DashMap<String, Arc<RwLock<Draft>>>>;



#[derive(Clone, Debug)]
pub struct ServerState {
    pub db_pool: PgPool,
    pub drafts: DraftCache,
    pub draft_runner: Arc<DraftRunner>,
}


#[derive(Clone, Debug, strum::Display)]
pub enum ServerError {
    PgConnection(String),
    CannotServe(String),
    MissingEnv(String),
}

impl std::error::Error for ServerError {}

pub type Error = ServerError;

pub struct Server {
    server_state: ServerState,
    router: Router<ServerState>,
}

impl Server {
    fn new(server_state: ServerState, router: Router<ServerState>) -> Self {
        Self {
            server_state,
            router,
        }
    }

    pub async fn build() -> Result<Self, Error> {
        let db_conn_string = env::var("DB_CONN_STRING").map_err(|e| {
            ServerError::MissingEnv(e.to_string())
        })?;
        let db_pool = PgPool::connect(&db_conn_string).await.map_err(|e| {
            ServerError::PgConnection(e.to_string())
        })?;
        let drafts = DraftCache::new(DashMap::new());
        let draft_runner = Arc::new(DraftRunner::new(drafts.clone()));
        let server_state = ServerState {
            db_pool,
            drafts,
            draft_runner,
        };
        let router = Self::create_router();
        let server = Self::new(server_state, router);


        Ok(server)
    }

    fn create_router() -> Router<ServerState> {
        Router::new()
            .route("/", get(|| async { "blitz auction api" }))
            .route("/drafts", post(handlers::create_draft))
            .route("/drafts/{draft_id}/join", post(handlers::join_draft))
            .route("/ranked/drafts", post(handlers::create_draft))
            .route("/ranked/drafts/{draft_id}/join", post(handlers::join_draft))
            .route("/drafts/{draft_id}", get(handlers::get_draft))
            .route("/drafts/{draft_id}/bid", post(handlers::bid))
            .route("/ws/{draft_id}", any(handlers::websocket_handler))
            .route("/login/guest", get(handlers::guest_login))
            .route("/login/discord", get(handlers::discord_login))
    }

    pub async fn serve(self) -> Result<(), Error>{
        let app = self.router
            .with_state(self.server_state);
        let address = env::var("AXUM_SERVER_ADDR").unwrap_or_else(|_| "0.0.0.0:3000".into());
        let listener = tokio::net::TcpListener::bind(address.clone())
            .await
            .unwrap();
        println!("listening on {}", address);
        axum::serve(listener, app.into_make_service()).await.map_err(|e| {
            ServerError::CannotServe(e.to_string())
        })?;
        Ok(())
    }
}

