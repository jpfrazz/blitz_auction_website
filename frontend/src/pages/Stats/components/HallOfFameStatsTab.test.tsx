import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { fetchHallOfFameEligible } from '../../../shared/api/stats';
import type {
  AdminHallOfFameEligibleEntry,
  HallOfFamePokemon,
} from '../../../types';
import { formatHallOfFameDate } from '../../../utils/hallOfFameLabels';
import HallOfFameStatsTab from './HallOfFameStatsTab';

jest.mock('../../../shared/api/stats', () => ({
  fetchHallOfFameEligible: jest.fn(),
}));

const mockFetch = fetchHallOfFameEligible as jest.MockedFunction<
  typeof fetchHallOfFameEligible
>;

const names = [
  'Ribombee',
  'Luxray',
  'Feraligatr',
  'Chesnaught',
  'Arcanine',
  'Perrserker',
];

const entry: AdminHallOfFameEligibleEntry = {
  team_id: 3864,
  draft_id: 'draft-1',
  draft_name: 'Test Draft',
  draft_type: 'auction',
  user_id: 'user-1',
  user_name: 'jeansmm',
  trainer_id: 656,
  beat_name: 'Wally',
  hours: 1,
  minutes: 29,
  seconds: 58,
  beat_date: '2026-11-26T00:00:00Z',
  hall_of_fame_team: names.map(
    (name): HallOfFamePokemon => ({ name, icon: name.toLowerCase() }),
  ),
};

const classificationWithDate = `Competitive Auction • ${formatHallOfFameDate(entry.beat_date)}`;

type RenderOverrides = {
  currentUserId?: string | null;
  currentUsername?: string | null;
};

const renderTab = (overrides: RenderOverrides = {}) =>
  render(
    <HallOfFameStatsTab
      validDraftIds={new Set(['draft-1'])}
      casual1v1DraftIds={new Set()}
      {...overrides}
    />,
  );

