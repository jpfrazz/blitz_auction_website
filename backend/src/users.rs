// github discord oauth example: https://github.com/maxcountryman/axum-login/tree/main/examples/oauth2

use axum::http::header::{AUTHORIZATION, USER_AGENT};
use axum_login;
use axum_login::{AuthUser, AuthnBackend};
use oauth2::url::Url;
use oauth2::Scope;
use oauth2::{AuthorizationCode, TokenResponse};
use oauth2::{CsrfToken, EndpointNotSet, EndpointSet, basic::BasicClient, reqwest};
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, sqlx_macros::FromRow};
use strum;

use crate::pokemon;

const DISCORD_AUTH_URL: &str = "https://discord.com/oauth2/authorize";
const DISCORD_TOKEN_URL: &str = "https://discord.com/api/oauth2/token";
const POKEMON_NATURES: [&str; 25] = [
    "Hardy",
    "Lonely",
    "Brave",
    "Adamant",
    "Naughty",
    "Bold",
    "Docile",
    "Relaxed",
    "Impish",
    "Lax",
    "Timid",
    "Hasty",
    "Serious",
    "Jolly",
    "Naive",
    "Modest",
    "Mild",
    "Quiet",
    "Bashful",
    "Rash",
    "Calm",
    "Gentle",
    "Sassy",
    "Careful",
    "Quirky",
];

#[derive(Clone, Debug)]
pub enum AuthError {
    InvalidCredentials,
    OAuthError,
    PgError,
    SqlxError,
    ReqwestError,
}

impl std::fmt::Display for AuthError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{:?}", self)
    }
}

impl std::error::Error for AuthError {}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub enum User {
    DiscordUser(DiscordUser),
    GuestUser(GuestUser),
}

impl User {
    pub fn get_user_id_string(&self) -> String {
        match self {
            Self::GuestUser(user) => user.user_id.clone(),
            Self::DiscordUser(user) => user.user_id.clone(),
        }
    }

    pub fn get_user_name_string(&self) -> String {
        match self {
            Self::GuestUser(user) => user.user_name.clone(),
            Self::DiscordUser(user) => user.user_name.clone(),
        }
    }
}

// https://discord.com/developers/docs/resources/user
#[derive(Clone, Debug, Deserialize, FromRow, Serialize, PartialEq, Eq)]
pub struct DiscordUser {
    #[serde(rename = "id")]
    pub user_id: String,
    #[serde(rename = "username")]
    pub user_name: String,
    discriminator: String,
    global_name: Option<String>,
    avatar: Option<String>,
    #[sqlx(default)]
    roles: Option<Vec<String>>,
    #[serde(skip)]
    role_hash: Vec<u8>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct GuestUser {
    pub user_id: String,
    pub user_name: String,
}

#[derive(strum::Display, Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub enum UserId {
    DiscordId(String),
    GuestId(String),
}

impl AuthUser for User {
    type Id = UserId;

    fn id(&self) -> Self::Id {
        match self {
            User::GuestUser(user) => UserId::GuestId(user.user_id.clone()),
            User::DiscordUser(user) => UserId::DiscordId(user.user_id.clone()),
        }
    }

    fn session_auth_hash(&self) -> &[u8] {
        match self {
            User::GuestUser(_) => &[],
            User::DiscordUser(user) => &user.role_hash,
        }
    }
}

pub enum Credentials {
    Guest,
    Discord(DiscordCreds),
}

pub struct DiscordCreds {
    pub code: String,
    pub old_state: CsrfToken,
    pub new_state: CsrfToken,
}

pub type BasicClientSet =
    BasicClient<EndpointSet, EndpointNotSet, EndpointNotSet, EndpointNotSet, EndpointSet>;

#[derive(Clone, Debug)]
pub struct AuthBackend {
    db_pool: PgPool,
    client: BasicClientSet,
    http_client: reqwest::Client,
}

impl AuthBackend {
    pub fn new(db_pool: PgPool, client: BasicClientSet) -> Self {
        let http_client: reqwest::Client = reqwest::ClientBuilder::new()
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .expect("http_client should build");

        Self {
            db_pool,
            client,
            http_client,
        }
    }

    async fn insert_user_in_db(&self, user: &User) -> Result<(), AuthError> {
        match user {
            User::GuestUser(user) => {
                let _res = sqlx::query!(
                    "
                    INSERT INTO guests (user_id, user_name)
                    VALUES ($1, $2);
                    ",
                    user.user_id,
                    user.user_name,
                )
                .execute(&self.db_pool)
                .await
                .map_err(|_e| AuthError::SqlxError)?;
            }
            User::DiscordUser(user) => {
                let role_hash = self.get_discord_roles(user);
                let _res = sqlx::query!(
                    "
                    INSERT INTO users (user_id, user_name, discriminator, global_name, avatar, role_hash)
                    VALUES ($1, $2, $3, $4, $5, $6)
                    ON CONFLICT (user_id) DO NOTHING;
                    ",
                    user.user_id,
                    user.user_name,
                    user.discriminator,
                    user.global_name,
                    user.avatar,
                    role_hash,
                )
                .execute(&self.db_pool)
                .await
                .map_err(|_e| AuthError::SqlxError)?;
            }
        }

        Ok(())
    }

