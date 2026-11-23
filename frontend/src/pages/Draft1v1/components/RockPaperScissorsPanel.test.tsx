import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import RockPaperScissorsPanel from './RockPaperScissorsPanel';
import { RockPaperScissorsState, Team } from '../../../types';

const teams: Team[] = [
  { user_id: 'host-1', username: 'Host', budget_remaining: 0 },
  { user_id: 'guest-2', username: 'Opponent', budget_remaining: 0 },
];

const baseRps: RockPaperScissorsState = {
  host: 'host-1',
  opponent: 'guest-2',
  round: 1,
  host_ready: false,
  opponent_ready: false,
  last_round: null,
  winner: null,
  first_pick: null,
};

const renderPanel = (
  rps: RockPaperScissorsState,
  currentUserId: string | null = 'host-1',
  overrides: Partial<React.ComponentProps<typeof RockPaperScissorsPanel>> = {},
) =>
  render(
    <RockPaperScissorsPanel
      rps={rps}
      teams={teams}
      currentUserId={currentUserId}
      isBusy={false}
      onPick={jest.fn()}
      onChooseFirstPick={jest.fn()}
      {...overrides}
    />,
  );

test('renders both tile rows, large move labels, and no status text', () => {
  const { container } = renderPanel(baseRps);

  expect(container.querySelector('.rps-tile-grid')).toBeTruthy();
  expect(container.querySelector('.rps-face-down-row')).toBeTruthy();
  expect(container.querySelector('.rps-battle')).toBeNull();

  expect(container.querySelectorAll('.rps-face-down-tile')).toHaveLength(3);
  const tiles = container.querySelectorAll('.rps-tile-grid .rps-tile');
  expect(tiles).toHaveLength(3);
  expect(tiles[0].classList.contains('rps-rock')).toBe(true);
  expect(tiles[1].classList.contains('rps-paper')).toBe(true);
  expect(tiles[2].classList.contains('rps-scissors')).toBe(true);
  expect(screen.getByAltText('Rock').getAttribute('src')).toBe('/generic/Rock.png');
  expect(screen.getByAltText('Paper').getAttribute('src')).toBe('/generic/Paper.png');
  expect(screen.getByAltText('Scissors').getAttribute('src')).toBe('/generic/Scissors.png');
  expect(screen.getByText('Rock')).toBeTruthy();
  expect(screen.getByText('Paper')).toBeTruthy();
  expect(screen.getByText('Scissors')).toBeTruthy();

  expect(screen.queryByText(/round\s*\d+/i)).toBeNull();
  expect(screen.queryByText(/pick your move/i)).toBeNull();
  expect(screen.queryByText(/locked in|choosing\.\.\./i)).toBeNull();
  expect(screen.queryByText(/hidden until/i)).toBeNull();
  expect(screen.queryByText(/^vs$/i)).toBeNull();
  expect(screen.queryByText(/playing again/i)).toBeNull();
});

test('re-clicking a tile unselects it and clicking another swaps the provisional pick', () => {
  const onPick = jest.fn().mockResolvedValue({});
  const { container } = renderPanel(baseRps, 'host-1', { onPick });

  const rock = screen.getByRole('button', { name: 'Rock' });
  const paper = screen.getByRole('button', { name: 'Paper' });
  const scissors = screen.getByRole('button', { name: 'Scissors' });

  fireEvent.click(paper);
  expect(onPick).toHaveBeenLastCalledWith('Paper');
  expect(paper.getAttribute('aria-pressed')).toBe('true');
  expect(container.querySelectorAll('.rps-tile-grid .rps-muted')).toHaveLength(2);

  fireEvent.click(paper);
  expect(onPick).toHaveBeenLastCalledWith(null);
  expect(paper.getAttribute('aria-pressed')).toBe('false');
  expect(container.querySelectorAll('.rps-tile-grid .rps-muted')).toHaveLength(0);

  fireEvent.click(rock);
  expect(onPick).toHaveBeenLastCalledWith('Rock');
  fireEvent.click(scissors);
  expect(onPick).toHaveBeenLastCalledWith('Scissors');
  expect(scissors.getAttribute('aria-pressed')).toBe('true');
  expect(rock.getAttribute('aria-pressed')).toBe('false');
});

