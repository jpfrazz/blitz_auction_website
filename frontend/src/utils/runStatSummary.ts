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

const COMBINED_PLUSLE_MINUN_ICONS = ['plusle', 'minun'] as const;

/**
 * The auction has one "Plusle and Minun" pick, but the save stores them as two
 * separate species. Sum both halves so the combined row gets the pair's total.
 */
function isCombinedPlusleMinunPick(fullName: string): boolean {
  const normalized = fullName.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return normalized.includes('plusle') && normalized.includes('minun');
}

function mergeRunStats(summaries: RunStatSummary[]): RunStatSummary {
  const hasKos = summaries.some((summary) => summary.koCount != null);
  const hasTurns = summaries.some((summary) => summary.totalTurns != null);
  return {
    koCount: hasKos
      ? summaries.reduce((total, summary) => total + (summary.koCount ?? 0), 0)
      : null,
    totalTurns: hasTurns
      ? summaries.reduce((total, summary) => total + (summary.totalTurns ?? 0), 0)
      : null,
    fainted: summaries.some((summary) => summary.fainted),
    faintedLevel: summaries.find((summary) => summary.faintedLevel != null)?.faintedLevel ?? null,
  };
}

/** Resolve a drafted pick's run stats, including the two-for-one Plusle/Minun pick. */
export function getRunStatsForPick(
  statsByIcon: Map<string, RunStatSummary>,
  fullName: string
): RunStatSummary | undefined {
  if (!isCombinedPlusleMinunPick(fullName)) {
    return statsByIcon.get(getIconName(fullName));
  }

  const combined = COMBINED_PLUSLE_MINUN_ICONS
    .map((icon) => statsByIcon.get(icon))
    .filter((summary): summary is RunStatSummary => Boolean(summary));
  if (combined.length === 0) return undefined;
  return mergeRunStats(combined);
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
