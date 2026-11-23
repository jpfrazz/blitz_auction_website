export const PICK_COLOR = '#7CB946';
export const BAN_COLOR = '#66b2ff';
export const OUTLIER_COLOR = '#8B0000';

/** Bans / 29s are blue unless that point is itself a statistical outlier. */
export function getPickHistoryDotColor(isBan: boolean, isOutlier: boolean): string {
  if (isOutlier) return OUTLIER_COLOR;
  if (isBan) return BAN_COLOR;
  return PICK_COLOR;
}
