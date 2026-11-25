import { getChampionName, hasChampionWin, isRunFinishedFor } from './runCompletion';

const win = (trainer_id: number, is_loss = false) => ({ trainer_id, is_loss, hours: 1, minutes: 0, seconds: 0 });

describe('champion detection', () => {
  test('a Wally or Steven win finishes the run', () => {
    expect(hasChampionWin({ trainer_card_wins: [win(656)] })).toBe(true);
    expect(hasChampionWin({ trainer_card_wins: [win(804)] })).toBe(true);
  });

  test('gym wins and champion losses do not finish the run', () => {
    expect(hasChampionWin({ trainer_card_wins: [win(265)] })).toBe(false);
    expect(hasChampionWin({ trainer_card_wins: [win(804, true)] })).toBe(false);
    expect(hasChampionWin({ trainer_card_wins: [] })).toBe(false);
    expect(hasChampionWin(null)).toBe(false);
  });

  test('the display name comes from the last champion win', () => {
    expect(getChampionName({ trainer_card_wins: [win(656), win(265), win(804)] })).toBe('Steven');
    expect(getChampionName({ trainer_card_wins: [win(265), win(804, true)] })).toBeNull();
  });
});

describe('run finish marker', () => {
  test('a finished run stays finished for its own draft', () => {
    expect(isRunFinishedFor('draft-a', 'draft-a')).toBe(true);
  });

  test('a new draft starts fresh even in a reused emulator component', () => {
    expect(isRunFinishedFor('draft-a', 'draft-b')).toBe(false);
    expect(isRunFinishedFor(null, 'draft-b')).toBe(false);
  });
});