test('tie reveals in place, bonks, then returns to choosing without a cutaway', () => {
  jest.useFakeTimers();
  const tied: RockPaperScissorsState = {
    ...baseRps,
    round: 2,
    last_round: { round: 1, host: 'Rock', opponent: 'Rock', winner: null },
  };
  const { container, unmount } = renderPanel(tied);

  // Both rows stay mounted; only the opponent's actual move flips over.
  expect(container.querySelector('.rps-tile-grid')).toBeTruthy();
  expect(container.querySelector('.rps-face-down-row')).toBeTruthy();
  expect(container.querySelector('.rps-battle')).toBeNull();
  expect(container.querySelector('.rps-panel-inner.rps-revealing')).toBeTruthy();
  expect(container.querySelectorAll('.rps-face-down-tile.is-flipped')).toHaveLength(1);
  const flipped = container.querySelector('.rps-face-down-tile.is-flipped');
  expect(flipped?.querySelector('img')?.getAttribute('src')).toBe('/generic/Rock.png');
  expect(container.querySelectorAll('.rps-swap')).toHaveLength(0);
  expect(screen.queryByText(/tie!/i)).toBeNull();

  act(() => { jest.advanceTimersByTime(520); });
  expect(container.querySelectorAll('.rps-tile-cell.rps-approach')).toHaveLength(1);
  expect(container.querySelectorAll('.rps-face-motion.rps-approach')).toHaveLength(1);

  act(() => { jest.advanceTimersByTime(480); });
  expect(container.querySelectorAll('.rps-tile-cell.rps-bonk')).toHaveLength(1);
  expect(container.querySelectorAll('.rps-face-motion.rps-bonk')).toHaveLength(1);
  expect(screen.queryByRole('button', { name: '1st Pick' })).toBeNull();

  act(() => { jest.advanceTimersByTime(750); });
  expect(container.querySelector('.rps-tile-grid')).toBeTruthy();
  expect(container.querySelector('.rps-face-down-row')).toBeTruthy();
  expect(container.querySelector('.rps-panel-inner.rps-revealing')).toBeNull();
  expect(container.querySelectorAll('.rps-face-down-tile.is-flipped')).toHaveLength(0);
  expect(container.querySelectorAll('.rps-bonk')).toHaveLength(0);
  expect(screen.queryByRole('button', { name: '1st Pick' })).toBeNull();

  unmount();
  jest.useRealTimers();
});

test('winner sees Winner!, large enabled buttons, and no tiles after the clash', () => {
  jest.useFakeTimers();
  const won: RockPaperScissorsState = {
    ...baseRps,
    winner: 'host-1',
    last_round: { round: 1, host: 'Scissors', opponent: 'Paper', winner: 'host-1' },
  };
  const onChooseFirstPick = jest.fn().mockResolvedValue({});
  const { container, unmount } = renderPanel(won, 'host-1', { onChooseFirstPick });

  expect(container.querySelector('.rps-tile-grid')).toBeTruthy();
  expect(container.querySelector('.rps-face-down-row')).toBeTruthy();
  expect(container.querySelector('.rps-battle')).toBeNull();
  expect(screen.queryByText('Winner!')).toBeNull();

  act(() => { jest.advanceTimersByTime(520); });
  expect(container.querySelectorAll('.rps-swap')).toHaveLength(0);
  expect(container.querySelector('.rps-face-down-tile.is-flipped')).toBeTruthy();

  act(() => { jest.advanceTimersByTime(1000); });
  const swaps = container.querySelectorAll('.rps-tile-cell.rps-swap');
  expect(swaps).toHaveLength(2);
  const scissorsCell = screen.getByRole('button', { name: 'Scissors' });
  const paperCell = screen.getByRole('button', { name: 'Paper' });
  expect(scissorsCell.classList.contains('rps-swap')).toBe(true);
  expect(paperCell.classList.contains('rps-swap')).toBe(true);
  expect(scissorsCell.style.getPropertyValue('--rps-column-shift')).toBe('-1');
  expect(paperCell.style.getPropertyValue('--rps-column-shift')).toBe('1');
  expect(container.querySelectorAll('.rps-face-motion.rps-swap')).toHaveLength(0);
  expect(screen.queryByText('Winner!')).toBeNull();

  act(() => { jest.advanceTimersByTime(260); });
  const approaching = container.querySelector('.rps-tile-cell.rps-approach');
  const approachingEnemy = container.querySelector('.rps-face-motion.rps-approach');
  expect(approaching?.textContent).toContain('Scissors');
  expect(approachingEnemy?.querySelector('img')?.getAttribute('src')).toBe('/generic/Paper.png');
  expect(screen.queryByText('Winner!')).toBeNull();

  act(() => { jest.advanceTimersByTime(320); });
  const winnerTile = container.querySelector('.rps-tile-cell.rps-approach');
  const shattered = container.querySelector('.rps-face-motion.rps-shatter');
  expect(winnerTile?.textContent).toContain('Scissors');
  expect(shattered?.querySelector('img')?.getAttribute('src')).toBe('/generic/Paper.png');
  expect((shattered as HTMLElement)?.style.getPropertyValue('--rps-shard-image')).toContain('/generic/Paper.png');
  expect(container.querySelector('.rps-knock')).toBeNull();
  expect(screen.queryByText('Winner!')).toBeNull();

  act(() => { jest.advanceTimersByTime(700); });
  expect(container.querySelector('.rps-tile-grid')).toBeNull();
  expect(container.querySelector('.rps-face-down-row')).toBeNull();
  expect(container.querySelector('.rps-outcome--win')).toBeTruthy();
  expect(screen.getByText('Winner!')).toBeTruthy();
  const first = screen.getByRole('button', { name: '1st Pick' }) as HTMLButtonElement;
  const second = screen.getByRole('button', { name: '2nd+3rd Pick' }) as HTMLButtonElement;
  expect(first.disabled).toBe(false);
  expect(second.disabled).toBe(false);

  fireEvent.click(first);
  expect(onChooseFirstPick).toHaveBeenCalledWith(true);
  fireEvent.click(second);
  expect(onChooseFirstPick).toHaveBeenCalledWith(false);

  unmount();
  jest.useRealTimers();
});

