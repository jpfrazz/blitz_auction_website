import { decodeMonBattleCounts } from './parseSaveFile';
import { formatEnemyMonTooltip, formatMonTotalsLine } from './monTooltip';

test('decodes koCount and totalTurns from the misc substructure word', () => {
  const word = ((123 & 0xffff) << 16 | (42 & 0xffff)) >>> 0;

  expect(decodeMonBattleCounts(word)).toEqual({ ko_count: 42, total_turns: 123 });
});

test('mini-icon tooltip shows both lifetime totals', () => {
  expect(formatMonTotalsLine({ total_turns: 123, ko_count: 42 })).toBe(
    '\nTotal Turns: 123 | Total KOs: 42'
  );
});

test('mini-icon tooltip uses a dash for saves that predate these fields', () => {
  expect(formatMonTotalsLine({})).toBe('\nTotal Turns: — | Total KOs: —');
});

test('enemy hover groups stats into two rows and lists moves', () => {
  const tip = formatEnemyMonTooltip({
    name: 'Tyranitar',
    ability: 'Sand Stream',
    nature: 'Adamant',
    max_hp: 100,
    stats: { atk: 120, def: 110, spa: 95, spd: 100, spe: 61 },
    moves: [1, 2, 0],
  });

  expect(tip).toBe(
    'Tyranitar (Sand Stream) - Adamant\n' +
    'HP: 100  Atk: 120  Def: 110\n' +
    'SpAtk: 95  SpDef: 100  Spd: 61\n' +
    'Moves: Pound, Karate Chop'
  );
});

test('enemy hover falls back gracefully when live details are missing', () => {
  expect(formatEnemyMonTooltip({ name: 'Missingno' })).toBe(
    'Missingno (Unknown) - Unknown\n' +
    'HP: —  Atk: —  Def: —\n' +
    'SpAtk: —  SpDef: —  Spd: —\n' +
    'Moves: —'
  );
});
