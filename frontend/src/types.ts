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
