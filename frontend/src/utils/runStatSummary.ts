import type { RunMonStat } from '../types';
import { SPECIES_BY_ID } from './speciesIdMap';
import type { RunStatLineage } from './runStatLineage';
import { getIconName } from './speciesUtils';

export interface RunStatSummary {
  koCount: number | null;
  totalTurns: number | null;
  fainted: boolean;
  faintedLevel: number | null;
}

/**
 * Shared KO/turn attribution for the player profile run charts and the Cost
 * Breakdown Average KOs column.
 *
 * Key by MiniIcons name so save-file species ids line up with the drafted
 * Pokémon list (which carries display names and forms instead of ROM ids).
 * A save holds the species a mon has *become*, so each mon is attributed to
 * every species in its evolution line — that keeps an evolved mon's numbers on
 * the row for the Pokémon that was actually drafted.
 */
export function getRunStatsByIcon(
  stats: RunMonStat[] | null | undefined,
  lineage: RunStatLineage | null
): Map<string, RunStatSummary> {
  const byIcon = new Map<string, RunStatSummary>();
  (stats ?? []).forEach((mon) => {
    const speciesName = SPECIES_BY_ID[mon.species_id]?.name ?? '';
    const mappedIcons = lineage?.getIcons(mon.species_id) ?? [];
    const icons = mappedIcons.length > 0 ? mappedIcons : [getIconName(speciesName, mon.species_id)];
    icons.forEach((icon) => {
      const existing = byIcon.get(icon);
      if (!existing) {
        byIcon.set(icon, {
          koCount: mon.ko_count,
          totalTurns: mon.total_turns,
          fainted: mon.fainted,
          faintedLevel: mon.fainted ? mon.level : null,
        });
        return;
      }
      if (mon.ko_count != null) existing.koCount = (existing.koCount ?? 0) + mon.ko_count;
      if (mon.total_turns != null) existing.totalTurns = (existing.totalTurns ?? 0) + mon.total_turns;
      if (mon.fainted) {
        existing.fainted = true;
        if (existing.faintedLevel == null && mon.level != null) existing.faintedLevel = mon.level;
      }
    });
  });
  return byIcon;
}
