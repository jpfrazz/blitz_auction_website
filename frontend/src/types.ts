// Global types for the frontend

export interface Pokemon {
  id: number;
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

// Types for stubbed draft data
export type DraftState = 'PENDING' | 'SELECTING' | 'BIDDING' | { PAUSED: number } | 'COMPLETED';

export interface DraftSettings {
  num_players: number;
  starting_money: number;
  pokemon_ids: number[];
  patch_version: string;
}

export interface Auction {
  auction_id: number;
  pokemon: {
    pokedex_id: number;
    name: string;
    form: string;
  };
  status: 'BIDDING' | 'COMPLETED' | 'PENDING';
  highest_bid: number;
  highest_bidder: string;
  expires_at?: string;
}

export interface Draft {
  draft_id: string;
  host: string;
  state: DraftState;
  settings: DraftSettings;
  current_auction: Auction;
  completed_auctions: Auction[];
  players: string[];
  spectators: string[];
}
