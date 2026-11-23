import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import PokemonWinHistoryTable from './PokemonWinHistoryTable';
import type {
  StatsAuction,
  StatsPagePlayer,
  StatsPageResponse,
  StatsPageTeamRow,
} from '../../types';
import type { RunStatLineage } from '../../utils/runStatLineage';

const player = (user_id: string, user_name: string): StatsPagePlayer => ({
  user_id,
  user_name,
  global_name: null,
  is_guest: false,
  linked_user_id: null,
  rps_wins: 0,
  rps_losses: 0,
});

const team = (overrides: Partial<StatsPageTeamRow>): StatsPageTeamRow => ({
  team_id: 1,
  user_id: 'u1',
  guest_id: null,
  draft_id: 'd1',
  money_remaining: 0,
  pokemon_drafted: 1,
  placement: null,
  pre_match_mmr: null,
  updated_at: '2026-01-01T00:00:00Z',
  created_at: '2026-01-01T00:00:00Z',
  draft_type: 'auction',
  has_boss_battles: true,
  ...overrides,
});

const auction = (overrides: Partial<StatsAuction>): StatsAuction => ({
  auction_id: 1,
  pokedex_id: 4,
  name: 'Charmander',
  form: '',
  draft_id: 'd1',
  draft_order: 1,
  state: 'COMPLETED',
  paused_time_remaining: null,
  winning_bid: 2000,
  winning_user_id: 'u1',
  winning_guest_id: null,
  updated_at: '2026-01-01T00:00:00Z',
  created_at: '2026-01-01T00:00:00Z',
  draft_type: 'auction',
  season: 1,
  action: null,
  ...overrides,
} as StatsAuction);

const stats: StatsPageResponse = {
  players: [player('u1', 'Alice'), player('u2', 'Bob')],
  teams: [
    team({
      team_id: 1,
      draft_id: 'd1',
      user_id: 'u1',
      draft_type: 'auction',
      created_at: '2026-01-01T00:00:00Z',
    }),
    team({
      team_id: 2,
      draft_id: 'd2',
      user_id: 'u2',
      draft_type: '1v1',
      created_at: '2026-02-01T00:00:00Z',
    }),
  ],
  auctions: [
    auction({
      auction_id: 1,
      draft_id: 'd1',
      winning_user_id: 'u1',
      created_at: '2026-01-01T00:00:00Z',
    }),
    auction({
      auction_id: 2,
      draft_id: 'd2',
      draft_type: '1v1',
      winning_bid: null,
      action: 'PICK',
      winning_user_id: 'u2',
      created_at: '2026-02-01T00:00:00Z',
    }),
  ],
  legacy: [],
  winning_run_kos: [
    {
      team_id: 1,
      draft_id: 'd1',
      user_id: 'u1',
      guest_id: null,
      draft_type: 'auction',
      species_id: 4,
      ko_count: 3,
    },
    {
      team_id: 2,
      draft_id: 'd2',
      user_id: 'u2',
      guest_id: null,
      draft_type: '1v1',
      species_id: 4,
      ko_count: 9,
    },
  ],
  winning_races: [
    {
      team_id: 1,
      draft_id: 'd1',
      user_id: 'u1',
      guest_id: null,
      draft_type: 'auction',
    },
    {
      team_id: 2,
      draft_id: 'd2',
      user_id: 'u2',
      guest_id: null,
      draft_type: '1v1',
    },
  ],
};

const lineage = {
  getIcons: (speciesId: number) => (speciesId === 4 ? ['charmander'] : []),
} as RunStatLineage;

test('sorts win history by every clickable column', () => {
  render(
    <PokemonWinHistoryTable
      pokemonKey="Charmander"
      pokemonName="Charmander"
      stats={stats}
      validDraftIds={new Set(['d1'])}
      casualOneVOneDraftIds={new Set<string>()}
      runStatLineage={lineage}
    />,
  );

  const visibleRows = () => Array.from(document.querySelectorAll('.win-history-row'))
    .map((row) => row.textContent ?? '');
  const clickHeader = (name: RegExp) => fireEvent.click(screen.getByRole('button', { name }));

  // Newest draft first by default: Bob's February 1v1 run.
  expect(visibleRows()).toHaveLength(2);
  expect(visibleRows()[0]).toContain('Bob');
  expect(visibleRows()[0]).toContain('1v1');
  expect(visibleRows()[0]).toContain('9');

  clickHeader(/^Player/);
  expect(visibleRows()[0]).toContain('Alice');
  clickHeader(/^Player/);
  expect(visibleRows()[0]).toContain('Bob');

  clickHeader(/^Type/);
  expect(visibleRows()[0]).toContain('1v1');
  clickHeader(/^Type/);
  expect(visibleRows()[0]).toContain('Auction');

  clickHeader(/^KOs/);
  expect(visibleRows()[0]).toContain('9');
  clickHeader(/^KOs/);
  expect(visibleRows()[0]).toContain('3');

  clickHeader(/^Date/);
  expect(visibleRows()[0]).toContain('Bob');
  clickHeader(/^Date/);
  expect(visibleRows()[0]).toContain('Alice');
});
