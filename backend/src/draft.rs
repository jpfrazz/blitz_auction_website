use axum::http::StatusCode;
use chrono::Utc;
use dashmap::DashMap;
use petname::petname;
use rand::seq::SliceRandom;
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Row};
use std::{collections::{HashMap, HashSet}, sync::{Arc, atomic::AtomicUsize}};
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
    /// Number of live viewer WebSocket connections per spectator identity.
    /// Multiple tabs from the same signed-in or guest session share one entry,
    /// so the reported count reflects people rather than open tabs.
    pub spectator_presence: Arc<DashMap<String, usize>>,
    /// Number of distinct live spectators watching this draft. Emulator sockets
    /// register player presence and are excluded, so this counts actual
    /// spectators, unlike the spectator roster below (teams moved out of a
    /// player slot while the draft is pending).
    pub spectator_count: Arc<AtomicUsize>,
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
    /// Players who were moved to the spectator list (not active teams). The
    /// host can move them back into a player slot while the draft is pending.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    spectators: Vec<SpectatorInfo>,
    draft_state: DraftState,
    current_auction: usize,
    completed_auctions: Vec<AuctionResponse>,
    current_server_time: chrono::DateTime<Utc>,
    auction_length: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    one_v_one_pool_size: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    booster_team_size: Option<u32>,
    /// 1v1 drafts only: the shared pick/ban pool and current turn state.
    #[serde(skip_serializing_if = "Option::is_none")]
    one_v_one: Option<OneVOneState>,
    /// 1v1 drafts only: the rock-paper-scissors pick-order showdown.
    #[serde(skip_serializing_if = "Option::is_none")]
    rps: Option<RockPaperScissorsState>,
    /// Booster drafts only: every pack, the current secret-submission round,
    /// and the revealed pick/ban history.
    #[serde(skip_serializing_if = "Option::is_none")]
    booster: Option<BoosterState>,
}

#[derive(Clone, Debug, Serialize)]
pub struct DraftLobbyResponse {
    draft_id: Uuid,
    draft_name: String,
    has_password: bool,
    host: String,
    pub host_username: String,
    //players: Vec<String>,
    ranked: bool,
    draft_type: String,
    format: String,
    teams_joined: u32,
    total_teams: u32,
    total_auctions: u32,
    pub draft_state: DraftState,
    created_at: chrono::DateTime<Utc>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, Display)]
pub enum DraftState {
    PENDING,
    /// 1v1 drafts only: players are settling the pick order with RPS.
    RPS,
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

/// A move in the 1v1 pick-order rock-paper-scissors showdown.
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub enum RpsChoice {
    Rock,
    Paper,
    Scissors,
}

impl RpsChoice {
    fn beats(self, other: Self) -> bool {
        matches!(
            (self, other),
            (Self::Rock, Self::Scissors)
                | (Self::Paper, Self::Rock)
                | (Self::Scissors, Self::Paper)
        )
    }
}

#[cfg(test)]
mod rps_choice_tests {
    use super::RpsChoice;

    #[test]
    fn each_move_beats_exactly_one_other_move() {
        use RpsChoice::*;
        assert!(Rock.beats(Scissors));
        assert!(Paper.beats(Rock));
        assert!(Scissors.beats(Paper));
        assert!(!Scissors.beats(Rock));
        assert!(!Rock.beats(Paper));
        assert!(!Paper.beats(Scissors));
        assert!(!Rock.beats(Rock));
    }
}

/// Resolve a completed RPS round into a publicly revealable result.
fn resolve_rps_round(
    round: u32,
    host: &str,
    opponent: &str,
    host_choice: RpsChoice,
    opponent_choice: RpsChoice,
) -> RpsRoundResult {
    let winner = if host_choice == opponent_choice {
        None
    } else if host_choice.beats(opponent_choice) {
        Some(host.to_string())
    } else {
        Some(opponent.to_string())
    };
    RpsRoundResult {
        round,
        host: host_choice,
        opponent: opponent_choice,
        winner,
    }
}

#[cfg(test)]
mod resolve_rps_round_tests {
    use super::{resolve_rps_round, RpsChoice};

