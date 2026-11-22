import type { RunMonStat, StatsAuction } from '../types';
import type { RunStatLineage } from './runStatLineage';
import { findEggHatchStats, isEggAuction } from './eggHatchStats';

const auction = (name: string, auctionId: number): StatsAuction => ({
  auction_id: auctionId,
  pokedex_id: 1573,
  name,
  form: '',
  draft_id: 'draft-1',
  draft_order: auctionId,
  state: 'COMPLETED',
  paused_time_remaining: null,
  winning_bid: 1000,
  winning_user_id: 'user-1',
  winning_guest_id: null,
  updated_at: '2026-01-01T00:00:00Z',
  created_at: '2026-01-01T00:00:00Z',
  draft_type: 'auction',
  season: 1,
  action: 'PICK',
} as StatsAuction);

const mon = (
  speciesId: number,
  personality: number,
  koCount: number | null,
  totalTurns: number | null
): RunMonStat => ({
  species_id: speciesId,
  personality,
  ko_count: koCount,
  total_turns: totalTurns,
  level: null,
  fainted: false,
});

const icons: Record<number, string[]> = {
  4: ['charmander'],
  35: ['clefairy', 'cleffa'],
  36: ['clefable', 'clefairy', 'cleffa'],
  133: ['eevee'],
  173: ['cleffa'],
  175: ['togepi'],
  176: ['togetic', 'togepi'],
  468: ['togekiss', 'togetic', 'togepi'],
  543: ['venipede'],
  1524: ['clefable', 'clefairy', 'cleffa'],
  1573: ['egg'],
};
const lineage = {
  getIcons: (speciesId: number) => icons[speciesId] ?? [],
} as RunStatLineage;

test('infers an evolved hatch and labels it with the species the egg hatched into', () => {
  const result = findEggHatchStats(
    [
      mon(1573, 1, null, null),
      mon(4, 2, 5, 20),
      mon(133, 3, 3, 10),
      mon(468, 4, 31, 8),
    ],
    [auction('Egg', 1), auction('Charmander', 2)],
    lineage,
  );

  expect(result).not.toBeNull();
  expect(result?.speciesId).toBe(468);
  expect(result?.name).toBe('Togepi');
  expect(result?.summary.koCount).toBe(31);
  expect(result?.summary.totalTurns).toBe(8);
});

test('uses the hatch species name for a mega form', () => {
  const result = findEggHatchStats(
    [mon(1573, 1, null, null), mon(4, 2, 5, 20), mon(133, 3, 3, 10), mon(1524, 4, 12, 4)],
    [auction('Egg', 1), auction('Charmander', 2)],
    lineage,
  );

  expect(result?.name).toBe('Cleffa');
  expect(result?.summary.koCount).toBe(12);
});

test('ignores an unmatched mon that the egg could never hatch into', () => {
  const result = findEggHatchStats(
    [
      mon(1573, 1, null, null),
      mon(4, 2, 5, 20),
      mon(133, 3, 3, 10),
      mon(543, 4, 31, 8),
    ],
    [auction('Egg', 1), auction('Charmander', 2)],
    lineage,
  );

  expect(result).toBeNull();
});

test('does not guess when no hatch-family run stat is left', () => {
  const result = findEggHatchStats(
    [mon(1573, 1, null, null), mon(4, 2, 5, 20), mon(133, 3, 3, 10)],
    [auction('Egg', 1), auction('Charmander', 2)],
    lineage,
  );

  expect(result).toBeNull();
});

test('does not guess when multiple hatch-family mons are unclaimed', () => {
  const result = findEggHatchStats(
    [
      mon(1573, 1, null, null),
      mon(4, 2, 5, 20),
      mon(133, 3, 3, 10),
      mon(175, 4, 31, 8),
      mon(173, 5, 2, 6),
    ],
    [auction('Egg', 1), auction('Charmander', 2)],
    lineage,
  );

  expect(result).toBeNull();
});

test('treats a locally revealed Egg name as an egg row', () => {
  expect(isEggAuction(auction('Egg (Togepi)', 1))).toBe(true);
  expect(isEggAuction(auction('Charmander', 2))).toBe(false);
});
