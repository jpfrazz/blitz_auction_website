import { buildOpponentsByDraftId, getSelectedPlayerIdentityIds } from './opponentLinks';
import type { StatsPagePlayer, StatsPageTeamRow } from '../../types';

const player = (overrides: Partial<StatsPagePlayer> & Pick<StatsPagePlayer, 'user_id' | 'user_name'>): StatsPagePlayer => ({
  global_name: null,
  is_guest: false,
  linked_user_id: null,
  rps_wins: 0,
  rps_losses: 0,
  ...overrides,
});

const team = (overrides: Partial<StatsPageTeamRow> & Pick<StatsPageTeamRow, 'team_id' | 'draft_id'>): StatsPageTeamRow => ({
  user_id: null,
  guest_id: null,
  money_remaining: 0,
  pokemon_drafted: 0,
  placement: null,
  pre_match_mmr: null,
  updated_at: '2026-01-01T00:00:00Z',
  created_at: '2026-01-01T00:00:00Z',
  has_boss_battles: false,
  ...overrides,
});

describe('opponent profile links', () => {
  it('excludes linked guest identities of the selected player', () => {
    const players = [
      player({ user_id: 'alice', user_name: 'alice#1' }),
      player({ user_id: 'guest-alice', user_name: 'AliceGuest', is_guest: true, linked_user_id: 'alice' }),
    ];

    expect(getSelectedPlayerIdentityIds(players[0], players)).toEqual(new Set(['alice', 'guest-alice']));
    expect(getSelectedPlayerIdentityIds(players[1], players)).toEqual(new Set(['alice', 'guest-alice']));
  });

  it('resolves guests to registered profiles, dedupes opponents, and sorts by display name', () => {
    const players = [
      player({ user_id: 'alice', user_name: 'alice#1', global_name: 'Alice' }),
      player({ user_id: 'guest-alice', user_name: 'AliceGuest', is_guest: true, linked_user_id: 'alice' }),
      player({ user_id: 'bob', user_name: 'bob#2', global_name: 'Bob' }),
      player({ user_id: 'guest-bob', user_name: 'BobGuest', is_guest: true, linked_user_id: 'bob' }),
      player({ user_id: 'carol', user_name: 'carol#3', global_name: 'Carol' }),
    ];
    const teams = [
      team({ team_id: 1, draft_id: 'd1', user_id: 'alice' }),
      team({ team_id: 2, draft_id: 'd1', guest_id: 'guest-alice' }),
      team({ team_id: 3, draft_id: 'd1', user_id: 'bob' }),
      team({ team_id: 4, draft_id: 'd1', guest_id: 'guest-bob' }),
      team({ team_id: 5, draft_id: 'd1', user_id: 'carol' }),
    ];

    const identities = getSelectedPlayerIdentityIds(players[0], players);
    const opponents = buildOpponentsByDraftId(teams, players, identities).get('d1');

    expect(opponents).toEqual([
      { teamId: 3, userId: 'bob', name: 'Bob' },
      { teamId: 5, userId: 'carol', name: 'Carol' },
    ]);
  });

  it('falls back to the team id when a player is missing from the stats player list', () => {
    const teams = [
      team({ team_id: 1, draft_id: 'd2', user_id: 'self' }),
      team({ team_id: 2, draft_id: 'd2', user_id: 'unknown-id' }),
    ];

    const opponents = buildOpponentsByDraftId(teams, [], new Set(['self'])).get('d2');

    expect(opponents).toEqual([{ teamId: 2, userId: 'unknown-id', name: 'unknown-id' }]);
  });
});
