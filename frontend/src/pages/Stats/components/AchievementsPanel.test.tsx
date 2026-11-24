import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { ACHIEVEMENT_DEFINITIONS, type PlayerAchievement } from '../achievements';
import AchievementsPanel from './AchievementsPanel';

const achievements: PlayerAchievement[] = [
  {
    id: 'early-bird',
    name: 'Early Bird',
    description: 'Have a race from March or April 2026',
    icon: 'EarlyBird.png',
    earned: true,
    manuallySet: false,
  },
  {
    id: 'blitz-legend',
    name: 'Blitz Legend',
    description: 'Beat the game 100 times',
    icon: 'BlitzLegend.png',
    earned: false,
    manuallySet: false,
  },
];

describe('AchievementsPanel', () => {
  it('shows only earned achievements with their icon and title', () => {
    render(<AchievementsPanel achievements={achievements} />);

    expect(screen.getByRole('button', { name: 'Early Bird' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Blitz Legend' })).toBeNull();
    expect(document.querySelector('img')?.getAttribute('src')).toBe('/Achievements/EarlyBird.png');
  });

  it('expands and collapses the description when the badge is clicked', () => {
    render(<AchievementsPanel achievements={achievements} />);
    const badge = screen.getByRole('button', { name: 'Early Bird' });

    const description = screen.getByText('Have a race from March or April 2026');
    expect(description.getAttribute('aria-hidden')).toBe('true');
    fireEvent.click(badge);
    expect(description.classList.contains('is-visible')).toBe(true);
    expect(description.getAttribute('aria-hidden')).toBe('false');
    expect(badge.getAttribute('aria-expanded')).toBe('true');

    fireEvent.click(badge);
    expect(description.classList.contains('is-visible')).toBe(false);
    expect(description.getAttribute('aria-hidden')).toBe('true');
    expect(badge.getAttribute('aria-expanded')).toBe('false');
  });

  it('renders nothing when no achievements are earned', () => {
    const { container } = render(
      <AchievementsPanel achievements={achievements.map((achievement) => ({ ...achievement, earned: false }))} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('allows only one badge to be expanded at a time', () => {
    const twoEarned = achievements.map((achievement) => ({ ...achievement, earned: true }));
    render(<AchievementsPanel achievements={twoEarned} />);
    const first = screen.getByRole('button', { name: 'Early Bird' });
    const second = screen.getByRole('button', { name: 'Blitz Legend' });

    fireEvent.click(first);
    expect(first.getAttribute('aria-expanded')).toBe('true');

    fireEvent.click(second);
    expect(first.getAttribute('aria-expanded')).toBe('false');
    expect(second.getAttribute('aria-expanded')).toBe('true');
  });

  it('groups earned badges into rows of six', () => {
    const many = Array.from({ length: 7 }, (_, index) => ({
      ...achievements[0],
      id: `achievement-${index}`,
      name: `Achievement ${index}`,
    }));
    const { container } = render(<AchievementsPanel achievements={many} />);
    const rows = container.querySelectorAll('.player-achievement-row');

    expect(rows.length).toBe(2);
    expect(rows[0].querySelectorAll('.player-achievement-badge').length).toBe(6);
    expect(rows[1].querySelectorAll('.player-achievement-badge').length).toBe(1);
  });

  it('lets an admin add and remove achievements', () => {
    const onToggle = jest.fn();
    render(
      <AchievementsPanel
        achievements={achievements}
        canEdit
        onToggleAchievement={onToggle}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Edit player achievements' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add Blitz Legend' }));
    expect(onToggle).toHaveBeenCalledWith(achievements[1]);
    expect(screen.getByRole('button', { name: 'Remove Early Bird' })).toBeTruthy();
  });

  it('offers the newest achievements in the admin menu with their icons', () => {
    const unearned = ACHIEVEMENT_DEFINITIONS.map((achievement) => ({
      ...achievement,
      earned: false,
      manuallySet: false,
    }));
    render(
      <AchievementsPanel
        achievements={unearned}
        canEdit
        onToggleAchievement={jest.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Edit player achievements' }));
    expect(screen.getByRole('button', { name: 'Add 10+ Club' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add True Love' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add Impatient' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add Who Are You?' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add Old Faithful' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add Pokémon Professor' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add Old Head' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add Deathless' })).toBeTruthy();
    expect(document.querySelector('img[src="/Achievements/10+.png"]')).toBeTruthy();
    expect(document.querySelector('img[src="/Achievements/TrueLove.png"]')).toBeTruthy();
    expect(document.querySelector('img[src="/Achievements/Impatient.png"]')).toBeTruthy();
    expect(document.querySelector('img[src="/Achievements/WhoAreYou.png"]')).toBeTruthy();
    expect(document.querySelector('img[src="/Achievements/OldFaithful.png"]')).toBeTruthy();
    expect(document.querySelector('img[src="/Achievements/PokemonProfessor.png"]')).toBeTruthy();
    expect(document.querySelector('img[src="/Achievements/OldHead.png"]')).toBeTruthy();
    expect(document.querySelector('img[src="/Achievements/Deathless.png"]')).toBeTruthy();
  });
});
