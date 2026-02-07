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
    specialAttack: number;
    specialDefense: number;
    speed: number;
  };
  description?: string;
  form?: string;
}

// Types for draft data
export type DraftState = 'PENDING' | 'BIDDING' | 'PAUSED' | 'COMPLETED' | { BIDDING: number } | { PAUSED: number };

export interface Auction {
  auction_id: string;
  pokemon: Pokemon;
  status: 'BIDDING' | 'COMPLETED' | 'PENDING';
  highest_bid: number;
  highest_bidder: string;
  expires_at?: string;
}

export interface Team {
  user_id: string;
  money: number;
  pokemon: Pokemon[];
}

export interface Draft {
  draft_id: string;
  host: string;
  teams: Team[];
  draft_state: DraftState;
  completed_auctions: Auction[];
  current_auction: Auction | null;
  pokemon: Pokemon[];
  patch_version: string;
}