    #[test]
    fn ties_have_no_winner_and_wins_go_to_the_matching_player() {
        use RpsChoice::*;
        let tie = resolve_rps_round(1, "host", "guest", Rock, Rock);
        assert_eq!(tie.winner, None);

        let host_win = resolve_rps_round(2, "host", "guest", Scissors, Paper);
        assert_eq!(host_win.winner.as_deref(), Some("host"));

        let guest_win = resolve_rps_round(3, "host", "guest", Rock, Paper);
        assert_eq!(guest_win.winner.as_deref(), Some("guest"));
    }
}

/// One resolved RPS round. Choices are only revealed once both players lock in.
#[derive(Clone, Debug, Serialize)]
pub struct RpsRoundResult {
    pub round: u32,
    pub host: RpsChoice,
    pub opponent: RpsChoice,
    /// user id of the round winner; `None` means the round was a tie.
    pub winner: Option<String>,
}

/// Public RPS state included in `DraftResponse` while the showdown is running.
/// Current-round choices are deliberately omitted so players can't see the
/// opponent's move before they both lock in.
#[derive(Clone, Debug, Serialize)]
pub struct RockPaperScissorsState {
    pub host: String,
    pub opponent: String,
    pub round: u32,
    pub host_ready: bool,
    pub opponent_ready: bool,
    pub last_round: Option<RpsRoundResult>,
    /// user id of the player who won a round and gets to choose pick order.
    pub winner: Option<String>,
    /// user id of the player who will receive the first pick.
    pub first_pick: Option<String>,
}

/// Internal RPS state. Holds the hidden picks until both players have chosen.
struct RpsEngine {
    host: String,
    opponent: String,
    round: u32,
    host_choice: Option<RpsChoice>,
    opponent_choice: Option<RpsChoice>,
    last_round: Option<RpsRoundResult>,
    winner: Option<String>,
    first_pick: Option<String>,
}

impl RpsEngine {
    fn to_state(&self) -> RockPaperScissorsState {
        RockPaperScissorsState {
            host: self.host.clone(),
            opponent: self.opponent.clone(),
            round: self.round,
            host_ready: self.host_choice.is_some(),
            opponent_ready: self.opponent_choice.is_some(),
            last_round: self.last_round.clone(),
            winner: self.winner.clone(),
            first_pick: self.first_pick.clone(),
        }
    }
}

/// The action a booster player is submitting for the current pass.
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub enum BoosterAction {
    Pick,
    Ban,
    Ward,
}

/// A single pokemon in one booster pack. Until the whole table has submitted,
/// even picked/banned statuses from previous passes stay visible while the
/// current pass's choices are hidden in `BoosterEngine`'s pending maps. Ward
/// ownership is separate because warded pokemon remain pickable.
#[derive(Clone, Debug, Serialize)]
pub struct BoosterPoolSlot {
    pub pokemon: Pokemon,
    pub status: BoosterSlotStatus,
    pub warded_by: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub enum BoosterSlotStatus {
    Available,
    Picked(String),
    Banned(String),
    Leftover,
}

#[derive(Clone, Debug, Serialize)]
pub struct BoosterPackState {
    /// Original seat that opened this pack.
    pub pack_index: u32,
    pub owner_id: String,
    /// Seat currently holding this pack after the latest pass.
    pub holder_id: String,
    pub slots: Vec<BoosterPoolSlot>,
}

#[derive(Clone, Debug, Serialize)]
pub struct BoosterSubmissionState {
    pub user_id: String,
    pub has_picked: bool,
    pub has_banned: bool,
    pub has_warded: bool,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub enum BoosterHistoryAction {
    Pick,
    Ban,
    Leftover,
}

#[derive(Clone, Debug, Serialize)]
pub struct BoosterHistoryEntry {
    pub round: u32,
    pub pack_index: u32,
    pub action: BoosterHistoryAction,
    pub player_id: Option<String>,
    pub pokemon: Pokemon,
}

/// Public booster state. Current-pass choices are deliberately represented
/// only by ready flags so no player can see another player's hidden pick/ban.
#[derive(Clone, Debug, Serialize)]
pub struct BoosterState {
    pub player_ids: Vec<String>,
    pub packs: Vec<BoosterPackState>,
    pub submissions: Vec<BoosterSubmissionState>,
    pub round: u32,
    pub total_rounds: u32,
    pub bans_enabled: bool,
    /// Only the first pass offers a ward after the player's pick and ban.
    pub wards_enabled: bool,
    pub team_size: u32,
    pub casual: bool,
    pub history: Vec<BoosterHistoryEntry>,
}

/// The full 1v1 pick/ban order. Each tuple is (player, action).
/// P1 opens with a lone pick, P2 takes a double pick with no ban, then P1
/// picks and bans once. After that the players alternate Pick+Ban turns
/// (starting with P2). Four pool pokemon are left over.
fn one_v_one_action_sequence(pool_size: usize) -> Vec<(OneVOnePlayer, OneVOneAction)> {
    use OneVOneAction::*;
    use OneVOnePlayer::*;
    let mut seq = vec![
        (P1, Pick), // pick 1: P1
        (P2, Pick), // pick 2: P2
        (P2, Pick), // pick 3: P2
        (P1, Pick), // pick 4: P1
        (P1, Ban),  // ban 1: P1
    ];
    for _ in 0..(5 + (pool_size - 32) / 4) {
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

#[cfg(test)]
mod one_v_one_sequence_tests {
    use super::{one_v_one_action_sequence, OneVOneAction, OneVOnePlayer};

    #[test]
    fn pool_sizes_leave_four_and_give_equal_picks_and_bans() {
        for pool_size in [32, 36, 40] {
            let sequence = one_v_one_action_sequence(pool_size);
            assert_eq!(sequence.len(), pool_size - 4);
            for player in [OneVOnePlayer::P1, OneVOnePlayer::P2] {
                assert_eq!(sequence.iter().filter(|entry| **entry == (player, OneVOneAction::Pick)).count(), pool_size / 4);
                assert_eq!(sequence.iter().filter(|entry| **entry == (player, OneVOneAction::Ban)).count(), pool_size / 4 - 2);
            }
        }
    }
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
    #[serde(default = "default_one_v_one_pool_size")]
    pub one_v_one_pool_size: u32,
    /// 'auction' (default), '1v1', or 'booster'. Determines the lobby format.
    #[serde(default = "default_draft_type")]
    pub draft_type: String,
    /// Booster drafts only: 8, 9, or 10. Sizes 9 and 10 are casual.
    #[serde(default = "default_booster_team_size")]
    pub booster_team_size: u32,
}

fn default_draft_type() -> String {
    "auction".to_string()
}

fn default_one_v_one_pool_size() -> u32 {
    32
}

fn default_booster_team_size() -> u32 {
    8
}

fn booster_pack_size(player_count: usize) -> usize {
    match player_count {
        // Eight picks, three bans, then three leftovers. A ten-Pokemon team
        // adds two more passes per pack and leaves one leftover.
        3 => 14,
        // Eight picks, four bans, then three leftovers. A ten-Pokemon team
        // adds two more passes per pack and leaves one leftover.
        4 => 15,
        _ => 3 * player_count + 3,
    }
}

/// Booster packs only draw base, non-rental Pokemon, so "top 30 by average
/// price" is ranked within that eligible pool. Pokemon without auction data
/// have no price and are not featured.
const BOOSTER_FEATURED_LIMIT: usize = 30;

fn booster_featured_keys(
    candidates: &[Arc<Pokemon>],
    avg_prices: &HashMap<(u32, Option<String>), u32>,
) -> Vec<(u32, Option<String>)> {
    let mut priced: Vec<((u32, Option<String>), u32)> = candidates
        .iter()
        .filter_map(|pokemon| {
            avg_prices
                .get(&(pokemon.pokedex_id, pokemon.form.clone()))
                .copied()
                .map(|price| ((pokemon.pokedex_id, pokemon.form.clone()), price))
        })
        .collect();
    priced.sort_by(|(key_a, price_a), (key_b, price_b)| {
        price_b
            .cmp(price_a)
            .then_with(|| key_a.0.cmp(&key_b.0))
            .then_with(|| key_a.1.cmp(&key_b.1))
    });
    priced
        .into_iter()
        .take(BOOSTER_FEATURED_LIMIT)
        .map(|(key, _)| key)
        .collect()
}

/// Seed one randomly chosen top-priced Pokemon into every pack, then fill the
/// remaining slots from the rest of the eligible pool without duplicates.
fn booster_pack_groups(
    player_count: usize,
    pack_size: usize,
    candidates: Vec<Arc<Pokemon>>,
    featured_keys: Vec<(u32, Option<String>)>,
) -> Result<Vec<Vec<Arc<Pokemon>>>, AppError> {
    let needed = pack_size * player_count;
    if candidates.len() < needed {
        return Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            "not enough pokemon to build booster packs".to_string(),
        ));
    }

    let featured_key_set: HashSet<(u32, Option<String>)> =
        featured_keys.into_iter().collect();
    let mut featured: Vec<Arc<Pokemon>> = candidates
        .iter()
        .filter(|pokemon| {
            featured_key_set.contains(&(pokemon.pokedex_id, pokemon.form.clone()))
        })
        .cloned()
        .collect();
    if featured.len() < player_count {
        return Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            "not enough top-priced pokemon to seed booster packs".to_string(),
        ));
    }
    featured.shuffle(&mut rand::rng());
    featured.truncate(player_count);

    let chosen_keys: HashSet<(u32, Option<String>)> = featured
        .iter()
        .map(|pokemon| (pokemon.pokedex_id, pokemon.form.clone()))
        .collect();
    let mut rest: Vec<Arc<Pokemon>> = candidates
        .into_iter()
        .filter(|pokemon| !chosen_keys.contains(&(pokemon.pokedex_id, pokemon.form.clone())))
        .collect();
    rest.shuffle(&mut rand::rng());
    rest.truncate((pack_size - 1) * player_count);

    let mut packs: Vec<Vec<Arc<Pokemon>>> =
        featured.into_iter().map(|pokemon| vec![pokemon]).collect();
    for (index, pokemon) in rest.into_iter().enumerate() {
        packs[index / (pack_size - 1)].push(pokemon);
    }
    Ok(packs)
}

/// One round gives every player one pick, so the draft ends once everyone has
/// reached the configured team size. A three-player 8-Pokémon draft therefore
/// stops partway through the third circuit instead of forcing a full lap.
fn booster_total_rounds(_player_count: usize, team_size: u32) -> u32 {
    team_size
}

pub const DRAFT_TYPE_1V1: &str = "1v1";
pub const DRAFT_TYPE_BOOSTER: &str = "booster";

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

#[derive(Clone, Debug, Serialize)]
pub struct SpectatorInfo {
    pub user_id: String,
    pub user_name: String,
    pub global_name: Option<String>,
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
            spectator_presence: Arc::new(DashMap::new()),
            spectator_count: Arc::new(AtomicUsize::new(0)),
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
            if ![32, 36, 40].contains(&settings.one_v_one_pool_size) {
                return Err((StatusCode::BAD_REQUEST, "1v1 pool size must be 32, 36, or 40".to_string()));
            }
            settings.num_teams = 2;
            settings.num_auctions = 0;
            settings.starting_money = 0;
            settings.ranked = false;
            settings.excluded_pokemon.clear();
        }

