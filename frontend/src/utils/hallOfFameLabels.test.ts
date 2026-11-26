import type { AdminHallOfFameEligibleEntry } from '../types';
import {
  formatHallOfFameDate,
  formatHallOfFameTime,
  getHallOfFameClassification,
  getHallOfFameDraftType,
  getHallOfFameGlowRgb,
  isCasualHallOfFameDraft,
  type HallOfFameDraftSets,
} from './hallOfFameLabels';

const sets: HallOfFameDraftSets = {
  validDraftIds: new Set(['competitive-auction']),
  casual1v1DraftIds: new Set(['casual-1v1']),
  casualBoosterDraftIds: new Set(['casual-booster']),
};

const entry = (
  draftType: string,
  draftId: string,
): AdminHallOfFameEligibleEntry => ({
  team_id: 1,
  draft_id: draftId,
  draft_name: 'Draft',
  draft_type: draftType,
  user_id: null,
  user_name: 'Player',
  trainer_id: 656,
  beat_name: 'Wally',
  hours: 1,
  minutes: 29,
  seconds: 58,
  beat_date: '2026-11-26T00:00:00Z',
  hall_of_fame_team: [],
});

describe('getHallOfFameDraftType', () => {
  it('maps the stored draft types to their plain labels', () => {
    expect(getHallOfFameDraftType('auction')).toBe('Auction');
    expect(getHallOfFameDraftType('booster')).toBe('Booster');
    expect(getHallOfFameDraftType('1v1')).toBe('1v1');
  });

  it('treats unknown types as auction drafts', () => {
    expect(getHallOfFameDraftType('something-else')).toBe('Auction');
  });
});

describe('getHallOfFameGlowRgb', () => {
  it('uses a distinct glow color for each race type', () => {
    expect(getHallOfFameGlowRgb('auction')).toBe('124, 185, 70');
    expect(getHallOfFameGlowRgb('booster')).toBe('79, 195, 247');
    expect(getHallOfFameGlowRgb('1v1')).toBe('255, 176, 46');
  });

  it('falls back to the auction glow for unknown race types', () => {
    expect(getHallOfFameGlowRgb('something-else')).toBe('124, 185, 70');
  });
});

describe('isCasualHallOfFameDraft', () => {
  it('uses the competitive draft list for auctions', () => {
    expect(isCasualHallOfFameDraft(entry('auction', 'competitive-auction'), sets)).toBe(false);
    expect(isCasualHallOfFameDraft(entry('auction', 'casual-auction'), sets)).toBe(true);
  });

  it('uses the casual 1v1 draft list', () => {
    expect(isCasualHallOfFameDraft(entry('1v1', 'casual-1v1'), sets)).toBe(true);
    expect(isCasualHallOfFameDraft(entry('1v1', 'competitive-1v1'), sets)).toBe(false);
  });

  it('uses the casual booster draft list', () => {
    expect(isCasualHallOfFameDraft(entry('booster', 'casual-booster'), sets)).toBe(true);
    expect(isCasualHallOfFameDraft(entry('booster', 'competitive-booster'), sets)).toBe(false);
  });

  it('treats boosters as competitive when the casual list is omitted', () => {
    expect(
      isCasualHallOfFameDraft(entry('booster', 'any'), {
        validDraftIds: sets.validDraftIds,
        casual1v1DraftIds: sets.casual1v1DraftIds,
      }),
    ).toBe(false);
  });
});

describe('formatHallOfFameTime', () => {
  it('pads minutes and seconds without h/m/s suffixes', () => {
    expect(formatHallOfFameTime(entry('auction', 'any'))).toBe('1:29:58');
  });

  it('handles zero-padded values', () => {
    expect(formatHallOfFameTime({ ...entry('auction', 'any'), hours: 0, minutes: 4, seconds: 7 })).toBe('0:04:07');
  });
});

describe('formatHallOfFameDate', () => {
  it('returns an empty label when there is no beat date', () => {
    expect(formatHallOfFameDate('')).toBe('');
  });

  it('formats a date as numeric month/day/two-digit year', () => {
    expect(formatHallOfFameDate('2026-11-26T12:00:00')).toBe('11/26/26');
  });
});

describe('getHallOfFameClassification', () => {
  it('combines casual/competitive status with the draft type', () => {
    expect(getHallOfFameClassification(entry('auction', 'competitive-auction'), sets)).toBe(
      'Competitive Auction',
    );
    expect(getHallOfFameClassification(entry('auction', 'casual-auction'), sets)).toBe(
      'Casual Auction',
    );
    expect(getHallOfFameClassification(entry('booster', 'casual-booster'), sets)).toBe(
      'Casual Booster',
    );
    expect(getHallOfFameClassification(entry('1v1', 'competitive-1v1'), sets)).toBe(
      'Competitive 1v1',
    );
  });
});
