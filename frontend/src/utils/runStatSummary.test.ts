import type { RunStatSummary } from './runStatSummary';
import { getRunStatsForPick } from './runStatSummary';

const summary = (overrides: Partial<RunStatSummary>): RunStatSummary => ({
  koCount: null,
  totalTurns: null,
  fainted: false,
  faintedLevel: null,
  ...overrides,
});

describe('getRunStatsForPick', () => {
  it('uses the direct icon for a normal pick', () => {
    const statsByIcon = new Map([['charmander', summary({ koCount: 9 })]]);
    expect(getRunStatsForPick(statsByIcon, 'Charmander')?.koCount).toBe(9);
  });

  it('sums KOs and turns for the combined Plusle and Minun pick', () => {
    const statsByIcon = new Map([
      ['plusle', summary({ koCount: 7, totalTurns: 20 })],
      ['minun', summary({ koCount: 5, totalTurns: 18, fainted: true, faintedLevel: 31 })],
    ]);

    expect(getRunStatsForPick(statsByIcon, 'Plusle and Minun')).toEqual({
      koCount: 12,
      totalTurns: 38,
      fainted: true,
      faintedLevel: 31,
    });
  });

  it('still finds the half that has stats when only one is recorded', () => {
    const statsByIcon = new Map([['minun', summary({ koCount: 4 })]]);
    expect(getRunStatsForPick(statsByIcon, 'Plusle and Minun')?.koCount).toBe(4);
  });
});
