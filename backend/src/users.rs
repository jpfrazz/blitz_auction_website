// github discord oauth example: https://github.com/maxcountryman/axum-login/tree/main/examples/oauth2

use axum_login;
use axum_login::{AuthUser, AuthnBackend};
use dashmap::DashMap;
use oauth2::Scope;
use oauth2::url::Url;
use oauth2::{AuthorizationCode, TokenResponse};
use oauth2::{CsrfToken, EndpointNotSet, EndpointSet, basic::BasicClient, reqwest};
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, sqlx_macros::FromRow, types::Json};
use std::sync::Arc;
use strum;
use twilight_model::id::Id;
use twilight_model::id::marker::{RoleMarker, UserMarker};

use crate::{DISCORD_GUILD_ID, POKEMON_NATURES, pokemon};

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

    pub fn has_role_name(&self, role_name: &str) -> bool {
        match self {
            Self::DiscordUser(user) => user.roles.iter().any(|role| role.role_name == role_name),
            Self::GuestUser(_) => false,
        }
    }
}

// https://discord.com/developers/docs/resources/user
#[derive(Clone, Debug, FromRow, Serialize, Deserialize, PartialEq, Eq)]
pub struct DiscordUser {
    pub user_id: String,
    pub user_name: String,
    discriminator: String,
    global_name: Option<String>,
    avatar: Option<String>,
    #[sqlx(default)]
    roles: Vec<DiscordRole>,
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
        &[]
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
    discord_client: Arc<twilight_http::Client>,
    discord_role_map: DashMap<Id<RoleMarker>, DiscordRole>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq, sqlx::FromRow, sqlx::Type)]
pub struct DiscordRole {
    role_id: String,
    role_name: String,
}

impl AuthBackend {
    pub fn new(
        db_pool: PgPool,
        client: BasicClientSet,
        discord_client: Arc<twilight_http::Client>,
        discord_role_map: DashMap<Id<RoleMarker>, DiscordRole>,
    ) -> Self {
        let http_client: reqwest::Client = reqwest::ClientBuilder::new()
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .expect("http_client should build");

        Self {
            db_pool,
            client,
            http_client,
            discord_client,
            discord_role_map,
        }
    }

