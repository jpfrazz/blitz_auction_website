import type { RunStatLineage } from '../../utils/runStatLineage';
import type {
  StatsAuction,
  StatsPagePlayer,
  StatsPageTeamRow,
  WinningRunKoSample,
} from '../../types';
import { computeAverageKosByPokemonKey } from './costBreakdownKos';

const auction = (overrides: Partial<StatsAuction>): StatsAuction => ({
  auction_id: 1,
  pokedex_id: 4,
  name: 'Charmander',
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

const team = (overrides: Partial<StatsPageTeamRow>): StatsPageTeamRow => ({
  team_id: 1,
  user_id: 'user-1',
  guest_id: null,
  draft_id: 'draft-1',
  money_remaining: 0,
  pokemon_drafted: 1,
  placement: null,
  pre_match_mmr: null,
  updated_at: '2026-01-01T00:00:00Z',
  created_at: '2026-01-01T00:00:00Z',
  draft_type: 'auction',
  season: 1,
  has_save: true,
  ...overrides,
} as StatsPageTeamRow);

const sample = (overrides: Partial<WinningRunKoSample>): WinningRunKoSample => ({
  team_id: 1,
  draft_id: 'draft-1',
  user_id: 'user-1',
  guest_id: null,
  draft_type: 'auction',
  species_id: 4,
  ko_count: 10,
  ...overrides,
});

const lineage = { getIcons: () => ['charmander'] } as RunStatLineage;

test('averages profile-chart KOs from winning auction and 1v1 runs only', () => {
  const auctions = [
    auction({ auction_id: 1, draft_id: 'draft-1', winning_user_id: 'user-1' }),
    auction({ auction_id: 2, draft_id: 'draft-2', winning_user_id: 'user-1' }),
    auction({
      auction_id: 3,
      draft_id: 'draft-3',
      draft_type: '1v1',
      winning_bid: null,
      action: 'PICK',
      winning_user_id: 'user-2',
    }),
    // A ban is not a drafted pick and must not receive KOs.
    auction({
      auction_id: 4,
      draft_id: 'draft-3',
      draft_type: '1v1',
      winning_bid: null,
      action: 'BAN',
      winning_user_id: 'user-2',
    }),
  ];

  const teams = [
    team({ team_id: 1, draft_id: 'draft-1', user_id: 'user-1' }),
    team({ team_id: 2, draft_id: 'draft-2', user_id: 'user-1' }),
    team({ team_id: 3, draft_id: 'draft-3', user_id: 'user-2', draft_type: '1v1' }),
  ];

  const samples = [
    sample({ team_id: 1, ko_count: 10 }),
    sample({ team_id: 2, ko_count: 20 }),
    sample({
      team_id: 3,
      draft_id: 'draft-3',
      draft_type: '1v1',
      user_id: 'user-2',
      ko_count: 30,
    }),
    // Belongs to a team that did not draft this Pokémon.
    sample({ team_id: 4, draft_id: 'draft-4', user_id: 'user-3', ko_count: 100 }),
  ];

  const result = computeAverageKosByPokemonKey(
    samples,
    auctions,
    teams,
    [] as StatsPagePlayer[],
    lineage,
  );

  expect(result.get('Charmander')).toBe(20);
  expect(result.size).toBe(1);
});
