import type {
  Pokemon,
  StatsAuction,
  StatsPagePlayer,
  StatsPageTeamRow,
  WinningRace,
  WinningRunKoSample,
} from '../../types';
import { buildRunStatLineage, type RunStatLineage } from '../../utils/runStatLineage';
import {
  computeAverageKosByPokemonKey,
  computeWinOpportunitiesByPokemonKey,
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
  has_boss_battles: true,
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
  ...overrides,
});

const iconsBySpecies: Record<number, string[]> = {
  4: ['charmander'],
  98: ['wooper', 'wooper-paldea'],
  311: ['plusle'],
  312: ['minun'],
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

test('averages Aegislash form KOs onto a drafted Honedge row', () => {
  const aegislashCatalog: Pokemon[] = [
    { id: 679, pokedex_id: 679, name: 'Honedge' },
    { id: 680, pokedex_id: 680, name: 'Doublade', evolves_from_id: '679' },
    {
      id: 681,
      pokedex_id: 681,
      name: 'Aegislash-Shield',
      form: 'Shield',
      evolves_from_id: '680',
    },
    {
      id: 681,
      pokedex_id: 681,
      name: 'Aegislash-Blade',
      form: 'Blade',
      evolves_from_id: '680',
    },
  ];
  const aegislashLineage = buildRunStatLineage(aegislashCatalog);

  const result = computeAverageKosByPokemonKey(
    [
      sample({ species_id: 681, ko_count: 12 }),
      sample({ species_id: 1156, ko_count: 18 }),
    ],
    [auction({ auction_id: 1, name: 'Honedge', pokedex_id: 679, winning_user_id: 'user-1' })],
    [team({ team_id: 1, user_id: 'user-1' })],
    [] as StatsPagePlayer[],
    aegislashLineage,
  );

  expect(result.get('Honedge')).toBe(30);
  expect(result.size).toBe(1);
});

test('attributes Cursola KOs to a drafted Corsola-Galar', () => {
  const corsolaCatalog: Pokemon[] = [
    { id: 222, pokedex_id: 222, name: 'Corsola' },
    {
      id: 222,
      pokedex_id: 222,
      name: 'Corsola',
      form: 'Galar',
      evolves_from_id: '222',
    },
    {
      id: 864,
      pokedex_id: 864,
      name: 'Cursola',
      evolves_from_id: '222',
      evolves_from_form: 'Galar',
    },
  ];
  const corsolaLineage = buildRunStatLineage(corsolaCatalog);

  const result = computeAverageKosByPokemonKey(
    [sample({ species_id: 864, ko_count: 23 })],
    [
      auction({
        auction_id: 1,
        name: 'Corsola',
        form: 'Galar',
        pokedex_id: 222,
        winning_user_id: 'user-1',
      }),
    ],
    [team({ team_id: 1, user_id: 'user-1' })],
    [] as StatsPagePlayer[],
    corsolaLineage,
  );

  expect(result.get('Corsola-Galar')).toBe(23);
  expect(result.size).toBe(1);
});

test('sums Plusle and Minun KOs for the combined draft pick', () => {
  const result = computeAverageKosByPokemonKey(
    [
      sample({ species_id: 311, ko_count: 7 }),
      sample({ species_id: 312, ko_count: 5 }),
    ],
    [auction({ auction_id: 1, name: 'Plusle and Minun', pokedex_id: 311, winning_user_id: 'user-1' })],
    [team({ team_id: 1, user_id: 'user-1' })],
    [] as StatsPagePlayer[],
    lineage,
  );

  expect(result.get('Plusle and Minun')).toBe(12);
  expect(result.size).toBe(1);
});

test('counts one win per valid auction or non-casual 1v1 race where the Pokémon was drafted', () => {
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
    race({ team_id: 3, draft_id: 'draft-casual', user_id: 'user-1' }),
    race({
      team_id: 4,
      draft_id: 'draft-3',
      user_id: 'user-2',
      draft_type: '1v1',
    }),
    race({
      team_id: 5,
      draft_id: 'draft-4',
      user_id: 'user-2',
      draft_type: '1v1',
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

test('counts a valid unranked auction using the existing validDraftIds determination', () => {
  const result = computeWinningPicksByPokemonKey(
    [race({ team_id: 2, draft_id: 'draft-unranked', user_id: 'user-1' })],
    [auction({ auction_id: 1, draft_id: 'draft-unranked', winning_user_id: 'user-1' })],
    [team({ team_id: 2, draft_id: 'draft-unranked', user_id: 'user-1', ranked: false })],
    [] as StatsPagePlayer[],
    new Set(['draft-unranked']),
    new Set<string>(),
  );

  expect(result.get('Charmander')).toBe(1);
});

test('deduplicates one Pokémon per race and resolves linked guest owners', () => {
  const players: StatsPagePlayer[] = [
    {
      user_id: 'user-1',
      user_name: 'Player',
      global_name: null,
      is_guest: false,
      linked_user_id: null,
      rps_wins: 0,
      rps_losses: 0,
    },
    {
      user_id: 'guest-a',
      user_name: 'Guest',
      global_name: null,
      is_guest: true,
      linked_user_id: 'user-1',
      rps_wins: 0,
      rps_losses: 0,
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

test('counts one win chance per valid race that has boss battle data', () => {
  const auctions = [
    auction({ auction_id: 1, draft_id: 'draft-1', winning_user_id: 'user-1' }),
    auction({ auction_id: 2, draft_id: 'draft-2', winning_user_id: 'user-1' }),
    auction({ auction_id: 3, draft_id: 'draft-casual', winning_user_id: 'user-1' }),
    auction({ auction_id: 4, draft_id: 'draft-no-boss', winning_user_id: 'user-1' }),
    auction({
      auction_id: 5,
      draft_id: 'draft-3',
      draft_type: '1v1',
      winning_bid: null,
      action: 'PICK',
      winning_user_id: 'user-2',
    }),
    auction({
      auction_id: 6,
      draft_id: 'draft-4',
      draft_type: '1v1',
      winning_bid: null,
      action: 'PICK',
      winning_user_id: 'user-2',
    }),
    auction({
      auction_id: 7,
      draft_id: 'draft-3',
      draft_type: '1v1',
      winning_bid: null,
      action: 'BAN',
      winning_user_id: 'user-2',
    }),
    auction({
      auction_id: 8,
      draft_id: 'draft-1',
      name: 'Egg',
      pokedex_id: 1573,
      winning_user_id: 'user-1',
    }),
  ];

  const teams = [
    team({ team_id: 1, draft_id: 'draft-1', user_id: 'user-1' }),
    team({ team_id: 2, draft_id: 'draft-2', user_id: 'user-1' }),
    team({ team_id: 3, draft_id: 'draft-casual', user_id: 'user-1' }),
    team({ team_id: 4, draft_id: 'draft-no-boss', user_id: 'user-1', has_boss_battles: false }),
    team({ team_id: 5, draft_id: 'draft-3', user_id: 'user-2', draft_type: '1v1' }),
    team({ team_id: 6, draft_id: 'draft-4', user_id: 'user-2', draft_type: '1v1' }),
  ];

  const result = computeWinOpportunitiesByPokemonKey(
    teams,
    auctions,
    [] as StatsPagePlayer[],
    new Set(['draft-1', 'draft-2', 'draft-no-boss']),
    new Set(['draft-4']),
  );

  // draft-1 auction, draft-2 auction, and the non-casual 1v1 draft-3.
  expect(result.get('Charmander')).toBe(3);
  expect(result.get('Egg')).toBe(1);
  expect(result.size).toBe(2);
});

test('dedupes linked guest picks and forms when counting win chances', () => {
  const players: StatsPagePlayer[] = [
    {
      user_id: 'user-1',
      user_name: 'Player',
      global_name: null,
      is_guest: false,
      linked_user_id: null,
      rps_wins: 0,
      rps_losses: 0,
    },
    {
      user_id: 'guest-a',
      user_name: 'Guest',
      global_name: null,
      is_guest: true,
      linked_user_id: 'user-1',
      rps_wins: 0,
      rps_losses: 0,
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
      winning_user_id: null,
      winning_guest_id: 'guest-a',
    }),
    auction({
      auction_id: 3,
      draft_id: 'draft-1',
      winning_user_id: 'user-2',
    }),
  ];

  const result = computeWinOpportunitiesByPokemonKey(
    [team({ team_id: 1, user_id: 'user-1' })],
    auctions,
    players,
    new Set(['draft-1']),
    new Set<string>(),
  );

  expect(result.get('Wooper-Paldea')).toBe(1);
  expect(result.size).toBe(1);
});
