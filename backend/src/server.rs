use crate::{
    Draft, DraftRunner, PgPool, handlers, pokemon,
    users::{AuthBackend, Credentials},
};
use axum::{
    Router,
    extract::Request,
    http::{Method, StatusCode},
    middleware::{self, Next},
    response::Response,
    routing::{any, get, post},
};
use axum_login::{AuthManagerLayer, AuthManagerLayerBuilder, AuthSession, AuthnBackend};
use dashmap::DashMap;
use oauth2::{AuthUrl, ClientId, ClientSecret, TokenUrl, basic::BasicClient};
use std::{env, sync::Arc};
use tokio::sync::RwLock;
use tower_http::cors::{Any, CorsLayer};
use tower_sessions::{Expiry, MemoryStore, SessionManagerLayer};

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
    PokemonData(String),
}

impl std::error::Error for ServerError {}

pub type Error = ServerError;

pub struct Server {
    server_state: ServerState,
}

impl Server {
    fn new(server_state: ServerState) -> Self {
        Self { server_state }
    }

    pub async fn build() -> Result<Self, Error> {
        let db_conn_string = env::var("DB_CONN_STRING").map_err(|e| {
            ServerError::MissingEnv(format!("missing DB_CONN_STRING: {}", e.to_string()))
        })?;
        let db_pool = PgPool::connect(&db_conn_string)
            .await
            .map_err(|e| ServerError::PgConnection(e.to_string()))?;
        if let Err(e) = pokemon::init_pokemon_data(&db_pool).await {
            return Err(ServerError::PokemonData(format!(
                "failed to init pokemon data, {}",
                e.to_string()
            )));
        };
        let drafts = DraftCache::new(DashMap::new());
        let draft_runner = Arc::new(DraftRunner::new(drafts.clone()));
        let server_state = ServerState {
            db_pool,
            drafts,
            draft_runner,
        };
        let server = Self::new(server_state);

        Ok(server)
    }

    fn create_session_layer(&self) -> SessionManagerLayer<MemoryStore> {
        let session_store = MemoryStore::default();
        SessionManagerLayer::new(session_store)
            .with_expiry(Expiry::OnSessionEnd)
            .with_same_site(tower_sessions::cookie::SameSite::Lax)
    }

    fn create_auth_layer(
        &self,
        session_layer: SessionManagerLayer<MemoryStore>,
    ) -> AuthManagerLayer<AuthBackend, MemoryStore> {
        let auth_url = AuthUrl::new("https://discord.com/oauth2/authorize".to_string())
            .expect("auth_url should be created");
        let token_url = TokenUrl::new("https://discord.com/api/oauth2/token".to_string())
            .expect("token_url should be created");
        let client_id = env::var("OAUTH_CLIENT_ID")
            .map(ClientId::new)
            .expect("CLIENT_ID should be provided.");
        let client_secret = env::var("OAUTH_CLIENT_SECRET")
            .map(ClientSecret::new)
            .expect("CLIENT_SECRET should be provided");
        let client = BasicClient::new(client_id)
            .set_client_secret(client_secret)
            .set_auth_uri(auth_url)
            .set_token_uri(token_url);
        let auth_backend = AuthBackend::new(self.server_state.db_pool.clone(), client);
        AuthManagerLayerBuilder::new(auth_backend, session_layer).build()
    }

    fn create_router(
        self,
        auth_layer: AuthManagerLayer<AuthBackend, MemoryStore>,
        cors_layer: CorsLayer,
    ) -> Router {
        let public_routes = Router::new()
            .route("/", get(|| async { "blitz auction api" }))
            .route("/drafts/{draft_id}", get(handlers::get_draft))
            .route("/ws/{draft_id}", any(handlers::websocket_handler))
            .route("/login", get(handlers::discord_oauth_redirect))
            .route("/auth/discord/callback", get(handlers::discord_callback))
            .route("/me", get(handlers::me));

        let private_routes = Router::new()
            .route("/drafts", get(handlers::list_open_drafts).post(handlers::create_draft))
            .route("/drafts/{draft_id}/join", post(handlers::join_draft))
            .route("/drafts/{draft_id}/ready", post(handlers::ready_up))
            .route("/drafts/{draft_id}/bid", post(handlers::bid))
            .route("/drafts/{draft_id}/start", post(handlers::start_draft))
            .route("/drafts/{draft_id}/claim-eeveelution", post(handlers::claim_eeveelution))
            .route(
                "/drafts/{draft_id}/chats",
                get(handlers::get_draft_chats).post(handlers::create_draft_chat),
            )
            .route_layer(middleware::from_fn(auto_login_guest))
            .route("/logout", get(handlers::logout))
            .route("/guests/change-name", post(handlers::change_guest_name));

        Router::new()
            .merge(public_routes)
            .merge(private_routes)
            .with_state(self.server_state)
            .layer(auth_layer)
            .layer(cors_layer)
    }

    pub async fn serve(self) -> Result<(), Error> {
        let session_layer = self.create_session_layer();
        let auth_layer = self.create_auth_layer(session_layer);
        let cors_layer = CorsLayer::new()
            .allow_methods([Method::GET, Method::POST])
            .allow_origin(Any);
        let router = self.create_router(auth_layer, cors_layer);
        let address = "[::]:3001".to_string();
        let listener = tokio::net::TcpListener::bind(address.clone())
            .await
            .map_err(|_e| ServerError::CannotServe(format!("unable to bind to {}", address)))?;
        println!("listening on {}", address);
        axum::serve(listener, router.into_make_service())
            .await
            .map_err(|e| ServerError::CannotServe(e.to_string()))?;
        Ok(())
    }
}

async fn auto_login_guest(
    mut auth: AuthSession<AuthBackend>,
    mut request: Request,
    next: Next,
) -> Result<Response, StatusCode> {
    if auth.user.is_some() {
        return Ok(next.run(request).await);
    }

    let guest_user = auth
        .backend
        .authenticate(Credentials::Guest)
        .await
        .map_err(|_e| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::INTERNAL_SERVER_ERROR)?;

    auth.login(&guest_user)
        .await
        .map_err(|_e| StatusCode::INTERNAL_SERVER_ERROR)?;

    request.extensions_mut().insert(auth);

    Ok(next.run(request).await)
}
