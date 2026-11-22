import { BossBattleSubmissionBattle } from '../api/stats';
import {
  formatBattleTime,
  normalizeSubmissionBattles,
  parseBattleTime,
} from './BossBattleEditor';

const battle = (overrides: Partial<BossBattleSubmissionBattle> = {}): BossBattleSubmissionBattle => ({
  trainer_id: 265,
  version: 1,
  hours: 0,
  minutes: 0,
  seconds: 0,
  is_loss: false,
  ...overrides,
});

test('formats battle times as padded XX:XX:XX', () => {
  expect(formatBattleTime(0, 0, 0)).toBe('00:00:00');
  expect(formatBattleTime(1, 2, 3)).toBe('01:02:03');
  expect(formatBattleTime(123, 59, 59)).toBe('123:59:59');
});

test('parses only complete XX:XX:XX battle times', () => {
  expect(parseBattleTime('01:02:03')).toEqual({ hours: 1, minutes: 2, seconds: 3 });
  expect(parseBattleTime(' 123:59:59 ')).toEqual({ hours: 123, minutes: 59, seconds: 59 });
  expect(parseBattleTime('1:2:3')).toBeNull();
  expect(parseBattleTime('01:60:00')).toBeNull();
  expect(parseBattleTime('01:02')).toBeNull();
  expect(parseBattleTime('abc')).toBeNull();
});

test('numbers the first eight numbered rows by row position', () => {
  const battles = Array.from({ length: 10 }, () => battle());

  const result = normalizeSubmissionBattles(battles);

  expect(result.slice(0, 8).map((entry) => entry.version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  expect(result[8].version).toBe(1);
  expect(result[9].version).toBe(1);
});

test('removes numbers from trainers that do not have one', () => {
  const battles = [
    battle({ trainer_id: 804, version: 3 }),
    battle({ trainer_id: 807, version: 4 }),
    battle({ trainer_id: 265, version: 7 }),
  ];

  const result = normalizeSubmissionBattles(battles);

  expect(result[0].version).toBeNull();
  expect(result[1].version).toBeNull();
  expect(result[2].version).toBe(3);
});

test('leaves locked battles untouched', () => {
  const battles = [
    battle({ trainer_id: 807, version: 4 }),
    battle({ trainer_id: 265, version: 5 }),
  ];

  const result = normalizeSubmissionBattles(battles, 1);

  expect(result[0].version).toBe(4);
  expect(result[1].version).toBe(2);
});