describe('Hall of Fame diorama', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValue([entry]);
  });

  it('loads the full eligible list and defaults to 200 entries per page', async () => {
    const { container } = renderTab();
    await screen.findByAltText('Hall of Fame trophy');

    expect(mockFetch).toHaveBeenCalledWith(undefined, undefined);
    const input = screen.getByLabelText('Entries per page') as HTMLInputElement;
    expect(input.type).toBe('number');
    expect(input.value).toBe('200');
    expect(screen.queryByText('Show Most Recent')).toBeNull();
    expect(container.querySelector('.admin-hof-entry')).toBeTruthy();
  });

  it('paginates the loaded entries with a typeable page size', async () => {
    mockFetch.mockResolvedValue(
      Array.from({ length: 5 }, (_, idx) => ({
        ...entry,
        team_id: entry.team_id + idx,
        user_name: `player-${idx}`,
      })),
    );
    const { container } = renderTab();
    await screen.findAllByAltText('Hall of Fame trophy');

    const input = screen.getByLabelText('Entries per page') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '2' } });
    fireEvent.blur(input);

    expect(await screen.findByText(/Page 1 of 3/)).toBeTruthy();
    expect(container.querySelectorAll('.admin-hof-entry')).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: /Next/i }));
    expect(screen.getByText(/Page 2 of 3/)).toBeTruthy();
    expect(container.querySelectorAll('.admin-hof-entry')).toHaveLength(2);
    expect(container.textContent).toContain('player-2');
  });

  it('keeps the draft type filter at three quarters of its old width', async () => {
    const { container } = renderTab();
    await screen.findByAltText('Hall of Fame trophy');

    const draftTypeSelect = Array.from(
      container.querySelectorAll<HTMLSelectElement>('select.stats-filter-input'),
    ).find((select) =>
      Array.from(select.options).some((option) => option.textContent === 'Auction Draft'),
    )!;

    expect(draftTypeSelect.style.width).toBe('99px');
  });

  it('puts the names in their own row between the beat time and the diorama', async () => {
    const { container } = renderTab();
    await screen.findByAltText('Hall of Fame trophy');

    const beat = container.querySelector('.admin-hof-entry-beat')!;
    const namesRow = container.querySelector('.admin-hof-team-names')!;
    const diorama = container.querySelector('.hof-diorama')!;

    expect(
      beat.compareDocumentPosition(namesRow) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      namesRow.compareDocumentPosition(diorama) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      Array.from(namesRow.querySelectorAll('.admin-hof-team-name')).map(
        (child) => child.textContent,
      ),
    ).toEqual(names);
    expect(
      Array.from(namesRow.querySelectorAll('.admin-hof-team-separator')).map(
        (child) => child.textContent,
      ),
    ).toEqual(Array(names.length - 1).fill('•'));
    expect(namesRow.querySelector('img')).toBeNull();
  });

  it('renders one centered summary line with the avatar and a padded time', async () => {
    const { container } = renderTab();
    await screen.findByAltText('Hall of Fame trophy');

    const head = container.querySelector('.admin-hof-entry-head')!;
    const player = container.querySelector('.admin-hof-entry-player') as HTMLAnchorElement;
    const avatar = container.querySelector('.admin-hof-entry-avatar') as HTMLImageElement;

    expect(head.textContent).toBe('jeansmm beat Wally in 1:29:58');
    expect(player.tagName).toBe('A');
    expect(player.getAttribute('href')).toContain('/Stats/PlayerProfiles/jeansmm');
    expect(player.querySelector('span')!.textContent).toBe('jeansmm');
    expect(avatar.getAttribute('src')).toBe('/api/avatar/user-1');
    expect(container.querySelector('.admin-hof-entry-race')).toBeNull();
    expect(head.textContent).not.toContain('1h');
    expect(head.textContent).not.toContain(' on ');
  });

  it('falls back to the generic avatar when the user avatar fails to load', async () => {
    const { container } = renderTab();
    await screen.findByAltText('Hall of Fame trophy');

    const avatar = container.querySelector('.admin-hof-entry-avatar') as HTMLImageElement;
    fireEvent.error(avatar);
    await waitFor(() =>
      expect(avatar.getAttribute('src')).toBe('/generic/DiscordAvatar.png'),
    );
  });

  it('stacks the summary, names, classification, and diorama in order', async () => {
    const { container } = renderTab();
    await screen.findByAltText('Hall of Fame trophy');

    const head = container.querySelector('.admin-hof-entry-head')!;
    const namesRow = container.querySelector('.admin-hof-team-names')!;
    const classificationRow = container.querySelector('.admin-hof-classification')!;
    const diorama = container.querySelector('.hof-diorama')!;

    expect(
      head.compareDocumentPosition(namesRow) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      namesRow.compareDocumentPosition(classificationRow) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      classificationRow.compareDocumentPosition(diorama) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('puts all three text rows inside the black top bar', async () => {
    const { container } = renderTab();
    await screen.findByAltText('Hall of Fame trophy');

    const infoBar = container.querySelector('.admin-hof-entry-info')!;
    const head = container.querySelector('.admin-hof-entry-head')!;
    const namesRow = container.querySelector('.admin-hof-team-names')!;
    const classificationRow = container.querySelector('.admin-hof-classification')!;
    const diorama = container.querySelector('.hof-diorama')!;

    expect(infoBar.contains(head)).toBe(true);
    expect(infoBar.contains(namesRow)).toBe(true);
    expect(infoBar.contains(classificationRow)).toBe(true);
    expect(infoBar.contains(diorama)).toBe(false);
  });

  it('shows a plain-text classification row between the names and the diorama', async () => {
    const { container } = renderTab();
    await screen.findByAltText('Hall of Fame trophy');

    const namesRow = container.querySelector('.admin-hof-team-names')!;
    const classificationRow = container.querySelector('.admin-hof-classification')!;
    const diorama = container.querySelector('.hof-diorama')!;

    expect(classificationRow.textContent).toBe(classificationWithDate);
    expect(
      namesRow.compareDocumentPosition(classificationRow) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      classificationRow.compareDocumentPosition(diorama) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(container.querySelector('.admin-hof-draft-type')).toBeNull();
  });

  it('labels a casual booster without a badge', async () => {
    mockFetch.mockResolvedValue([
      { ...entry, draft_id: 'booster-1', draft_type: 'booster' },
    ]);
    render(
      <HallOfFameStatsTab
        validDraftIds={new Set()}
        casual1v1DraftIds={new Set()}
        casualBoosterDraftIds={new Set(['booster-1'])}
      />,
    );

    expect(
      await screen.findByText(`Casual Booster • ${formatHallOfFameDate(entry.beat_date)}`),
    ).toBeTruthy();
    expect(document.querySelector('.admin-hof-draft-type')).toBeNull();
  });

  it('removes the labels from beneath the pokemon sprites', async () => {
    const { container } = renderTab();
    await screen.findByAltText('Hall of Fame trophy');

    expect(container.querySelectorAll('.hof-diorama-mon span')).toHaveLength(0);
    expect(container.querySelectorAll('.admin-hof-team-icon')).toHaveLength(0);
  });

  it('adds two decorative spotlight beams behind the text', async () => {
    const { container } = renderTab();
    await screen.findByAltText('Hall of Fame trophy');

    const beams = container.querySelectorAll<HTMLElement>('.hof-spotlight');
    expect(beams).toHaveLength(2);
    expect(beams[0].classList.contains('left')).toBe(true);
    expect(beams[1].classList.contains('right')).toBe(true);
    expect(beams[0].style.getPropertyValue('--beam-origin-x')).toMatch(/%$/);
    expect(
      Number.parseFloat(beams[0].style.getPropertyValue('--beam-source-w')),
    ).toBeGreaterThanOrEqual(6);
    expect(beams[0].style.getPropertyValue('--beam-a')).toMatch(/%$/);
    expect(beams[0].style.getPropertyValue('--beam-b')).toMatch(/%$/);
    expect(
      container.querySelector('.hof-spotlights')!.getAttribute('aria-hidden'),
    ).toBe('true');
  });

  it('varies spotlight origins and angles widely between entries without animating them', async () => {
    mockFetch.mockResolvedValue(
      Array.from({ length: 6 }, (_, idx) => ({
        ...entry,
        team_id: entry.team_id + idx,
      })),
    );
    const { container } = render(
      <HallOfFameStatsTab
        validDraftIds={new Set(['draft-1'])}
        casual1v1DraftIds={new Set()}
      />,
    );
    await screen.findAllByAltText('Hall of Fame trophy');

    const beams = Array.from(
      container.querySelectorAll<HTMLElement>('.hof-spotlight.left'),
    );
    const values = (property: string) =>
      beams.map((beam) => Number.parseFloat(beam.style.getPropertyValue(property)));
    const spread = (numbers: number[]) => Math.max(...numbers) - Math.min(...numbers);

    expect(spread(values('--beam-origin-x'))).toBeGreaterThan(8);
    expect(spread(values('--beam-a'))).toBeGreaterThan(12);
    expect(spread(values('--beam-b'))).toBeGreaterThan(12);
    expect(beams[0].style.animation).toBe('');
  });

  it('sets the spotlight and bottom-glow color from the race type', async () => {
    mockFetch.mockResolvedValue([
      entry,
      { ...entry, team_id: 3865, draft_type: 'booster', draft_id: 'booster-1' },
      { ...entry, team_id: 3866, draft_type: '1v1', draft_id: '1v1-1' },
      { ...entry, team_id: 3867, draft_type: 'unknown', draft_id: 'unknown-1' },
    ]);
    const { container } = render(
      <HallOfFameStatsTab
        validDraftIds={new Set(['draft-1'])}
        casual1v1DraftIds={new Set()}
      />,
    );
    await screen.findAllByAltText('Hall of Fame trophy');

    const cards = container.querySelectorAll<HTMLElement>('.admin-hof-entry');
    expect(
      Array.from(cards, (card) =>
        card.style.getPropertyValue('--hof-glow-rgb'),
      ),
    ).toEqual([
      '124, 185, 70',
      '79, 195, 247',
      '255, 176, 46',
      '124, 185, 70',
    ]);
  });

  it('puts the trophy in the middle of the two evenly split lines', async () => {
    const { container } = renderTab();
    await screen.findByAltText('Hall of Fame trophy');

    const diorama = container.querySelector('.hof-diorama')!;
    expect(
      Array.from(diorama.children).map((child) => child.className),
    ).toEqual(['hof-diorama-side left', 'hof-diorama-trophy', 'hof-diorama-side right']);
    expect(container.querySelectorAll('.hof-diorama-side.left .hof-diorama-mon')).toHaveLength(3);
    expect(container.querySelectorAll('.hof-diorama-side.right .hof-diorama-mon')).toHaveLength(3);
    expect(screen.getByAltText('Hall of Fame trophy').getAttribute('src')).toBe(
      '/generic/Trophy.png',
    );
  });

  it('sends background pokemon higher and behind the foreground pokemon', async () => {
    const { container } = renderTab();
    await screen.findByAltText('Hall of Fame trophy');

    const leftSlots = container.querySelectorAll<HTMLElement>(
      '.hof-diorama-side.left .hof-diorama-mon',
    );
    const rightSlots = container.querySelectorAll<HTMLElement>(
      '.hof-diorama-side.right .hof-diorama-mon',
    );

    expect(leftSlots[0].dataset.depth).toBe('2');
    expect(leftSlots[0].style.transform).toBe('translateY(-24px) scale(0.92)');
    expect(leftSlots[2].style.transform).toBe('translateY(0px) scale(1)');
    expect(Number(leftSlots[0].style.zIndex)).toBeLessThan(
      Number(leftSlots[2].style.zIndex),
    );

    expect(rightSlots[0].dataset.depth).toBe('0');
    expect(rightSlots[2].dataset.depth).toBe('2');
    expect(rightSlots[2].style.transform).toBe('translateY(-24px) scale(0.92)');
  });

  it('loads full pokemon sprites and falls back through the sprite folders', async () => {
    renderTab();
    const ribombee = await screen.findByAltText('Ribombee');

    expect(ribombee.getAttribute('src')).toBe('/evolutions/Ribombee.png');

    fireEvent.error(ribombee);
    await waitFor(() =>
      expect(ribombee.getAttribute('src')).toBe('/baseforms/Ribombee.png'),
    );
  });

  it('lets the owner flip each pokemon in their own entry', async () => {
    const { container } = renderTab({
      currentUserId: 'user-1',
      currentUsername: 'jeansmm',
    });
    await screen.findByAltText('Hall of Fame trophy');

    const buttons = container.querySelectorAll<HTMLButtonElement>(
      '.admin-hof-entry button.hof-diorama-mon',
    );
    expect(buttons).toHaveLength(6);
    expect(buttons[0].getAttribute('aria-label')).toBe('Flip Ribombee');

    const image = buttons[0].querySelector('img')!;
    fireEvent.click(buttons[0]);
    expect(image.style.transform).toBe('scaleX(-1)');
    fireEvent.click(buttons[0]);
    expect(image.style.transform).toBe('');
  });

  it('does not offer flip controls on someone else\'s entry', async () => {
    const { container } = renderTab({
      currentUserId: 'someone-else',
      currentUsername: 'other-player',
    });
    await screen.findByAltText('Hall of Fame trophy');

    expect(container.querySelector('button.hof-diorama-mon')).toBeNull();
  });

  it('lets franklynathan flip pokemon in any entry', async () => {
    mockFetch.mockResolvedValue([
      entry,
      { ...entry, team_id: 3865, user_id: 'user-2', user_name: 'other-player' },
    ]);
    const { container } = renderTab({
      currentUserId: 'franklynathan-id',
      currentUsername: 'franklynathan',
    });
    await screen.findAllByAltText('Hall of Fame trophy');

    const cards = container.querySelectorAll('.admin-hof-entry');
    expect(cards[0].querySelectorAll('button.hof-diorama-mon')).toHaveLength(6);
    expect(cards[1].querySelectorAll('button.hof-diorama-mon')).toHaveLength(6);

    const secondEntryButton = cards[1].querySelector<HTMLButtonElement>(
      'button.hof-diorama-mon',
    )!;
    const image = secondEntryButton.querySelector('img')!;
    fireEvent.click(secondEntryButton);
    expect(image.style.transform).toBe('scaleX(-1)');
  });
});
