import { StatsAuction, StatsPageTeamRow } from '../../types';
import { resolvePokemonIdentity } from '../../shared/utils/pokemonIdentity';

export function boosterLeftoverOrders(auctions: StatsAuction[]): Map<string, number> {
  const orders = new Map<string, number>();
  auctions.forEach((auction) => {
    if (auction.draft_type !== 'booster' || auction.action !== 'LEFTOVER') return;
    const previous = orders.get(auction.draft_id);
    if (previous === undefined || auction.draft_order < previous) {
      orders.set(auction.draft_id, auction.draft_order);
    }
  });
  return orders;
}

/**
 * Every booster player makes one pick per pass and team-8 drafts run 8 passes,
 * so the competitive baseline is `8 * players` numbered picks. A three-player
 * draft stops partway through its third circuit; it no longer gets a ninth
 * numbered pick just because all three packs used to complete a circuit.
 */
function boosterPickBaseline(players: number): number {
  return 8 * players;
}

/**
 * Booster drafts with 9/10-card teams add one or two extra final passes.
 * Bans are persisted with negative draft orders, so a normal team-8 booster
 * numbers only `8 * N` picks before the leftovers; a team-9 booster adds N
 * picks and a team-10 booster adds 2N. Anything later than the team-8 leftover
 * order came from extra passes. The completed pick count is also a fallback
 * for drafts without persisted leftovers.
 */
export function casualBoosterDraftIds(
  auctions: StatsAuction[],
  teams: StatsPageTeamRow[],
): Set<string> {
  const teamCounts = new Map<string, number>();
  const teamSizes = new Map<string, number>();
  teams.forEach((team) => {
    teamCounts.set(team.draft_id, (teamCounts.get(team.draft_id) ?? 0) + 1);
    teamSizes.set(
      team.draft_id,
      Math.max(teamSizes.get(team.draft_id) ?? 0, team.pokemon_drafted ?? 0),
    );
  });

  const pickCounts = new Map<string, number>();
  auctions.forEach((auction) => {
    if (auction.draft_type !== 'booster' || auction.action !== 'PICK') return;
    pickCounts.set(auction.draft_id, (pickCounts.get(auction.draft_id) ?? 0) + 1);
  });

  const leftoverOrders = boosterLeftoverOrders(auctions);
  const casualIds = new Set<string>();

  pickCounts.forEach((picks, draftId) => {
    const players = teamCounts.get(draftId) ?? 0;
    if (players <= 0) return;

    const baseline = boosterPickBaseline(players);
    const teamSize = teamSizes.get(draftId) ?? 0;
    if (teamSize >= 9) {
      casualIds.add(draftId);
      return;
    }

    const leftoverOrder = leftoverOrders.get(draftId);
    if (leftoverOrder !== undefined) {
      if (leftoverOrder > baseline + 1) casualIds.add(draftId);
      return;
    }

    // Team 10 makes baseline + 2N picks. Team 8 makes baseline picks and team
    // 9 makes baseline + N, so neither can reach the team-10 count.
    if (picks >= baseline + 2 * players) casualIds.add(draftId);
  });

  return casualIds;
}

/**
 * Booster picks are persisted with a positive, per-draft `draft_order`. Bans
 * use negative orders and leftovers come after the final pick, so only PICK
 * rows contribute to the average-pick-number stat.
 */
export function boosterPickSlot(auction: StatsAuction): number | null {
  if (auction.draft_type !== 'booster' || auction.action !== 'PICK') return null;
  return auction.draft_order > 0 ? auction.draft_order : null;
}

/** Competitive boosters with a save, matching the 1v1 pick-stat eligibility. */
export function playedBoosterDraftIds(
  auctions: StatsAuction[],
  teams: StatsPageTeamRow[],
): Set<string> {
  const casualIds = casualBoosterDraftIds(auctions, teams);
  const savedIds = new Set(
    teams.filter((team) => team.has_save).map((team) => team.draft_id),
  );
  return new Set(Array.from(savedIds).filter((id) => !casualIds.has(id)));
}

/**
 * Per-Pokémon pick numbers for booster drafts. Mirrors `buildOneVOnePickMap`
 * so the cost breakdown chart can consume booster numbers the same way once
 * the UI columns are added.
 */
export function buildBoosterPickMap(
  auctions: StatsAuction[] | undefined,
  playedDraftIds: Set<string>,
  excludeDraftIds: Set<string> = new Set(),
): Map<string, number[]> {
  const map = new Map<string, number[]>();
  (auctions ?? []).forEach((auction) => {
    if (!playedDraftIds.has(auction.draft_id)) return;
    if (excludeDraftIds.has(auction.draft_id)) return;

    const slot = boosterPickSlot(auction);
    if (slot === null) return;

    const { key } = resolvePokemonIdentity(auction.name || '', auction.form || '');
    const picks = map.get(key) ?? [];
    picks.push(slot);
    map.set(key, picks);
  });
  return map;
}

export interface BoosterPickStat {
  average: number | null;
  total: number;
  movement: number | null;
}

export function averagePickNumber(picks: number[]): number | null {
  if (picks.length === 0) return null;
  return picks.reduce((sum, pick) => sum + pick, 0) / picks.length;
}

/** Combined current/historic averages, ready for a future chart column. */
export function buildBoosterPickStats(
  currentPicks: Map<string, number[]>,
  historicPicks: Map<string, number[]> = new Map(),
): Map<string, BoosterPickStat> {
  const stats = new Map<string, BoosterPickStat>();
  currentPicks.forEach((picks, key) => {
    const average = averagePickNumber(picks);
    const historicAverage = averagePickNumber(historicPicks.get(key) ?? []);
    stats.set(key, {
      average,
      total: picks.length,
      movement: average !== null && historicAverage !== null ? average - historicAverage : null,
    });
  });
  return stats;
}
