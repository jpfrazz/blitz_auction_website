use axum::http::StatusCode;
use chrono::Utc;
use dashmap::DashMap;
use petname::petname;
use rand::seq::SliceRandom;
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Row};
use std::{collections::{HashMap, HashSet}, sync::Arc};
use strum::Display;
use tokio::{
    sync::{broadcast, mpsc, oneshot},
    time::{Duration, Instant},
};
use uuid::Uuid;

use crate::{
    AppError,
    auction::{self, Auction, AuctionResponse},
    db_writer::DbWriter,
    messages::{ClientBidRequest, ServerMessage},
    pokemon::{self, Pokemon, PokemonStage},
    users::User,
};

#[derive(Debug)]
pub struct Draft {
    pub draft_id: Uuid,
    pub draft_name: String,
    pub host: User,
    pub broadcast_tx: broadcast::Sender<ServerMessage>,
    pub pokemon: Vec<Arc<Pokemon>>,
    /// Number of live player-emulator WebSocket connections per user_id.
    /// Used to tell spectators/sidebars when a player has closed their tab or
    /// otherwise left the lobby. The emulator page registers itself on connect
    /// and the count is decremented when its socket drops; the Spectate page
    /// never registers, so it doesn't count as a player connection.
    pub presence: Arc<DashMap<String, usize>>,
    pub created_at: chrono::DateTime<Utc>,
    actor_sender: mpsc::Sender<DraftCommand>,
}

#[derive(Clone, Debug, Serialize)]
pub struct DraftResponse {
    draft_id: String,
    draft_name: String,
    has_password: bool,
    total_auctions: u32,
    host: String,
    ranked: bool,
    draft_type: String,
    format: String,
    total_teams: u32,
    teams: Vec<Team>,
    draft_state: DraftState,
    current_auction: usize,
    completed_auctions: Vec<AuctionResponse>,
    current_server_time: chrono::DateTime<Utc>,
    auction_length: u32,
    /// 1v1 drafts only: the shared pick/ban pool and current turn state.
    #[serde(skip_serializing_if = "Option::is_none")]
    one_v_one: Option<OneVOneState>,
}

#[derive(Clone, Debug, Serialize)]
pub struct DraftLobbyResponse {
    draft_id: Uuid,
    draft_name: String,
    has_password: bool,
    host: String,
    host_username: String,
    players: Vec<String>,
    ranked: bool,
    draft_type: String,
    format: String,
    teams_joined: u32,
    total_teams: u32,
    total_auctions: u32,
    draft_state: DraftState,
    created_at: chrono::DateTime<Utc>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, Display)]
pub enum DraftState {
    PENDING,
    BIDDING,
    COMPLETED,
}

