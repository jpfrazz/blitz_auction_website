import type { RunMonStat, StatsAuction } from '../types';
import { EEVEELUTION_IDS } from './eevee';
import type { RunStatLineage } from './runStatLineage';
import { getRunStatsByIcon, RunStatSummary } from './runStatSummary';
import { SPECIES_BY_ID } from './speciesIdMap';
import { getIconName } from './speciesUtils';

const EGG_SPECIES_ID = 1573;

/**
 * The egg can only hatch into one of these four babies. By the time a save is
 * posted the mon may have evolved, so every species in each family maps back to
 * the baby that was actually hatched. Keys are base/dex ids (the `baseId` on
 * SPECIES_BY_ID), which keeps mega forms such as Clefable-Mega in the family.
 */
const EGG_HATCH_FAMILY_BY_BASE_ID: Record<number, string> = {
  35: 'Cleffa',       // Clefairy
  36: 'Cleffa',       // Clefable (including Mega Clefable)
  173: 'Cleffa',      // Cleffa
  39: 'Igglybuff',    // Jigglypuff
  40: 'Igglybuff',    // Wigglytuff
  174: 'Igglybuff',   // Igglybuff
  183: 'Azurill',     // Marill
  184: 'Azurill',     // Azumarill
  298: 'Azurill',     // Azurill
  175: 'Togepi',      // Togepi
  176: 'Togepi',      // Togetic
  468: 'Togepi',      // Togekiss
};

export function isEggAuction(auction: StatsAuction): boolean {
  return auction.name.trim().toLowerCase().startsWith('egg');
}

export interface EggHatchStats {
  speciesId: number;
  name: string;
  summary: RunStatSummary;
}

/**
 * The egg's contents are not stored with the draft, so infer them from the
 * saved run: every drafted mon (and the gifted Eevee) is matched to its run
 * stat entry first, and the one remaining entry is the hatched Pokémon. Only
 * Igglybuff/Azurill/Togepi/Cleffa and their evolutions qualify, so unrelated
 * leftover mons can't be mistaken for the hatch.
 *
 * Returns null when there is no hatched mon or the match is ambiguous, so a
 * wrong species is never attributed to the egg.
 */
export function findEggHatchStats(
  stats: RunMonStat[] | null | undefined,
  auctions: StatsAuction[],
  lineage: RunStatLineage | null
): EggHatchStats | null {
  const draftedIcons = new Set<string>();
  for (const auction of auctions) {
    if (isEggAuction(auction)) continue;
    const fullName = auction.form ? `${auction.name}-${auction.form}` : auction.name;
    draftedIcons.add(getIconName(fullName));
  }

  const seen = new Set<string>();
  const candidates = (stats ?? []).filter((mon) => {
    if (mon.species_id === EGG_SPECIES_ID || EEVEELUTION_IDS.has(mon.species_id)) return false;

    const species = SPECIES_BY_ID[mon.species_id];
    const hatchName = species ? EGG_HATCH_FAMILY_BY_BASE_ID[species.baseId] : undefined;
    if (!hatchName) return false;

    const identity = `${mon.personality >>> 0}-${mon.species_id}`;
    if (seen.has(identity)) return false;
    seen.add(identity);

    const mappedIcons = lineage?.getIcons(mon.species_id) ?? [];
    const icons = mappedIcons.length > 0
      ? mappedIcons
      : [getIconName(species?.name ?? '', mon.species_id)];
    return !icons.some((icon) => draftedIcons.has(icon));
  });

  if (candidates.length !== 1) return null;

  const mon = candidates[0];
  const byIcon = getRunStatsByIcon([mon], lineage);
  let summary: RunStatSummary | undefined;
  byIcon.forEach((value) => {
    if (!summary) summary = value;
  });
  if (!summary) {
    summary = {
      koCount: mon.ko_count,
      totalTurns: mon.total_turns,
      fainted: mon.fainted,
      faintedLevel: mon.fainted ? mon.level : null,
    };
  }

  const species = SPECIES_BY_ID[mon.species_id];
  return {
    speciesId: mon.species_id,
    name: (species && EGG_HATCH_FAMILY_BY_BASE_ID[species.baseId]) || species?.name || `ID ${mon.species_id}`,
    summary,
  };
}
