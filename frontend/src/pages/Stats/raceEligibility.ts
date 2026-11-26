import type { BossBattleHistoryEntry } from '../../shared/api/stats';
import type { MatchHistoryTeam } from '../../types';

/** Minimal shape needed to decide whether a race is a casual draft. */
export interface RaceEligibilityRef {
  draft_id: string;
  draft_type?: string | null;
}

/**
 * Shared definition of a non-casual race:
 * - auctions must pass the site's competitive-draft validation (`validDraftIds`)
 * - 1v1s must not be one of the large-pool casual 1v1 drafts
 */
export function isNonCasualRace(
  race: RaceEligibilityRef,
  validDraftIds: Set<string>,
  casual1v1DraftIds: Set<string>,
  casualBoosterDraftIds: Set<string> = new Set(),
): boolean {
  if (race.draft_type === 'booster') {
    return !casualBoosterDraftIds.has(race.draft_id);
  }
  if (race.draft_type === '1v1') {
    return !casual1v1DraftIds.has(race.draft_id);
  }
  return validDraftIds.has(race.draft_id);
}

const CHAMPION_TRAINER_IDS = new Set([804, 656]);

export function isChampionWin(entry: BossBattleHistoryEntry): boolean {
  return !entry.is_loss && CHAMPION_TRAINER_IDS.has(entry.trainer_id);
}

/** Fastest champion win from non-casual races only. */
export function computePersonalBestSeconds(
  matchHistory: MatchHistoryTeam[],
  bossBattleHistory: Map<number, BossBattleHistoryEntry[]>,
  validDraftIds: Set<string>,
  casual1v1DraftIds: Set<string>,
  casualBoosterDraftIds: Set<string> = new Set(),
): number | null {
  let bestSeconds: number | null = null;

  matchHistory.forEach((team) => {
    if (!isNonCasualRace(team, validDraftIds, casual1v1DraftIds, casualBoosterDraftIds)) return;

    (bossBattleHistory.get(team.team_id) ?? []).forEach((battle) => {
      if (!isChampionWin(battle)) return;
      const seconds = battle.hours * 3600 + battle.minutes * 60 + battle.seconds;
      if (bestSeconds === null || seconds < bestSeconds) bestSeconds = seconds;
    });
  });

  return bestSeconds;
}