impl Default for DraftState {
    fn default() -> DraftState {
        DraftState::PENDING
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ExcludedPokemon {
    pub pokedex_id: u32,
    pub form: Option<String>,
}

/// 1v1 draft: which player slot (1 = first pick / blue, 2 = second pick / red).
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub enum OneVOnePlayer {
    P1,
    P2,
}

impl OneVOnePlayer {
    pub fn other(&self) -> Self {
        match self {
            OneVOnePlayer::P1 => OneVOnePlayer::P2,
            OneVOnePlayer::P2 => OneVOnePlayer::P1,
        }
    }
}

/// The action a player is currently taking in a 1v1 draft.
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub enum OneVOneAction {
    Pick,
    Ban,
    /// A pokemon left unclaimed at the end of the main phase. Present in
    /// `history` so pool ordering stays consistent, but never picked by anyone.
    Leftover,
}

/// One recorded entry in a 1v1 draft's history (a pick or a ban).
#[derive(Clone, Debug, Serialize)]
pub struct OneVOneHistoryEntry {
    pub order: u32,
    pub action: OneVOneAction,
    pub player: OneVOnePlayer,
    pub pokemon: Pokemon,
}

/// A single pokemon in the 1v1 shared pool with its current status.
#[derive(Clone, Debug, Serialize)]
pub struct OneVOnePoolSlot {
    pub pokemon: Pokemon,
    /// None = available, Some(player) = picked by that player, or banned.
    pub status: OneVOneSlotStatus,
    /// Average auction price used for display ordering / auto-pick tiebreaks.
    pub avg_price: u32,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub enum OneVOneSlotStatus {
    Available,
    Picked(OneVOnePlayer),
    Banned(OneVOnePlayer),
}

/// Public 1v1 draft state included in `DraftResponse` for 1v1 lobbies.
#[derive(Clone, Debug, Serialize)]
pub struct OneVOneState {
    pub pool: Vec<OneVOnePoolSlot>,
    /// user_id of player 1 (blue / first pick) and player 2 (red / second pick).
    pub player1: String,
    pub player2: String,
    /// Whose turn it is and what they are doing, while the draft is running.
    pub current_player: Option<OneVOnePlayer>,
    pub current_action: Option<OneVOneAction>,
    /// Number of picks each player has made so far.
    pub p1_picks: u32,
    pub p2_picks: u32,
    /// When the current 30s turn expires (server time), for the countdown.
    pub turn_expires_at: Option<chrono::DateTime<Utc>>,
    pub paused_time_remaining: Option<u32>,
    /// Whether the pick/ban countdown timer is currently enabled.
    pub timer_enabled: bool,
    /// True once the main 16-pick phase is done and eeveelution bans begin.
    pub eeveelution_phase: bool,
    /// Ordered pick/ban history for the Draft History tab.
    pub history: Vec<OneVOneHistoryEntry>,
    /// The 8 eeveelutions available to ban/claim once the main phase ends.
    pub eeveelutions: Vec<OneVOnePoolSlot>,
    /// pokedex_ids of eeveelutions that were banned (greyed out in the emulator).
    pub banned_eeveelutions: Vec<u32>,
}

/// The full 1v1 pick/ban order. Each tuple is (player, action).
/// P1 opens with a lone pick, P2 takes a double pick with no ban, then P1
/// picks and bans once. After that the players alternate Pick+Ban turns
/// (starting with P2) until each player has 8 picks and 6 bans.
/// 16 picks + 12 bans = 28 actions. After this, 4 pool pokemon are left over.
fn one_v_one_action_sequence() -> Vec<(OneVOnePlayer, OneVOneAction)> {
    use OneVOneAction::*;
    use OneVOnePlayer::*;
    let mut seq = vec![
        (P1, Pick), // pick 1: P1
        (P2, Pick), // pick 2: P2
        (P2, Pick), // pick 3: P2
        (P1, Pick), // pick 4: P1
        (P1, Ban),  // ban 1: P1
    ];
    // P1 burned its opening ban, so its ban count runs one ahead of P2's.
    // After 5 alternating rounds P1 has all 6 bans but only 7 picks, so a
    // 6th round finishes P2 (8 picks, 6 bans) and P1 closes with pick 8.
    for _ in 0..5 {
        seq.push((P2, Pick));
        seq.push((P2, Ban));
        seq.push((P1, Pick));
        seq.push((P1, Ban));
    }
    seq.push((P2, Pick));
    seq.push((P2, Ban));
    seq.push((P1, Pick));
    seq
}

/// Linear-interpolation quantile over a sorted slice, matching the stats page.
fn calc_quantile(sorted: &[i32], q: f64) -> f64 {
    let pos = (sorted.len() as f64 - 1.0) * q;
    let base = pos.floor() as usize;
    let rest = pos - base as f64;
    if sorted.get(base + 1).is_some() {
        sorted[base] as f64 + rest * (sorted[base + 1] as f64 - sorted[base] as f64)
    } else {
        sorted[base] as f64
    }
}

impl OneVOneEngine {
    /// Build the public state snapshot sent to clients.
    fn to_state(&self, actor: &DraftActor) -> OneVOneState {
        let (current_player, current_action) = self.current_turn(&actor.draft_state);
        OneVOneState {
            pool: self.pool.clone(),
            player1: self.player1.clone(),
            player2: self.player2.clone(),
            current_player,
            current_action,
            p1_picks: self.p1_picks,
            p2_picks: self.p2_picks,
            turn_expires_at: self.turn_expires_at.map(crate::get_expiry_time_from_instant),
            paused_time_remaining: self.paused_time_remaining,
            timer_enabled: self.timer_enabled,
            eeveelution_phase: self.eeveelution_phase,
            history: self.history.clone(),
            eeveelutions: self.eeveelutions.clone(),
            banned_eeveelutions: self.banned_eeveelutions.clone(),
        }
    }

    /// Returns the current turn's (player, action), if the draft is running.
    fn current_turn(&self, draft_state: &DraftState) -> (Option<OneVOnePlayer>, Option<OneVOneAction>) {
        if *draft_state != DraftState::BIDDING {
            return (None, None);
        }
        if self.eeveelution_phase {
            let player = if self.eeveelution_bans % 2 == 0 {
                OneVOnePlayer::P1
            } else {
                OneVOnePlayer::P2
            };
            return (Some(player), Some(OneVOneAction::Ban));
        }
        self.sequence
            .get(self.action_index)
            .map(|(p, a)| (Some(*p), Some(*a)))
            .unwrap_or((None, None))
    }

    /// Reserve the next monotonic draft_order for a row being persisted to
    /// `auctions`. Draft orders must be unique per (draft_id, draft_order),
    /// and eeveelution bans don't append to `history`, so a separate counter
    /// (rather than `history.len()`) is what keeps every INSERT unique.
    fn take_next_order(&mut self) -> u32 {
        let order = self.next_order;
        self.next_order += 1;
        order
    }

    fn player_id(&self, player: OneVOnePlayer) -> &str {
        match player {
            OneVOnePlayer::P1 => &self.player1,
            OneVOnePlayer::P2 => &self.player2,
        }
    }

    /// Highest avg-price pokemon still available for the given action.
    fn highest_avg_price_available(&self, action: OneVOneAction) -> Option<&OneVOnePoolSlot> {
        let source: &Vec<OneVOnePoolSlot> = if self.eeveelution_phase {
            &self.eeveelutions
        } else {
            &self.pool
        };
        source
            .iter()
            .filter(|s| s.status == OneVOneSlotStatus::Available)
            .max_by_key(|s| s.avg_price)
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct DraftSettings {
    pub num_teams: u32,
    pub starting_money: u32,
    #[serde(default)]
    pub draft_name: String,
    #[serde(default)]
    pub ranked: bool,
    #[serde(default)]
    pub password: Option<String>,
    pub excluded_pokemon: Vec<ExcludedPokemon>,
    pub num_auctions: u32,
    pub auction_length: u32,
    /// 'auction' (default) or '1v1'. Determines the lobby format.
    #[serde(default = "default_draft_type")]
    pub draft_type: String,
}

fn default_draft_type() -> String {
    "auction".to_string()
}

pub const DRAFT_TYPE_1V1: &str = "1v1";

fn clone_arc_pokemon(p: &Arc<Pokemon>) -> Pokemon {
    (**p).clone()
}

#[derive(Clone, Debug, Serialize)]
struct Team {
    pub user_id: String,
    pub username: String,
    pub global_name: Option<String>,
    pub ready: bool,
    budget_remaining: u32,
    pub auctions_won: Vec<Arc<Pokemon>>,
    /// Last save persisted for this team (from the teams table). Filled in for
    /// `GET /drafts/{id}` so a freshly loaded page sees every player's latest
    /// save even after that player stops broadcasting live `SaveUpdate`s.
    pub save_data: Option<serde_json::Value>,
    #[serde(skip)]
    auto_bid: Option<u32>,
    /// 1v1 drafts: number of pokemon picked (mirrors DB column).
    #[serde(skip)]
    pokemon_drafted: u32,
}

impl DraftResponse {
    /// Replaces each team's `save_data` with the value persisted in the DB, if
    /// any. The in-memory actor never holds saves, so this is only used when
    /// serving a fresh HTTP response rather than a live broadcast.
    pub fn attach_saves(&mut self, saves: HashMap<String, Option<serde_json::Value>>) {
        for team in &mut self.teams {
            team.save_data = saves.get(&team.user_id).cloned().flatten();
        }
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct AutoBidResponse {
    pub enabled: bool,
    pub value: Option<u32>,
}

impl Draft {
    fn new(
        draft_id: Uuid,
        draft_name: String,
        host: User,
        pokemon: Vec<Arc<Pokemon>>,
        actor_sender: mpsc::Sender<DraftCommand>,
        broadcast_tx: broadcast::Sender<ServerMessage>,
        created_at: chrono::DateTime<Utc>,
    ) -> Draft {
        Draft {
            draft_id,
            draft_name,
            host,
            pokemon,
            broadcast_tx,
            actor_sender,
            presence: Arc::new(DashMap::new()),
            created_at,
        }
    }

    pub async fn build(
        host: User,
        mut settings: DraftSettings,
        pool: PgPool,
    ) -> Result<Arc<Draft>, AppError> {
        // Normalize settings for 1v1 drafts.
        if settings.draft_type == DRAFT_TYPE_1V1 {
            settings.num_teams = 2;
            settings.num_auctions = 0;
            settings.starting_money = 0;
            settings.ranked = false;
            settings.excluded_pokemon.clear();
        }

        let draft_id = uuid::Uuid::now_v7();
        let draft_name = if settings.draft_name.trim().is_empty() {
            let Some(name) = petname(2, "-") else {
                return Err((
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("failed to generate random draft name"),
                ));
            };
            name
        } else {
            settings.draft_name.trim().to_string()
        };
        let Some(mut pokemon) = pokemon::get_pokemon_data(&settings.excluded_pokemon) else {
            return Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("error getting pokemon data"),
            ));
        };
        // always randomize order
        pokemon.shuffle(&mut rand::rng());
        let db_writer = DbWriter::new(pool.clone(), draft_id, settings.starting_money);

        println!("pokemon len:, {}", pokemon.len());
        let auction_ids = db_writer
            .create_draft(host.clone(), settings.clone(), pokemon.clone())
            .await?;
        if !settings.ranked {
            db_writer.join_draft(host.clone()).await?;
        }
        let mut auctions = Vec::new();
        println!("auction_ids len, {}", auction_ids.len());

        for (id, p) in auction_ids.into_iter() {
            let auction = Auction::new(draft_id, id, p);
            auctions.push(auction);
        }
        let (actor_sender, actor_receiver) = mpsc::channel(1_000);
        let (broadcast_tx, _) = broadcast::channel(10_000);
        let created_at = Utc::now();
        let draft = Arc::new(Draft::new(
            draft_id,
            draft_name,
            host.clone(),
            pokemon,
            actor_sender,
            broadcast_tx.clone(),
            created_at,
        ));
        let actor_draft = draft.clone();

        tokio::spawn(async move {
            let actor = DraftActor::new(
                actor_draft,
                host,
                settings,
                auctions,
                db_writer,
                actor_receiver,
                broadcast_tx,
            );
            actor.run().await;
        });

        return Ok(draft);
    }

    pub fn get_pokemon(&self) -> Vec<Arc<Pokemon>> {
        self.pokemon.clone()
    }

    pub async fn get_current_auction(&self) -> Result<Option<AuctionResponse>, AppError> {
        let (response_sender, response_receiver) = oneshot::channel();
        let cmd = DraftCommand::GetCurrentAuction(response_sender);
        let _ = self.actor_sender.send(cmd).await.map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to send resolve auction cmd, {}", e),
            )
        })?;

        response_receiver.await.map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to listen to resolve auction response, {}", e),
            )
        })?
    }

    pub async fn resolve_auction(
        &self,
        completed_auction: AuctionResponse,
    ) -> Result<(), AppError> {
        let (response_sender, response_receiver) = oneshot::channel();
        let cmd = DraftCommand::ResolveAuction {
            response_sender,
            completed_auction,
        };
        let _ = self.actor_sender.send(cmd).await.map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to send resolve auction cmd, {}", e),
            )
        })?;

        response_receiver.await.map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to listen to resolve auction response, {}", e),
            )
        })?
    }

    pub async fn join_draft(&self, user: User, password: Option<String>) -> Result<(), AppError> {
        let (response_sender, response_receiver) = oneshot::channel();
        let cmd = DraftCommand::Join {
            response_sender,
            user,
            password,
        };
        let _ = self.actor_sender.send(cmd).await.map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to send join draft cmd, {}", e),
            )
        })?;

        response_receiver.await.map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to listen to join draft response, {}", e),
            )
        })?
    }

    pub async fn kick(&self, user: User) -> Result<(), AppError> {
        let (response_sender, response_receiver) = oneshot::channel();
        let cmd = DraftCommand::Kick {
            response_sender,
            user,
        };
        let _ = self.actor_sender.send(cmd).await.map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to send join draft cmd, {}", e),
            )
        })?;

        response_receiver.await.map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to listen to join draft response, {}", e),
            )
        })?
    }

    pub async fn bid(&self, auction_id: i64, bid_value: u32, user: User) -> Result<(), AppError> {
        let (response_sender, response_receiver) = oneshot::channel();
        let cmd = DraftCommand::Bid {
            response_sender,
            auction_id,
            bid_value,
            user,
        };
        self.actor_sender.send(cmd).await.map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to send bid to actor, {}", e),
            )
        })?;

        response_receiver.await.map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to wait for actor response, {}", e),
            )
        })?
    }

    pub async fn start(&self, user_id: String) -> Result<(), AppError> {
        let (response_sender, response_receiver) = oneshot::channel();
        let cmd = DraftCommand::Start {
            response_sender,
            user_id,
        };
        self.actor_sender.send(cmd).await.map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to send to actor, {}", e),
            )
        })?;

        response_receiver.await.map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to wait for actor response, {}", e),
            )
        })?
    }

    pub async fn pause(&self, user_id: String) -> Result<(), AppError> {
        let (response_sender, response_receiver) = oneshot::channel();
        let cmd = DraftCommand::Pause {
            response_sender,
            user_id,
        };
        self.actor_sender.send(cmd).await.map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to send to actor, {}", e),
            )
        })?;

        response_receiver.await.map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to wait for actor response, {}", e),
            )
        })?
    }

    pub async fn resume(&self, user_id: String) -> Result<(), AppError> {
        let (response_sender, response_receiver) = oneshot::channel();
        let cmd = DraftCommand::Resume {
            response_sender,
            user_id,
        };
        self.actor_sender.send(cmd).await.map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to send resume cmd to actor, {}", e),
            )
        })?;

        response_receiver.await.map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to wait for actor response, {}", e),
            )
        })?
    }

    pub async fn get(&self) -> Result<DraftResponse, AppError> {
        let (response_sender, response_receiver) = oneshot::channel();
        let cmd = DraftCommand::Get(response_sender);
        self.actor_sender.send(cmd).await.map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to send get cmd to actor, {}", e),
            )
        })?;

        response_receiver.await.map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to wait for actor response, {}", e),
            )
        })?
    }

    pub async fn get_lobby(&self) -> Result<DraftLobbyResponse, AppError> {
        let (response_sender, response_receiver) = oneshot::channel();
        let cmd = DraftCommand::GetLobby(response_sender);
        self.actor_sender.send(cmd).await.map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to send get lobby cmd to actor, {}", e),
            )
        })?;

        response_receiver.await.map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to wait for actor response, {}", e),
            )
        })?
    }

    pub async fn ready_up(&self, user_id: String) -> Result<(), AppError> {
        let (response_sender, response_receiver) = oneshot::channel();
        let cmd = DraftCommand::ReadyUp {
            response_sender,
            user_id,
        };
        self.actor_sender.send(cmd).await.map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to send ready up cmd to actor, {}", e),
            )
        })?;

        response_receiver.await.map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to wait for actor response, {}", e),
            )
        })?
    }

    pub async fn get_auto_bid(&self, user_id: String) -> Result<AutoBidResponse, AppError> {
        let (response_sender, response_receiver) = oneshot::channel();
        let cmd = DraftCommand::GetAutoBid {
            response_sender,
            user_id,
        };
        self.actor_sender.send(cmd).await.map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to send get auto bid cmd to actor, {}", e),
            )
        })?;

        response_receiver.await.map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to wait for actor response, {}", e),
            )
        })?
    }

    pub async fn set_auto_bid(
        &self,
        user_id: String,
        value: u32,
        enabled: bool,
    ) -> Result<AutoBidResponse, AppError> {
        let (response_sender, response_receiver) = oneshot::channel();
        let cmd = DraftCommand::SetAutoBid {
            response_sender,
            user_id,
            value,
            enabled,
        };
        self.actor_sender.send(cmd).await.map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to send set auto bid cmd to actor, {}", e),
            )
        })?;

        response_receiver.await.map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to wait for actor response, {}", e),
            )
        })?
    }

    pub async fn claim_eeveelution(
        &self,
        user: User,
        pokedex_id: i32,
        form: Option<String>,
        target_user_id: Option<String>,
    ) -> Result<serde_json::Value, AppError> {
        let (response_sender, response_receiver) = oneshot::channel();
        let cmd = DraftCommand::ClaimEeveelution {
            response_sender,
            user,
            pokedex_id,
            form,
            target_user_id,
        };
        self.actor_sender.send(cmd).await.map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to send claim eeveelution to actor, {}", e),
            )
        })?;

        response_receiver.await.map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to wait for actor response, {}", e),
            )
        })?
    }

    pub async fn unclaim_eeveelution(
        &self,
        user: User,
        pokedex_id: i32,
        form: Option<String>,
        target_user_id: Option<String>,
    ) -> Result<serde_json::Value, AppError> {
        let (response_sender, response_receiver) = oneshot::channel();
        let cmd = DraftCommand::UnclaimEeveelution {
            response_sender,
            user,
            pokedex_id,
            form,
            target_user_id,
        };
        self.actor_sender.send(cmd).await.map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to send unclaim eeveelution to actor, {}", e),
            )
        })?;

        response_receiver.await.map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to wait for actor response, {}", e),
            )
        })?
    }

    pub async fn update_pending_settings(
        &self,
        user_id: String,
        num_teams: u32,
        num_auctions: u32,
        remove_team_ids: Vec<String>,
    ) -> Result<DraftResponse, AppError> {
        let (response_sender, response_receiver) = oneshot::channel();
        let cmd = DraftCommand::UpdatePendingSettings {
            response_sender,
            user_id,
            num_teams,
            num_auctions,
            remove_team_ids,
        };
        self.actor_sender.send(cmd).await.map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to send update pending settings cmd to actor, {}", e),
            )
        })?;

        response_receiver.await.map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to wait for response, {}", e),
            )
        })?
    }

    pub async fn update_user_name(&self, user_id: String, new_name: String) {
        let cmd = DraftCommand::UpdateUserName { user_id, new_name };
        let _ = self.actor_sender.send(cmd).await;
    }

    pub async fn one_v_one_pick(
        &self,
        user: User,
        pokedex_id: u32,
        form: Option<String>,
    ) -> Result<(), AppError> {
        let (response_sender, response_receiver) = oneshot::channel();
        let cmd = DraftCommand::OneVOnePick {
            response_sender,
            user,
            pokedex_id,
            form,
        };
        self.actor_sender.send(cmd).await.map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to send 1v1 pick cmd to actor, {}", e),
            )
        })?;
        response_receiver.await.map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to wait for actor response, {}", e),
            )
        })?
    }

    pub async fn one_v_one_ban(
        &self,
        user: User,
        pokedex_id: u32,
        form: Option<String>,
    ) -> Result<(), AppError> {
        let (response_sender, response_receiver) = oneshot::channel();
        let cmd = DraftCommand::OneVOneBan {
            response_sender,
            user,
            pokedex_id,
            form,
        };
        self.actor_sender.send(cmd).await.map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to send 1v1 ban cmd to actor, {}", e),
            )
        })?;
        response_receiver.await.map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to wait for actor response, {}", e),
            )
        })?
    }

    pub async fn one_v_one_toggle_timer(&self, user_id: String) -> Result<(), AppError> {
        let (response_sender, response_receiver) = oneshot::channel();
        let cmd = DraftCommand::OneVOneToggleTimer {
            response_sender,
            user_id,
        };
        self.actor_sender.send(cmd).await.map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to send 1v1 toggle-timer cmd to actor, {}", e),
            )
        })?;
        response_receiver.await.map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to wait for actor response, {}", e),
            )
        })?
    }

    pub async fn shutdown(&self) {
        let _ = self.actor_sender.send(DraftCommand::Shutdown).await;
    }
}

