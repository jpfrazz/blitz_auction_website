export const BOOSTER_PLAYER_COLORS = [
  '#4a86d8', // P1 blue
  '#d05555', // P2 red
  '#e08a2c', // P3 orange
  '#8e5fd8', // P4 purple
  '#2fa89b',
  '#d95fa8',
  '#6d8bd8',
  '#b88a45',
  '#4aa3d0',
  '#8bbd3f',
];

export function boosterPlayerColor(seatIndex: number): string {
  if (seatIndex < 0) return '#9e9e9e';
  return BOOSTER_PLAYER_COLORS[seatIndex % BOOSTER_PLAYER_COLORS.length];
}

/** Hex-to-rgba helper for pack outlines and hover tints. */
export function boosterColorWithAlpha(color: string, alpha: number): string {
  const hex = color.replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(hex)) return `rgba(158, 158, 158, ${alpha})`;
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Lighten (positive) or darken (negative) a hex color for 1v1-style hovers. */
export function boosterColorShade(color: string, amount: number): string {
  const hex = color.replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(hex)) return '#9e9e9e';
  const target = amount >= 0 ? 255 : 0;
  const ratio = Math.abs(amount);
  const channels = [0, 2, 4].map((start) => {
    const value = parseInt(hex.slice(start, start + 2), 16);
    return Math.round(value + (target - value) * ratio);
  });
  return `#${channels.map((value) => value.toString(16).padStart(2, '0')).join('')}`;
}
