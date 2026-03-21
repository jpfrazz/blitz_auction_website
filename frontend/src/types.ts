// Global types for the frontend

export interface Pokemon {
  id: number;
  pokedex_id?: number;
  name: string;
  type1?: string;
  type2?: string;
  ability?: string;
  ability1?: string;
  ability2?: string;
  hidden_ability?: string;
  stats?: {
    hp: number;
    attack: number;
    defense: number;
    sp_attack?: number;
    sp_defense?: number;
    specialAttack: number;
    specialDefense: number;
    speed: number;
  };
  key_moves?: KeyMove[];
  description?: string;
  form?: string;
  stage?: string;
  evolves_from_id?: string;
  evolves_from_form?: string;
  evolution_method?: string;
  mega?: string;
  obtain_method?: string;
}

export interface KeyMove {
  move_name: string;
  learn_method: string;
  species?: string; // Optional field to indicate if the move is specific to a certain species or form
}

export interface UserRole {
  role_id: string;
  role_name: string;
}

export type SerializedUser =
  | { GuestUser: { user_id: string; user_name: string } }
  | { DiscordUser: {
      id?: string | null;
      user_id?: string;
      user_name?: string;
      username?: string;
      global_name?: string | null;
      roles?: UserRole[];
    } };

// Types for draft data
export type DraftState = 'PENDING' | 'BIDDING' | 'COMPLETED';

export interface Auction {
  auction_id: string;
  pokemon: Pokemon;
  auction_state: 'BIDDING' | 'COMPLETED' | 'PENDING' | 'PAUSED';
  highest_bid: number;
  highest_bidder: string | SerializedUser | null;
  expires_at?: string;
  current_server_time?: string;
}

export interface Team {
  user_id: string;
  username: string;
  ready?: boolean;
  budget_remaining: number;
  pokemon?: Pokemon[];
  auctions_won?: Pokemon[];
}

export interface Draft {
  draft_id: string;
  draft_name: string;
  has_password: boolean;
  total_auctions: number;
  host: string;
  ranked: boolean;
  total_teams: number;
  teams: Team[];
  draft_state: DraftState;
  completed_auctions: Auction[];
  current_server_time?: string;
  auction_length: number;
}

export interface ChatMessage {
  chat_id: number;
  draft_id: string;
  user_id: string;
  user_name: string;
  message: string;
  created_at: string;
}

export interface DraftLobby {
  draft_id: string;
  draft_name: string;
  has_password: boolean;
  ranked: boolean;
  teams_joined: number;
  total_teams: number;
  draft_state: DraftState;
}

export interface StatsAuction {
  auction_id: number;
  pokedex_id: number;
  name: string;
  form: string;
  draft_id: string;
  draft_order: number;
  state: string;
  paused_time_remaining: number | null;
  winning_bid: number | null;
  winning_user_id: string | null;
  winning_guest_id: string | null;
  updated_at: string;
  created_at: string;
}

export interface MatchHistoryTeam {
  team_id: number;
  user_id: string | null;
  guest_id: string | null;
  draft_id: string;
  money_remaining: number;
  pokemon_drafted: StatsAuction[];
  placement: number | null;
  pre_match_mmr: number | null;
  updated_at: string;
  created_at: string;
}

export interface StatsPageTeamRow {
  team_id: number;
  user_id: string | null;
  guest_id: string | null;
  draft_id: string;
  money_remaining: number;
  pokemon_drafted: number;
  placement: number | null;
  pre_match_mmr: number | null;
  updated_at: string;
  created_at: string;
}

export interface StatsPagePlayer {
  user_id: string;
  user_name: string;
  is_guest: boolean;
}

export interface StatsPageResponse {
  players: StatsPagePlayer[];
  teams: StatsPageTeamRow[];
  auctions: StatsAuction[];
}