    async fn insert_user_in_db(&self, user: &User) -> Result<(), AuthError> {
        println!("inserting user into db, {}", user.get_user_name_string());
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
                let mut tx = self
                    .db_pool
                    .begin()
                    .await
                    .map_err(|_| AuthError::SqlxError)?;
                let _ = sqlx::query!(
                    r#"
                    INSERT INTO users (user_id, user_name, discriminator, global_name, avatar)
                    VALUES ($1, $2, $3, $4, $5)
                    ON CONFLICT (user_id) DO UPDATE
                    SET
                        user_name = EXCLUDED.user_name,
                        global_name = EXCLUDED.global_name,
                        avatar = EXCLUDED.avatar,
                        discriminator = EXCLUDED.discriminator
                    "#,
                    user.user_id,
                    user.user_name,
                    user.discriminator,
                    user.global_name,
                    user.avatar,
                )
                .execute(&mut *tx)
                .await
                .map_err(|_| AuthError::SqlxError)?;

                let id_vec: Vec<String> = user.roles.iter().map(|r| r.role_id.clone()).collect();

                let name_vec: Vec<String> =
                    user.roles.iter().map(|r| r.role_name.clone()).collect();

                println!("deleting roles in db, {}", user.user_name);

                // delete removed roles
                let _ = sqlx::query!(
                    r#"
                        DELETE FROM user_roles WHERE user_id = $1 AND NOT (role_id = ANY($2))
                    "#,
                    user.user_id,
                    &id_vec,
                )
                .execute(&mut *tx)
                .await
                .map_err(|_| AuthError::SqlxError)?;

                println!("changing roles in db, {}", user.user_name);

                // add new roles
                let _ = sqlx::query!(
                    r#" 
                        INSERT INTO user_roles (user_id, role_id, role_name)
                        SELECT $1, * FROM UNNEST($2::text[], $3::text[])
                        ON CONFLICT (user_id, role_id) DO NOTHING
                    "#,
                    user.user_id,
                    &id_vec,
                    &name_vec
                )
                .execute(&mut *tx)
                .await
                .map_err(|_| AuthError::SqlxError)?;

                tx.commit().await.map_err(|_| AuthError::SqlxError)?;
            }
        }

        println!(
            "inserted user successfully, {}",
            user.get_user_name_string()
        );

        Ok(())
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

        let random_pokemon_name = pokemon::get_pokemon_data(&Vec::new())
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

    async fn get_discord_roles(
        &self,
        user_id: twilight_model::id::Id<UserMarker>,
    ) -> Vec<DiscordRole> {
        let guild_id = Id::new(DISCORD_GUILD_ID);

        let member_res = self.discord_client.guild_member(guild_id, user_id).await;
        match member_res {
            Ok(res) => {
                if let Ok(member) = res.model().await {
                    member
                        .roles
                        .into_iter()
                        .map(|role_id| DiscordRole {
                            role_id: role_id.get().to_string().clone(),
                            role_name: self
                                .discord_role_map
                                .get(&role_id)
                                .map(|e| e.value().role_name.to_string())
                                .unwrap_or_default()
                                .clone(),
                        })
                        .collect()
                } else {
                    eprintln!("failed to parse member roles");
                    vec![]
                }
            }
            Err(e) => {
                eprintln!("failed to parse member roles, {}", e);
                vec![]
            }
        }
    }

    pub async fn get_role_map(
        client: &twilight_http::Client,
    ) -> DashMap<Id<RoleMarker>, DiscordRole> {
        let guild_id = Id::new(DISCORD_GUILD_ID);
        if let Ok(res) = client.roles(guild_id).await {
            if let Ok(roles) = res.model().await {
                roles
                    .into_iter()
                    .map(|role| {
                        let discord_role = DiscordRole {
                            role_id: role.id.get().to_string().clone(),
                            role_name: role.name,
                        };
                        (role.id, discord_role)
                    })
                    .collect()
            } else {
                DashMap::new()
            }
        } else {
            DashMap::new()
        }
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

                println!("getting user from discord");

                let token_res = self
                    .client
                    .exchange_code(AuthorizationCode::new(creds.code))
                    .request_async(&self.http_client)
                    .await
                    .map_err(|_| Self::Error::OAuthError)?;

                let access_token = token_res.access_token().secret();

                let twilight_client =
                    twilight_http::Client::new(format!("Bearer {}", access_token));

                let twilight_user = twilight_client
                    .current_user()
                    .await
                    .map_err(|e| {
                        eprintln!("{}", e);
                        Self::Error::ReqwestError
                    })?
                    .model()
                    .await
                    .map_err(|e| {
                        eprintln!("{}", e);
                        Self::Error::ReqwestError
                    })?;

                let discord_roles = self.get_discord_roles(twilight_user.id).await;

                let discord_user = DiscordUser {
                    user_id: twilight_user.id.to_string(),
                    user_name: twilight_user.name,
                    discriminator: twilight_user.discriminator.to_string(),
                    global_name: twilight_user.global_name,
                    avatar: twilight_user.avatar.map(|a| a.to_string()),
                    roles: discord_roles,
                };

                println!("got user {} from discord", discord_user.user_name);

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
                println!("getting user {}", user_id);
                let row = sqlx::query!(
                    r#"
                        SELECT u.user_id, u.user_name, u.discriminator, u.global_name, u.avatar,
                            COALESCE(
                                jsonb_agg(
                                    jsonb_build_object('role_id', r.role_id, 'role_name', r.role_name)
                                ) FILTER (WHERE r.role_id IS NOT NULL),
                                '[]'
                            ) as "roles!"
                        FROM users as u
                        LEFT JOIN user_roles r ON r.user_id = u.user_id
                        WHERE u.user_id = $1
                        GROUP BY u.user_id
                    "#,
                    user_id,
                )
                .fetch_one(&self.db_pool)
                .await
                .map_err(|e| {
                    eprintln!("{e}");
                    Self::Error::SqlxError
                })?;

                let discord_user = DiscordUser {
                    user_id: row.user_id,
                    user_name: row.user_name,
                    discriminator: row.discriminator,
                    global_name: row.global_name,
                    avatar: row.avatar,
                    roles: serde_json::from_value(row.roles).map_err(|e| {
                        eprintln!("failed to get roles from db, {}", e);
                        AuthError::SqlxError
                    })?,
                };

                println!("got user {}", user_id);
                User::DiscordUser(discord_user)
            }
        };

        Ok(Some(user))
    }
}

type AuthSession = axum_login::AuthSession<AuthBackend>;

#[derive(Debug, Clone, Deserialize)]
pub struct AuthzResp {
    code: String,
    state: CsrfToken,
}