        // Booster drafts are simultaneous pick/ban rounds; they have no
        // auctions, money, ranked MMR, or pokemon exclusions.
        if settings.draft_type == DRAFT_TYPE_BOOSTER {
            if !(3..=4).contains(&settings.num_teams) {
                return Err((
                    StatusCode::BAD_REQUEST,
                    "booster drafts require between 3 and 4 players".to_string(),
                ));
            }
            if ![8, 9, 10].contains(&settings.booster_team_size) {
                return Err((
                    StatusCode::BAD_REQUEST,
                    "booster team size must be 8, 9, or 10".to_string(),
                ));
            }
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
        pokemon::weighted_shuffle(&mut pokemon);
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

    pub async fn get(&self, viewer_id: Option<String>) -> Result<DraftResponse, AppError> {
        let (response_sender, response_receiver) = oneshot::channel();
        let cmd = DraftCommand::Get {
            response_sender,
            viewer_id,
        };
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

    pub async fn become_spectator(&self, user_id: String) -> Result<(), AppError> {
        let (response_sender, response_receiver) = oneshot::channel();
        let cmd = DraftCommand::BecomeSpectator {
            response_sender,
            user_id,
        };
        self.actor_sender.send(cmd).await.map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to send become spectator cmd to actor, {}", e),
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
        move_to_spectator_user_ids: Vec<String>,
        add_spectator_user_ids: Vec<String>,
    ) -> Result<DraftResponse, AppError> {
        let (response_sender, response_receiver) = oneshot::channel();
        let cmd = DraftCommand::UpdatePendingSettings {
            response_sender,
            user_id,
            num_teams,
            num_auctions,
            remove_team_ids,
            move_to_spectator_user_ids,
            add_spectator_user_ids,
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

    /// 1v1 drafts: set or clear a pending rock-paper-scissors move.
    pub async fn rps_pick(&self, user_id: String, choice: Option<RpsChoice>) -> Result<(), AppError> {
        let (response_sender, response_receiver) = oneshot::channel();
        let cmd = DraftCommand::RpsPick {
            response_sender,
            user_id,
            choice,
        };
        self.actor_sender.send(cmd).await.map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to send rps pick cmd to actor, {}", e),
            )
        })?;
        response_receiver.await.map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to wait for actor response, {}", e),
            )
        })?
    }

    /// 1v1 drafts: the RPS winner decides who receives the first pick.
    pub async fn rps_choose_first_pick(
        &self,
        user_id: String,
        first_pick: bool,
    ) -> Result<(), AppError> {
        let (response_sender, response_receiver) = oneshot::channel();
        let cmd = DraftCommand::RpsChooseFirstPick {
            response_sender,
            user_id,
            first_pick,
        };
        self.actor_sender.send(cmd).await.map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to send rps choose cmd to actor, {}", e),
            )
        })?;
        response_receiver.await.map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to wait for actor response, {}", e),
            )
        })?
    }

    /// Booster drafts: submit this pass's pick or ban. The choice is hidden
    /// from every other participant until the whole table has submitted.
    pub async fn booster_submit(
        &self,
        user: User,
        action: BoosterAction,
        pokedex_id: u32,
        form: Option<String>,
    ) -> Result<(), AppError> {
        let (response_sender, response_receiver) = oneshot::channel();
        let cmd = DraftCommand::BoosterSubmit {
            response_sender,
            user,
            action,
            pokedex_id,
            form,
        };
        self.actor_sender.send(cmd).await.map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to send booster submission to actor, {}", e),
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
    /// 1v1 drafts only: the pick-order RPS showdown state.
    rps: Option<RpsEngine>,
    /// Booster drafts only: simultaneous pack pick/ban engine.
    booster: Option<BoosterEngine>,
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

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct BoosterChoice {
    pack_index: usize,
    slot_index: usize,
}

struct BoosterPack {
    owner_id: String,
    holder_seat: usize,
    slots: Vec<BoosterPoolSlot>,
}

struct BoosterEngine {
    player_ids: Vec<String>,
    packs: Vec<BoosterPack>,
    round: u32,
    total_rounds: u32,
    team_size: u32,
    /// A pass belongs to the first circuit, so players pick and ban.
    bans_enabled: bool,
    /// Only the opening pass adds a ward to the pick and ban.
    wards_enabled: bool,
    /// Hidden until every player has submitted every action for this pass.
    pending_picks: HashMap<String, BoosterChoice>,
    pending_bans: HashMap<String, BoosterChoice>,
    pending_wards: HashMap<String, BoosterChoice>,
    history: Vec<BoosterHistoryEntry>,
    next_order: u32,
    /// Bans are bookkeeping for the first circuit only. They are stored with
    /// negative orders so the first LEFTOVER row stays at the circuit baseline
    /// plus one and casual boosters can be classified from leftover order.
    next_ban_order: i32,
}

impl BoosterEngine {
    fn to_state(&self) -> BoosterState {
        self.to_state_for(None)
    }

    /// Public snapshot. `viewer_id` is used only to reveal that viewer's own
    /// hidden submissions; every other player's current-pass choices stay
    /// invisible until the whole table has submitted.
    fn to_state_for(&self, viewer_id: Option<&str>) -> BoosterState {
        let mut packs: Vec<BoosterPackState> = self
            .packs
            .iter()
            .enumerate()
            .map(|(pack_index, pack)| BoosterPackState {
                pack_index: pack_index as u32,
                owner_id: pack.owner_id.clone(),
                holder_id: self.player_ids[pack.holder_seat].clone(),
                slots: pack.slots.clone(),
            })
            .collect();
        let submissions = self
            .player_ids
            .iter()
            .map(|user_id| BoosterSubmissionState {
                user_id: user_id.clone(),
                has_picked: self.pending_picks.contains_key(user_id),
                has_banned: self.pending_bans.contains_key(user_id),
                has_warded: self.pending_wards.contains_key(user_id),
            })
            .collect();

        if let Some(viewer) = viewer_id.filter(|id| self.is_participant(id)) {
            for (pending, status) in [
                (&self.pending_picks, BoosterSlotStatus::Picked(viewer.to_string())),
                (&self.pending_bans, BoosterSlotStatus::Banned(viewer.to_string())),
            ] {
                if let Some(choice) = pending.get(viewer) {
                    if let Some(slot) = packs
                        .get_mut(choice.pack_index)
                        .and_then(|pack| pack.slots.get_mut(choice.slot_index))
                    {
                        if slot.status == BoosterSlotStatus::Available {
                            slot.status = status;
                        }
                    }
                }
            }
            if let Some(choice) = self.pending_wards.get(viewer) {
                if let Some(slot) = packs
                    .get_mut(choice.pack_index)
                    .and_then(|pack| pack.slots.get_mut(choice.slot_index))
                {
                    if slot.status == BoosterSlotStatus::Available {
                        slot.warded_by = Some(viewer.to_string());
                    }
                }
            }
        }

        BoosterState {
            player_ids: self.player_ids.clone(),
            packs,
            submissions,
            round: self.round,
            total_rounds: self.total_rounds,
            bans_enabled: self.bans_enabled,
            wards_enabled: self.wards_enabled,
            team_size: self.team_size,
            casual: self.team_size >= 9,
            history: self.history.clone(),
        }
    }

    fn held_pack_index(&self, user_id: &str) -> Option<usize> {
        self.packs
            .iter()
            .position(|pack| self.player_ids[pack.holder_seat] == user_id)
    }

    fn is_participant(&self, user_id: &str) -> bool {
        self.player_ids.iter().any(|id| id == user_id)
    }

    fn all_submitted(&self) -> bool {
        self.player_ids.iter().all(|user_id| {
            self.pending_picks.contains_key(user_id)
                && (!self.bans_enabled || self.pending_bans.contains_key(user_id))
                && (!self.wards_enabled || self.pending_wards.contains_key(user_id))
        })
    }

    fn take_next_order(&mut self) -> u32 {
        let order = self.next_order;
        self.next_order += 1;
        order
    }

    fn take_ban_order(&mut self) -> i32 {
        let order = self.next_ban_order;
        self.next_ban_order -= 1;
        order
    }

    /// Claim an available slot and return its pokemon for persistence.
    fn claim_slot(&mut self, choice: BoosterChoice, status: BoosterSlotStatus) -> Option<Pokemon> {
        let slot = self.packs.get_mut(choice.pack_index)?.slots.get_mut(choice.slot_index)?;
        if slot.status != BoosterSlotStatus::Available {
            return None;
        }
        slot.status = status;
        slot.warded_by = None;
        Some(slot.pokemon.clone())
    }

    /// Mark an available slot as ban-proof without removing it from the pack.
    fn ward_slot(&mut self, choice: BoosterChoice, user_id: &str) -> bool {
        let Some(slot) = self.packs.get_mut(choice.pack_index).and_then(|pack| pack.slots.get_mut(choice.slot_index)) else {
            return false;
        };
        if slot.status != BoosterSlotStatus::Available {
            return false;
        }
        slot.warded_by = Some(user_id.to_string());
        true
    }

    fn available_slots(&self) -> Vec<BoosterChoice> {
        let mut choices = Vec::new();
        for (pack_index, pack) in self.packs.iter().enumerate() {
            for (slot_index, slot) in pack.slots.iter().enumerate() {
                if slot.status == BoosterSlotStatus::Available {
                    choices.push(BoosterChoice { pack_index, slot_index });
                }
            }
        }
        choices
    }

    fn pass_packs(&mut self) {
        for pack in &mut self.packs {
            pack.holder_seat = (pack.holder_seat + 1) % self.player_ids.len();
        }
        self.pending_picks.clear();
        self.pending_bans.clear();
        self.pending_wards.clear();
        self.round += 1;
        self.bans_enabled = self.round <= self.player_ids.len() as u32;
        self.wards_enabled = self.round == 1;
        if !self.bans_enabled {
            for pack in &mut self.packs {
                for slot in &mut pack.slots {
                    slot.warded_by = None;
                }
            }
        }
    }
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
    Get {
        response_sender: oneshot::Sender<Result<DraftResponse, AppError>>,
        viewer_id: Option<String>,
    },
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
    BecomeSpectator {
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
        move_to_spectator_user_ids: Vec<String>,
        add_spectator_user_ids: Vec<String>,
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
    /// 1v1 drafts: a player sets or clears their pending RPS move.
    RpsPick {
        response_sender: oneshot::Sender<Result<(), AppError>>,
        user_id: String,
        choice: Option<RpsChoice>,
    },
    /// 1v1 drafts: the RPS winner picks who gets the 1st / 2nd+3rd picks.
    RpsChooseFirstPick {
        response_sender: oneshot::Sender<Result<(), AppError>>,
        user_id: String,
        first_pick: bool,
    },
    /// Booster drafts: a player secretly submits their pick or ban for the
    /// current pass. The round reveals and passes once everyone has submitted.
    BoosterSubmit {
        response_sender: oneshot::Sender<Result<(), AppError>>,
        user: User,
        action: BoosterAction,
        pokedex_id: u32,
        form: Option<String>,
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
            rps: None,
            booster: None,
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
                    DraftCommand::Get { response_sender, viewer_id } => {
                        let _ = response_sender.send(Ok(self.response_for(viewer_id.as_deref())));
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
                    DraftCommand::BecomeSpectator {
                        response_sender,
                        user_id,
                    } => {
                        let res = self.become_spectator(user_id).await;
                        let ok = res.is_ok();
                        let _ = response_sender.send(res);
                        self.broadcast();
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
                        move_to_spectator_user_ids,
                        add_spectator_user_ids,
                    } => {
                        let res = self
                            .update_pending_settings(
                                user_id,
                                num_teams,
                                num_auctions,
                                remove_team_ids,
                                move_to_spectator_user_ids,
                                add_spectator_user_ids,
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
                    DraftCommand::RpsPick {
                        response_sender,
                        user_id,
                        choice,
                    } => {
                        let res = self.rps_pick(user_id, choice).await;
                        let ok = res.is_ok();
                        let _ = response_sender.send(res);
                        if ok {
                            self.broadcast();
                        };
                    }
                    DraftCommand::RpsChooseFirstPick {
                        response_sender,
                        user_id,
                        first_pick,
                    } => {
                        let res = self.rps_choose_first_pick(user_id, first_pick).await;
                        let ok = res.is_ok();
                        let _ = response_sender.send(res);
                        if ok {
                            self.broadcast();
                        };
                    }
                    DraftCommand::BoosterSubmit {
                        response_sender,
                        user,
                        action,
                        pokedex_id,
                        form,
                    } => {
                        let res = self.booster_submit(user, action, pokedex_id, form).await;
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
            || self.settings.draft_type == DRAFT_TYPE_BOOSTER
        {
            return Ok(None);
        }
        let auction = &self.auctions[self.current_auction];
        auction.get().await.map(|ok| Some(ok))
    }

    async fn bid(&self, auction_id: i64, bid_value: u32, user: User) -> Result<(), AppError> {
        if self.settings.draft_type == DRAFT_TYPE_1V1
            || self.settings.draft_type == DRAFT_TYPE_BOOSTER
        {
            return Err((
                StatusCode::PRECONDITION_FAILED,
                format!("this draft type does not use bidding"),
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
            // 1v1 drafts settle the pick order with rock-paper-scissors before
            // the pick/ban pool is generated.
            return self.start_rps();
        }
        if self.settings.draft_type == DRAFT_TYPE_BOOSTER {
            return self.start_booster().await;
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

    /// Begin the 1v1 pick-order showdown instead of generating the pool.
    fn start_rps(&mut self) -> Result<(), AppError> {
        if self.teams.len() != 2 {
            return Err((
                StatusCode::PRECONDITION_FAILED,
                format!("1v1 drafts require exactly 2 players"),
            ));
        }

        let mut player_ids: Vec<String> = self.teams.keys().cloned().collect();
        player_ids.sort();
        let host = if player_ids.contains(&self.host) {
            self.host.clone()
        } else {
            player_ids[0].clone()
        };
        let opponent = player_ids
            .into_iter()
            .find(|id| *id != host)
            .ok_or_else(|| {
                (
                    StatusCode::PRECONDITION_FAILED,
                    "1v1 drafts require exactly 2 players".to_string(),
                )
            })?;

        self.rps = Some(RpsEngine {
            host,
            opponent,
            round: 1,
            host_choice: None,
            opponent_choice: None,
            last_round: None,
            winner: None,
            first_pick: None,
        });
        self.draft_state = DraftState::RPS;
        Ok(())
    }

    /// Generate one pack per player and open the first simultaneous pick/ban
    /// pass. Three-player packs have 14 pokemon and four-player packs have 15,
    /// and each pack is seeded with one of the 30 highest average-price Pokemon
    /// eligible for booster packs. A full circuit is one pass per player, and
    /// the opening pass also adds a ward after each player's pick and ban. The
    /// rest of the first circuit bans one pokemon per pass. The draft runs one
    /// pass per drafted pokemon, so 8-Pokemon teams stop after 8 passes even if
    /// that cuts a circuit short.
    async fn start_booster(&mut self) -> Result<(), AppError> {
        let player_count = self.teams.len();
        if player_count != self.settings.num_teams as usize {
            return Err((
                StatusCode::PRECONDITION_FAILED,
                "not all players have joined the booster draft".to_string(),
            ));
        }

        let mut player_ids: Vec<String> = self.teams.keys().cloned().collect();
        player_ids.sort();
        if let Some(host_pos) = player_ids.iter().position(|id| *id == self.host) {
            let host = player_ids.remove(host_pos);
            player_ids.insert(0, host);
        }

        let pack_size = booster_pack_size(player_count);
        let candidates: Vec<Arc<Pokemon>> = self
            .draft
            .pokemon
            .iter()
            .filter(|p| p.stage == PokemonStage::base && p.obtain_method.is_none())
            .cloned()
            .collect();
        let avg_prices = self.load_avg_prices().await;
        let featured_keys = booster_featured_keys(&candidates, &avg_prices);
        let pack_groups =
            booster_pack_groups(player_count, pack_size, candidates, featured_keys)?;
        let packs = pack_groups
            .into_iter()
            .enumerate()
            .map(|(pack_index, pack)| {
                let mut slots: Vec<BoosterPoolSlot> = pack
                    .iter()
                    .map(|p| BoosterPoolSlot {
                        pokemon: clone_arc_pokemon(p),
                        status: BoosterSlotStatus::Available,
                        warded_by: None,
                    })
                    .collect();
                slots.sort_by(|a, b| {
                    let price_a = avg_prices
                        .get(&(a.pokemon.pokedex_id, a.pokemon.form.clone()))
                        .copied()
                        .unwrap_or(0);
                    let price_b = avg_prices
                        .get(&(b.pokemon.pokedex_id, b.pokemon.form.clone()))
                        .copied()
                        .unwrap_or(0);
                    price_b
                        .cmp(&price_a)
                        .then_with(|| a.pokemon.pokedex_id.cmp(&b.pokemon.pokedex_id))
                });
                BoosterPack {
                    owner_id: player_ids[pack_index].clone(),
                    holder_seat: pack_index,
                    slots,
                }
            })
            .collect();

        self.booster = Some(BoosterEngine {
            player_ids,
            packs,
            round: 1,
            total_rounds: booster_total_rounds(player_count, self.settings.booster_team_size),
            team_size: self.settings.booster_team_size,
            bans_enabled: true,
            wards_enabled: true,
            pending_picks: HashMap::new(),
            pending_bans: HashMap::new(),
            pending_wards: HashMap::new(),
            history: vec![],
            next_order: 1,
            next_ban_order: -1,
        });

        self.db_writer.start_draft().await?;
        self.draft_state = DraftState::BIDDING;
        Ok(())
    }

    /// Set or clear one player's provisional RPS move. When both moves are in,
    /// the round is revealed: a tie advances to a new round, otherwise the
    /// winner decides pick order and the round is persisted for stats.
    async fn rps_pick(&mut self, user_id: String, choice: Option<RpsChoice>) -> Result<(), AppError> {
        if self.draft_state != DraftState::RPS {
            return Err((
                StatusCode::PRECONDITION_FAILED,
                format!("rock paper scissors is not in progress"),
            ));
        }
        let Some(rps) = self.rps.as_mut() else {
            return Err((
                StatusCode::PRECONDITION_FAILED,
                format!("rock paper scissors is not in progress"),
            ));
        };
        if rps.winner.is_some() {
            return Err((
                StatusCode::PRECONDITION_FAILED,
                format!("rock paper scissors is already decided"),
            ));
        }

        let is_host = user_id == rps.host;
        let is_opponent = user_id == rps.opponent;
        if !is_host && !is_opponent {
            return Err((
                StatusCode::PRECONDITION_FAILED,
                format!("user is not part of the rock paper scissors match"),
            ));
        }
        // The move stays provisional until both players have one in, so a
        // player may replace it or clear it (`None`) before then.
        if is_host {
            rps.host_choice = choice;
        } else {
            rps.opponent_choice = choice;
        }

        // Collect the decisive result while the RPS state is borrowed, then
        // hand it to the DB writer once the borrow ends.
        let mut decisive = None;
        if let (Some(host_choice), Some(opponent_choice)) = (rps.host_choice, rps.opponent_choice) {
            let round = rps.round;
            let result = resolve_rps_round(
                round,
                &rps.host,
                &rps.opponent,
                host_choice,
                opponent_choice,
            );
            let winner = result.winner.clone();
            rps.last_round = Some(result);
            rps.host_choice = None;
            rps.opponent_choice = None;
            match winner {
                Some(winner_id) => {
                    let loser_id = if winner_id == rps.host {
                        rps.opponent.clone()
                    } else {
                        rps.host.clone()
                    };
                    decisive = Some((round, winner_id.clone(), loser_id));
                    rps.winner = Some(winner_id);
                }
                None => rps.round += 1,
            }
        }

        if let Some((round, winner_id, loser_id)) = decisive {
            self.db_writer
                .record_rps_result(round, winner_id, loser_id)
                .await;
        }

        Ok(())
    }

    /// The RPS winner chooses who gets the first pick (and therefore who gets
    /// the 2nd+3rd picks). This transitions straight into the 1v1 draft.
    async fn rps_choose_first_pick(
        &mut self,
        user_id: String,
        first_pick: bool,
    ) -> Result<(), AppError> {
        if self.draft_state != DraftState::RPS {
            return Err((
                StatusCode::PRECONDITION_FAILED,
                format!("rock paper scissors is not in progress"),
            ));
        }
        let Some(rps) = self.rps.as_ref() else {
            return Err((
                StatusCode::PRECONDITION_FAILED,
                format!("rock paper scissors is not in progress"),
            ));
        };
        if rps.winner.as_deref() != Some(user_id.as_str()) {
            return Err((
                StatusCode::PRECONDITION_FAILED,
                format!("only the rock paper scissors winner can choose pick order"),
            ));
        }
        if rps.first_pick.is_some() {
            return Err((
                StatusCode::PRECONDITION_FAILED,
                format!("pick order has already been chosen"),
            ));
        }

        let winner = rps.winner.clone().unwrap();
        let loser = if winner == rps.host {
            rps.opponent.clone()
        } else {
            rps.host.clone()
        };
        let first_pick_user = if first_pick { winner } else { loser };
        self.start_one_v_one(Some(first_pick_user.clone())).await?;
        if let Some(rps) = self.rps.as_mut() {
            rps.first_pick = Some(first_pick_user);
        }
        Ok(())
    }

    /// Initializes the 1v1 pick/ban engine and starts the first turn.
    /// `first_pick` comes from the RPS showdown; if absent (legacy/internal
    /// callers) the first player is chosen randomly.
    async fn start_one_v_one(&mut self, first_pick: Option<String>) -> Result<(), AppError> {
        // Exactly two teams required.
        if self.teams.len() != 2 {
            return Err((
                StatusCode::PRECONDITION_FAILED,
                format!("1v1 drafts require exactly 2 players"),
            ));
        }

        // P1 is the first pick (blue), P2 gets the 2nd and 3rd picks (red).
        let player1 = if let Some(first_pick) = first_pick {
            if !self.teams.contains_key(&first_pick) {
                return Err((
                    StatusCode::PRECONDITION_FAILED,
                    format!("first pick player is not in the draft"),
                ));
            }
            first_pick
        } else {
            let mut player_ids: Vec<String> = self.teams.keys().cloned().collect();
            player_ids.shuffle(&mut rand::rng());
            player_ids[0].clone()
        };
        let player2 = self
            .teams
            .keys()
            .find(|id| **id != player1)
            .cloned()
            .ok_or_else(|| {
                (
                    StatusCode::PRECONDITION_FAILED,
                    "1v1 drafts require exactly 2 players".to_string(),
                )
            })?;

        // Choose base, non-rental pokemon at random from the draft pool.
        let pool_size = self.settings.one_v_one_pool_size as usize;
        let mut candidates: Vec<Arc<Pokemon>> = self
            .draft
            .pokemon
            .iter()
            .filter(|p| p.stage == pokemon::PokemonStage::base && p.obtain_method.is_none())
            .cloned()
            .collect();
        candidates.shuffle(&mut rand::rng());
        if candidates.len() < pool_size {
            return Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("not enough pokemon to build a 1v1 pool"),
            ));
        }
        let chosen: Vec<Arc<Pokemon>> = candidates.into_iter().take(pool_size).collect();

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
        let sequence = one_v_one_action_sequence(pool.len());

        self.one_v_one = Some(OneVOneEngine {
            pool,
            player1,
            player2,
            action_index: 0,
            sequence,
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
             WHERE d.draft_type NOT IN ('1v1', 'booster')
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
               AND d.draft_type NOT IN ('1v1', 'booster')
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

        // --- 3. Pokemon name -> identity lookup (for legacy rows) -------------
        let mut legacy_identity_by_name: HashMap<String, (i32, Option<String>)> = HashMap::new();
        if let Ok(rows) = sqlx::query(
            "SELECT pokedex_id, name, form FROM pokemon ORDER BY (form = '') DESC, form",
        )
            .fetch_all(self.db_writer.pool())
            .await
        {
            for row in rows {
                if let (Ok(id), Ok(name), Ok(form)) = (
                    row.try_get::<i32, _>("pokedex_id"),
                    row.try_get::<String, _>("name"),
                    row.try_get::<String, _>("form"),
                )
                {
                    let form = if form.trim().is_empty() { None } else { Some(form) };
                    legacy_identity_by_name.entry(name).or_insert((id, form));
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
             WHERE d.draft_type NOT IN ('1v1', 'booster')
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
                if let Some((id, form)) = legacy_identity_by_name.get(&name) {
                    bids_by_key
                        .entry((*id as u32, form.clone()))
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
        if is_eevee {
            // During eeveelution phase, only eeveelutions can be banned
            let is_valid_eeveelution = engine.eeveelutions.iter().any(|s| s.pokemon.pokedex_id == pokedex_id && s.pokemon.form == form);
            if !is_valid_eeveelution {
                return Err((StatusCode::PRECONDITION_FAILED, "only eeveelutions can be banned during the eeveelution phase".to_string()));
            }
        }
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

    // ------------------------------------------------------------------
    // Booster Draft Engine
    // ------------------------------------------------------------------

    async fn booster_submit(
        &mut self,
        user: User,
        action: BoosterAction,
        pokedex_id: u32,
        form: Option<String>,
    ) -> Result<(), AppError> {
        if self.draft_state != DraftState::BIDDING {
            return Err((StatusCode::PRECONDITION_FAILED, "draft is not running".to_string()));
        }
        let user_id = user.get_user_id_string();
        let (
            choice,
            bans_enabled,
            wards_enabled,
            existing_pick,
            existing_ban,
            existing_ward,
            warded_by,
        ) = {
            let engine = self.booster.as_ref().ok_or((
                StatusCode::PRECONDITION_FAILED,
                "not a booster draft".to_string(),
            ))?;
            if !engine.is_participant(&user_id) {
                return Err((StatusCode::UNAUTHORIZED, "not a participant".to_string()));
            }
            let pack_index = engine.held_pack_index(&user_id).ok_or((
                StatusCode::INTERNAL_SERVER_ERROR,
                "no pack assigned to player".to_string(),
            ))?;
            let slot_index = engine.packs[pack_index]
                .slots
                .iter()
                .position(|slot| {
                    slot.pokemon.pokedex_id == pokedex_id
                        && slot.pokemon.form.as_deref() == form.as_deref()
                })
                .ok_or((
                    StatusCode::BAD_REQUEST,
                    "pokemon is not in your current pack".to_string(),
                ))?;
            if engine.packs[pack_index].slots[slot_index].status != BoosterSlotStatus::Available {
                return Err((
                    StatusCode::BAD_REQUEST,
                    "pokemon is no longer available".to_string(),
                ));
            }
            (
                BoosterChoice { pack_index, slot_index },
                engine.bans_enabled,
                engine.wards_enabled,
                engine.pending_picks.get(&user_id).copied(),
                engine.pending_bans.get(&user_id).copied(),
                engine.pending_wards.get(&user_id).copied(),
                engine.packs[pack_index].slots[slot_index].warded_by.clone(),
            )
        };

        match action {
            BoosterAction::Pick => {
                if existing_ban == Some(choice) {
                    return Err((
                        StatusCode::BAD_REQUEST,
                        "cannot pick the pokemon you banned".to_string(),
                    ));
                }
                if existing_ward == Some(choice) {
                    return Err((
                        StatusCode::BAD_REQUEST,
                        "cannot pick the pokemon you warded".to_string(),
                    ));
                }
                self.booster
                    .as_mut()
                    .expect("booster engine")
                    .pending_picks
                    .insert(user_id, choice);
            }
            BoosterAction::Ban => {
                if !bans_enabled {
                    return Err((
                        StatusCode::PRECONDITION_FAILED,
                        "bans are only allowed during the first cycle".to_string(),
                    ));
                }
                if warded_by.is_some() {
                    return Err((
                        StatusCode::BAD_REQUEST,
                        "warded pokemon cannot be banned".to_string(),
                    ));
                }
                if existing_pick == Some(choice) {
                    return Err((
                        StatusCode::BAD_REQUEST,
                        "cannot ban the pokemon you picked".to_string(),
                    ));
                }
                if existing_ward == Some(choice) {
                    return Err((
                        StatusCode::BAD_REQUEST,
                        "cannot ban the pokemon you warded".to_string(),
                    ));
                }
                self.booster
                    .as_mut()
                    .expect("booster engine")
                    .pending_bans
                    .insert(user_id, choice);
            }
            BoosterAction::Ward => {
                if !wards_enabled {
                    return Err((
                        StatusCode::PRECONDITION_FAILED,
                        "wards are only allowed on your first pick".to_string(),
                    ));
                }
                if existing_pick.is_none() || existing_ban.is_none() {
                    return Err((
                        StatusCode::PRECONDITION_FAILED,
                        "pick and ban before warding".to_string(),
                    ));
                }
                if existing_pick == Some(choice) {
                    return Err((
                        StatusCode::BAD_REQUEST,
                        "cannot ward the pokemon you picked".to_string(),
                    ));
                }
                if existing_ban == Some(choice) {
                    return Err((
                        StatusCode::BAD_REQUEST,
                        "cannot ward the pokemon you banned".to_string(),
                    ));
                }
                if warded_by.is_some() {
                    return Err((
                        StatusCode::BAD_REQUEST,
                        "pokemon is already warded".to_string(),
                    ));
                }
                self.booster
                    .as_mut()
                    .expect("booster engine")
                    .pending_wards
                    .insert(user_id, choice);
            }
        }

        let all_submitted = self
            .booster
            .as_ref()
            .expect("booster engine")
            .all_submitted();
        if all_submitted {
            self.booster_reveal_and_pass().await;
        }
        Ok(())
    }

    /// Reveal and persist the whole table's submissions, then pass every pack
    /// to the right. Nothing here is applied until all players are ready, so
    /// no player can react to another player's hidden choice.
    async fn booster_reveal_and_pass(&mut self) {
        let (round, bans_enabled, wards_enabled, picks, bans, wards) = {
            let engine = self.booster.as_ref().expect("booster engine");
            let picks = engine
                .player_ids
                .iter()
                .filter_map(|id| engine.pending_picks.get(id).map(|choice| (id.clone(), *choice)))
                .collect::<Vec<_>>();
            let bans = engine
                .player_ids
                .iter()
                .filter_map(|id| engine.pending_bans.get(id).map(|choice| (id.clone(), *choice)))
                .collect::<Vec<_>>();
            let wards = engine
                .player_ids
                .iter()
                .filter_map(|id| engine.pending_wards.get(id).map(|choice| (id.clone(), *choice)))
                .collect::<Vec<_>>();
            (engine.round, engine.bans_enabled, engine.wards_enabled, picks, bans, wards)
        };

        for (user_id, choice) in picks {
            let Some(pokemon) = self.booster.as_mut().expect("booster engine").claim_slot(
                choice,
                BoosterSlotStatus::Picked(user_id.clone()),
            ) else {
                continue;
            };
            let order = self.booster.as_mut().expect("booster engine").take_next_order();
            let user = self.team_users.get(&user_id).cloned();
            self.db_writer
                .write_one_v_one_action(pokemon.pokedex_id, pokemon.form.clone(), order as i32, "PICK", user.clone())
                .await;
            if let Some(user) = user {
                self.db_writer.increment_one_v_one_pick(user.clone()).await;
                if let Some(team) = self.teams.get_mut(&user_id) {
                    team.auctions_won.push(Arc::new(pokemon.clone()));
                    team.pokemon_drafted += 1;
                }
            }
            self.booster.as_mut().expect("booster engine").history.push(BoosterHistoryEntry {
                round,
                pack_index: choice.pack_index as u32,
                action: BoosterHistoryAction::Pick,
                player_id: Some(user_id),
                pokemon,
            });
        }

        if bans_enabled {
            for (user_id, choice) in bans {
                let Some(pokemon) = self.booster.as_mut().expect("booster engine").claim_slot(
                    choice,
                    BoosterSlotStatus::Banned(user_id.clone()),
                ) else {
                    continue;
                };
                let order = self.booster.as_mut().expect("booster engine").take_ban_order();
                let user = self.team_users.get(&user_id).cloned();
                self.db_writer
                    .write_one_v_one_action(pokemon.pokedex_id, pokemon.form.clone(), order, "BAN", user)
                    .await;
                self.booster.as_mut().expect("booster engine").history.push(BoosterHistoryEntry {
                    round,
                    pack_index: choice.pack_index as u32,
                    action: BoosterHistoryAction::Ban,
                    player_id: Some(user_id),
                    pokemon,
                });
            }
        }

        if wards_enabled {
            let engine = self.booster.as_mut().expect("booster engine");
            for (user_id, choice) in wards {
                engine.ward_slot(choice, &user_id);
            }
        }

        let (round, total_rounds, has_cards) = {
            let engine = self.booster.as_ref().expect("booster engine");
            (
                engine.round,
                engine.total_rounds,
                !engine.available_slots().is_empty(),
            )
        };
        if !has_cards || round >= total_rounds {
            self.booster_finish().await;
            return;
        }
        self.booster.as_mut().expect("booster engine").pass_packs();
    }

    /// Mark every unclaimed pokemon as leftover and persist it, matching the
    /// 1v1 draft's stats/leftover convention.
    async fn booster_finish(&mut self) {
        let leftovers = self
            .booster
            .as_ref()
            .expect("booster engine")
            .available_slots();
        for choice in leftovers {
            let Some(pokemon) = self
                .booster
                .as_mut()
                .expect("booster engine")
                .claim_slot(choice, BoosterSlotStatus::Leftover)
            else {
                continue;
            };
            let round = self.booster.as_ref().expect("booster engine").round;
            let order = self.booster.as_mut().expect("booster engine").take_next_order();
            self.db_writer
                .write_one_v_one_action(pokemon.pokedex_id, pokemon.form.clone(), order as i32, "LEFTOVER", None)
                .await;
            self.booster.as_mut().expect("booster engine").history.push(BoosterHistoryEntry {
                round,
                pack_index: choice.pack_index as u32,
                action: BoosterHistoryAction::Leftover,
                player_id: None,
                pokemon,
            });
        }
        if self.db_writer.finish_draft().await.is_ok() {
            self.draft_state = DraftState::COMPLETED;
        }
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
        if self.settings.draft_type == DRAFT_TYPE_BOOSTER {
            return Err((
                StatusCode::PRECONDITION_FAILED,
                "booster drafts do not use a countdown timer".to_string(),
            ));
        }
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
        if self.settings.draft_type == DRAFT_TYPE_BOOSTER {
            return Err((
                StatusCode::PRECONDITION_FAILED,
                "booster drafts do not use a countdown timer".to_string(),
            ));
        }
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
        if self.settings.draft_type == DRAFT_TYPE_1V1
            || self.settings.draft_type == DRAFT_TYPE_BOOSTER
        {
            return Err((
                StatusCode::PRECONDITION_FAILED,
                format!("this draft type does not use bidding"),
            ));
        }
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

    async fn become_spectator(&mut self, user_id: String) -> Result<(), AppError> {
        if self.draft_state != DraftState::PENDING {
            return Err((
                StatusCode::PRECONDITION_FAILED,
                "draft must be in PENDING state to become a spectator".to_string(),
            ));
        }
        if user_id == self.host {
            return Err((StatusCode::BAD_REQUEST, "host cannot become a spectator".to_string()));
        }
        let Some(user) = self.team_users.get(&user_id).cloned() else {
            return Err((
                StatusCode::BAD_REQUEST,
                "user is not a participant in this draft".to_string(),
            ));
        };

        self.db_writer.kick_draft(user.clone()).await?;
        self.teams.remove(&user_id);
        self.team_users.remove(&user_id);
        if self
            .spectators
            .iter()
            .all(|u| u.get_user_id_string() != user_id)
        {
            self.spectators.push(user);
        }

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
        move_to_spectator_user_ids: Vec<String>,
        add_spectator_user_ids: Vec<String>,
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

        // Settings can only be changed while PENDING; the check above keeps a
        // started draft's size locked. Pick/ban-only drafts only support
        // kicking joined players, so ignore num_teams/num_auctions here.
        if self.settings.draft_type == DRAFT_TYPE_1V1
            || self.settings.draft_type == DRAFT_TYPE_BOOSTER
        {
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
            if !self.teams.contains_key(&team_id) {
                return Err((
                    StatusCode::BAD_REQUEST,
                    format!("team {} not in draft", team_id),
                ));
            }
            unique_remove_ids.push(team_id);
        }

        let mut unique_spectate_ids = Vec::new();
        for spectator_id in move_to_spectator_user_ids {
            if unique_spectate_ids.contains(&spectator_id) || unique_remove_ids.contains(&spectator_id) {
                continue;
            }
            if !self.teams.contains_key(&spectator_id) {
                return Err((
                    StatusCode::BAD_REQUEST,
                    format!("team {} not in draft", spectator_id),
                ));
            }
            unique_spectate_ids.push(spectator_id);
        }

        let mut unique_add_ids = Vec::new();
        for spectator_id in add_spectator_user_ids {
            if unique_add_ids.contains(&spectator_id) {
                continue;
            }
            if self
                .spectators
                .iter()
                .all(|u| u.get_user_id_string() != spectator_id)
            {
                return Err((
                    StatusCode::BAD_REQUEST,
                    format!("user {} is not a spectator", spectator_id),
                ));
            }
            unique_add_ids.push(spectator_id);
        }

        let removed_total = unique_remove_ids.len() + unique_spectate_ids.len();
        let mut teams_after = self.teams.len().saturating_sub(removed_total) as u32;
        if num_teams < teams_after {
            return Err((
                StatusCode::BAD_REQUEST,
                "num_teams less than remaining teams".to_string(),
            ));
        }
        for _ in &unique_add_ids {
            if teams_after >= num_teams {
                return Err((StatusCode::BAD_REQUEST, "draft is already full".to_string()));
            }
            teams_after += 1;
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
        let combined_remove_ids: Vec<String> = unique_remove_ids
            .iter()
            .chain(unique_spectate_ids.iter())
            .cloned()
            .collect();
        let new_ids = self
            .db_writer
            .update_draft_settings(
                num_teams,
                combined_remove_ids,
                new_auctions_data.clone(),
                truncate_to,
            )
            .await?;

        // Persist spectators moving back into a player slot.
        for spectator_id in &unique_add_ids {
            if let Some(user) = self
                .spectators
                .iter()
                .find(|u| u.get_user_id_string() == *spectator_id)
                .cloned()
            {
                self.db_writer.join_draft(user).await?;
            }
        }

        // Update state
        for spectator_id in unique_spectate_ids {
            if let Some(user) = self.team_users.remove(&spectator_id) {
                if self
                    .spectators
                    .iter()
                    .all(|u| u.get_user_id_string() != spectator_id)
                {
                    self.spectators.push(user);
                }
            }
            self.teams.remove(&spectator_id);
        }
        for team_id in unique_remove_ids {
            self.teams.remove(&team_id);
            self.team_users.remove(&team_id);
        }
        for spectator_id in unique_add_ids {
            if let Some(pos) = self
                .spectators
                .iter()
                .position(|u| u.get_user_id_string() == spectator_id)
            {
                let user = self.spectators.remove(pos);
                let uid = user.get_user_id_string();
                let team = Team {
                    user_id: uid.clone(),
                    username: user.get_user_name_string(),
                    global_name: user.get_global_name(),
                    ready: uid == self.host,
                    budget_remaining: self.settings.starting_money,
                    auctions_won: vec![],
                    save_data: None,
                    auto_bid: None,
                    pokemon_drafted: 0,
                };
                self.teams.insert(uid.clone(), team);
                self.team_users.insert(uid, user);
            }
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

    fn response_for(&self, viewer_id: Option<&str>) -> DraftResponse {
        let mut response = DraftResponse::from(self);
        if let (Some(engine), Some(viewer)) = (self.booster.as_ref(), viewer_id) {
            response.booster = Some(engine.to_state_for(Some(viewer)));
        }
        response
    }
}

impl From<&DraftActor> for DraftResponse {
    fn from(value: &DraftActor) -> Self {
        let draft_type = value.settings.draft_type.clone();
        let format = format_label(
            &draft_type,
            value.settings.ranked,
            value.settings.booster_team_size,
        );
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
            spectators: value
                .spectators
                .iter()
                .map(|user| SpectatorInfo {
                    user_id: user.get_user_id_string(),
                    user_name: user.get_user_name_string(),
                    global_name: user.get_global_name(),
                })
                .collect(),
            draft_state: value.draft_state.clone(),
            current_auction: value.current_auction,
            completed_auctions: value.completed_auctions.clone(),
            current_server_time: Utc::now(),
            auction_length: value.settings.auction_length,
            one_v_one_pool_size: (value.settings.draft_type == DRAFT_TYPE_1V1).then_some(value.settings.one_v_one_pool_size),
            booster_team_size: (value.settings.draft_type == DRAFT_TYPE_BOOSTER)
                .then_some(value.settings.booster_team_size),
            one_v_one: value.one_v_one.as_ref().map(|e| e.to_state(value)),
            rps: value.rps.as_ref().map(|e| e.to_state()),
            booster: value.booster.as_ref().map(|e| e.to_state()),
        }
    }
}

impl From<&DraftActor> for DraftLobbyResponse {
    fn from(value: &DraftActor) -> Self {
        let draft_type = value.settings.draft_type.clone();
        let format = format_label(
            &draft_type,
            value.settings.ranked,
            value.settings.booster_team_size,
        );
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
            //players,
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

fn format_label(draft_type: &str, ranked: bool, booster_team_size: u32) -> String {
    if draft_type == DRAFT_TYPE_BOOSTER {
        if booster_team_size >= 9 {
            "Booster (Casual)".to_string()
        } else {
            "Booster".to_string()
        }
    } else if draft_type == DRAFT_TYPE_1V1 {
        "1v1".to_string()
    } else if ranked {
        "Ranked".to_string()
    } else {
        "Auction".to_string()
    }
}

#[cfg(test)]
mod booster_tests {
    use super::*;

    fn test_pokemon(pokedex_id: u32) -> Arc<Pokemon> {
        Arc::new(Pokemon {
            pokedex_id,
            name: format!("Pokemon {}", pokedex_id),
            form: None,
            stage: PokemonStage::base,
            type1: pokemon::PokemonType::Normal,
            type2: None,
            ability1: String::new(),
            ability2: None,
            hidden_ability: None,
            stats: pokemon::PokemonStats {
                hp: 1,
                attack: 1,
                defense: 1,
                sp_attack: 1,
                sp_defense: 1,
                speed: 1,
            },
            key_moves: sqlx::types::Json(vec![]),
            description: None,
            evolves_from_id: None,
            evolves_from_form: None,
            evolution_method: None,
            obtain_method: None,
        })
    }

    fn test_engine(player_count: usize, team_size: u32) -> BoosterEngine {
        let player_ids: Vec<String> = (0..player_count).map(|i| format!("p{}", i + 1)).collect();
        let packs = (0..player_count)
            .map(|i| BoosterPack {
                owner_id: player_ids[i].clone(),
                holder_seat: i,
                slots: Vec::new(),
            })
            .collect();
        BoosterEngine {
            player_ids,
            packs,
            round: 1,
            total_rounds: booster_total_rounds(player_count, team_size),
            team_size,
            bans_enabled: true,
            wards_enabled: true,
            pending_picks: HashMap::new(),
            pending_bans: HashMap::new(),
            pending_wards: HashMap::new(),
            history: Vec::new(),
            next_order: 1,
            next_ban_order: -1,
        }
    }

    #[test]
    fn pack_sizes_leave_three_leftovers_for_eight_pokemon_teams() {
        assert_eq!(booster_pack_size(3), 14);
        assert_eq!(booster_pack_size(4), 15);

        for player_count in [3, 4] {
            let pack_size = booster_pack_size(player_count);
            assert_eq!(pack_size - 8 - player_count, 3);
            assert_eq!(pack_size - 9 - player_count, 2);
            assert_eq!(pack_size - 10 - player_count, 1);
        }
    }

    #[test]
    fn booster_featured_keys_only_include_the_top_thirty_priced_pokemon() {
        let candidates: Vec<Arc<Pokemon>> = (1..=40u32).map(test_pokemon).collect();
        let avg_prices: HashMap<(u32, Option<String>), u32> = (1..=40u32)
            .map(|id| ((id, None), 1000 - id))
            .collect();

        let featured = booster_featured_keys(&candidates, &avg_prices);
        assert_eq!(featured.len(), 30);
        assert!(featured.contains(&(1, None)));
        assert!(featured.contains(&(30, None)));
        assert!(!featured.contains(&(31, None)));
    }

    #[test]
    fn every_booster_pack_gets_a_top_priced_pokemon_without_duplicates() {
        let player_count = 3;
        let pack_size = booster_pack_size(player_count);
        let needed = pack_size * player_count;
        let candidates: Vec<Arc<Pokemon>> = (1..=(needed as u32)).map(test_pokemon).collect();
        let avg_prices: HashMap<(u32, Option<String>), u32> = (1..=40u32)
            .map(|id| ((id, None), 1000 - id))
            .collect();
        let featured_keys = booster_featured_keys(&candidates, &avg_prices);

        let packs = booster_pack_groups(player_count, pack_size, candidates, featured_keys.clone())
            .expect("packs should build");
        assert_eq!(packs.len(), player_count);

        let mut seen = HashSet::new();
        for pack in &packs {
            assert_eq!(pack.len(), pack_size);
            assert!(
                pack.iter().any(|pokemon| {
                    featured_keys.contains(&(pokemon.pokedex_id, pokemon.form.clone()))
                }),
                "pack is missing a top-priced pokemon"
            );
            for pokemon in pack {
                assert!(seen.insert((pokemon.pokedex_id, pokemon.form.clone())));
            }
        }
        assert_eq!(seen.len(), needed);
    }

    #[test]
    fn rounds_match_the_configured_team_size() {
        assert_eq!(booster_total_rounds(3, 8), 8);
        assert_eq!(booster_total_rounds(3, 9), 9);
        assert_eq!(booster_total_rounds(3, 10), 10);
        assert_eq!(booster_total_rounds(4, 8), 8);
        assert_eq!(booster_total_rounds(4, 9), 9);
        assert_eq!(booster_total_rounds(4, 10), 10);
    }

    #[test]
    fn reveal_waits_for_every_pick_ban_and_ward() {
        let mut engine = test_engine(3, 8);
        assert!(!engine.all_submitted());

        for player in 0..3 {
            engine.pending_picks.insert(
                format!("p{}", player + 1),
                BoosterChoice {
                    pack_index: player,
                    slot_index: 0,
                },
            );
        }
        assert!(!engine.all_submitted(), "bans are still missing");

        for player in 0..3 {
            engine.pending_bans.insert(
                format!("p{}", player + 1),
                BoosterChoice {
                    pack_index: player,
                    slot_index: 1,
                },
            );
        }
        assert!(!engine.all_submitted(), "wards are still missing");

        for player in 0..3 {
            engine.pending_wards.insert(
                format!("p{}", player + 1),
                BoosterChoice {
                    pack_index: player,
                    slot_index: 2,
                },
            );
        }
        assert!(engine.all_submitted());

        engine.pass_packs();
        for player in 0..3 {
            let id = format!("p{}", player + 1);
            engine.pending_picks.insert(id.clone(), BoosterChoice { pack_index: player, slot_index: 0 });
            engine.pending_bans.insert(id, BoosterChoice { pack_index: player, slot_index: 1 });
        }
        assert!(engine.all_submitted(), "later passes need no ward");

        engine.bans_enabled = false;
        engine.pending_bans.clear();
        assert!(engine.all_submitted(), "pick-only passes need no bans");
    }

    #[test]
    fn passes_rotate_right_and_disable_bans_after_first_circuit() {
        let mut engine = test_engine(3, 8);
        assert_eq!(engine.held_pack_index("p1"), Some(0));
        assert_eq!(engine.held_pack_index("p3"), Some(2));

        engine.pass_packs();
        assert!(engine.bans_enabled);
        assert!(!engine.wards_enabled, "only the first pass offers a ward");
        for _ in 0..2 {
            engine.pass_packs();
        }

        assert_eq!(engine.round, 4);
        assert!(!engine.bans_enabled);
        assert_eq!(engine.held_pack_index("p1"), Some(0));
        assert_eq!(engine.held_pack_index("p2"), Some(1));
        assert_eq!(engine.held_pack_index("p3"), Some(2));
    }

    #[test]
    fn ward_stays_until_bans_end_but_can_be_picked() {
        let mut engine = test_engine(3, 8);
        for pack in &mut engine.packs {
            pack.slots = (1..=5u32)
                .map(|id| BoosterPoolSlot {
                    pokemon: test_pokemon(id).as_ref().clone(),
                    status: BoosterSlotStatus::Available,
                    warded_by: None,
                })
                .collect();
        }

        let choice = BoosterChoice { pack_index: 0, slot_index: 2 };
        assert!(engine.ward_slot(choice, "p1"));
        assert_eq!(engine.packs[0].slots[2].warded_by.as_deref(), Some("p1"));
        assert_eq!(engine.packs[0].slots[2].status, BoosterSlotStatus::Available);

        // A ward does not block picks, and claiming the slot clears the ward.
        let picked = engine.claim_slot(choice, BoosterSlotStatus::Picked("p2".to_string()));
        assert!(picked.is_some());
        assert_eq!(engine.packs[0].slots[2].warded_by, None);
        assert!(!engine.ward_slot(choice, "p3"), "picked slots cannot be warded");

        let surviving = BoosterChoice { pack_index: 1, slot_index: 2 };
        assert!(engine.ward_slot(surviving, "p2"));
        engine.pass_packs();
        engine.pass_packs();
        assert_eq!(engine.packs[1].slots[2].warded_by.as_deref(), Some("p2"));
        engine.pass_packs();
        assert!(!engine.bans_enabled);
        assert_eq!(engine.packs[1].slots[2].warded_by, None);
    }

    #[test]
    fn bans_use_negative_orders_so_leftover_baseline_is_team_size_times_players() {
        let mut engine = test_engine(3, 8);
        assert_eq!(engine.take_next_order(), 1);
        assert_eq!(engine.take_next_order(), 2);
        assert_eq!(engine.take_ban_order(), -1);
        assert_eq!(engine.take_ban_order(), -2);

        // 3 players x 8 picks = 24 numbered picks, so the first leftover row
        // is 25. Team sizes 9/10 add N/2N picks before the leftovers.
        let baseline = 8 * 3 + 1;
        assert_eq!(baseline, 25);
        assert_eq!(baseline + 3, 28);
        assert_eq!(baseline + 6, 31);

        // Four players also make 8 picks each, so their first leftover is 33.
        assert_eq!(8 * 4 + 1, 33);
    }

    #[test]
    fn casual_label_covers_team_sizes_nine_and_ten() {
        assert_eq!(format_label(DRAFT_TYPE_BOOSTER, false, 8), "Booster");
        assert_eq!(
            format_label(DRAFT_TYPE_BOOSTER, false, 9),
            "Booster (Casual)"
        );
        assert_eq!(
            format_label(DRAFT_TYPE_BOOSTER, false, 10),
            "Booster (Casual)"
        );
    }
}