struct DraftActor {
    draft: Arc<Draft>,
    host: String,
    draft_state: DraftState,
    settings: DraftSettings,
    current_auction: usize,
    auctions: Vec<Auction>,
    completed_auctions: Vec<AuctionResponse>,
    db_writer: DbWriter,
    teams: HashMap<String, Team>,
    team_users: HashMap<String, User>,
    spectators: Vec<User>,
    receiver: mpsc::Receiver<DraftCommand>,
    broadcast_tx: broadcast::Sender<ServerMessage>,
    /// 1v1 drafts only: the pick/ban engine state.
    one_v_one: Option<OneVOneEngine>,
}

/// Internal (non-serialized) 1v1 engine state for the actor.
struct OneVOneEngine {
    pool: Vec<OneVOnePoolSlot>,
    player1: String,
    player2: String,
    /// Index into the pick/ban action sequence.
    action_index: usize,
    sequence: Vec<(OneVOnePlayer, OneVOneAction)>,
    p1_picks: u32,
    p2_picks: u32,
    history: Vec<OneVOneHistoryEntry>,
    eeveelutions: Vec<OneVOnePoolSlot>,
    banned_eeveelutions: Vec<u32>,
    eeveelution_phase: bool,
    /// Number of eeveelution bans made so far (P1 first, then P2).
    eeveelution_bans: u32,
    /// Monotonic draft_order handed out for every persisted `auctions` row
    /// (picks, bans, leftovers, and eeveelution bans).
    next_order: u32,
    /// When the current 30s turn expires.
    turn_expires_at: Option<Instant>,
    paused_time_remaining: Option<u32>,
    /// Whether the countdown timer is enabled.
    timer_enabled: bool,
    /// Monotonic counter guarding against stale turn-timeout tasks.
    turn_generation: u64,
}

enum DraftCommand {
    Start {
        response_sender: oneshot::Sender<Result<(), AppError>>,
        user_id: String,
    },
    Resume {
        response_sender: oneshot::Sender<Result<(), AppError>>,
        user_id: String,
    },
    Pause {
        response_sender: oneshot::Sender<Result<(), AppError>>,
        user_id: String,
    },
    Get(oneshot::Sender<Result<DraftResponse, AppError>>),
    Join {
        response_sender: oneshot::Sender<Result<(), AppError>>,
        user: User,
        password: Option<String>,
    },
    Kick {
        response_sender: oneshot::Sender<Result<(), AppError>>,
        user: User,
    },
    Bid {
        response_sender: oneshot::Sender<Result<(), AppError>>,
        auction_id: i64,
        bid_value: u32,
        user: User,
    },
    ResolveAuction {
        response_sender: oneshot::Sender<Result<(), AppError>>,
        completed_auction: AuctionResponse,
    },
    GetLobby(oneshot::Sender<Result<DraftLobbyResponse, AppError>>),
    ReadyUp {
        response_sender: oneshot::Sender<Result<(), AppError>>,
        user_id: String,
    },
    GetCurrentAuction(oneshot::Sender<Result<Option<AuctionResponse>, AppError>>),
    GetAutoBid {
        response_sender: oneshot::Sender<Result<AutoBidResponse, AppError>>,
        user_id: String,
    },
    SetAutoBid {
        response_sender: oneshot::Sender<Result<AutoBidResponse, AppError>>,
        user_id: String,
        value: u32,
        enabled: bool,
    },
    ClaimEeveelution {
        response_sender: oneshot::Sender<Result<serde_json::Value, AppError>>,
        user: User,
        pokedex_id: i32,
        form: Option<String>,
        target_user_id: Option<String>,
    },
    UnclaimEeveelution {
        response_sender: oneshot::Sender<Result<serde_json::Value, AppError>>,
        user: User,
        pokedex_id: i32,
        form: Option<String>,
        target_user_id: Option<String>,
    },
    UpdatePendingSettings {
        response_sender: oneshot::Sender<Result<DraftResponse, AppError>>,
        user_id: String,
        num_teams: u32,
        num_auctions: u32,
        remove_team_ids: Vec<String>,
    },
    UpdateUserName {
        user_id: String,
        new_name: String,
    },
    /// 1v1 drafts: a player picks a pokemon from the shared pool.
    OneVOnePick {
        response_sender: oneshot::Sender<Result<(), AppError>>,
        user: User,
        pokedex_id: u32,
        form: Option<String>,
    },
    /// 1v1 drafts: a player bans a pokemon from the shared pool.
    OneVOneBan {
        response_sender: oneshot::Sender<Result<(), AppError>>,
        user: User,
        pokedex_id: u32,
        form: Option<String>,
    },
    /// 1v1 drafts: the current turn's 30s timer fired (auto pick/ban).
    OneVOneTurnTimeout { generation: u64 },
    /// 1v1 drafts: enable/disable the pick/ban countdown timer.
    OneVOneToggleTimer {
        response_sender: oneshot::Sender<Result<(), AppError>>,
        user_id: String,
    },
    Shutdown,
}

impl DraftActor {
    pub fn new(
        draft: Arc<Draft>,
        host: User,
        settings: DraftSettings,
        auctions: Vec<Auction>,
        db_writer: DbWriter,
        receiver: mpsc::Receiver<DraftCommand>,
        broadcast_tx: broadcast::Sender<ServerMessage>,
    ) -> Self {
        let host_id = host.get_user_id_string();
        let mut teams = HashMap::new();
        let mut team_users = HashMap::new();
        if !settings.ranked {
            teams.insert(
                host_id.clone(),
                Team {
                    user_id: host_id.clone(),
                    username: host.get_user_name_string(),
                    global_name: host.get_global_name(),
                    ready: true,
                    budget_remaining: settings.starting_money,
                    auctions_won: vec![],
                    save_data: None,
                    auto_bid: None,
                    pokemon_drafted: 0,
                },
            );
            team_users.insert(host_id.clone(), host);
        }
        Self {
            draft,
            host: host_id,
            draft_state: DraftState::PENDING,
            settings,
            current_auction: 0,
            teams,
            team_users,
            auctions,
            db_writer,
            completed_auctions: vec![],
            receiver,
            broadcast_tx,
            spectators: vec![],
            one_v_one: None,
        }
    }

    fn broadcast(&self) {
        let data = DraftResponse::from(self);
        let _ = self.broadcast_tx.send(ServerMessage::DraftUpdate(data));
    }

