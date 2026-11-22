import { resolvePokemonIdentity } from '../../shared/utils/pokemonIdentity';
import { findEggHatchStats, isEggAuction } from '../../utils/eggHatchStats';
import type { RunStatLineage } from '../../utils/runStatLineage';
import { getRunStatsByIcon } from '../../utils/runStatSummary';
import { getIconName } from '../../utils/speciesUtils';
import type {
  RunMonStat,
  StatsAuction,
  StatsPagePlayer,
  StatsPageTeamRow,
  WinningRace,
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

function buildGuestIdsByUserId(players: StatsPagePlayer[]): Map<string, Set<string>> {
  const guestIdsByUserId = new Map<string, Set<string>>();
  for (const player of players) {
    if (!player.is_guest || !player.linked_user_id) continue;
    const bucket = guestIdsByUserId.get(player.linked_user_id) ?? new Set<string>();
    bucket.add(player.user_id);
    guestIdsByUserId.set(player.linked_user_id, bucket);
  }
  return guestIdsByUserId;
}

function buildAccountIds(
  ids: Array<string | null | undefined>,
  guestIdsByUserId: Map<string, Set<string>>,
): Set<string> {
  const accountIds = new Set<string>();
  for (const id of ids) {
    if (!id) continue;
    accountIds.add(id);
    (guestIdsByUserId.get(id) ?? []).forEach((guestId) => accountIds.add(guestId));
  }
  return accountIds;
}

function buildAuctionsByDraft(auctions: StatsAuction[]): Map<string, StatsAuction[]> {
  const auctionsByDraft = new Map<string, StatsAuction[]>();
  for (const auction of auctions) {
    const bucket = auctionsByDraft.get(auction.draft_id) ?? [];
    bucket.push(auction);
    auctionsByDraft.set(auction.draft_id, bucket);
  }
  return auctionsByDraft;
}

function ownerWonAuction(auction: StatsAuction, accountIds: Set<string>): boolean {
  return (auction.winning_user_id != null && accountIds.has(auction.winning_user_id))
    || (auction.winning_guest_id != null && accountIds.has(auction.winning_guest_id));
}

/**
 * Averages the KO counts shown on the player profile run charts across winning
 * runs only. Backend samples are limited to runs that beat Steven/Wally; each
 * sample is fed through the same `getRunStatsByIcon` lineage mapping the
 * profile charts use, then matched to the picks that winning team drafted.
 *
 * The egg's contents are not stored on the draft row, so an unmatched hatch-
 * family mon is inferred for that team and its KOs are attributed to the Egg
 * row instead of to Azurill/Cleffa/Igglybuff/Togepi.
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
  const guestIdsByUserId = buildGuestIdsByUserId(players);
  const auctionsByDraft = buildAuctionsByDraft(auctions);
  const totals = new Map<string, KoTotal>();

  samplesByTeam.forEach((samplesForTeam, teamId) => {
    const team = teamById.get(teamId);
    const first = samplesForTeam[0];
    const draftId = team?.draft_id ?? first.draft_id;

    const accountIds = buildAccountIds(
      [team?.user_id, team?.guest_id, first.user_id, first.guest_id],
      guestIdsByUserId,
    );

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

    const ownedPicks = (auctionsByDraft.get(draftId) ?? []).filter(
      (auction) => isDraftedPick(auction) && ownerWonAuction(auction, accountIds),
    );
    const eggHatch = ownedPicks.some(isEggAuction)
      ? findEggHatchStats(runStats, ownedPicks, lineage)
      : null;

    const seenKeys = new Set<string>();
    for (const auction of ownedPicks) {
      const identity = resolvePokemonIdentity(auction.name || '', auction.form || '');
      if (seenKeys.has(identity.key)) continue;
      seenKeys.add(identity.key);

      const fullName = auction.form ? `${auction.name}-${auction.form}` : auction.name;
      const koCount = isEggAuction(auction)
        ? eggHatch?.summary.koCount
        : runStatsByIcon.get(getIconName(fullName))?.koCount;
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

/**
 * Counts races in which the winning team had drafted/picked that Pokémon and
 * then beat Steven or Wally. Auction eligibility comes from the same
 * `validDraftIds` used by Cost Breakdown and player profiles, so unranked
 * auctions count as long as they are not casual drafts. This deliberately uses
 * the draft rows rather than the saved run, so a win still counts without KO
 * data and evolution/form changes (including an egg hatch) stay on the drafted
 * row.
 */
export function computeWinningPicksByPokemonKey(
  races: WinningRace[],
  auctions: StatsAuction[],
  teams: StatsPageTeamRow[],
  players: StatsPagePlayer[],
  validAuctionDraftIds: Set<string>,
  casualOneVOneDraftIds: Set<string>,
): Map<string, number> {
  const wins = new Map<string, number>();
  if (races.length === 0) return wins;

  const teamById = new Map(teams.map((team) => [team.team_id, team]));
  const guestIdsByUserId = buildGuestIdsByUserId(players);
  const auctionsByDraft = buildAuctionsByDraft(auctions);

  for (const race of races) {
    if (race.draft_type === '1v1') {
      if (casualOneVOneDraftIds.has(race.draft_id)) continue;
    } else if (!validAuctionDraftIds.has(race.draft_id)) {
      continue;
    }

    const team = teamById.get(race.team_id);
    const accountIds = buildAccountIds(
      [team?.user_id, team?.guest_id, race.user_id, race.guest_id],
      guestIdsByUserId,
    );

    const seenKeys = new Set<string>();
    for (const auction of auctionsByDraft.get(race.draft_id) ?? []) {
      if (!isDraftedPick(auction) || !ownerWonAuction(auction, accountIds)) continue;
      const { key } = resolvePokemonIdentity(auction.name || '', auction.form || '');
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      wins.set(key, (wins.get(key) ?? 0) + 1);
    }
  }

  return wins;
}
