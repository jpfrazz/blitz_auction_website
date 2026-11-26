import type { CSSProperties } from 'react';
import type { HallOfFamePokemon } from '../types';
import { HOF_SPRITE_BY_ICON, HOF_SPRITE_BY_NAME } from './hofSpriteMap';
import { getIconName } from './speciesUtils';

// Layout of the Hall of Fame diorama. The trophy sits at the point of a V and
// the winning team is split evenly between its two arms. Within an arm, the
// pokemon closest to the trophy are in the foreground (lowest on screen and
// painted on top of the pokemon receding behind them).

export interface DioramaSlot {
  pokemon: HallOfFamePokemon;
  side: 'left' | 'right';
  /** 0 is closest to the trophy / in the foreground; larger values are deeper. */
  depth: number;
}

export interface DioramaSides {
  /** Rendered outermost first, so the last slot is the one beside the trophy. */
  left: DioramaSlot[];
  /** Rendered innermost first, so the first slot is the one beside the trophy. */
  right: DioramaSlot[];
}

export const HOF_DIORAMA_DEPTH_STEP_PX = 12;
export const HOF_DIORAMA_DEPTH_SCALE_STEP = 0.04;
const MAX_STYLED_DEPTH = 5;

/** Split a six-pokemon winning team into the two arms of the diorama. */
export const buildDioramaSlots = (
  team: readonly HallOfFamePokemon[],
): DioramaSides => {
  const leftCount = Math.floor(team.length / 2);

  // Left arm: rendered in team order, with the first member at the back of the
  // arm and the last one beside the trophy in the foreground.
  const left = team.slice(0, leftCount).map((pokemon, index) => ({
    pokemon,
    side: 'left' as const,
    depth: leftCount - 1 - index,
  }));

  // Right arm: team members N+1..end start next to the trophy and recede outward.
  const right = team.slice(leftCount).map((pokemon, index) => ({
    pokemon,
    side: 'right' as const,
    depth: index,
  }));

  return { left, right };
};

/**
 * Depth styling for a slot: background pokemon ride slightly higher, shrink a
 * little, and sit behind anything closer to the foreground.
 */
export const getDioramaSlotStyle = (slot: DioramaSlot): CSSProperties => {
  const depth = Math.min(Math.max(slot.depth, 0), MAX_STYLED_DEPTH);
  return {
    zIndex: 30 - depth,
    transform: `translateY(${-depth * HOF_DIORAMA_DEPTH_STEP_PX}px) scale(${Number(
      (1 - depth * HOF_DIORAMA_DEPTH_SCALE_STEP).toFixed(2),
    )})`,
  };
};

const unique = (values: string[]): string[] => Array.from(new Set(values));

// Some teams store the plain species name while the sprite folder only has a
// regional form (e.g. "Perrserker" -> Perrserker-Galar.png).
const REGIONAL_FORMS = ['Alola', 'Galar', 'Hisui', 'Paldea'];

/** Convert a display name to the PascalCase naming used by the sprite folders. */
const toSpriteName = (name: string): string =>
  name
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\.$/, '')
    .replace(/(^|[\s-])([a-z])/g, (_, separator: string, letter: string) =>
      `${separator}${letter.toUpperCase()}`,
    );

interface NameCandidates {
  /** Names that match the stored name closely; tried in both sprite folders first. */
  primary: string[];
  /** Form/base-name guesses; only tried if no exact sprite exists. */
  secondary: string[];
}

const getNameCandidates = (name: string): NameCandidates => {
  const trimmed = name?.trim();
  if (!trimmed || trimmed === '???') return { primary: [], secondary: [] };

  const base = toSpriteName(trimmed);
  const lower = trimmed.toLowerCase();
  const primary: string[] = [];
  const secondary: string[] = [];

  // Database-style "Mega Charizard X" -> "Charizard X-Mega".
  const megaDisplay = lower.match(/^mega\s+(.+?)(?:\s+(x|y|z))?$/);
  if (megaDisplay) {
    const core = toSpriteName(megaDisplay[1]);
    const letter = megaDisplay[2]?.toUpperCase();
    if (letter) {
      primary.push(
        `${core} ${letter}-Mega`,
        `${core}-Mega ${letter}`,
        `${core}-Mega_${letter}`,
      );
    } else {
      primary.push(`${core}-Mega`);
    }
    primary.push(base);
  } else {
    // ROM-style names ("Charizard-Mega_Y") usually match a sprite as-is, but
    // the X spelling in the folders is "Charizard X-Mega", so try both.
    primary.push(base);
    const romMegaWithLetter = lower.match(/^(.+?)-mega[ _-]?(x|y|z)$/);
    if (romMegaWithLetter) {
      primary.push(
        `${toSpriteName(romMegaWithLetter[1])} ${romMegaWithLetter[2].toUpperCase()}-Mega`,
      );
    }
  }

  if (!lower.startsWith('mega ') && !base.includes('-')) {
    REGIONAL_FORMS.forEach((form) => secondary.push(`${base}-${form}`));
  }

  // A form without its own sprite can still show the base form.
  const formSeparator = base.indexOf('-');
  if (formSeparator > 0) {
    secondary.push(base.slice(0, formSeparator));
  }

  return { primary: unique(primary), secondary: unique(secondary) };
};

/** Candidate sprite file names, exact matches first. */
export const getDioramaImageNames = (name: string): string[] => {
  const { primary, secondary } = getNameCandidates(name);
  return unique([...primary, ...secondary]);
};

/** Match the normalized keys used by the generated species->sprite map. */
const mapKey = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');

/**
 * Ordered image URLs to try, from the preferred full sprite to the fallback.
 * Known species resolve directly through the generated map, which covers form
 * names the sprite folders spell differently (Flabébé-Red, Basculegion-M,
 * Kommo-o, etc.). Unrecognized/admin-entered names still use name guesses.
 */
export const getDioramaImageSources = (name: string, icon?: string): string[] => {
  const { primary, secondary } = getNameCandidates(name);
  const trimmed = name?.trim();
  const nameKey = trimmed && trimmed !== '???' ? mapKey(trimmed) : '';
  const iconKey = icon?.trim() ? mapKey(icon) : '';
  const mapped =
    (nameKey && HOF_SPRITE_BY_NAME[nameKey]) ||
    (iconKey && HOF_SPRITE_BY_ICON[iconKey]);

  const sources: string[] = [];
  if (mapped) sources.push(mapped);
  sources.push(
    ...primary.map((spriteName) => `/evolutions/${encodeURI(spriteName)}.png`),
    ...primary.map((spriteName) => `/baseforms/${encodeURI(spriteName)}.png`),
    ...secondary.map((spriteName) => `/evolutions/${encodeURI(spriteName)}.png`),
    ...secondary.map((spriteName) => `/baseforms/${encodeURI(spriteName)}.png`),
  );

  if (nameKey) {
    const iconName = getIconName(name);
    sources.push(`/MiniIcons/${iconName}.png`);
    if (icon && icon !== iconName) {
      sources.push(`/MiniIcons/${icon}.png`);
    }
  }
  sources.push('/MiniIcons/question.png');

  return unique(sources);
};