    pub async fn run(mut self) {
        loop {
            if let Some(cmd) = self.receiver.recv().await {
                match cmd {
                    DraftCommand::Bid {
                        response_sender,
                        auction_id,
                        bid_value,
                        user,
                    } => {
                        let res = self.bid(auction_id, bid_value, user).await;
                        let _ = response_sender.send(res);
                    }
                    DraftCommand::Start {
                        response_sender,
                        user_id,
                    } => {
                        let res = self.start(user_id).await;
                        let ok = res.is_ok();
                        let _ = response_sender.send(res);
                        if ok {
                            self.broadcast();
                        };
                    }
                    DraftCommand::Pause {
                        response_sender,
                        user_id,
                    } => {
                        let res = self.pause(user_id).await;
                        let ok = res.is_ok();
                        let _ = response_sender.send(res);
                        if ok {
                            self.broadcast();
                        };
                    }
                    DraftCommand::Resume {
                        response_sender,
                        user_id,
                    } => {
                        let res = self.resume(user_id).await;
                        let ok = res.is_ok();
                        let _ = response_sender.send(res);
                        if ok {
                            self.broadcast();
                        };
                    }
                    DraftCommand::Join {
                        response_sender,
                        user,
                        password,
                    } => {
                        let res = self.join(user, password).await;
                        let ok = res.is_ok();
                        let _ = response_sender.send(res);
                        if ok {
                            self.broadcast();
                        };
                    }
                    DraftCommand::Kick {
                        response_sender,
                        user,
                    } => {
                        let res = self.kick(user).await;
                        let ok = res.is_ok();
                        let _ = response_sender.send(res);
                        if ok {
                            self.broadcast();
                        };
                    }
                    DraftCommand::Get(response_sender) => {
                        let _ = response_sender.send(Ok(DraftResponse::from(&self)));
                    }
                    DraftCommand::GetLobby(response_sender) => {
                        let _ = response_sender.send(Ok(DraftLobbyResponse::from(&self)));
                    }
                    DraftCommand::ResolveAuction {
                        response_sender,
                        completed_auction,
                    } => {
                        let res = self.resolve_auction(completed_auction).await;
                        let ok = res.is_ok();
                        let _ = response_sender.send(res);
                        if ok {
                            self.broadcast();
                        };
                    }
                    DraftCommand::ReadyUp {
                        response_sender,
                        user_id,
                    } => {
                        let res = self.ready_up(user_id).await;
                        let ok = res.is_ok();
                        let _ = response_sender.send(res);
                        if ok {
                            self.broadcast();
                        };
                    }
                    DraftCommand::GetCurrentAuction(response_sender) => {
                        let res = self.get_current_auction().await;
                        let _ = response_sender.send(res);
                    }
                    DraftCommand::GetAutoBid {
                        response_sender,
                        user_id,
                    } => {
                        let res = self.get_auto_bid(user_id);
                        let _ = response_sender.send(res);
                    }
                    DraftCommand::SetAutoBid {
                        response_sender,
                        user_id,
                        value,
                        enabled,
                    } => {
                        let res = self.set_auto_bid(user_id, value, enabled);
                        let ok = res.is_ok();
                        let _ = response_sender.send(res);
                        if ok {
                            self.broadcast();
                        };
                    }
                    DraftCommand::ClaimEeveelution {
                        response_sender,
                        user,
                        pokedex_id,
                        form,
                        target_user_id,
                    } => {
                        let res = self.claim_eeveelution(user, pokedex_id, form, target_user_id).await;
                        let _ = response_sender.send(res);
                    }
                    DraftCommand::UnclaimEeveelution {
                        response_sender,
                        user,
                        pokedex_id,
                        form,
                        target_user_id,
                    } => {
                        let res = self.unclaim_eeveelution(user, pokedex_id, form, target_user_id).await;
                        let _ = response_sender.send(res);
                    }
                    DraftCommand::UpdatePendingSettings {
                        response_sender,
                        user_id,
                        num_teams,
                        num_auctions,
                        remove_team_ids,
                    } => {
                        let res = self
                            .update_pending_settings(
                                user_id,
                                num_teams,
                                num_auctions,
                                remove_team_ids,
                            )
                            .await;
                        let _ = response_sender.send(res);
                    }
                    DraftCommand::UpdateUserName { user_id, new_name } => {
                        if let Some(team) = self.teams.get_mut(&user_id) {
                            team.username = new_name;
                            self.broadcast();
                        }
                    }
                    DraftCommand::OneVOnePick {
                        response_sender,
                        user,
                        pokedex_id,
                        form,
                    } => {
                        let res = self.one_v_one_pick(user, pokedex_id, form).await;
                        let ok = res.is_ok();
                        let _ = response_sender.send(res);
                        if ok {
                            self.broadcast();
                        };
                    }
                    DraftCommand::OneVOneBan {
                        response_sender,
                        user,
                        pokedex_id,
                        form,
                    } => {
                        let res = self.one_v_one_ban(user, pokedex_id, form).await;
                        let ok = res.is_ok();
                        let _ = response_sender.send(res);
                        if ok {
                            self.broadcast();
                        };
                    }
                    DraftCommand::OneVOneTurnTimeout { generation } => {
                        let advanced = self.one_v_one_turn_timeout(generation).await;
                        if advanced {
                            self.broadcast();
                        }
                    }
                    DraftCommand::OneVOneToggleTimer {
                        response_sender,
                        user_id,
                    } => {
                        let res = self.one_v_one_toggle_timer(user_id).await;
                        let ok = res.is_ok();
                        let _ = response_sender.send(res);
                        if ok {
                            self.broadcast();
                        };
                    }
                    DraftCommand::Shutdown => break,
                }
            }
        }
    }

    async fn get_current_auction(&self) -> Result<Option<AuctionResponse>, AppError> {
        if self.draft_state == DraftState::PENDING
            || self.draft_state == DraftState::COMPLETED
            || self.settings.draft_type == DRAFT_TYPE_1V1
        {
            return Ok(None);
        }
        let auction = &self.auctions[self.current_auction];
        auction.get().await.map(|ok| Some(ok))
    }

    async fn bid(&self, auction_id: i64, bid_value: u32, user: User) -> Result<(), AppError> {
        if self.settings.draft_type == DRAFT_TYPE_1V1 {
            return Err((
                StatusCode::PRECONDITION_FAILED,
                format!("1v1 drafts do not use bidding"),
            ));
        }
        if self.draft_state != DraftState::BIDDING {
            return Err((
                StatusCode::PRECONDITION_FAILED,
                format!("draft is not accepting bids"),
            ));
        }
        let auction = &self.auctions[self.current_auction];
        if auction.auction_id != auction_id {
            return Err((
                StatusCode::PRECONDITION_FAILED,
                format!("auction is not active"),
            ));
        }
        if bid_value % 100 != 0 {
            return Err((
                StatusCode::PRECONDITION_FAILED,
                format!("bid must be multiple of 100"),
            ));
        }
        let Some(team) = self.teams.get(&user.get_user_id_string()) else {
            return Err((
                StatusCode::PRECONDITION_FAILED,
                format!("user is not assigned to a team"),
            ));
        };

        if team.budget_remaining < bid_value {
            return Err((
                StatusCode::PRECONDITION_FAILED,
                format!("team does not have enough money remaining"),
            ));
        }

        auction.bid(bid_value, user.clone()).await?;
        self.db_writer.write_bid(auction_id, bid_value, user).await;

        Ok(())
    }

    async fn start(&mut self, user_id: String) -> Result<(), AppError> {
        if user_id != self.host {
            return Err((
                StatusCode::PRECONDITION_FAILED,
                format!("user is not the host"),
            ));
        }
        if self.draft_state != DraftState::PENDING {
            return Err((
                StatusCode::PRECONDITION_FAILED,
                format!("draft is not pending"),
            ));
        }
        if self.teams.len() < self.settings.num_teams as usize {
            return Err((
                StatusCode::PRECONDITION_FAILED,
                format!(
                    "only {} of {} teams have joined the draft",
                    self.teams.len(),
                    self.settings.num_teams
                ),
            ));
        }
        if self.teams.values().any(|t| !t.ready) {
            return Err((
                StatusCode::PRECONDITION_FAILED,
                format!("not all teams are ready"),
            ));
        }

        if self.settings.draft_type == DRAFT_TYPE_1V1 {
            return self.start_one_v_one().await;
        }

        self.db_writer.start_draft().await?;

        let auction = &self.auctions[self.current_auction];
        auction
            .start(self.draft.clone(), self.settings.auction_length)
            .await?;

        self.draft_state = DraftState::BIDDING;

        self.place_auto_bids().await;

        Ok(())
    }

