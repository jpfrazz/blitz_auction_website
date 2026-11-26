import { BOOSTER_FIRST_PICK_NOTE, boosterCycleNotes, buildBoosterPassOrder } from './BoosterPackOrderTab';

describe('buildBoosterPassOrder', () => {
  test('chains every player to the next seat and wraps back to the first', () => {
    expect(buildBoosterPassOrder(4)).toEqual([
      { from: 0, to: 1 },
      { from: 1, to: 2 },
      { from: 2, to: 3 },
      { from: 3, to: 0 },
    ]);
  });

  test('handles the three-player minimum and ignores fewer than two players', () => {
    expect(buildBoosterPassOrder(3)).toHaveLength(3);
    expect(buildBoosterPassOrder(1)).toEqual([]);
    expect(buildBoosterPassOrder(0)).toEqual([]);
  });
});

describe('boosterCycleNotes', () => {
  test('the first-pick note sits above the cycle notes', () => {
    expect(BOOSTER_FIRST_PICK_NOTE).toBe('1st Pick: Pick+Ban+Ward');
  });

  test('eight-Pokemon teams stop after eight passes', () => {
    expect(boosterCycleNotes(4, 8)).toEqual([
      '1st Cycle: Pick+Ban',
      '2nd Cycle: Picks only',
    ]);
    expect(boosterCycleNotes(3, 8)).toEqual([
      '1st Cycle: Pick+Ban',
      '2nd Cycle: Picks only',
      '3rd Cycle: Picks only (partial)',
    ]);
  });

  test('nine-Pokemon teams add one pass, completing three cycles for three players', () => {
    expect(boosterCycleNotes(3, 9)).toEqual([
      '1st Cycle: Pick+Ban',
      '2nd Cycle: Picks only',
      '3rd Cycle: Picks only',
    ]);
    expect(boosterCycleNotes(4, 9)).toEqual([
      '1st Cycle: Pick+Ban',
      '2nd Cycle: Picks only',
      '3rd Cycle: Picks only (partial)',
    ]);
  });

  test('ten-Pokemon teams add two passes', () => {
    expect(boosterCycleNotes(3, 10)).toEqual([
      '1st Cycle: Pick+Ban',
      '2nd Cycle: Picks only',
      '3rd Cycle: Picks only',
      '4th Cycle: Picks only (partial)',
    ]);
  });
});
