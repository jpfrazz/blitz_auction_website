import type { AdminHallOfFameEligibleEntry } from '../types';

export interface HallOfFameDraftSets {
  validDraftIds: ReadonlySet<string>;
  casual1v1DraftIds: ReadonlySet<string>;
  casualBoosterDraftIds?: ReadonlySet<string>;
}

export type HallOfFameDraftType = 'Auction' | 'Booster' | '1v1';

/** The plain-text portion of a Hall of Fame classification row. */
export const getHallOfFameDraftType = (
  draftType: string,
): HallOfFameDraftType => {
  if (draftType === 'booster') return 'Booster';
  if (draftType === '1v1') return '1v1';
  return 'Auction';
};

/** Casual/competitive status uses the same draft lists as the old badge. */
export const isCasualHallOfFameDraft = (
  entry: AdminHallOfFameEligibleEntry,
  sets: HallOfFameDraftSets,
): boolean => {
  if (entry.draft_type === 'booster') {
    return sets.casualBoosterDraftIds?.has(entry.draft_id) ?? false;
  }
  if (entry.draft_type === '1v1') {
    return sets.casual1v1DraftIds.has(entry.draft_id);
  }
  return !sets.validDraftIds.has(entry.draft_id);
};

/** e.g. "Competitive Auction" or "Casual Booster". */
export const getHallOfFameClassification = (
  entry: AdminHallOfFameEligibleEntry,
  sets: HallOfFameDraftSets,
): string =>
  `${isCasualHallOfFameDraft(entry, sets) ? 'Casual' : 'Competitive'} ${getHallOfFameDraftType(entry.draft_type)}`;

/** RGB triplets used by the spotlights and bottom glow for each race type. */
export const HALL_OF_FAME_GLOW_RGB = {
  auction: '124, 185, 70',
  booster: '79, 195, 247',
  '1v1': '255, 176, 46',
} as const;

/** Unknown draft types fall back to the auction glow. */
export const getHallOfFameGlowRgb = (draftType: string): string =>
  HALL_OF_FAME_GLOW_RGB[draftType as keyof typeof HALL_OF_FAME_GLOW_RGB] ??
  HALL_OF_FAME_GLOW_RGB.auction;

/** e.g. "1:29:58" from the stored hour/minute/second fields. */
export const formatHallOfFameTime = (
  entry: AdminHallOfFameEligibleEntry,
): string => {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${entry.hours}:${pad(entry.minutes)}:${pad(entry.seconds)}`;
};

/** e.g. "11/26/26"; empty when the entry has no beat date. */
export const formatHallOfFameDate = (beatDate: string): string => {
  if (!beatDate) return '';
  return new Date(beatDate).toLocaleDateString('en-US', {
    month: 'numeric',
    day: 'numeric',
    year: '2-digit',
  });
};