    /// Initializes the 1v1 pick/ban engine and starts the first turn.
    async fn start_one_v_one(&mut self) -> Result<(), AppError> {
        // Exactly two teams required.
        if self.teams.len() != 2 {
            return Err((
                StatusCode::PRECONDITION_FAILED,
                format!("1v1 drafts require exactly 2 players"),
            ));
        }

        // Randomly assign first pick (P1 / blue) and second pick (P2 / red).
        let mut player_ids: Vec<String> = self.teams.keys().cloned().collect();
        player_ids.shuffle(&mut rand::rng());
        let player1 = player_ids[0].clone();
        let player2 = player_ids[1].clone();

        // Choose 32 base, non-rental pokemon at random from the draft pool.
        let mut candidates: Vec<Arc<Pokemon>> = self
            .draft
            .pokemon
            .iter()
            .filter(|p| p.stage == pokemon::PokemonStage::base && p.obtain_method.is_none())
            .cloned()
            .collect();
        candidates.shuffle(&mut rand::rng());
        if candidates.len() < 32 {
            return Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("not enough pokemon to build a 1v1 pool"),
            ));
        }
        let chosen: Vec<Arc<Pokemon>> = candidates.into_iter().take(32).collect();

        // Attach avg prices (from auction stats) for ordering + auto-pick.
        let avg_prices = self.load_avg_prices().await;
        let mut pool: Vec<OneVOnePoolSlot> = chosen
            .into_iter()
            .map(|p| {
                let avg_price = avg_prices
                    .get(&(p.pokedex_id, p.form.clone()))
                    .copied()
                    .unwrap_or(0);
                OneVOnePoolSlot {
                    pokemon: clone_arc_pokemon(&p),
                    status: OneVOneSlotStatus::Available,
                    avg_price,
                }
            })
            .collect();
        // Sort most expensive -> least expensive (top-left to bottom-right).
        pool.sort_by(|a, b| b.avg_price.cmp(&a.avg_price));

        let eeveelutions = self.one_v_one_eeveelutions(&avg_prices);

        self.one_v_one = Some(OneVOneEngine {
            pool,
            player1,
            player2,
            action_index: 0,
            sequence: one_v_one_action_sequence(),
            p1_picks: 0,
            p2_picks: 0,
            history: vec![],
            eeveelutions,
            banned_eeveelutions: vec![],
            eeveelution_phase: false,
            eeveelution_bans: 0,
            next_order: 1,
            turn_expires_at: None,
            paused_time_remaining: None,
            timer_enabled: false,
            turn_generation: 0,
        });

        self.db_writer.start_draft().await?;
        self.draft_state = DraftState::BIDDING;

        // Start the first turn's 30s timer.
        self.one_v_one_begin_turn();

        Ok(())
    }

    /// Builds the 8 eeveelution slots used for the post-pick ban phase.
    fn one_v_one_eeveelutions(
        &self,
        avg_prices: &HashMap<(u32, Option<String>), u32>,
    ) -> Vec<OneVOnePoolSlot> {
        const EEVEELUTION_IDS: [u32; 8] = [134, 135, 136, 196, 197, 470, 471, 700];
        EEVEELUTION_IDS
            .iter()
            .filter_map(|id| {
                self.draft
                    .pokemon
                    .iter()
                    .find(|p| p.pokedex_id == *id && p.form.is_none())
                    .map(|p| {
                        let avg_price = avg_prices
                            .get(&(p.pokedex_id, p.form.clone()))
                            .copied()
                            .unwrap_or(0);
                        OneVOnePoolSlot {
                            pokemon: clone_arc_pokemon(p),
                            status: OneVOneSlotStatus::Available,
                            avg_price,
                        }
                    })
            })
            .collect()
    }

    /// Loads average winning bid per pokemon from historical auction stats,
    /// matching the stats page "AVG PRICE" computation exactly: only
    /// "competitive" drafts pass a validity check (>= 40 sales, <= 3 min-bids,
    /// exactly 8 * teammates sold, no single sale > $12,000), a hardcoded list
    /// of pokemon is excluded, $100 minimum-bids are dropped, IQR outlier
    /// trimming is applied, and legacy (pre-website) sale data is included.
    async fn load_avg_prices(&self) -> HashMap<(u32, Option<String>), u32> {
        const EXCLUDED: [&str; 9] = [
            "Bombirdier", "Larvesta", "Hawlucha", "Falinks", "Absol", "Miltank",
            "Stonjourner", "Klawf", "Turtonator",
        ];
        let is_excluded = |name: &str| EXCLUDED.contains(&name);

        // --- 1. Team count per non-1v1 draft ---------------------------------
        let mut team_counts: HashMap<Uuid, i32> = HashMap::new();
        if let Ok(rows) = sqlx::query(
            "SELECT d.draft_id, COUNT(*)::INT AS team_count
             FROM teams t
             JOIN drafts d ON d.draft_id = t.draft_id
             WHERE d.draft_type != '1v1'
             GROUP BY d.draft_id",
        )
        .fetch_all(self.db_writer.pool())
        .await
        {
            for row in rows {
                if let (Ok(id), Ok(count)) =
                    (row.try_get::<Uuid, _>("draft_id"), row.try_get::<i32, _>("team_count"))
                {
                    team_counts.insert(id, count);
                }
            }
        }

        // --- 2. Auction aggregate stats per non-1v1 draft ---------------------
        let mut valid_drafts: HashSet<Uuid> = HashSet::new();
        if let Ok(rows) = sqlx::query(
            "SELECT a.draft_id,
                    COUNT(*)::INT AS total,
                    COUNT(*) FILTER (WHERE a.winning_bid = 100)::INT AS min_bid_count,
                    MAX(a.winning_bid)::INT AS max_bid
             FROM auctions a
             JOIN drafts d ON d.draft_id = a.draft_id
             WHERE a.winning_bid IS NOT NULL
               AND d.draft_type != '1v1'
             GROUP BY a.draft_id",
        )
        .fetch_all(self.db_writer.pool())
        .await
        {
            for row in rows {
                let (Ok(id), Ok(total), Ok(min_bid_count), Ok(max_bid)) = (
                    row.try_get::<Uuid, _>("draft_id"),
                    row.try_get::<i32, _>("total"),
                    row.try_get::<i32, _>("min_bid_count"),
                    row.try_get::<i32, _>("max_bid"),
                ) else {
                    continue;
                };
                let team_count = team_counts.get(&id).copied().unwrap_or(0);
                if total >= 40 && min_bid_count <= 3 && total == 8 * team_count && max_bid <= 12000
                {
                    valid_drafts.insert(id);
                }
            }
        }

        // --- 3. Pokemon base name -> pokedex_id lookup (for legacy rows) ------
        let mut base_id_by_name: HashMap<String, i32> = HashMap::new();
        if let Ok(rows) = sqlx::query("SELECT pokedex_id, name FROM pokemon WHERE form = ''")
            .fetch_all(self.db_writer.pool())
            .await
        {
            for row in rows {
                if let (Ok(id), Ok(name)) =
                    (row.try_get::<i32, _>("pokedex_id"), row.try_get::<String, _>("name"))
                {
                    base_id_by_name.entry(name).or_insert(id);
                }
            }
        }

        // --- 4. Collect bids per (pokedex_id, form) ---------------------------
        let mut bids_by_key: HashMap<(u32, Option<String>), Vec<i32>> = HashMap::new();

        // Modern competitive auctions.
        if let Ok(rows) = sqlx::query(
            "SELECT a.draft_id, a.pokedex_id, a.form, p.name, a.winning_bid
             FROM auctions a
             JOIN drafts d ON d.draft_id = a.draft_id
             JOIN pokemon p ON p.pokedex_id = a.pokedex_id AND p.form = a.form
             WHERE d.draft_type != '1v1'
               AND a.winning_bid IS NOT NULL",
        )
        .fetch_all(self.db_writer.pool())
        .await
        {
            for row in rows {
                let (Ok(draft_id), Ok(pokedex_id), Ok(name), Ok(bid)) = (
                    row.try_get::<Uuid, _>("draft_id"),
                    row.try_get::<i32, _>("pokedex_id"),
                    row.try_get::<String, _>("name"),
                    row.try_get::<i32, _>("winning_bid"),
                ) else {
                    continue;
                };
                if !valid_drafts.contains(&draft_id) || is_excluded(&name) {
                    continue;
                }
                let form: String = row.try_get("form").unwrap_or_default();
                let form_opt = if form.trim().is_empty() { None } else { Some(form) };
                bids_by_key
                    .entry((pokedex_id as u32, form_opt))
                    .or_default()
                    .push(bid);
            }
        }

        // Legacy (pre-website) sale data, merged by base pokemon identity.
        if let Ok(rows) = sqlx::query("SELECT pokemon, cost FROM legacy_pokemon_costs")
            .fetch_all(self.db_writer.pool())
            .await
        {
            let mut legacy_by_name: HashMap<String, Vec<i32>> = HashMap::new();
            for row in rows {
                let (Ok(name), Ok(cost)) = (
                    row.try_get::<String, _>("pokemon"),
                    row.try_get::<String, _>("cost"),
                ) else {
                    continue;
                };
                let trimmed = cost.trim().replace(',', "");
                if !trimmed.chars().all(|c| c.is_ascii_digit()) {
                    continue;
                }
                let Ok(bid) = trimmed.parse::<i32>() else {
                    continue;
                };
                if is_excluded(&name) {
                    continue;
                }
                legacy_by_name.entry(name).or_default().push(bid);
            }
            for (name, bids) in legacy_by_name {
                if let Some(&id) = base_id_by_name.get(&name) {
                    bids_by_key
                        .entry((id as u32, None))
                        .or_default()
                        .extend(bids);
                }
            }
        }

        // --- 5. IQR-trimmed rounded mean, keeping only prices above $100 ------
        let mut map: HashMap<(u32, Option<String>), u32> = HashMap::new();
        for (key, mut bids) in bids_by_key {
            bids.retain(|b| *b != 100);
            if bids.is_empty() {
                continue;
            }
            if bids.len() > 1 {
                bids.sort_unstable();
                let q1 = calc_quantile(&bids, 0.25);
                let q3 = calc_quantile(&bids, 0.75);
                let iqr = q3 - q1;
                let lower = q1 - 1.5 * iqr;
                let upper = q3 + 2.0 * iqr;
                bids.retain(|b| (*b as f64) >= lower && (*b as f64) <= upper);
            }
            if bids.is_empty() {
                continue;
            }
            let sum: i64 = bids.iter().map(|b| *b as i64).sum();
            let avg = (sum as f64 / bids.len() as f64).round() as i32;
            if avg > 100 {
                map.insert(key, avg.max(0) as u32);
            }
        }
        map
    }

    // ------------------------------------------------------------------
    // 1v1 Draft Engine
    // ------------------------------------------------------------------

    fn one_v_one_begin_turn(&mut self) {
        let Some(engine) = self.one_v_one.as_mut() else {
            return;
        };
        engine.turn_generation += 1;
        let generation = engine.turn_generation;
        if !engine.timer_enabled {
            engine.paused_time_remaining = None;
            engine.turn_expires_at = None;
            return;
        }
        let remaining = engine.paused_time_remaining.take().unwrap_or(60).max(1);
        let expires_at = Instant::now() + Duration::from_secs(remaining as u64);
        engine.turn_expires_at = Some(expires_at);
        let sender = self.draft.actor_sender.clone();
        tokio::spawn(async move {
            tokio::time::sleep_until(expires_at).await;
            let _ = sender.send(DraftCommand::OneVOneTurnTimeout { generation }).await;
        });
    }

    async fn one_v_one_pick(
        &mut self,
        user: User,
        pokedex_id: u32,
        form: Option<String>,
    ) -> Result<(), AppError> {
        if self.draft_state != DraftState::BIDDING {
            return Err((StatusCode::PRECONDITION_FAILED, "draft is not running".to_string()));
        }
        let engine = self.one_v_one.as_mut().ok_or((
            StatusCode::PRECONDITION_FAILED,
            "not a 1v1 draft".to_string(),
        ))?;
        if engine.eeveelution_phase {
            return Err((
                StatusCode::PRECONDITION_FAILED,
                "main pick phase is over".to_string(),
            ));
        }
        let (Some(current_player), Some(current_action)) = engine.current_turn(&self.draft_state)
        else {
            return Err((StatusCode::PRECONDITION_FAILED, "no active turn".to_string()));
        };
        if current_action != OneVOneAction::Pick {
            return Err((StatusCode::PRECONDITION_FAILED, "it is not time to pick".to_string()));
        }
        let current_player_id = engine.player_id(current_player);
        if user.get_user_id_string() != current_player_id {
            return Err((StatusCode::PRECONDITION_FAILED, "not your turn".to_string()));
        }
        self.one_v_one_apply_pick(current_player, pokedex_id, form).await;
        Ok(())
    }

    async fn one_v_one_ban(
        &mut self,
        user: User,
        pokedex_id: u32,
        form: Option<String>,
    ) -> Result<(), AppError> {
        if self.draft_state != DraftState::BIDDING {
            return Err((StatusCode::PRECONDITION_FAILED, "draft is not running".to_string()));
        }
        let engine = self.one_v_one.as_mut().ok_or((
            StatusCode::PRECONDITION_FAILED,
            "not a 1v1 draft".to_string(),
        ))?;
        let (Some(current_player), Some(current_action)) = engine.current_turn(&self.draft_state)
        else {
            return Err((StatusCode::PRECONDITION_FAILED, "no active turn".to_string()));
        };
        if current_action != OneVOneAction::Ban {
            return Err((StatusCode::PRECONDITION_FAILED, "it is not time to ban".to_string()));
        }
        let current_player_id = engine.player_id(current_player);
        if user.get_user_id_string() != current_player_id {
            return Err((StatusCode::PRECONDITION_FAILED, "not your turn".to_string()));
        }
        let is_eevee = engine.eeveelution_phase;
        self.one_v_one_apply_ban(current_player, pokedex_id, form, is_eevee).await;
        Ok(())
    }

    async fn one_v_one_turn_timeout(&mut self, generation: u64) -> bool {
        let Some(engine) = self.one_v_one.as_mut() else {
            return false;
        };
        if engine.turn_generation != generation {
            return false;
        }
        let (Some(current_player), Some(current_action)) = engine.current_turn(&self.draft_state)
        else {
            return false;
        };
        let target = engine.highest_avg_price_available(current_action);
        if let Some(slot) = target {
            let pokedex_id = slot.pokemon.pokedex_id;
            let form = slot.pokemon.form.clone();
            match current_action {
                OneVOneAction::Pick => {
                    self.one_v_one_apply_pick(current_player, pokedex_id, form).await;
                }
                OneVOneAction::Ban => {
                    let is_eevee = engine.eeveelution_phase;
                    self.one_v_one_apply_ban(current_player, pokedex_id, form, is_eevee).await;
                }
                OneVOneAction::Leftover => {}
            }
            true
        } else {
            // Nothing left to pick/ban; advance manually.
            self.one_v_one_advance().await;
            true
        }
    }

    async fn one_v_one_apply_pick(
        &mut self,
        player: OneVOnePlayer,
        pokedex_id: u32,
        form: Option<String>,
    ) {
        // Find and mark the slot in the main pool.
        let slot = {
            let engine = self.one_v_one.as_mut().expect("1v1 engine");
            let slot = engine
                .pool
                .iter_mut()
                .find(|s| s.pokemon.pokedex_id == pokedex_id && s.pokemon.form == form)
                .expect("pokemon not in pool");
            slot.status = OneVOneSlotStatus::Picked(player);
            slot.clone()
        };

        let order = {
            let engine = self.one_v_one.as_mut().expect("1v1 engine");
            engine.take_next_order()
        };

        // Persist the pick row.
        let user_id = self
            .one_v_one
            .as_ref()
            .map(|e| e.player_id(player).to_string());
        let user = user_id.as_ref().and_then(|id| self.team_users.get(id).cloned());
        self.db_writer
            .write_one_v_one_action(pokedex_id, form.clone(), order as i32, "PICK", user.clone())
            .await;
        if let Some(user) = user {
            self.db_writer.increment_one_v_one_pick(user.clone()).await;
            if let Some(team) = self.teams.get_mut(&user.get_user_id_string()) {
                team.auctions_won.push(Arc::new(slot.pokemon.clone()));
                team.pokemon_drafted += 1;
            }
        }

        {
            let engine = self.one_v_one.as_mut().expect("1v1 engine");
            engine.history.push(OneVOneHistoryEntry {
                order,
                action: OneVOneAction::Pick,
                player,
                pokemon: slot.pokemon.clone(),
            });
            match player {
                OneVOnePlayer::P1 => engine.p1_picks += 1,
                OneVOnePlayer::P2 => engine.p2_picks += 1,
            }
        }

        self.one_v_one_advance().await;
    }

    async fn one_v_one_apply_ban(
        &mut self,
        player: OneVOnePlayer,
        pokedex_id: u32,
        form: Option<String>,
        is_eeveelution: bool,
    ) {
        let slot = if is_eeveelution {
            let engine = self.one_v_one.as_mut().expect("1v1 engine");
            let slot = engine
                .eeveelutions
                .iter_mut()
                .find(|s| s.pokemon.pokedex_id == pokedex_id && s.pokemon.form == form)
                .expect("eeveelution not found");
            slot.status = OneVOneSlotStatus::Banned(player);
            engine.banned_eeveelutions.push(pokedex_id);
            slot.clone()
        } else {
            let engine = self.one_v_one.as_mut().expect("1v1 engine");
            let slot = engine
                .pool
                .iter_mut()
                .find(|s| s.pokemon.pokedex_id == pokedex_id && s.pokemon.form == form)
                .expect("pokemon not in pool");
            slot.status = OneVOneSlotStatus::Banned(player);
            slot.clone()
        };

        let order = {
            let engine = self.one_v_one.as_mut().expect("1v1 engine");
            engine.take_next_order()
        };

        let user = if is_eeveelution {
            None
        } else {
            let user_id = self
                .one_v_one
                .as_ref()
                .map(|e| e.player_id(player).to_string());
            user_id.as_ref().and_then(|id| self.team_users.get(id).cloned())
        };
        let action_str = if is_eeveelution { "BAN" } else { "BAN" };
        self.db_writer
            .write_one_v_one_action(pokedex_id, form, order as i32, action_str, user)
            .await;

        if !is_eeveelution {
            let engine = self.one_v_one.as_mut().expect("1v1 engine");
            engine.history.push(OneVOneHistoryEntry {
                order,
                action: OneVOneAction::Ban,
                player,
                pokemon: slot.pokemon.clone(),
            });
        }

        if is_eeveelution {
            let engine = self.one_v_one.as_mut().expect("1v1 engine");
            engine.eeveelution_bans += 1;
        }

        self.one_v_one_advance().await;
    }

    async fn one_v_one_toggle_timer(&mut self, user_id: String) -> Result<(), AppError> {
        if self.draft_state != DraftState::BIDDING {
            return Err((StatusCode::PRECONDITION_FAILED, "draft is not running".to_string()));
        }
        if !self.is_one_v_one_player(&user_id) {
            return Err((StatusCode::UNAUTHORIZED, "not a participant".to_string()));
        }
        let enabled = {
            let engine = self.one_v_one.as_mut().ok_or((
                StatusCode::PRECONDITION_FAILED,
                "not a 1v1 draft".to_string(),
            ))?;
            engine.timer_enabled = !engine.timer_enabled;
            engine.timer_enabled
        };
        if enabled {
            self.one_v_one_begin_turn();
        } else {
            let engine = self.one_v_one.as_mut().expect("1v1 engine");
            engine.turn_expires_at = None;
            engine.paused_time_remaining = None;
            engine.turn_generation += 1;
        }
        Ok(())
    }

    async fn one_v_one_advance(&mut self) {
        let engine = self.one_v_one.as_mut().expect("1v1 engine");

        if engine.eeveelution_phase {
            if engine.eeveelution_bans >= 2 {
                self.one_v_one_finish().await;
                return;
            }
            let _ = engine;
            self.one_v_one_begin_turn();
            return;
        }

        engine.action_index += 1;
        if engine.action_index >= engine.sequence.len() {
            // Main phase done: persist the four leftover pokemon.
            engine.eeveelution_phase = true;
            let leftovers: Vec<OneVOnePoolSlot> = engine
                .pool
                .iter()
                .filter(|s| s.status == OneVOneSlotStatus::Available)
                .cloned()
                .collect();
            for leftover in leftovers.iter().take(4) {
                let leftover_order = self
                    .one_v_one
                    .as_mut()
                    .expect("1v1 engine")
                    .take_next_order();
                self.db_writer
                    .write_one_v_one_action(
                        leftover.pokemon.pokedex_id,
                        leftover.pokemon.form.clone(),
                        leftover_order as i32,
                        "LEFTOVER",
                        None,
                    )
                    .await;
            }
            // Insert placeholder history entries for the leftovers so stats ordering matches.
            let engine = self.one_v_one.as_mut().expect("1v1 engine");
            for leftover in leftovers.into_iter().take(4) {
                engine.history.push(OneVOneHistoryEntry {
                    order: engine.history.len() as u32 + 1,
                    action: OneVOneAction::Leftover,
                    player: OneVOnePlayer::P1, // unused for leftovers
                    pokemon: leftover.pokemon,
                });
            }
            let _ = engine;
            self.one_v_one_begin_turn();
            return;
        }

        let _ = engine;
        self.one_v_one_begin_turn();
    }

    async fn one_v_one_finish(&mut self) {
        let Some(engine) = self.one_v_one.as_mut() else {
            return;
        };
        engine.turn_expires_at = None;
        engine.paused_time_remaining = None;
        engine.turn_generation += 1; // cancel any running timer
        let _ = engine;
        if self.db_writer.finish_draft().await.is_ok() {
            self.draft_state = DraftState::COMPLETED;
        }
    }

    async fn one_v_one_pause(&mut self) -> Result<(), AppError> {
        let Some(engine) = self.one_v_one.as_mut() else {
            return Err((StatusCode::PRECONDITION_FAILED, "not a 1v1 draft".to_string()));
        };
        let Some(expires_at) = engine.turn_expires_at else {
            return Err((StatusCode::PRECONDITION_FAILED, "turn is already paused".to_string()));
        };
        let remaining = expires_at.saturating_duration_since(Instant::now()).as_secs() as u32;
        engine.paused_time_remaining = Some(remaining.max(1));
        engine.turn_expires_at = None;
        engine.turn_generation += 1;
        Ok(())
    }

    async fn one_v_one_resume(&mut self) -> Result<(), AppError> {
        let Some(engine) = self.one_v_one.as_mut() else {
            return Err((StatusCode::PRECONDITION_FAILED, "not a 1v1 draft".to_string()));
        };
        if engine.paused_time_remaining.is_none() {
            return Err((StatusCode::PRECONDITION_FAILED, "turn is not paused".to_string()));
        }
        let _ = engine;
        self.one_v_one_begin_turn();
        Ok(())
    }

    async fn place_auto_bids(&self) {
        let auction = &self.auctions[self.current_auction];

        let mut candidates: Vec<(String, u32)> = self
            .teams
            .values()
            .filter_map(|team| {
                let value = team.auto_bid?;
                if team.budget_remaining >= value {
                    Some((team.user_id.clone(), value))
                } else {
                    None
                }
            })
            .collect();

        if candidates.is_empty() {
            return;
        }

        let max_bid = candidates.iter().map(|(_, value)| *value).max().unwrap();
        candidates.retain(|(_, value)| *value == max_bid);
        candidates.shuffle(&mut rand::rng());

        let Some((winner_id, _)) = candidates.first() else {
            return;
        };
        let Some(user) = self.team_users.get(winner_id).cloned() else {
            return;
        };

        println!(
            "auto bid {} placed for {} on auction {}",
            max_bid, winner_id, auction.auction_id
        );
        let _ = self.bid(auction.auction_id, max_bid, user).await;
    }

    async fn resume(&mut self, user_id: String) -> Result<(), AppError> {
        if self.settings.draft_type == DRAFT_TYPE_1V1 {
            if !self.is_one_v_one_player(&user_id) {
                return Err((StatusCode::UNAUTHORIZED, "not a participant".to_string()));
            }
            return self.one_v_one_resume().await;
        }
        if user_id != self.host {
            return Err((StatusCode::UNAUTHORIZED, format!("user is not the host")));
        }
        if self.draft_state != DraftState::BIDDING {
            return Err((
                StatusCode::PRECONDITION_FAILED,
                format!("draft is not in bidding state"),
            ));
        }

        let auction = &self.auctions[self.current_auction];
        self.db_writer.resume_auction(auction.auction_id).await?;
        auction.resume().await
    }

    async fn pause(&mut self, user_id: String) -> Result<(), AppError> {
        if self.settings.draft_type == DRAFT_TYPE_1V1 {
            if !self.is_one_v_one_player(&user_id) {
                return Err((StatusCode::UNAUTHORIZED, "not a participant".to_string()));
            }
            return self.one_v_one_pause().await;
        }
        if user_id != self.host {
            return Err((StatusCode::UNAUTHORIZED, format!("user is not the host")));
        }
        if self.draft_state != DraftState::BIDDING {
            return Err((
                StatusCode::PRECONDITION_FAILED,
                format!("draft is not in bidding state"),
            ));
        }

        let auction = &self.auctions[self.current_auction];
        let time_remaining = auction.pause().await?;
        self.db_writer
            .pause_auction(auction.auction_id, time_remaining)
            .await
    }

    fn is_one_v_one_player(&self, user_id: &str) -> bool {
        self.one_v_one
            .as_ref()
            .map(|e| e.player1 == user_id || e.player2 == user_id)
            .unwrap_or(false)
    }

    async fn join(&mut self, user: User, password: Option<String>) -> Result<(), AppError> {
        let user_id = user.get_user_id_string();
        if self.teams.iter().any(|(u_id, _)| *u_id == user_id) {
            return Err((
                StatusCode::PRECONDITION_FAILED,
                format!("user is already in this draft"),
            ));
        }
        if self.teams.len() >= self.settings.num_teams as usize {
            return Err((
                StatusCode::PRECONDITION_FAILED,
                format!("draft is already full"),
            ));
        }

        if user_id != self.host {
            if let Some(draft_password) = self.settings.password.as_ref() {
                let Some(password) = password
                    .as_ref()
                    .map(|p| p.trim().to_string())
                    .filter(|p| !p.is_empty())
                else {
                    return Err((StatusCode::BAD_REQUEST, format!("password required")));
                };

                if password != *draft_password {
                    return Err((StatusCode::BAD_REQUEST, format!("password is incorrect")));
                }
            }
        }

        let team = Team {
            user_id: user_id.clone(),
            username: user.get_user_name_string(),
            global_name: user.get_global_name(),
            ready: user_id == self.host,
            budget_remaining: self.settings.starting_money,
            auctions_won: vec![],
            save_data: None,
            auto_bid: None,
            pokemon_drafted: 0,
        };
        self.teams.insert(user_id.clone(), team);
        self.team_users.insert(user_id, user.clone());

        self.db_writer.join_draft(user).await
    }

    async fn kick(&mut self, user: User) -> Result<(), AppError> {
        let user_id = user.get_user_id_string();
        if !self.teams.iter().any(|(u_id, _)| *u_id == user_id) {
            return Err((
                StatusCode::PRECONDITION_FAILED,
                format!("user is not in draft"),
            ));
        }
        if user_id == self.host {
            return Err((StatusCode::BAD_REQUEST, format!("cannot kick host")));
        }
        if self.draft_state != DraftState::PENDING {
            return Err((
                StatusCode::PRECONDITION_FAILED,
                format!("cannot kick after draft starts"),
            ));
        }

        self.db_writer.kick_draft(user).await?;
        self.teams.remove(&user_id);
        self.team_users.remove(&user_id);
        Ok(())
    }

    async fn resolve_auction(
        &mut self,
        completed_auction: AuctionResponse,
    ) -> Result<(), AppError> {
        if self.draft_state != DraftState::BIDDING {
            return Err((
                StatusCode::PRECONDITION_FAILED,
                format!("draft is not in the bidding state"),
            ));
        }
        let current_auction = &self.auctions[self.current_auction];
        if current_auction.auction_id != completed_auction.auction_id {
            return Err((
                StatusCode::PRECONDITION_FAILED,
                format!(
                    "completed auction {}, different than current auction {}",
                    completed_auction.auction_id, current_auction.auction_id
                ),
            ));
        }
        self.db_writer
            .resolve_auction(completed_auction.auction_id)
            .await?;

        if let Some(winner) = &completed_auction.highest_bidder {
            if let Some(team) = self.teams.get_mut(&winner.get_user_id_string()) {
                team.auctions_won.push(current_auction.pokemon.clone());
                team.budget_remaining = team
                    .budget_remaining
                    .saturating_sub(completed_auction.highest_bid);
                team.auto_bid = None;
            }
        }
        self.current_auction += 1;
        self.completed_auctions.push(completed_auction);
        if let Some(auction) = self.auctions.get(self.current_auction) {
            let _ = auction
                .start(self.draft.clone(), self.settings.auction_length)
                .await;
            self.place_auto_bids().await;
        } else {
            if let Ok(_) = self.db_writer.finish_draft().await {
                self.draft_state = DraftState::COMPLETED;
                self.broadcast();
            }
        }

        Ok(())
    }

    async fn ready_up(&mut self, user_id: String) -> Result<(), AppError> {
        let Some(team) = self.teams.get_mut(&user_id) else {
            return Err((
                StatusCode::BAD_REQUEST,
                format!("user is not a participant in this draft"),
            ));
        };

        team.ready = true;
        Ok(())
    }

    fn get_auto_bid(&self, user_id: String) -> Result<AutoBidResponse, AppError> {
        let Some(team) = self.teams.get(&user_id) else {
            return Ok(AutoBidResponse {
                enabled: false,
                value: None,
            });
        };

        Ok(AutoBidResponse {
            enabled: team.auto_bid.is_some(),
            value: team.auto_bid,
        })
    }

    fn set_auto_bid(
        &mut self,
        user_id: String,
        value: u32,
        enabled: bool,
    ) -> Result<AutoBidResponse, AppError> {
        let Some(team) = self.teams.get_mut(&user_id) else {
            return Err((
                StatusCode::BAD_REQUEST,
                format!("user is not a participant in this draft"),
            ));
        };

        if enabled {
            if value == 0 || value % 100 != 0 {
                return Err((
                    StatusCode::BAD_REQUEST,
                    format!("auto bid must be a positive multiple of 100"),
                ));
            }
            if value > 5000 {
                return Err((
                    StatusCode::BAD_REQUEST,
                    format!("that value is too high for an auto bid!"),
                ));
            }
            if value > team.budget_remaining {
                return Err((
                    StatusCode::BAD_REQUEST,
                    format!("auto bid exceeds remaining funds"),
                ));
            }
            team.auto_bid = Some(value);
        } else {
            team.auto_bid = None;
        }

        Ok(AutoBidResponse {
            enabled: team.auto_bid.is_some(),
            value: team.auto_bid,
        })
    }

    async fn claim_eeveelution(
        &mut self,
        user: User,
        pokedex_id: i32,
        form: Option<String>,
        target_user_id: Option<String>,
    ) -> Result<serde_json::Value, AppError> {
        if self.draft_state != DraftState::COMPLETED {
            return Err((
                StatusCode::PRECONDITION_FAILED,
                "draft must be completed".to_string(),
            ));
        }

        let eeveelutions = [133, 134, 135, 136, 196, 197, 470, 471, 700];
        if !eeveelutions.contains(&pokedex_id) {
            return Err((
                StatusCode::BAD_REQUEST,
                "Only Eeveelutions can be claimed through this method".to_string(),
            ));
        }

        // 1v1 drafts: banned eeveelutions are unpickable.
        if self.settings.draft_type == DRAFT_TYPE_1V1 {
            if let Some(engine) = self.one_v_one.as_ref() {
                if engine.banned_eeveelutions.contains(&(pokedex_id as u32)) {
                    return Ok(serde_json::json!({
                        "success": false,
                        "error": "This Eeveelution was banned in the 1v1 draft"
                    }));
                }
            }
        }

        let is_ref = user.has_role_name("Developer") || user.has_role_name("Developer");
        let actual_user_id = if let Some(tid) = target_user_id {
            if is_ref { tid } else { user.get_user_id_string() }
        } else {
            user.get_user_id_string()
        };

        if let Some(team) = self.teams.get(&actual_user_id) {
            if team
                .auctions_won
                .iter()
                .any(|p| eeveelutions.contains(&(p.pokedex_id as i32)))
            {
                return Ok(serde_json::json!({
                    "success": false,
                    "error": if actual_user_id == user.get_user_id_string() {
                        "You have already claimed an Eeveelution".to_string()
                    } else {
                        format!("{} has already claimed an Eeveelution", team.username)
                    }
                }));
            }
        }

        let target_pokemon = self
            .draft
            .pokemon
            .iter()
            .find(|p| p.pokedex_id as i32 == pokedex_id && p.form == form)
            .cloned();
        let target_pokemon = match target_pokemon {
            Some(p) => p,
            None => {
                return Err((
                    StatusCode::NOT_FOUND,
                    "pokemon not found in draft".to_string(),
                ));
            }
        };

        // Check if claimed
        let already_claimed_by =
            self.teams.values().find_map(|team| {
                if team.auctions_won.iter().any(|p| {
                    p.pokedex_id == target_pokemon.pokedex_id && p.form == target_pokemon.form
                }) {
                    Some(team.username.clone())
                } else {
                    None
                }
            });

        if let Some(claimer_name) = already_claimed_by {
            return Ok(serde_json::json!({
                "success": false,
                "error": format!("Already claimed by {}", claimer_name),
                "claimed_by": claimer_name
            }));
        }

        if let Some(team) = self.teams.get_mut(&actual_user_id) {
            team.auctions_won.push(target_pokemon.clone());

            // Send WebSocket notification about the claim
            let _ = self.broadcast_tx.send(crate::messages::ServerMessage::EeveelutionClaimed {
                user_name: team.username.clone(),
                eeveelution_name: target_pokemon.name.clone(),
                user_id: actual_user_id.clone(),
                pokedex_id: target_pokemon.pokedex_id,
                form: target_pokemon.form.clone(),
            });

            self.broadcast();
            Ok(serde_json::json!({
                "success": true,
                "claimed_by": actual_user_id,
                "pokemon": {
                    "pokedex_id": target_pokemon.pokedex_id,
                    "name": target_pokemon.name,
                    "form": target_pokemon.form
                }
            }))
        } else {
            Err((StatusCode::NOT_FOUND, "team not found".to_string()))
        }
    }

    async fn unclaim_eeveelution(
        &mut self,
        user: User,
        pokedex_id: i32,
        form: Option<String>,
        target_user_id: Option<String>,
    ) -> Result<serde_json::Value, AppError> {
        if self.draft_state != DraftState::COMPLETED {
            return Err((
                StatusCode::PRECONDITION_FAILED,
                "draft must be completed".to_string(),
            ));
        }

        let eeveelutions = [133, 134, 135, 136, 196, 197, 470, 471, 700];
        if !eeveelutions.contains(&pokedex_id) {
            return Err((
                StatusCode::BAD_REQUEST,
                "Only Eeveelutions can be unclaimed through this method".to_string(),
            ));
        }

        let target_pokemon = self
            .draft
            .pokemon
            .iter()
            .find(|p| p.pokedex_id as i32 == pokedex_id && p.form == form)
            .cloned();
        let target_pokemon = match target_pokemon {
            Some(p) => p,
            None => {
                return Err((
                    StatusCode::NOT_FOUND,
                    "pokemon not found in draft".to_string(),
                ));
            }
        };

        let is_ref = user.has_role_name("Referee") || user.has_role_name("Admin");
        let actual_user_id = if let Some(tid) = target_user_id {
            if is_ref { tid } else { user.get_user_id_string() }
        } else {
            user.get_user_id_string()
        };

        let team_status = self.teams.get(&actual_user_id).map(|team| {
            (
                team.username.clone(),
                team.auctions_won.iter().any(|p| {
                    p.pokedex_id == target_pokemon.pokedex_id && p.form == target_pokemon.form
                }),
            )
        });

        match team_status {
            Some((_, true)) => {
                let team = self.teams.get_mut(&actual_user_id).unwrap();
                let index = team.auctions_won.iter().position(|p| {
                    p.pokedex_id == target_pokemon.pokedex_id && p.form == target_pokemon.form
                }).unwrap();
                team.auctions_won.remove(index);

                // Send WebSocket notification about the unclaim
                let _ = self.broadcast_tx.send(crate::messages::ServerMessage::EeveelutionUnclaimed {
                    user_name: team.username.clone(),
                    eeveelution_name: target_pokemon.name.clone(),
                    user_id: actual_user_id.clone(),
                    pokedex_id: target_pokemon.pokedex_id,
                    form: target_pokemon.form.clone(),
                });

                self.broadcast();
                Ok(serde_json::json!({
                    "success": true,
                    "unclaimed_by": actual_user_id,
                    "pokemon": {
                        "pokedex_id": target_pokemon.pokedex_id,
                        "name": target_pokemon.name,
                        "form": target_pokemon.form
                    }
                }))
            }
            Some((username, false)) => {
                let claimed_by_other = self.teams.values().find_map(|other_team| {
                    if other_team.user_id != actual_user_id
                        && other_team.auctions_won.iter().any(|p| {
                            p.pokedex_id == target_pokemon.pokedex_id && p.form == target_pokemon.form
                        })
                    {
                        Some(other_team.username.clone())
                    } else {
                        None
                    }
                });

                if let Some(owner_name) = claimed_by_other {
                    return Err((StatusCode::FORBIDDEN, format!("eeveelution is claimed by {}", owner_name)));
                }

                let error_msg = if actual_user_id == user.get_user_id_string() {
                    "you have not claimed this eeveelution".to_string()
                } else {
                    format!("{} has not claimed this eeveelution", username)
                };
                Err((StatusCode::NOT_FOUND, error_msg))
            }
            None => Err((StatusCode::NOT_FOUND, "team not found".to_string())),
        }
    }

    async fn update_pending_settings(
        &mut self,
        user_id: String,
        num_teams: u32,
        num_auctions: u32,
        remove_team_ids: Vec<String>,
    ) -> Result<DraftResponse, AppError> {
        if self.draft_state != DraftState::PENDING {
            return Err((
                StatusCode::PRECONDITION_FAILED,
                "draft must be in PENDING state".to_string(),
            ));
        }
        if user_id != self.host {
            return Err((StatusCode::FORBIDDEN, "user is not host".to_string()));
        }

        // 1v1 drafts only support kicking joined players; ignore num_teams/num_auctions.
        if self.settings.draft_type == DRAFT_TYPE_1V1 {
            return self.update_one_v_one_pending_settings(remove_team_ids).await;
        }

        if num_teams == 0 || num_auctions == 0 {
            return Err((StatusCode::BAD_REQUEST, "invalid settings".to_string()));
        }

        let mut unique_remove_ids = Vec::new();
        for team_id in remove_team_ids {
            if unique_remove_ids.contains(&team_id) {
                continue;
            }
            if team_id == self.host {
                return Err((
                    StatusCode::BAD_REQUEST,
                    "host cannot be removed".to_string(),
                ));
            }
            if !self.teams.contains_key(&team_id) {
                return Err((
                    StatusCode::BAD_REQUEST,
                    format!("team {} not in draft", team_id),
                ));
            }
            unique_remove_ids.push(team_id);
        }

        let teams_after = self.teams.len().saturating_sub(unique_remove_ids.len()) as u32;
        if num_teams < teams_after {
            return Err((
                StatusCode::BAD_REQUEST,
                "num_teams less than remaining teams".to_string(),
            ));
        }

        let current_auctions_len = self.auctions.len() as u32;
        let mut new_auctions_data = Vec::new();
        let mut truncate_to = None;

        if num_auctions > current_auctions_len {
            let needed = num_auctions - current_auctions_len;
            let mut count_suitable = 0;
            for p in self.draft.pokemon.iter() {
                if p.stage == pokemon::PokemonStage::base && p.obtain_method.is_none()
                {
                    if count_suitable >= current_auctions_len {
                        new_auctions_data.push((p.clone(), count_suitable as i32));
                        if new_auctions_data.len() == needed as usize {
                            break;
                        }
                    }
                    count_suitable += 1;
                }
            }

            if new_auctions_data.len() < needed as usize {
                return Err((
                    StatusCode::BAD_REQUEST,
                    format!(
                        "Not enough suitable pokemon to increase auctions to {}",
                        num_auctions
                    ),
                ));
            }
        } else if num_auctions < current_auctions_len {
            truncate_to = Some(num_auctions);
        }

        // Update DB
        let new_ids = self
            .db_writer
            .update_draft_settings(
                num_teams,
                unique_remove_ids.clone(),
                new_auctions_data.clone(),
                truncate_to,
            )
            .await?;

        // Update state
        for team_id in unique_remove_ids {
            self.teams.remove(&team_id);
            self.team_users.remove(&team_id);
        }
        self.settings.num_teams = num_teams;
        self.settings.num_auctions = num_auctions;
        self.auctions.truncate(num_auctions as usize); // Remove excess auctions if any

        // Add new auctions if any
        for (id, (p, _)) in new_ids.into_iter().zip(new_auctions_data.into_iter()) {
            let auction = Auction::new(self.draft.draft_id, id, p);
            self.auctions.push(auction);
        }

        self.broadcast();
        Ok(DraftResponse::from(&*self))
    }

    async fn update_one_v_one_pending_settings(
        &mut self,
        remove_team_ids: Vec<String>,
    ) -> Result<DraftResponse, AppError> {
        let mut unique_remove_ids = Vec::new();
        for team_id in remove_team_ids {
            if unique_remove_ids.contains(&team_id) {
                continue;
            }
            if team_id == self.host {
                return Err((
                    StatusCode::BAD_REQUEST,
                    "host cannot be removed".to_string(),
                ));
            }
            if !self.teams.contains_key(&team_id) {
                return Err((
                    StatusCode::BAD_REQUEST,
                    format!("team {} not in draft", team_id),
                ));
            }
            unique_remove_ids.push(team_id);
        }

        if !unique_remove_ids.is_empty() {
            for team_id in &unique_remove_ids {
                if let Some(user) = self.team_users.get(team_id).cloned() {
                    let _ = self.db_writer.kick_draft(user).await;
                }
            }
            for team_id in unique_remove_ids {
                self.teams.remove(&team_id);
                self.team_users.remove(&team_id);
            }
        }

        self.broadcast();
        Ok(DraftResponse::from(&*self))
    }
}

