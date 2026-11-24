import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import SeenItAllProgressPanel from './SeenItAllProgressPanel';
import { fetchBossBattleHistory, fetchMatchHistoryByUserId, fetchStatsPageData } from '../../shared/api/stats';
import { fetchAdminDiscordUsers } from '../../shared/api/users';
import { fetchManualAchievements } from '../../shared/api/achievements';
import { AdminDiscordUser, MatchHistoryTeam, StatsPageResponse } from '../../types';

jest.mock('../../shared/api/stats', () => ({
  fetchStatsPageData: jest.fn(),
  fetchMatchHistoryByUserId: jest.fn(),
  fetchBossBattleHistory: jest.fn(),
}));

jest.mock('../../shared/api/users', () => ({
  fetchAdminDiscordUsers: jest.fn(),
}));

jest.mock('../../shared/api/achievements', () => ({
  fetchManualAchievements: jest.fn(),
}));

const stats: StatsPageResponse = {
  players: [],
  teams: [],
  auctions: [],
  legacy: [],
  winning_run_kos: [],
  winning_races: [],
};

const user: AdminDiscordUser = {
  user_id: 'user-1',
  user_name: 'speedrunner',
  discriminator: '0',
  global_name: 'Speed Runner',
  avatar: null,
  wins: 1,
  losses: 0,
  mmr: 1000,
  updated_at: '2026-04-15T00:00:00Z',
  created_at: '2026-04-15T00:00:00Z',
};

const team = (teamId: number, draftId: string): MatchHistoryTeam => ({
  team_id: teamId,
  user_id: 'user-1',
  guest_id: null,
  draft_id: draftId,
  ranked: false,
  draft_type: 'auction',
  team_count: 8,
  money_remaining: 0,
  pokemon_drafted: [],
  placement: null,
  pre_match_mmr: null,
  updated_at: '2026-04-15T00:00:00Z',
  created_at: '2026-04-15T00:00:00Z',
});

describe('SeenItAllProgressPanel', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (fetchStatsPageData as jest.Mock).mockResolvedValue(stats);
    (fetchAdminDiscordUsers as jest.Mock).mockResolvedValue([user]);
    (fetchMatchHistoryByUserId as jest.Mock).mockResolvedValue([
      team(1, 'draft-1'),
      team(2, 'draft-2'),
    ]);
    (fetchBossBattleHistory as jest.Mock).mockImplementation(async (draftId: string) => (
      draftId === 'draft-1'
        ? [{ trainer_id: 265, version: 1, hours: 0, minutes: 1, seconds: 0, is_loss: false }]
        : [{ trainer_id: 804, version: null, hours: 0, minutes: 2, seconds: 0, is_loss: false }]
    ));
    (fetchManualAchievements as jest.Mock).mockResolvedValue([]);
  });

  const selectUser = async () => {
    render(<SeenItAllProgressPanel />);
    fireEvent.change(await screen.findByPlaceholderText('Search users by name or Discord ID...'), {
      target: { value: 'speed' },
    });
    fireEvent.click(await screen.findByText('Speed Runner'));
  };

  it('shows the selected user\'s faced and missing boss trainers', async () => {
    await selectUser();

    await waitFor(() => {
      expect(document.querySelector('.admin-seen-it-all-count')?.textContent).toContain('2 / 84 boss trainers faced');
    });
    expect(screen.getByText('Not earned')).toBeTruthy();
    expect(screen.getByText('✓ Roxanne')).toBeTruthy();
    expect(screen.getByText('✓ Steven')).toBeTruthy();
    expect(screen.getAllByText(/– /).length).toBeGreaterThan(0);
    expect(fetchBossBattleHistory).toHaveBeenCalledTimes(2);
  });

  it('shows when a manual override drives the earned state', async () => {
    (fetchManualAchievements as jest.Mock).mockResolvedValue([
      { achievement_id: 'seen-it-all', earned: true },
    ]);

    await selectUser();

    expect(await screen.findByText(/manually granted/)).toBeTruthy();
    expect(screen.getByText('Earned')).toBeTruthy();
  });
});
