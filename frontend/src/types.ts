// Global types for the frontend

export interface Pokemon {
  id: number;
  pokedex_id?: number;
  name: string;
  type1?: string;
  type2?: string;
  ability?: string;
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
  description?: string;
  form?: string;
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
  budget_remaining: number;
  pokemon: Pokemon[];
  auctions_won?: Pokemon[];
}

export interface Draft {
  draft_id: string;
  host: string;
  teams: Team[];
  draft_state: DraftState;
  completed_auctions: Auction[];
  current_auction: Auction | null;
  current_auction_expires_at?: string;
  pokemon: Pokemon[];
  patch_version: string;
}
