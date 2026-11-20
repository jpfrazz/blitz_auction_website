import { resolvePokemonIdentity } from '../../shared/utils/pokemonIdentity';
import type { RunStatLineage } from '../../utils/runStatLineage';
import { getRunStatsByIcon } from '../../utils/runStatSummary';
import { getIconName } from '../../utils/speciesUtils';
import type {
  RunMonStat,
  StatsAuction,
  StatsPagePlayer,
  StatsPageTeamRow,
  WinningRunKoSample,
} from '../../types';

interface KoTotal {
  sum: number;
  count: number;
}

function isDraftedPick(auction: StatsAuction): boolean {
  if (auction.draft_type === '1v1') {
    return auction.action === 'PICK';
  }
  return auction.winning_bid !== null && auction.winning_bid !== undefined;
}

/**
 * Averages the KO counts shown on the player profile run charts across winning
 * runs only. Backend samples are limited to runs that beat Steven/Wally; each
 * sample is fed through the same `getRunStatsByIcon` lineage mapping the
 * profile charts use, then matched to the picks that winning team drafted.
 */
export function computeAverageKosByPokemonKey(
  samples: WinningRunKoSample[],
  auctions: StatsAuction[],
  teams: StatsPageTeamRow[],
  players: StatsPagePlayer[],
  lineage: RunStatLineage,
): Map<string, number> {
  const samplesByTeam = new Map<number, WinningRunKoSample[]>();
  for (const sample of samples) {
    if (sample.ko_count == null) continue;
    const bucket = samplesByTeam.get(sample.team_id) ?? [];
    bucket.push(sample);
    samplesByTeam.set(sample.team_id, bucket);
  }

  const averages = new Map<string, number>();
  if (samplesByTeam.size === 0) return averages;

  const teamById = new Map(teams.map((team) => [team.team_id, team]));

  const guestIdsByUserId = new Map<string, Set<string>>();
  for (const player of players) {
    if (!player.is_guest || !player.linked_user_id) continue;
    const bucket = guestIdsByUserId.get(player.linked_user_id) ?? new Set<string>();
    bucket.add(player.user_id);
    guestIdsByUserId.set(player.linked_user_id, bucket);
  }

  const auctionsByDraft = new Map<string, StatsAuction[]>();
  for (const auction of auctions) {
    const bucket = auctionsByDraft.get(auction.draft_id) ?? [];
    bucket.push(auction);
    auctionsByDraft.set(auction.draft_id, bucket);
  }

  const totals = new Map<string, KoTotal>();

  samplesByTeam.forEach((samplesForTeam, teamId) => {
    const team = teamById.get(teamId);
    const first = samplesForTeam[0];
    const draftId = team?.draft_id ?? first.draft_id;
    const ownerUserId = team?.user_id ?? first.user_id;
    const ownerGuestId = team?.guest_id ?? first.guest_id;

    const accountIds = new Set<string>();
    [ownerUserId, first.user_id].forEach((id) => {
      if (!id) return;
      accountIds.add(id);
      (guestIdsByUserId.get(id) ?? []).forEach((guestId) => accountIds.add(guestId));
    });
    if (ownerGuestId) accountIds.add(ownerGuestId);
    if (first.guest_id) accountIds.add(first.guest_id);

    // Same shape the profile run charts receive from /api/match-history. Only
    // KO counts are needed here, so the other fields use neutral defaults.
    const runStats: RunMonStat[] = samplesForTeam.map((sample) => ({
      species_id: sample.species_id,
      personality: 0,
      ko_count: sample.ko_count,
      total_turns: null,
      level: null,
      fainted: false,
    }));
    const runStatsByIcon = getRunStatsByIcon(runStats, lineage);

    const seenKeys = new Set<string>();
    for (const auction of auctionsByDraft.get(draftId) ?? []) {
      if (!isDraftedPick(auction)) continue;
      const wonByUser = auction.winning_user_id != null && accountIds.has(auction.winning_user_id);
      const wonByGuest = auction.winning_guest_id != null && accountIds.has(auction.winning_guest_id);
      if (!wonByUser && !wonByGuest) continue;

      const identity = resolvePokemonIdentity(auction.name || '', auction.form || '');
      if (seenKeys.has(identity.key)) continue;
      seenKeys.add(identity.key);

      const fullName = auction.form ? `${auction.name}-${auction.form}` : auction.name;
      const koCount = runStatsByIcon.get(getIconName(fullName))?.koCount;
      if (koCount == null) continue;

      const total = totals.get(identity.key) ?? { sum: 0, count: 0 };
      total.sum += koCount;
      total.count += 1;
      totals.set(identity.key, total);
    }
  });

  totals.forEach((total, key) => {
    if (total.count > 0) averages.set(key, total.sum / total.count);
  });

  return averages;
}
