import type { RunStatLineage } from '../../utils/runStatLineage';
import type {
  StatsAuction,
  StatsPagePlayer,
  StatsPageTeamRow,
  WinningRace,
  WinningRunKoSample,
} from '../../types';
import {
  computeAverageKosByPokemonKey,
  computeWinningPicksByPokemonKey,
} from './costBreakdownKos';

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
  action: null,
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
  ranked: true,
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

const race = (overrides: Partial<WinningRace>): WinningRace => ({
  team_id: 1,
  draft_id: 'draft-1',
  user_id: 'user-1',
  guest_id: null,
  draft_type: 'auction',
  ranked: true,
  ...overrides,
});

const iconsBySpecies: Record<number, string[]> = {
  4: ['charmander'],
  98: ['wooper', 'wooper-paldea'],
  468: ['togekiss', 'togetic', 'togepi'],
  1573: ['egg'],
};
const lineage = {
  getIcons: (speciesId: number) => iconsBySpecies[speciesId] ?? [],
} as RunStatLineage;

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

test('attributes an evolved egg hatch to the Egg row instead of the hatch species', () => {
  const result = computeAverageKosByPokemonKey(
    [sample({ species_id: 468, ko_count: 31 })],
    [auction({ name: 'Egg', pokedex_id: 1573, winning_user_id: 'user-1' })],
    [team({ team_id: 1, user_id: 'user-1' })],
    [] as StatsPagePlayer[],
    lineage,
  );

  expect(result.get('Egg')).toBe(31);
  expect(result.has('Togepi')).toBe(false);
  expect(result.size).toBe(1);
});

test('counts one win per non-casual winning race where the Pokémon was drafted', () => {
  const auctions = [
    auction({ auction_id: 1, draft_id: 'draft-1', winning_user_id: 'user-1' }),
    auction({ auction_id: 2, draft_id: 'draft-2', winning_user_id: 'user-1' }),
    auction({
      auction_id: 3,
      draft_id: 'draft-casual',
      winning_user_id: 'user-1',
    }),
    auction({
      auction_id: 4,
      draft_id: 'draft-1',
      name: 'Egg',
      pokedex_id: 1573,
      winning_user_id: 'user-1',
    }),
    auction({
      auction_id: 5,
      draft_id: 'draft-3',
      draft_type: '1v1',
      winning_bid: null,
      action: 'PICK',
      winning_user_id: 'user-2',
    }),
    // Bans are not picks.
    auction({
      auction_id: 6,
      draft_id: 'draft-3',
      draft_type: '1v1',
      winning_bid: null,
      action: 'BAN',
      winning_user_id: 'user-2',
    }),
    auction({
      auction_id: 7,
      draft_id: 'draft-4',
      draft_type: '1v1',
      winning_bid: null,
      action: 'PICK',
      winning_user_id: 'user-2',
    }),
  ];

  const teams = [
    team({ team_id: 1, draft_id: 'draft-1', user_id: 'user-1' }),
    team({ team_id: 2, draft_id: 'draft-2', user_id: 'user-1' }),
    team({ team_id: 3, draft_id: 'draft-casual', user_id: 'user-1', ranked: false }),
    team({ team_id: 4, draft_id: 'draft-3', user_id: 'user-2', draft_type: '1v1' }),
    team({ team_id: 5, draft_id: 'draft-4', user_id: 'user-2', draft_type: '1v1' }),
  ];

  const races = [
    race({ team_id: 1, draft_id: 'draft-1', user_id: 'user-1' }),
    race({ team_id: 2, draft_id: 'draft-2', user_id: 'user-1' }),
    race({ team_id: 3, draft_id: 'draft-casual', user_id: 'user-1', ranked: false }),
    race({
      team_id: 4,
      draft_id: 'draft-3',
      user_id: 'user-2',
      draft_type: '1v1',
      ranked: false,
    }),
    race({
      team_id: 5,
      draft_id: 'draft-4',
      user_id: 'user-2',
      draft_type: '1v1',
      ranked: false,
    }),
  ];

  const result = computeWinningPicksByPokemonKey(
    races,
    auctions,
    teams,
    [] as StatsPagePlayer[],
    new Set(['draft-1', 'draft-2']),
    new Set(['draft-4']),
  );

  expect(result.get('Charmander')).toBe(3);
  expect(result.get('Egg')).toBe(1);
  expect(result.has('Togepi')).toBe(false);
  expect(result.size).toBe(2);
});

test('deduplicates one Pokémon per race and resolves linked guest owners', () => {
  const players: StatsPagePlayer[] = [
    {
      user_id: 'user-1',
      user_name: 'Player',
      global_name: null,
      is_guest: false,
      linked_user_id: null,
    },
    {
      user_id: 'guest-a',
      user_name: 'Guest',
      global_name: null,
      is_guest: true,
      linked_user_id: 'user-1',
    },
  ];
  const auctions = [
    auction({
      auction_id: 1,
      draft_id: 'draft-1',
      name: 'Wooper',
      pokedex_id: 194,
      winning_user_id: null,
      winning_guest_id: 'guest-a',
    }),
    auction({
      auction_id: 2,
      draft_id: 'draft-1',
      name: 'Wooper',
      form: 'Paldea',
      pokedex_id: 194,
      winning_bid: 1500,
      winning_user_id: null,
      winning_guest_id: 'guest-a',
    }),
    // Drafted by someone who wasn't on the winning team.
    auction({
      auction_id: 3,
      draft_id: 'draft-1',
      winning_bid: 1500,
      winning_user_id: 'user-2',
    }),
  ];

  const result = computeWinningPicksByPokemonKey(
    [race({ team_id: 1, user_id: 'user-1' })],
    auctions,
    [team({ team_id: 1, user_id: 'user-1' })],
    players,
    new Set(['draft-1']),
    new Set<string>(),
  );

  expect(result.get('Wooper-Paldea')).toBe(1);
  expect(result.size).toBe(1);
});