impl From<&DraftActor> for DraftResponse {
    fn from(value: &DraftActor) -> Self {
        let draft_type = value.settings.draft_type.clone();
        let format = format_label(&draft_type, value.settings.ranked);
        DraftResponse {
            draft_id: value.draft.draft_id.to_string(),
            draft_name: value.draft.draft_name.clone(),
            has_password: value.settings.password.is_some(),
            host: value.host.clone(),
            ranked: value.settings.ranked,
            draft_type,
            format,
            total_teams: value.settings.num_teams,
            total_auctions: value.settings.num_auctions,
            teams: value.teams.values().cloned().collect(),
            draft_state: value.draft_state.clone(),
            current_auction: value.current_auction,
            completed_auctions: value.completed_auctions.clone(),
            current_server_time: Utc::now(),
            auction_length: value.settings.auction_length,
            one_v_one: value.one_v_one.as_ref().map(|e| e.to_state(value)),
        }
    }
}

impl From<&DraftActor> for DraftLobbyResponse {
    fn from(value: &DraftActor) -> Self {
        let draft_type = value.settings.draft_type.clone();
        let format = format_label(&draft_type, value.settings.ranked);
        let mut players: Vec<String> = value
            .team_users
            .values()
            .map(|user| user.get_user_name_string())
            .collect();
        players.sort();
        let host_username = value
            .team_users
            .get(&value.host)
            .map(|user| user.get_user_name_string())
            .or_else(|| {
                value
                    .teams
                    .get(&value.host)
                    .map(|team| team.username.clone())
            })
            .unwrap_or_default();
        DraftLobbyResponse {
            draft_id: value.draft.draft_id,
            draft_name: value.draft.draft_name.clone(),
            has_password: value.settings.password.is_some(),
            host: value.host.clone(),
            host_username,
            players,
            ranked: value.settings.ranked,
            draft_type,
            format,
            total_teams: value.settings.num_teams,
            total_auctions: value.settings.num_auctions,
            draft_state: value.draft_state.clone(),
            teams_joined: value.teams.len() as u32,
            created_at: value.draft.created_at,
        }
    }
}

fn format_label(draft_type: &str, ranked: bool) -> String {
    if draft_type == DRAFT_TYPE_1V1 {
        "1v1".to_string()
    } else if ranked {
        "Ranked".to_string()
    } else {
        "Auction".to_string()
    }
}
