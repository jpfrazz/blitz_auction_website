import { Draft } from "../../types";

// Create a static expiration time that doesn't change on each call
const auctionStartTime = Date.now();
const auctionExpiresAt = new Date(auctionStartTime + 10000).toISOString();

// Stub for fetching a draft by id
export async function fetchDraftById(draft_id: string): Promise<Draft> {
  // Simulate network delay
  await new Promise(res => setTimeout(res, 300));
  return {
    draft_id,
    host: 'Ash',
    state: 'PENDING',
    settings: {
      num_players: 8,
      starting_money: 20000,
      pokemon_ids: [1, 4, 7, 25, 133],
      patch_version: 'v1.0',
    },
    current_auction: {
      auction_id: 3,
      pokemon: {
        pokedex_id: 1,
        name: 'Bulbasaur',
        form: 'Base',
      },
      status: 'BIDDING',
      highest_bid: 3500,
      highest_bidder: 'Ash',
      expires_at: auctionExpiresAt,
    },
    completed_auctions: [
      {
        auction_id: 1,
        pokemon: {
          pokedex_id: 4,
          name: 'Charmander',
          form: 'Base',
        },
        status: 'COMPLETED',
        highest_bid: 2000,
        highest_bidder: 'Misty',
      },
      {
        auction_id: 2,
        pokemon: {
          pokedex_id: 7,
          name: 'Squirtle',
          form: 'Base',
        },
        status: 'COMPLETED',
        highest_bid: 1800,
        highest_bidder: 'Brock',
      },
    ],
    players: ['Ash', 'Misty', 'Brock'],
    spectators: [],
  };
}