    fn get_discord_roles(&self, user: &DiscordUser) -> String {
        "".to_string()
    }

    pub fn authorize_url(&self) -> (Url, CsrfToken) {
        self.client
        .authorize_url(CsrfToken::new_random)
        .add_scope(Scope::new("identify".to_string()))
        .url()
    }

    fn generate_guest_username(&self) -> String {
        let random_nature_index = (uuid::Uuid::new_v4().as_u128() as usize) % POKEMON_NATURES.len();
        let random_nature = POKEMON_NATURES[random_nature_index];

        let random_pokemon_name = pokemon::get_highest_patch_pokemon_data()
            .and_then(|pokemon_data| {
                if pokemon_data.is_empty() {
                    None
                } else {
                    let random_pokemon_index =
                        (uuid::Uuid::new_v4().as_u128() as usize) % pokemon_data.len();
                    Some(pokemon_data[random_pokemon_index].name.clone())
                }
            })
            .unwrap_or_else(|| "Pikachu".to_string());

        format!("guest:{}-{}", random_nature, random_pokemon_name)
    }
}

impl AuthnBackend for AuthBackend {
    type User = User;
    type Credentials = Credentials;
    type Error = AuthError;

    async fn authenticate(
        &self,
        creds: Self::Credentials,
    ) -> Result<Option<Self::User>, Self::Error> {
        let user: User;
        match creds {
            Credentials::Guest => {
                let user_id = uuid::Uuid::new_v4().to_string();
                let user_name = self.generate_guest_username();
                user = User::GuestUser(GuestUser { user_id, user_name });
            }
            Credentials::Discord(creds) => {
                if creds.old_state.secret() != creds.new_state.secret() {
                    return Ok(None);
                }

                let token_res = self
                    .client
                    .exchange_code(AuthorizationCode::new(creds.code))
                    .request_async(&self.http_client)
                    .await
                    .map_err(|_| Self::Error::OAuthError)?;

                let user_info_text = reqwest::Client::new()
                    .get("https://discord.com/api/users/@me")
                    .header(USER_AGENT.as_str(), "blitz-auction-backend")
                    .header(
                        AUTHORIZATION.as_str(),
                        format!("Bearer {}", token_res.access_token().secret()),
                    )
                    .send()
                    .await
                    .map_err(|e| {
                        println!("{}", e);
                        Self::Error::ReqwestError
                    })?
                    .text()
                    .await
                    .map_err(|e| {
                        println!("{}", e);
                        Self::Error::ReqwestError
                    })?;

                let discord_user: DiscordUser =
                    serde_json::from_str(&user_info_text)
                    .map_err(|e| {
                        println!("{}", e);
                        Self::Error::ReqwestError
                    })?;

                user = User::DiscordUser(discord_user);
            }
        }

        let Ok(_) = self.insert_user_in_db(&user).await else {
            return Err(Self::Error::PgError);
        };

        Ok(Some(user))
    }

    async fn get_user(
        &self,
        user_id: &axum_login::UserId<Self>,
    ) -> Result<Option<Self::User>, Self::Error> {
        let user: Self::User = match user_id {
            UserId::GuestId(user_id) => {
                let guest_user = sqlx::query_as!(
                    GuestUser,
                    r#"
                        SELECT user_id, user_name
                        FROM guests
                        WHERE user_id = $1
                    "#,
                    user_id,
                )
                .fetch_one(&self.db_pool)
                .await
                .map_err(|_e| Self::Error::SqlxError)?;

                User::GuestUser(guest_user)
            }
            UserId::DiscordId(user_id) => {
                let discord_user = sqlx::query_as!(
                    DiscordUser,
                    r#"
                        SELECT u.user_id, u.user_name, u.discriminator, u.global_name, u.avatar, u.role_hash,
                            COALESCE(
                                array_agg(r.role) FILTER (WHERE r.role IS NOT NULL),
                                '{}'
                            ) as "roles!: Vec<String>"
                        FROM users as u
                        LEFT JOIN user_roles r ON r.user_id = u.user_id
                        WHERE u.user_id = $1
                        GROUP BY u.user_id
                    "#,
                    user_id,
                )
                .fetch_one(&self.db_pool)
                .await
                .map_err(|_e| {
                    Self::Error::SqlxError
                })?;

                User::DiscordUser(discord_user)
            }
        };

        Ok(Some(user))
    }
}

type AuthSession = axum_login::AuthSession<AuthBackend>;

pub const CSRF_STATE_KEY: &str = "oauth.csrf-state";

#[derive(Debug, Clone, Deserialize)]
pub struct AuthzResp {
    code: String,
    state: CsrfToken,
}

pub async fn discord_oauth_callback(auth_session: AuthSession) {}
