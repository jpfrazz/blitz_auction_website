import { resolvePokemonIdentity } from '../../shared/utils/pokemonIdentity';
import { isNonCasualRace } from './raceEligibility';
import { findEggHatchStats, isEggAuction } from '../../utils/eggHatchStats';
import type { RunStatLineage } from '../../utils/runStatLineage';
import { getRunStatsByIcon, getRunStatsForPick } from '../../utils/runStatSummary';
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
  // 1v1 and booster picks are persisted as no-bid PICK rows, while auction
  // picks carry a winning bid. Booster bans/leftovers must not count as picks.
  if (auction.draft_type === '1v1' || auction.draft_type === 'booster') {
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

interface PickContext {
  teamById: Map<number, StatsPageTeamRow>;
  guestIdsByUserId: Map<string, Set<string>>;
  auctionsByDraft: Map<string, StatsAuction[]>;
}

function buildPickContext(
  teams: StatsPageTeamRow[],
  players: StatsPagePlayer[],
  auctions: StatsAuction[],
): PickContext {
  return {
    teamById: new Map(teams.map((team) => [team.team_id, team])),
    guestIdsByUserId: buildGuestIdsByUserId(players),
    auctionsByDraft: buildAuctionsByDraft(auctions),
  };
}

type OwnedRaceRef = Pick<WinningRace, 'team_id' | 'draft_id' | 'user_id' | 'guest_id'>;

function getOwnedPicksForRace(race: OwnedRaceRef, context: PickContext): StatsAuction[] {
  const team = context.teamById.get(race.team_id);
  const accountIds = buildAccountIds(
    [team?.user_id, team?.guest_id, race.user_id, race.guest_id],
    context.guestIdsByUserId,
  );
  return (context.auctionsByDraft.get(race.draft_id) ?? []).filter(
    (auction) => isDraftedPick(auction) && ownerWonAuction(auction, accountIds),
  );
}

/** KO count per drafted key for one winning team, using the profile-chart rules. */
function getKosByKeyForOwnedPicks(
  ownedPicks: StatsAuction[],
  samplesForTeam: WinningRunKoSample[],
  lineage: RunStatLineage,
): Map<string, number | null> {
  const runStats: RunMonStat[] = samplesForTeam
    .filter((sample) => sample.ko_count != null)
    .map((sample) => ({
      species_id: sample.species_id,
      personality: 0,
      ko_count: sample.ko_count,
      total_turns: null,
      level: null,
      fainted: false,
    }));
  const runStatsByIcon = getRunStatsByIcon(runStats, lineage);
  const eggHatch = ownedPicks.some(isEggAuction)
    ? findEggHatchStats(runStats, ownedPicks, lineage)
    : null;

  const kos = new Map<string, number | null>();
  for (const auction of ownedPicks) {
    const identity = resolvePokemonIdentity(auction.name || '', auction.form || '');
    if (kos.has(identity.key)) continue;
    const fullName = auction.form ? `${auction.name}-${auction.form}` : auction.name;
    kos.set(
      identity.key,
      isEggAuction(auction)
        ? eggHatch?.summary.koCount ?? null
        : getRunStatsForPick(runStatsByIcon, fullName)?.koCount ?? null,
    );
  }
  return kos;
}

function getDraftCreatedAt(team: StatsPageTeamRow | undefined, draftAuctions: StatsAuction[]): string | null {
  if (team?.created_at) return team.created_at;
  const dates = draftAuctions.map((auction) => auction.created_at).filter(Boolean).sort();
  return dates[0] ?? null;
}

/** One win row for the Cost Breakdown "Win History" panel. */
export interface WinHistoryEntry {
  team_id: number;
  draft_id: string;
  user_id: string | null;
  guest_id: string | null;
  draft_type: string;
  created_at: string | null;
  ko_count: number | null;
}

/**
 * Builds per-Pokémon win rows using the same ownership, eligibility and KO
 * attribution rules as the Wins / Avg KOs columns. A missing save produces a
 * row with `ko_count: null` so the UI can show a dash instead of hiding the win.
 */
export function computeWinHistoryByPokemonKey(
  races: WinningRace[],
  samples: WinningRunKoSample[],
  auctions: StatsAuction[],
  teams: StatsPageTeamRow[],
  players: StatsPagePlayer[],
  lineage: RunStatLineage,
  validAuctionDraftIds: Set<string>,
  casualOneVOneDraftIds: Set<string>,
  casualBoosterDraftIds: Set<string> = new Set(),
): Map<string, WinHistoryEntry[]> {
  const history = new Map<string, WinHistoryEntry[]>();
  if (races.length === 0) return history;

  const context = buildPickContext(teams, players, auctions);
  const samplesByTeam = new Map<number, WinningRunKoSample[]>();
  for (const sample of samples) {
    if (sample.ko_count == null) continue;
    const bucket = samplesByTeam.get(sample.team_id) ?? [];
    bucket.push(sample);
    samplesByTeam.set(sample.team_id, bucket);
  }

  for (const race of races) {
    if (!isNonCasualRace(race, validAuctionDraftIds, casualOneVOneDraftIds, casualBoosterDraftIds)) continue;

    const ownedPicks = getOwnedPicksForRace(race, context);
    if (ownedPicks.length === 0) continue;

    const team = context.teamById.get(race.team_id);
    const koByKey = getKosByKeyForOwnedPicks(
      ownedPicks,
      samplesByTeam.get(race.team_id) ?? [],
      lineage,
    );
    const base: Omit<WinHistoryEntry, 'ko_count'> = {
      team_id: race.team_id,
      draft_id: race.draft_id,
      user_id: race.user_id ?? team?.user_id ?? null,
      guest_id: race.guest_id ?? team?.guest_id ?? null,
      draft_type: race.draft_type,
      created_at: getDraftCreatedAt(team, ownedPicks),
    };

    koByKey.forEach((koCount, key) => {
      const rows = history.get(key) ?? [];
      rows.push({ ...base, ko_count: koCount });
      history.set(key, rows);
    });
  }

  return history;
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
  casualBoosterDraftIds: Set<string> = new Set(),
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

  const context = buildPickContext(teams, players, auctions);
  const totals = new Map<string, KoTotal>();

  samplesByTeam.forEach((samplesForTeam, teamId) => {
    const team = context.teamById.get(teamId);
    const first = samplesForTeam[0];
    const draftId = team?.draft_id ?? first.draft_id;
    if (casualBoosterDraftIds.has(draftId)) return;

    const accountIds = buildAccountIds(
      [team?.user_id, team?.guest_id, first.user_id, first.guest_id],
      context.guestIdsByUserId,
    );
    const ownedPicks = (context.auctionsByDraft.get(draftId) ?? []).filter(
      (auction) => isDraftedPick(auction) && ownerWonAuction(auction, accountIds),
    );

    getKosByKeyForOwnedPicks(ownedPicks, samplesForTeam, lineage).forEach((koCount, key) => {
      if (koCount == null) return;
      const total = totals.get(key) ?? { sum: 0, count: 0 };
      total.sum += koCount;
      total.count += 1;
      totals.set(key, total);
    });
  });

  totals.forEach((total, key) => {
    if (total.count > 0) averages.set(key, total.sum / total.count);
  });

  return averages;
}

/**
 * Counts races in which the winning team had drafted/picked that Pokémon and
 * then beat Steven or Wally. Auction drafts use the same `validDraftIds` as
 * Cost Breakdown and player profiles, while 1v1 and booster drafts use their
 * own casual ID sets. This deliberately uses the draft rows rather than the
 * saved run, so a win still counts without KO data and evolution/form changes
 * (including an egg hatch) stay on the drafted row.
 */
export function computeWinningPicksByPokemonKey(
  races: WinningRace[],
  auctions: StatsAuction[],
  teams: StatsPageTeamRow[],
  players: StatsPagePlayer[],
  validAuctionDraftIds: Set<string>,
  casualOneVOneDraftIds: Set<string>,
  casualBoosterDraftIds: Set<string> = new Set(),
): Map<string, number> {
  const wins = new Map<string, number>();
  if (races.length === 0) return wins;

  const context = buildPickContext(teams, players, auctions);

  for (const race of races) {
    if (!isNonCasualRace(race, validAuctionDraftIds, casualOneVOneDraftIds, casualBoosterDraftIds)) continue;

    const seenKeys = new Set<string>();
    for (const auction of getOwnedPicksForRace(race, context)) {
      const { key } = resolvePokemonIdentity(auction.name || '', auction.form || '');
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      wins.set(key, (wins.get(key) ?? 0) + 1);
    }
  }

  return wins;
}

/**
 * Counts one chance to win per non-casual race (auction, 1v1 or booster) where the team
 * drafted/picked that Pokémon and the race has boss battle data. Races with no
 * boss battle history are excluded because the Pokémon had no opportunity to
 * win. Uses the same draft eligibility as `computeWinningPicksByPokemonKey`.
 */
export function computeWinOpportunitiesByPokemonKey(
  teams: StatsPageTeamRow[],
  auctions: StatsAuction[],
  players: StatsPagePlayer[],
  validAuctionDraftIds: Set<string>,
  casualOneVOneDraftIds: Set<string>,
  casualBoosterDraftIds: Set<string> = new Set(),
): Map<string, number> {
  const chances = new Map<string, number>();
  const guestIdsByUserId = buildGuestIdsByUserId(players);
  const auctionsByDraft = buildAuctionsByDraft(auctions);

  for (const team of teams) {
    if (!team.has_boss_battles) continue;
    if (!isNonCasualRace(team, validAuctionDraftIds, casualOneVOneDraftIds, casualBoosterDraftIds)) continue;

    const accountIds = buildAccountIds([team.user_id, team.guest_id], guestIdsByUserId);
    const seenKeys = new Set<string>();
    for (const auction of auctionsByDraft.get(team.draft_id) ?? []) {
      if (!isDraftedPick(auction) || !ownerWonAuction(auction, accountIds)) continue;
      const { key } = resolvePokemonIdentity(auction.name || '', auction.form || '');
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      chances.set(key, (chances.get(key) ?? 0) + 1);
    }
  }

  return chances;
}