test('loser sees the revealed result, waiting text, and disabled pick-order buttons', () => {
  jest.useFakeTimers();
  const won: RockPaperScissorsState = {
    ...baseRps,
    winner: 'host-1',
    last_round: { round: 1, host: 'Scissors', opponent: 'Paper', winner: 'host-1' },
  };
  const onChooseFirstPick = jest.fn().mockResolvedValue({});
  const { container, unmount } = renderPanel(won, 'guest-2', { onChooseFirstPick });

  // From the loser's side the enemy card is the host's winning Scissors.
  const flipped = container.querySelector('.rps-face-down-tile.is-flipped');
  expect(flipped?.querySelector('img')?.getAttribute('src')).toBe('/generic/Scissors.png');

  act(() => { jest.advanceTimersByTime(520); });
  expect(container.querySelectorAll('.rps-swap')).toHaveLength(0);

  act(() => { jest.advanceTimersByTime(1000); });
  const enemySwaps = container.querySelectorAll('.rps-face-motion.rps-swap');
  expect(enemySwaps).toHaveLength(2);
  const scissorsFace = Array.from(enemySwaps).find(
    (el) => el.querySelector('img')?.getAttribute('src') === '/generic/Scissors.png',
  ) as HTMLElement | undefined;
  const paperFace = Array.from(enemySwaps).find(
    (el) => el.querySelector('img')?.getAttribute('src') === '/generic/Paper.png',
  ) as HTMLElement | undefined;
  expect(scissorsFace?.style.getPropertyValue('--rps-column-shift')).toBe('-1');
  expect(paperFace?.style.getPropertyValue('--rps-column-shift')).toBe('1');
  expect(container.querySelectorAll('.rps-tile-cell.rps-swap')).toHaveLength(0);

  act(() => { jest.advanceTimersByTime(260); });
  const playerApproach = container.querySelector('.rps-tile-cell.rps-approach');
  expect(playerApproach?.textContent).toContain('Paper');
  expect(container.querySelector('.rps-face-motion.rps-approach')?.querySelector('img')?.getAttribute('src')).toBe('/generic/Scissors.png');

  act(() => { jest.advanceTimersByTime(320); });
  const shattered = container.querySelector('.rps-tile-cell.rps-shatter');
  expect(shattered?.textContent).toContain('Paper');
  expect((shattered as HTMLElement)?.style.getPropertyValue('--rps-shard-image')).toContain('/generic/Paper.png');
  expect(container.querySelector('.rps-face-motion.rps-approach')?.querySelector('img')?.getAttribute('src')).toBe('/generic/Scissors.png');
  expect(screen.queryByText('Waiting for opponent...')).toBeNull();

  act(() => { jest.advanceTimersByTime(700); });
  expect(container.querySelector('.rps-outcome--wait')).toBeTruthy();
  expect(screen.getByText('Waiting for opponent...')).toBeTruthy();
  expect(container.querySelector('.rps-pick-order--disabled')).toBeTruthy();
  const first = screen.getByRole('button', { name: '1st Pick' }) as HTMLButtonElement;
  const second = screen.getByRole('button', { name: '2nd+3rd Pick' }) as HTMLButtonElement;
  expect(first.disabled).toBe(true);
  expect(second.disabled).toBe(true);

  fireEvent.click(first);
  fireEvent.click(second);
  expect(onChooseFirstPick).not.toHaveBeenCalled();

  unmount();
  jest.useRealTimers();
});
