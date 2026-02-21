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
  mega?: string;
  is_baby?: boolean;
}

export interface KeyMove {
  move_name: string;
  learn_method: string;
}

export type SerializedUser =
  | { GuestUser: { user_id: string; user_name: string } }
  | { DiscordUser: { user_id: string; user_name: string } };

// Types for draft data
export type DraftState = 'PENDING' | 'BIDDING' | 'PAUSED' | 'COMPLETED' | { BIDDING: number } | { PAUSED: number };

export interface Auction {
  auction_id: string;
  pokemon: Pokemon;
  status: 'BIDDING' | 'COMPLETED' | 'PENDING';
  highest_bid: number;
  highest_bidder: string | SerializedUser | null;
  expires_at?: string;
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
  host: string;
  ranked: boolean;
  total_teams: number;
  teams: Team[];
  draft_state: DraftState;
  completed_auctions: Auction[];
  current_auction: Auction | null;
  current_auction_expires_at?: string;
  pokemon: Pokemon[];
  patch_version: string;
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
