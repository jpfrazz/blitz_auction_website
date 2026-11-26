import React from 'react';
import { render, screen } from '@testing-library/react';
import BoosterInfoPanel from './BoosterInfoPanel';

const boosterState = (warded: boolean) => ({
  player_ids: ['p1', 'p2', 'p3', 'p4'],
  packs: [],
  submissions: ['p1', 'p2', 'p3', 'p4'].map((userId) => ({
    user_id: userId,
    has_picked: true,
    has_banned: true,
    has_warded: warded,
  })),
  round: 1,
  total_rounds: 8,
  bans_enabled: true,
  wards_enabled: true,
  team_size: 8,
  casual: false,
  history: [],
});

const renderPanel = (warded: boolean) => {
  const { container } = render(
    <BoosterInfoPanel
      booster={boosterState(warded) as any}
      currentUserId="p1"
      hasPack
      canConfirm={false}
      onConfirm={() => {}}
    />,
  );
  return container;
};

describe('BoosterInfoPanel', () => {
  test('shows ward readiness and includes wards in the pass progress', () => {
    const container = renderPanel(false);

    expect(screen.getByText('Picks ready: 4/4')).toBeTruthy();
    expect(screen.getByText('Bans ready: 4/4')).toBeTruthy();
    expect(screen.getByText('Wards ready: 0/4')).toBeTruthy();
    expect((container.querySelector('.countdown-bar-progress') as HTMLElement).style.width).toBe('67%');
  });

  test('fills the progress bar once every pick, ban and ward is ready', () => {
    const container = renderPanel(true);

    expect(screen.getByText('Wards ready: 4/4')).toBeTruthy();
    expect((container.querySelector('.countdown-bar-progress') as HTMLElement).style.width).toBe('100%');
  });
});
