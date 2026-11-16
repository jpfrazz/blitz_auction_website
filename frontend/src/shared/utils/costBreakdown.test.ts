import { StatsAuction } from '../../types';
import { computeCostBreakdown } from './costBreakdown';

const sale = (overrides: Partial<StatsAuction>): StatsAuction => ({
  auction_id: 1,
  pokedex_id: 263,
  name: 'Zigzagoon',
  form: '',
  draft_id: 'draft-1',
  draft_order: 1,
  state: 'COMPLETED',
  paused_time_remaining: null,
  winning_bid: 2000,
  winning_user_id: 'user-1',
  winning_guest_id: null,
  updated_at: '2026-01-01T00:00:00Z',
  created_at: '2026-01-01T00:00:00Z',
  draft_type: 'auction',
  season: 1,
  action: 'PICK',
  ...overrides,
} as StatsAuction);

test('merges bare Zigzagoon rows and legacy costs into the Galar aggregate', () => {
  const result = computeCostBreakdown({
    auctions: [
      sale({ auction_id: 1, name: 'Zigzagoon', form: '', winning_bid: 2000 }),
      sale({ auction_id: 2, name: 'Zigzagoon', form: 'Galar', winning_bid: 4000 }),
    ],
    legacy: [{ pokemon: 'Zigzagoon', cost: '3000', date: '2026-01-01T00:00:00Z' }],
  });

  expect(result).toHaveLength(1);
  expect(result[0]).toMatchObject({
    key: 'Zigzagoon-Galar',
    name: 'Zigzagoon',
    form: 'Galar',
    bidsWon: 3,
    totalSpend: 9000,
    avgWinningBid: 3000,
  });
});
