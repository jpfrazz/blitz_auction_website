import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchMatchHistoryByUserId,
  fetchBossBattleHistory,
  fetchHallOfFameEligible,
  fetchMyBossBattleSubmissions,
  fetchPlayerIdByName,
  fetchPlayerProfileStats,
  submitBossBattleSubmission,
  withdrawBossBattleSubmission,
  BossBattleHistoryEntry,
  BossBattleSubmission,
  BossBattleSubmissionBattle,
} from '../../../shared/api/stats';
import BossBattleEditor, { normalizeSubmissionBattles } from '../../../shared/components/BossBattleEditor';
import HallOfFameTeamEditor from '../../../shared/components/HallOfFameTeamEditor';
import {
  AdminHallOfFameEligibleEntry,
  HallOfFamePokemon,
  MatchHistoryTeam,
  Pokemon,
  RentalStat,
  RunMonStat,
  StatsAuction,
  StatsPagePlayer,
} from '../../../types';
import { fetchLeaderboard, fetchSeason2Leaderboard } from '../../../shared/api/users';
import { fetchPokemonList } from '../../../shared/api/pokemon';
import {
  fetchManualAchievements,
  setManualAchievement,
} from '../../../shared/api/achievements';
import { computePlayerAchievements, PlayerAchievement } from '../achievements';
import { computePersonalBestSeconds, isNonCasualRace } from '../raceEligibility';
import AchievementsPanel from './AchievementsPanel';
import { getIconName } from '../../../utils/speciesUtils';
import { SPECIES_BY_ID } from '../../../utils/speciesIdMap';
import { getRunStatLineage, RunStatLineage } from '../../../utils/runStatLineage';
import { getRunStatsByIcon, getRunStatsForPick, RunStatSummary } from '../../../utils/runStatSummary';
import { findEggHatchStats, isEggAuction, EggHatchStats } from '../../../utils/eggHatchStats';
import { EEVEELUTION_IDS } from '../../../utils/eevee';
import { getAvatarUrl, onAvatarError } from '../../../shared/utils/user';
import { fetchCurrentUser } from '../../../shared/api/draftData';
import { resolvePokemonIdentity } from '../../../shared/utils/pokemonIdentity';
import { FiCamera, FiChevronDown } from 'react-icons/fi';
import '../Stats.scss';
import './PlayerSearchStatsTab.scss';
import { casualOneVOneDraftIds, oneVOneLeftoverOrders, oneVOnePickSlot } from '../oneVOneHistory';
import { casualBoosterDraftIds } from '../boosterHistory';
import { computeWinningPicksByPokemonKey } from '../costBreakdownKos';
import { buildOpponentsByDraftId, getSelectedPlayerIdentityIds } from '../opponentLinks';

const SITE_ADMIN_USER_ID = '270029441999175681';

interface PlayerProfileStatsTabProps {
  /** Stable id from the URL. This is the single source of truth for the profile. */
  initialUserId?: string;
  /** Legacy display-name fallback for URLs without an id. */
  initialUserName?: string;
  /** Team id to auto-expand when the profile is opened from a race's results. */
  initialTeamId?: number;
  currentUserId?: string | null;
}

interface PokemonDraftSummary {
  key: string;
  name: string;
  form: string;
  games: number;
  totalSpend: number;
  avgSpend: number;
}

interface PlayerOneVOnePickStats {
  timesPicked: number;
  appearedDraftIds: Set<string>;
}

type RaceCategory = 'auction' | 'casualAuction' | 'oneVOne' | 'casualOneVOne' | 'booster' | 'casualBooster';

function formatPokemonName(name: string | undefined): string {
  if (!name) return '';
  const lower = name.toLowerCase();
  if (lower.startsWith("farfetch'd")) {
    return "farfetch'd";
  }
  return lower.replace(/'/g, '');
}

function getPlacementLabel(placement: number | null, isRanked: boolean): string {
  if (!isRanked || placement === null) {
    return 'Normal';
  }

  const suffix = placement % 10 === 1 && placement % 100 !== 11
    ? 'st'
    : placement % 10 === 2 && placement % 100 !== 12
      ? 'nd'
      : placement % 10 === 3 && placement % 100 !== 13
        ? 'rd'
        : 'th';

  return `Ranked: ${placement}${suffix}`;
}

function getPlacementClass(placement: number | null, isRanked: boolean): string {
  if (!isRanked || placement === null || placement > 3) {
    return 'normal';
  }

  if (placement === 1) return 'first';
  if (placement === 2) return 'second';
  return 'third';
}

function getPokemonLabel(name: string, form: string): string {
  return form ? `${name} (${form})` : name;
}

// Every race falls into exactly one of these four buckets. Auctions are
// "competitive" when the draft passes the site's validation rules; 1v1s use
// their own casual detection based on the leftover pick order.
function getRaceCategory(
  team: MatchHistoryTeam,
  validDraftIds: Set<string>,
  casual1v1DraftIds: Set<string>,
  casualBoosterIds: Set<string>
): RaceCategory {
  if (team.draft_type === 'booster') {
    return casualBoosterIds.has(team.draft_id) ? 'casualBooster' : 'booster';
  }
  if (team.draft_type === '1v1') {
    return casual1v1DraftIds.has(team.draft_id) ? 'casualOneVOne' : 'oneVOne';
  }
  return validDraftIds.has(team.draft_id) ? 'auction' : 'casualAuction';
}

// Mapping of trainer IDs to trainer names (from parseSaveFile.ts and opponents.h)
const TRAINER_ID_TO_NAME: Record<number, string> = {
  265: "Roxanne",
  855: "Viola",
  266: "Brawly",
  267: "Wattson",
  268: "Flannery",
  269: "Norman",
  270: "Winona",
  271: "Tate & Liza",
  272: "Juan & Wallace",
  601: "Maxie",
  34: "Archie",
  261: "Sidney",
  262: "Phoebe",
  263: "Glacia",
  264: "Drake",
  806: "Tucker",
  807: "Spenser",
  810: "Lucy",
  811: "Brandon",
  804: "Steven",
  656: "Wally",
  // Gym leader versions from opponents.h
  770: "Roxanne 2",
  771: "Roxanne 3",
  772: "Roxanne 4",
  773: "Roxanne 5",
  812: "Roxanne 6",
  813: "Roxanne 7",
  814: "Roxanne 8",
  774: "Brawly 2",
  775: "Brawly 3",
  776: "Brawly 4",
  777: "Brawly 5",
  815: "Brawly 6",
  816: "Brawly 7",
  817: "Brawly 8",
  778: "Wattson 2",
  779: "Wattson 3",
  780: "Wattson 4",
  781: "Wattson 5",
  818: "Wattson 6",
  819: "Wattson 7",
  820: "Wattson 8",
  782: "Flannery 2",
  783: "Flannery 3",
  784: "Flannery 4",
  785: "Flannery 5",
  821: "Flannery 6",
  822: "Flannery 7",
  823: "Flannery 8",
  786: "Norman 2",
  787: "Norman 3",
  788: "Norman 4",
  789: "Norman 5",
  824: "Norman 6",
  825: "Norman 7",
  826: "Norman 8",
  790: "Winona 2",
  791: "Winona 3",
  792: "Winona 4",
  793: "Winona 5",
  827: "Winona 6",
  828: "Winona 7",
  829: "Winona 8",
  794: "Tate & Liza 2",
  795: "Tate & Liza 3",
  796: "Tate & Liza 4",
  797: "Tate & Liza 5",
  830: "Tate & Liza 6",
  831: "Tate & Liza 7",
  832: "Tate & Liza 8",
  798: "Juan & Wallace 2",
  799: "Juan & Wallace 3",
  800: "Juan & Wallace 4",
  801: "Juan & Wallace 5",
  833: "Juan & Wallace 6",
  834: "Juan & Wallace 7",
  835: "Juan & Wallace 8",
  856: "Viola 2",
  857: "Viola 3",
  858: "Viola 4",
  859: "Viola 5",
  860: "Viola 6",
  861: "Viola 7",
  862: "Viola 8",
};

function getTrainerNameById(trainerId: number, version?: number | null): string {
  const baseName = TRAINER_ID_TO_NAME[trainerId] || `Trainer #${trainerId}`;

  // If the trainer ID is already mapped with a version number (e.g., 801 = "Juan & Wallace 5"),
  // return it directly without appending another version
  if (/\d$/.test(baseName)) {
    return baseName;
  }

  if (version !== undefined && version !== null && version > 0) {
    return `${baseName} ${version}`;
  }
  return baseName;
}

// Front-facing trainer sprites from Pokemon Showdown (Gen 3 where available).
// Rematch IDs reuse the base trainer's sprite; "Juan & Wallace" uses Juan,
// matching the trainer card in the game.
const TRAINER_SPRITE_BY_NAME: Record<string, string> = {
  Roxanne: 'roxanne',
  Viola: 'viola',
  Brawly: 'brawly',
  Wattson: 'wattson',
  Flannery: 'flannery',
  Norman: 'norman',
  Winona: 'winona',
  'Tate & Liza': 'tate',
  'Juan & Wallace': 'juan',
  Maxie: 'maxie',
  Archie: 'archie',
  Sidney: 'sidney',
  Phoebe: 'phoebe',
  Glacia: 'glacia',
  Drake: 'drake',
  Tucker: 'tucker',
  Spenser: 'spenser',
  Lucy: 'lucy',
  Brandon: 'brandon',
  Steven: 'steven',
  Wally: 'wally',
};

function getTrainerSpriteName(trainerId: number, version?: number | null): string | null {
  const name = getTrainerNameById(trainerId, version).replace(/ \d+$/, '');
  return TRAINER_SPRITE_BY_NAME[name] ?? null;
}

function getBossBattleVictory(battles: BossBattleHistoryEntry[] | undefined): string | null {
  if (!battles || battles.length === 0) return null;

  // Check for Steven (804) or Wally (656) wins (not losses)
  const stevenWin = battles.find(b => b.trainer_id === 804 && !b.is_loss);
  const wallyWin = battles.find(b => b.trainer_id === 656 && !b.is_loss);

  const formatTime = (hours: number, minutes: number, seconds: number) => {
    return `${hours > 0 ? `${hours}h ` : ''}${minutes}m ${seconds}s`;
  };

  if (stevenWin) {
    return `Beat Steven (${formatTime(stevenWin.hours, stevenWin.minutes, stevenWin.seconds)})`;
  }
  if (wallyWin) {
    return `Beat Wally (${formatTime(wallyWin.hours, wallyWin.minutes, wallyWin.seconds)})`;
  }

  return null;
}

// `slot` is the second column: pick number in 1v1s, cost in auctions.
type RunSortColumn = 'slot' | 'turns' | 'kos';
type RunSort = { column: RunSortColumn; direction: 'asc' | 'desc' } | null;

interface EeveeGiftStats {
  speciesId: number;
  summary: RunStatSummary;
}

interface RunDisplayRow {
  key: string;
  icon: string;
  name: string;
  form: string;
  pickIdx: number;
  /** Pick number in 1v1s, cost in auctions; null for the gifted Eevee. */
  slotValue: number | null;
  pickLabel: string;
  /** Display-only override, e.g. "Egg (Venipede)" once the hatch is inferred. */
  label?: string;
  monStats?: RunStatSummary;
  isEeveeGift: boolean;
  isRental?: boolean;
}

// Everyone receives an Eevee, but it never appears in the auction rows. Its
// numbers live in the run save, so surface it as its own row. If it evolved,
// use the evolved species' name and icon while keeping the same battle stats.
function getEeveeGiftStats(stats: RunMonStat[] | null | undefined): EeveeGiftStats | null {
  const eeveeStats = (stats ?? []).filter((mon) => EEVEELUTION_IDS.has(mon.species_id));
  if (eeveeStats.length === 0) return null;

  const summary: RunStatSummary = {
    koCount: null,
    totalTurns: null,
    fainted: false,
    faintedLevel: null,
  };
  eeveeStats.forEach((mon) => {
    if (mon.ko_count != null) summary.koCount = (summary.koCount ?? 0) + mon.ko_count;
    if (mon.total_turns != null) summary.totalTurns = (summary.totalTurns ?? 0) + mon.total_turns;
    if (mon.fainted) {
      summary.fainted = true;
      if (summary.faintedLevel == null && mon.level != null) summary.faintedLevel = mon.level;
    }
  });

  // An evolved save normally has exactly one entry; prefer the last one if a
  // stale Eevee entry is also present.
  const speciesId = eeveeStats[eeveeStats.length - 1].species_id;
  return { speciesId, summary };
}

// Missing stats always stay at the bottom so sorting doesn't hide the useful
// rows behind Pokemon without a recorded save.
function sortRunRows(
  auctions: StatsAuction[],
  statsByIcon: Map<string, RunStatSummary>,
  sort: RunSort,
  is1v1: boolean,
  eeveeGift: EeveeGiftStats | null,
  eggHatch: EggHatchStats | null,
  rentals: RentalStat[]
): RunDisplayRow[] {
  const rows: RunDisplayRow[] = auctions.map((auction, pickIdx) => {
    const fullName = auction.form ? `${auction.name}-${auction.form}` : auction.name;
    const hatched = isEggAuction(auction) ? eggHatch : null;
    return {
      key: String(auction.auction_id),
      icon: formatPokemonName(fullName),
      name: auction.name,
      form: auction.form ?? '',
      pickIdx,
      slotValue: is1v1 ? pickIdx : (auction.winning_bid ?? 0),
      pickLabel: is1v1 ? `#${pickIdx + 1}` : `$${(auction.winning_bid ?? 0).toLocaleString()}`,
      label: hatched ? `Egg (${hatched.name})` : undefined,
      monStats: hatched?.summary ?? getRunStatsForPick(statsByIcon, fullName),
      isEeveeGift: false,
    };
  });

  // Rentals are returned to the NPC before the run ends, so their final
  // numbers are archived by the backend. Show them between the drafted picks
  // and the gifted Eevee.
  rentals.forEach((rental, rentalIdx) => {
    const species = SPECIES_BY_ID[rental.species_id];
    const name = species?.name ?? 'Rental';
    rows.push({
      key: `rental-${rental.personality}-${rental.species_id}-${rentalIdx}`,
      icon: formatPokemonName(getIconName(name, rental.species_id)),
      name,
      form: species?.form ?? '',
      pickIdx: rows.length,
      slotValue: null,
      pickLabel: 'Rental',
      monStats: {
        koCount: rental.ko_count ?? null,
        totalTurns: rental.total_turns ?? null,
        fainted: rental.fainted,
        faintedLevel: rental.level ?? null,
      },
      isEeveeGift: false,
      isRental: true,
    });
  });

  if (eeveeGift) {
    const species = SPECIES_BY_ID[eeveeGift.speciesId];
    const name = species?.name ?? 'Eevee';
    rows.push({
      key: 'eevee-gift',
      icon: formatPokemonName(getIconName(name, eeveeGift.speciesId)),
      name,
      form: species?.form ?? '',
      pickIdx: rows.length,
      slotValue: null,
      pickLabel: '\u2014',
      monStats: eeveeGift.summary,
      isEeveeGift: true,
    });
  }

  if (!sort) return rows;

  const valueOf = (row: RunDisplayRow): number | null => {
    if (sort.column === 'slot') return row.slotValue;
    return sort.column === 'kos'
      ? (row.monStats?.koCount ?? null)
      : (row.monStats?.totalTurns ?? null);
  };

  return rows.sort((a, b) => {
    const aValue = valueOf(a);
    const bValue = valueOf(b);
    if (aValue == null && bValue == null) return a.pickIdx - b.pickIdx;
    if (aValue == null) return 1;
    if (bValue == null) return -1;
    const diff = aValue - bValue;
    return (sort.direction === 'asc' ? diff : -diff) || a.pickIdx - b.pickIdx;
  });
}

function getRunResult(battles: BossBattleHistoryEntry[]): { result: string; trainer: string; isWin: boolean } | null {
  if (!battles || battles.length === 0) return null;

  const lastBattle = battles[battles.length - 1];

  // A wipe to any trainer (including Steven/Wally) ends the run as a loss
  if (lastBattle.is_loss) {
    return {
      result: 'Wiped to',
      trainer: getTrainerNameById(lastBattle.trainer_id, lastBattle.version),
      isWin: false,
    };
  }

  // Check if it's a win (Steven/Wally are the final bosses)
  if (lastBattle.trainer_id === 804 || lastBattle.trainer_id === 656) {
    return {
      result: 'Beat',
      trainer: lastBattle.trainer_id === 804 ? 'Steven' : 'Wally',
      isWin: true,
    };
  }

  return null;
}

function isRunFinished(battles: BossBattleHistoryEntry[] | undefined): boolean {
  if (!battles || battles.length === 0) return false;
  const lastBattle = battles[battles.length - 1];
  // Forfeit: any battle entry with hours===5 && minutes===0 && seconds===0
  if (lastBattle.hours === 5 && lastBattle.minutes === 0 && lastBattle.seconds === 0) {
    return true;
  }
  const result = getRunResult(battles);
  if (result !== null) {
    return true;
  }
  return false;
}
const PlayerProfileStatsTab: React.FC<PlayerProfileStatsTabProps> = ({
  initialUserId,
  initialUserName,
  initialTeamId,
  currentUserId,
}) => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Legacy name-only URLs need a tiny id lookup before the scoped endpoint
  // can be used. Every current link already carries ?userId=, so this is rare.
  const nameLookup = useQuery({
    queryKey: ['player-id-by-name', initialUserName],
    queryFn: () => fetchPlayerIdByName(initialUserName!),
    enabled: !initialUserId && Boolean(initialUserName),
    retry: false,
    staleTime: Infinity,
  });
  const profileUserId = initialUserId ?? nameLookup.data?.user_id;

  const profileQuery = useQuery({
    queryKey: ['player-profile', profileUserId],
    queryFn: () => fetchPlayerProfileStats(profileUserId!),
    enabled: Boolean(profileUserId),
  });
  const profile = profileQuery.data ?? null;
  const stats = profile?.stats ?? null;
  const validDraftIds = useMemo(
    () => new Set(profile?.valid_draft_ids ?? []),
    [profile],
  );
  // Precomputed globally by the backend so the profile never downloads the
  // whole auction table just to price a draft.
  const globalPokemonPrices = useMemo(
    () => new Map<string, number>(Object.entries(profile?.global_prices ?? {})),
    [profile],
  );
  const casual1v1DraftIds = useMemo(() => {
    return casualOneVOneDraftIds(stats?.auctions ?? []);
  }, [stats?.auctions]);
  const casualBoosterIds = useMemo(
    () => casualBoosterDraftIds(stats?.auctions ?? [], stats?.teams ?? []),
    [stats?.auctions, stats?.teams],
  );
  const [expandedTeamId, setExpandedTeamId] = useState<number | null>(null);
  const [showGamesBreakdown, setShowGamesBreakdown] = useState(false);
  const [showHofBreakdown, setShowHofBreakdown] = useState(false);
  const [runSort, setRunSort] = useState<RunSort>(null);
  const [runStatLineage, setRunStatLineage] = useState<RunStatLineage | null>(null);
  // The URL identifies the player; no local selection state to keep in sync.
  const selectedPlayer = useMemo<StatsPagePlayer | null>(() => {
    if (!stats || !profileUserId) return null;
    // Linked guest ids resolve to the registered account they belong to.
    return stats.players.find(
      (p) => p.user_id === profileUserId || p.linked_user_id === profileUserId,
    ) ?? null;
  }, [profileUserId, stats]);
  const selectedUserId = selectedPlayer?.user_id;
  const [avatarEditor, setAvatarEditor] = useState<{ userId: string; isFranklyNathan: boolean } | null>(null);
  const [avatarVersion, setAvatarVersion] = useState(0);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  // Match history and boss history are reads, so React Query owns their cache.
  const historyQuery = useQuery({
    queryKey: ['player-match-history', profileUserId],
    queryFn: async () => {
      const history = await fetchMatchHistoryByUserId(profileUserId!);
      const entries = await Promise.all(
        history.map(async (team) => {
          try {
            const battles = await fetchBossBattleHistory(team.draft_id, profileUserId!);
            return [team.team_id, battles] as const;
          } catch (e) {
            console.error('[PlayerProfileStatsTab] Error fetching boss battle history for team:', team.team_id, e);
            return [team.team_id, [] as BossBattleHistoryEntry[]] as const;
          }
        }),
      );
      return {
        history,
        bossHistory: new Map<number, BossBattleHistoryEntry[]>(entries),
      };
    },
    enabled: Boolean(profileUserId),
  });
  const playerMatchHistory = historyQuery.data?.history ?? null;
  const playerMatchHistoryLoading =
    nameLookup.isLoading || profileQuery.isLoading || historyQuery.isLoading;
  const playerMatchHistoryError =
    nameLookup.isError || profileQuery.isError || historyQuery.isError
      ? 'Failed to load player profile.'
      : null;
  // Expanding a team can refresh its battles; keep those local overrides on
  // top of the cached map instead of mutating query data.
  const [bossBattleHistoryOverrides, setBossBattleHistoryOverrides] = useState<
    Map<number, BossBattleHistoryEntry[]>
  >(new Map());
  const bossBattleHistory = useMemo(() => {
    const map = new Map(historyQuery.data?.bossHistory ?? []);
    bossBattleHistoryOverrides.forEach((battles, teamId) => map.set(teamId, battles));
    return map;
  }, [historyQuery.data, bossBattleHistoryOverrides]);
  const [bossBattleHistoryLoading, setBossBattleHistoryLoading] = useState(false);
  const achievementSourcesQuery = useQuery({
    queryKey: ['profile-achievement-sources'],
    queryFn: async () => {
      const [hallOfFame, season1, season2, pokemon] = await Promise.all([
        fetchHallOfFameEligible().catch(() => [] as AdminHallOfFameEligibleEntry[]),
        fetchLeaderboard().catch(() => []),
        fetchSeason2Leaderboard().catch(() => []),
        fetchPokemonList().catch(() => [] as Pokemon[]),
      ]);
      return {
        hallOfFame,
        leaderboardIds: new Set([...season1, ...season2].map((entry) => entry.user_id)),
        pokemon,
      };
    },
    staleTime: 5 * 60_000,
  });
  const achievementSources = achievementSourcesQuery.data ?? null;
  const manualAchievementsQuery = useQuery({
    queryKey: ['manual-achievements', selectedUserId],
    queryFn: () =>
      fetchManualAchievements(selectedUserId!).then(
        (overrides) => new Map(overrides.map((o) => [o.achievement_id, o.earned])),
      ),
    enabled: Boolean(selectedUserId),
  });
  const manualAchievements = useMemo(
    () => manualAchievementsQuery.data ?? new Map<string, boolean>(),
    [manualAchievementsQuery.data],
  );
  const [achievementSavingIds, setAchievementSavingIds] = useState<Set<string>>(new Set());
  const [achievementEditError, setAchievementEditError] = useState<string | null>(null);
  const isAchievementAdmin = currentUserId === SITE_ADMIN_USER_ID;
  const [pokemonFilterQuery, setPokemonFilterQuery] = useState('');
  const [mySubmissions, setMySubmissions] = useState<Map<number, BossBattleSubmission>>(new Map());
  const [mySubmissionsLoading, setMySubmissionsLoading] = useState(false);
  const [uploadTeam, setUploadTeam] = useState<{
    teamId: number;
    draftId: string;
    battles: BossBattleSubmissionBattle[];
    note: string;
    hallOfFameTeam: HallOfFamePokemon[];
    lockedCount?: number;
  } | null>(null);
  const [uploadSaving, setUploadSaving] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    getRunStatLineage()
      .then((lineage) => { if (active) setRunStatLineage(lineage); })
      .catch(() => { /* without catalog metadata, exact-species matching still works */ });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    fetchCurrentUser().then((user) => {
      if (active && !user.is_guest && user.user_id) {
        setAvatarEditor({ userId: user.user_id, isFranklyNathan: user.user_id === SITE_ADMIN_USER_ID });
      }
    }).catch(() => {});
    return () => { active = false; };
  }, []);

  const uploadAvatar = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !selectedPlayer) return;
    setAvatarError(null);
    if (file.size > 2_000_000) {
      setAvatarError('Choose an image smaller than 2 MB.');
      return;
    }
    setAvatarUploading(true);
    try {
      const response = await fetch(getAvatarUrl(selectedPlayer.user_id), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: file,
      });
      if (!response.ok) {
        if (response.status === 413) throw new Error('Image is too large. Please choose a smaller picture.');
        const contentType = response.headers.get('content-type') || '';
        const message = contentType.includes('text/plain') ? await response.text() : '';
        throw new Error(message || 'Could not upload profile picture. Please try again.');
      }
      setAvatarVersion((version) => version + 1);
      window.dispatchEvent(new CustomEvent('avatar-updated', { detail: selectedPlayer.user_id }));
    } catch (error) {
      setAvatarError(error instanceof Error ? error.message : 'Could not upload profile picture.');
    } finally {
      setAvatarUploading(false);
    }
  };

  useEffect(() => {
    if (!currentUserId) return;
    let cancelled = false;
    setMySubmissionsLoading(true);
    fetchMyBossBattleSubmissions()
      .then((submissions) => {
        if (cancelled) return;
        setMySubmissions(new Map(submissions.map((submission) => [submission.team_id, submission])));
      })
      .catch((e) => console.error('[PlayerProfileStatsTab] Error fetching boss battle submissions:', e))
      .finally(() => {
        if (!cancelled) setMySubmissionsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [currentUserId]);

  const openUploadModal = (
    teamId: number,
    draftId: string,
    existing?: BossBattleSubmission,
    additive?: boolean,
    prefillHistory?: boolean
  ) => {
    const existingBattles = existing ? existing.battles.map((battle) => ({ ...battle })) : [];
    const historyBattles: BossBattleSubmissionBattle[] = additive || prefillHistory
      ? (bossBattleHistory.get(teamId) ?? []).map((battle) => ({
          trainer_id: battle.trainer_id,
          version: battle.version ?? null,
          hours: battle.hours,
          minutes: battle.minutes,
          seconds: battle.seconds,
          is_loss: battle.is_loss,
        }))
      : existingBattles;
    const lockedCount =
      additive && historyBattles.length > 0 ? historyBattles.length : undefined;
    const hallOfFameTeam =
      existing?.hall_of_fame_team ??
      playerMatchHistory?.find((team) => team.team_id === teamId)?.hall_of_fame_team ??
      [];
    setUploadTeam({
      teamId,
      draftId,
      battles: normalizeSubmissionBattles(historyBattles, lockedCount),
      note: existing?.note ?? '',
      hallOfFameTeam: hallOfFameTeam.map((mon) => ({ ...mon })),
      lockedCount,
    });
    setUploadError(null);
  };

  const closeUploadModal = () => {
    if (uploadSaving) return;
    setUploadTeam(null);
    setUploadError(null);
  };

  const handleSubmitUpload = async () => {
    if (!uploadTeam) return;
    if (uploadTeam.battles.length === 0) {
      setUploadError('Add at least one boss battle before submitting.');
      return;
    }
    setUploadSaving(true);
    setUploadError(null);
    try {
      const submission = await submitBossBattleSubmission(
        uploadTeam.teamId,
        uploadTeam.battles,
        uploadTeam.note.trim() || null,
        uploadTeam.hallOfFameTeam,
      );
      setMySubmissions((prev) => new Map(prev).set(submission.team_id, submission));
      setUploadTeam(null);
    } catch (e: any) {
      console.error('[PlayerProfileStatsTab] Error submitting boss battles:', e);
      setUploadError(e?.response?.data ?? 'Failed to submit boss battle history.');
    } finally {
      setUploadSaving(false);
    }
  };

  const handleWithdraw = async (teamId: number) => {
    try {
      await withdrawBossBattleSubmission(teamId);
      setMySubmissions((prev) => {
        const next = new Map(prev);
        next.delete(teamId);
        return next;
      });
    } catch (e) {
      console.error('[PlayerProfileStatsTab] Error withdrawing boss battle submission:', e);
    }
  };

  const junkDraftIds = useMemo(() => {
    const soldCount = new Map<string, number>();
    (stats?.auctions ?? []).forEach((a) => {
      if (a.winning_bid === null) return;
      soldCount.set(a.draft_id, (soldCount.get(a.draft_id) || 0) + 1);
    });
    const junk = new Set<string>();
    soldCount.forEach((count, draftId) => {
      if (count < 16 || count > 150) junk.add(draftId);
    });
    return junk;
  }, [stats?.auctions]);

  const displayMatchHistory = useMemo(() => {
    if (!playerMatchHistory) return null;
    // Junk drafts (fewer than 16 pokemon sold) are dropped entirely.
    return playerMatchHistory.filter(team => !junkDraftIds.has(team.draft_id));
  }, [playerMatchHistory, junkDraftIds]);

  const isCasualTeam = (team: MatchHistoryTeam) =>
    !isNonCasualRace(team, validDraftIds, casual1v1DraftIds, casualBoosterIds);

  const auctionMatchHistory = useMemo(() => {
    if (!displayMatchHistory) return null;
    // Only competitive auction drafts count toward per-pokemon stats and RMV.
    return displayMatchHistory.filter(team => team.draft_type !== '1v1' && validDraftIds.has(team.draft_id));
  }, [displayMatchHistory, validDraftIds]);

  const draftDateMap = useMemo(() => {
    const map = new Map<string, string>();
    if (!stats?.auctions) return map;
    stats.auctions.forEach(a => {
      if (a.created_at && !map.has(a.draft_id)) {
        map.set(a.draft_id, new Date(a.created_at).toLocaleDateString());
      }
    });
    return map;
  }, [stats?.auctions]);

  // A profile can include linked guest accounts, so exclude every identity
  // tied to the selected player when finding the other teams in each race.
  const selectedPlayerIdentityIds = useMemo(
    () => getSelectedPlayerIdentityIds(selectedPlayer, stats?.players ?? []),
    [selectedPlayer, stats?.players],
  );

  const opponentsByDraftId = useMemo(
    () => buildOpponentsByDraftId(stats?.teams ?? [], stats?.players ?? [], selectedPlayerIdentityIds),
    [stats?.teams, stats?.players, selectedPlayerIdentityIds],
  );

  const pokemonDraftSummary = useMemo<PokemonDraftSummary[]>(() => {
    if (!auctionMatchHistory?.length) {
      return [];
    }

    const summary = new Map<string, PokemonDraftSummary>();

    auctionMatchHistory.forEach((team) => {
      // Count pokemon from any valid draft

      (team.pokemon_drafted ?? []).forEach((auction) => {
        const key = `${auction.name}::${auction.form}`;
        const existing = summary.get(key);

        if (existing) {
          existing.games += 1;
          existing.totalSpend += auction.winning_bid ?? 0;
          existing.avgSpend = existing.games === 0 ? 0 : existing.totalSpend / existing.games;
          return;
        }

        summary.set(key, {
          key,
          name: auction.name,
          form: auction.form,
          games: 1,
          totalSpend: auction.winning_bid ?? 0,
          avgSpend: auction.winning_bid ?? 0,
        });
      });
    });

    return Array.from(summary.values()).sort((left, right) => {
      if (right.games !== left.games) {
        return right.games - left.games;
      }

      return getPokemonLabel(left.name, left.form).localeCompare(getPokemonLabel(right.name, right.form));
    });
  }, [auctionMatchHistory]);

  const featuredPokemon = pokemonDraftSummary[0] ?? null;

  const personalBestSeconds = useMemo(
    () =>
      computePersonalBestSeconds(
        displayMatchHistory ?? [],
        bossBattleHistory,
        validDraftIds,
        casual1v1DraftIds,
        casualBoosterIds,
      ),
    [displayMatchHistory, bossBattleHistory, validDraftIds, casual1v1DraftIds, casualBoosterIds],
  );

  const personalBestTime = useMemo(() => {
    if (personalBestSeconds === null) return null;
    const h = Math.floor(personalBestSeconds / 3600);
    const m = Math.floor((personalBestSeconds % 3600) / 60);
    const s = personalBestSeconds % 60;
    return `${h > 0 ? `${h}h ` : ''}${m}m ${s}s`;
  }, [personalBestSeconds]);

  const totalGames = displayMatchHistory?.length ?? 0;

  const gamesBreakdown = useMemo(() => {
    const counts: Record<RaceCategory, number> = {
      auction: 0,
      casualAuction: 0,
      oneVOne: 0,
      casualOneVOne: 0,
      booster: 0,
      casualBooster: 0,
    };
    (displayMatchHistory ?? []).forEach((team) => {
      counts[getRaceCategory(team, validDraftIds, casual1v1DraftIds, casualBoosterIds)]++;
    });
    return counts;
  }, [displayMatchHistory, validDraftIds, casual1v1DraftIds, casualBoosterIds]);

  const hofBreakdown = useMemo(() => {
    const counts: Record<RaceCategory, number> = {
      auction: 0,
      casualAuction: 0,
      oneVOne: 0,
      casualOneVOne: 0,
      booster: 0,
      casualBooster: 0,
    };
    (displayMatchHistory ?? []).forEach((team) => {
      const battles = bossBattleHistory.get(team.team_id);
      if (!battles || !getRunResult(battles)?.isWin) return;
      counts[getRaceCategory(team, validDraftIds, casual1v1DraftIds, casualBoosterIds)]++;
    });
    return counts;
  }, [displayMatchHistory, bossBattleHistory, validDraftIds, casual1v1DraftIds, casualBoosterIds]);

  // Include casual variants so the headline number matches the breakdown tiles.
  const hallOfFameCount =
    hofBreakdown.auction +
    hofBreakdown.casualAuction +
    hofBreakdown.oneVOne +
    hofBreakdown.casualOneVOne +
    hofBreakdown.booster +
    hofBreakdown.casualBooster;

  const gamesBreakdownItems = [
    { label: 'Auctions Played', value: gamesBreakdown.auction },
    { label: 'Casual Auctions Played', value: gamesBreakdown.casualAuction },
    { label: '1v1s Played', value: gamesBreakdown.oneVOne },
    { label: 'Casual 1v1s Played', value: gamesBreakdown.casualOneVOne },
    { label: 'Boosters Played', value: gamesBreakdown.booster },
    { label: 'Casual Boosters Played', value: gamesBreakdown.casualBooster },
  ];

  const hofBreakdownItems = [
    { label: 'Auction HoFs', value: hofBreakdown.auction },
    { label: 'Casual Auction HoFs', value: hofBreakdown.casualAuction },
    { label: '1v1 HoFs', value: hofBreakdown.oneVOne },
    { label: 'Casual 1v1 HoFs', value: hofBreakdown.casualOneVOne },
    { label: 'Booster HoFs', value: hofBreakdown.booster },
    { label: 'Casual Booster HoFs', value: hofBreakdown.casualBooster },
  ];

  const playerOneVOnePickStats = useMemo(() => {
    const map = new Map<string, PlayerOneVOnePickStats>();
    if (!selectedPlayer || !displayMatchHistory) return map;
    const leftoverOrders = oneVOneLeftoverOrders(stats?.auctions ?? []);

    const playedDraftIds = new Set(
      (stats?.teams ?? [])
        .filter((team) => team.user_id === selectedPlayer.user_id && team.draft_type === '1v1' && team.has_save && !casual1v1DraftIds.has(team.draft_id))
        .map((team) => team.draft_id),
    );

    (stats?.auctions ?? []).forEach((auction) => {
      if (auction.draft_type !== '1v1' || !playedDraftIds.has(auction.draft_id)) return;
      if (oneVOnePickSlot(auction, leftoverOrders) === null) return;
      const { key } = resolvePokemonIdentity(auction.name, auction.form || '');
      const row = map.get(key) ?? { timesPicked: 0, appearedDraftIds: new Set<string>() };
      row.appearedDraftIds.add(auction.draft_id);
      map.set(key, row);
    });

    displayMatchHistory.forEach((team) => {
      if (team.draft_type !== '1v1' || !playedDraftIds.has(team.draft_id)) return;
      (team.pokemon_drafted ?? []).forEach((auction) => {
        if (auction.action !== 'PICK' || oneVOnePickSlot(auction, leftoverOrders) === null) return;
        const { key } = resolvePokemonIdentity(auction.name, auction.form || '');
        const row = map.get(key) ?? { timesPicked: 0, appearedDraftIds: new Set<string>() };
        row.timesPicked += 1;
        map.set(key, row);
      });
    });

    return map;
  }, [displayMatchHistory, selectedPlayer, stats?.auctions, stats?.teams, casual1v1DraftIds]);

  const draftRmvMap = useMemo(() => {
    const map = new Map<number, number>();
    displayMatchHistory?.forEach((team) => {
      const is1v1 = team.draft_type === '1v1';
      const rmv = (team.pokemon_drafted ?? []).reduce((sum, auction) => {
        if (is1v1 && auction.action !== 'PICK') return sum;
        const { key } = resolvePokemonIdentity(auction.name, auction.form || '');
        return sum + (globalPokemonPrices.get(key) ?? 0);
      }, 0);
      map.set(team.team_id, rmv);
    });
    return map;
  }, [displayMatchHistory, globalPokemonPrices]);

  // Winning races are global, so narrow them to the teams on this player's
  // profile (which already includes linked guest accounts and excludes junk
  // drafts) before reusing the Cost Breakdown win rules.
  const playerTeamIds = useMemo(
    () => new Set((displayMatchHistory ?? []).map((team) => team.team_id)),
    [displayMatchHistory],
  );

  const playerWinningRaces = useMemo(
    () => (stats?.winning_races ?? []).filter((race) => playerTeamIds.has(race.team_id)),
    [stats?.winning_races, playerTeamIds],
  );

  const opponentSignatureKeys = useMemo(
    () => new Map(Object.entries(profile?.one_v_one_opponent_signatures ?? {})),
    [profile?.one_v_one_opponent_signatures],
  );

  const playerAchievements = useMemo(() => {
    if (!selectedPlayer || !achievementSources || !displayMatchHistory) return [];
    return computePlayerAchievements({
      player: selectedPlayer,
      identityIds: selectedPlayerIdentityIds,
      matchHistory: displayMatchHistory,
      winningRaces: playerWinningRaces,
      bossBattleHistory,
      hallOfFame: achievementSources.hallOfFame,
      leaderboardIds: achievementSources.leaderboardIds,
      allTeams: stats?.teams ?? [],
      auctions: stats?.auctions ?? [],
      allPlayers: stats?.players ?? [],
      pokemon: achievementSources.pokemon,
      validDraftIds,
      casual1v1DraftIds,
      casualBoosterDraftIds: casualBoosterIds,
      rmvByTeamId: draftRmvMap,
      manualOverrides: manualAchievements,
      poolEntries: profile?.pool_entries,
      priceHistory: profile?.price_history,
      oneVOneOpponentSignatures: opponentSignatureKeys,
    });
  }, [
    selectedPlayer,
    achievementSources,
    displayMatchHistory,
    selectedPlayerIdentityIds,
    stats?.teams,
    stats?.auctions,
    stats?.players,
    playerWinningRaces,
    bossBattleHistory,
    validDraftIds,
    casual1v1DraftIds,
    casualBoosterIds,
    draftRmvMap,
    manualAchievements,
    profile?.pool_entries,
    profile?.price_history,
    opponentSignatureKeys,
  ]);

  const handleToggleAchievement = async (achievement: PlayerAchievement) => {
    if (!selectedUserId || achievementSavingIds.has(achievement.id)) return;
    const nextEarned = !achievement.earned;
    setAchievementSavingIds((current) => new Set(current).add(achievement.id));
    setAchievementEditError(null);
    try {
      await setManualAchievement(selectedUserId, achievement.id, nextEarned);
      queryClient.setQueryData<Map<string, boolean>>(
        ['manual-achievements', selectedUserId],
        (current) => new Map(current ?? []).set(achievement.id, nextEarned),
      );
    } catch (error) {
      console.error('[PlayerProfileStatsTab] Error updating achievement:', error);
      setAchievementEditError('Could not update achievements. Please try again.');
    } finally {
      setAchievementSavingIds((current) => {
        const next = new Set(current);
        next.delete(achievement.id);
        return next;
      });
    }
  };

  const averageRmv = useMemo(() => {
    if (!auctionMatchHistory || auctionMatchHistory.length === 0) return null;
    let total = 0;
    auctionMatchHistory.forEach((team) => {
      total += draftRmvMap.get(team.team_id) ?? 0;
    });
    return Math.round(total / auctionMatchHistory.length);
  }, [draftRmvMap, auctionMatchHistory]);

  const rpsWinRate = useMemo(() => {
    if (!selectedPlayer) return null;
    const wins = selectedPlayer.rps_wins ?? 0;
    const losses = selectedPlayer.rps_losses ?? 0;
    const rounds = wins + losses;
    return rounds > 0 ? Math.round((wins / rounds) * 100) : null;
  }, [selectedPlayer]);

  const winsByKey = useMemo(
    () =>
      computeWinningPicksByPokemonKey(
        playerWinningRaces,
        stats?.auctions ?? [],
        stats?.teams ?? [],
        stats?.players ?? [],
        validDraftIds,
        casual1v1DraftIds,
        casualBoosterIds,
      ),
    [
      playerWinningRaces,
      stats?.auctions,
      stats?.teams,
      stats?.players,
      validDraftIds,
      casual1v1DraftIds,
      casualBoosterIds,
    ],
  );

  interface AllPokemonRow {
    key: string;
    name: string;
    form: string;
    playerGames: number;
    appearances: number;
    pctDrafted: number | null;
    avgPaid: number | null;
    avgPrice: number | null;
    diff: number | null;
    timesPicked: number;
    oneVOneAppearances: number;
    pctPicked: number | null;
    wins: number;
  }

  const allPokemonList = useMemo<AllPokemonRow[]>(() => {
    const playerMap = new Map<string, PokemonDraftSummary>();
    pokemonDraftSummary.forEach((p) => {
      const { key } = resolvePokemonIdentity(p.name, p.form);
      playerMap.set(key, p);
    });

    // For each pokemon, the set of draft_ids where it was auctioned
    const pokemonDraftAppearances = new Map<string, Set<string>>();
    stats?.auctions.forEach((auction) => {
      if (!validDraftIds.has(auction.draft_id)) return;
      const { key } = resolvePokemonIdentity(auction.name, auction.form || '');
      if (!pokemonDraftAppearances.has(key)) pokemonDraftAppearances.set(key, new Set());
      pokemonDraftAppearances.get(key)!.add(auction.draft_id);
    });

    // Set of draft_ids the player participated in (auction drafts only)
    const playerDraftIds = new Set(auctionMatchHistory?.map((t) => t.draft_id) ?? []);

    // The backend supplies every identity seen in a valid draft so the table
    // doesn't shrink to only the Pokémon in this player's drafts.
    const globalPokemonKeys = new Map<string, { name: string; form: string }>();
    (profile?.global_pokemon_keys ?? []).forEach((pokemon) => {
      globalPokemonKeys.set(pokemon.key, { name: pokemon.name, form: pokemon.form });
    });

    const rows: AllPokemonRow[] = [];
    globalPokemonKeys.forEach(({ name, form }, key) => {
      const player = playerMap.get(key);
      const avgPrice = globalPokemonPrices.get(key) ?? null;
      const avgPaid = player ? Math.round(player.avgSpend) : null;
      const diff = avgPaid !== null && avgPrice !== null ? avgPaid - avgPrice : null;
      const playerPicks = playerOneVOnePickStats.get(key);
      const timesPicked = playerPicks?.timesPicked ?? 0;
      const oneVOneAppearances = playerPicks?.appearedDraftIds.size ?? 0;
      const pctPicked = oneVOneAppearances > 0 ? Math.round((timesPicked / oneVOneAppearances) * 100) : null;

      const draftSets = pokemonDraftAppearances.get(key);
      const appearances = draftSets ? Array.from(draftSets).filter((id) => playerDraftIds.has(id)).length : 0;
      const timesDrafted = player?.games ?? 0;
      const pctDrafted = appearances > 0 ? Math.round((timesDrafted / appearances) * 100) : null;

      rows.push({
        key,
        name,
        form,
        playerGames: timesDrafted,
        appearances,
        pctDrafted,
        avgPaid,
        avgPrice,
        diff,
        timesPicked,
        oneVOneAppearances,
        pctPicked,
        wins: winsByKey.get(key) ?? 0,
      });
    });

    rows.sort((a, b) => {
      if (b.playerGames !== a.playerGames) return b.playerGames - a.playerGames;
      return getPokemonLabel(a.name, a.form).localeCompare(getPokemonLabel(b.name, b.form));
    });

    return rows;
  }, [pokemonDraftSummary, stats?.auctions, validDraftIds, profile, globalPokemonPrices, auctionMatchHistory, playerOneVOnePickStats, winsByKey]);

  const signaturePokemon = useMemo(() => {
    const candidates = allPokemonList.filter((p) => p.pctDrafted !== null && p.pctDrafted > 0 && p.playerGames >= 3);
    if (candidates.length === 0) return null;
    return candidates.reduce((best, p) => (p.pctDrafted! > best.pctDrafted! ? p : best), candidates[0]);
  }, [allPokemonList]);

  type TableSortKey = 'name' | 'playerGames' | 'appearances' | 'pctDrafted' | 'avgPaid' | 'avgPrice' | 'diff' | 'timesPicked' | 'oneVOneAppearances' | 'pctPicked' | 'wins';
  const [tableSortConfig, setTableSortConfig] = useState<{ key: TableSortKey; direction: 'asc' | 'desc' }>({ key: 'playerGames', direction: 'desc' });

  const handleTableSort = (key: TableSortKey) => {
    setTableSortConfig((current) => ({
      key,
      direction: current.key === key && current.direction === 'desc' ? 'asc' : 'desc',
    }));
  };

  const renderSortArrow = (key: TableSortKey) =>
    tableSortConfig.key === key ? (tableSortConfig.direction === 'asc' ? '\u00A0\u2191' : '\u00A0\u2193') : '';

  const sortedPokemonList = useMemo(() => {
    const sorted = [...allPokemonList];
    const { key, direction } = tableSortConfig;
    const mult = direction === 'asc' ? 1 : -1;

    sorted.sort((a, b) => {
      switch (key) {
        case 'name':
          return mult * getPokemonLabel(a.name, a.form).localeCompare(getPokemonLabel(b.name, b.form));
        case 'playerGames':
          return mult * (a.playerGames - b.playerGames);
        case 'appearances':
          return mult * (a.appearances - b.appearances);
        case 'pctDrafted':
          return mult * ((a.pctDrafted ?? -1) - (b.pctDrafted ?? -1));
        case 'avgPaid':
          return mult * ((a.avgPaid ?? -Infinity) - (b.avgPaid ?? -Infinity));
        case 'avgPrice':
          return mult * ((a.avgPrice ?? -Infinity) - (b.avgPrice ?? -Infinity));
        case 'diff':
          return mult * ((a.diff ?? -Infinity) - (b.diff ?? -Infinity));
        case 'timesPicked':
          return mult * (a.timesPicked - b.timesPicked);
        case 'oneVOneAppearances':
          return mult * (a.oneVOneAppearances - b.oneVOneAppearances);
        case 'pctPicked':
          return mult * ((a.pctPicked ?? -Infinity) - (b.pctPicked ?? -Infinity));
        case 'wins':
          return mult * (a.wins - b.wins);
        default:
          return 0;
      }
    });

    return sorted;
  }, [allPokemonList, tableSortConfig]);

  const filteredPokemonList = useMemo(() => {
    if (!pokemonFilterQuery.trim()) return sortedPokemonList;
    const q = pokemonFilterQuery.trim().toLowerCase();
    return sortedPokemonList.filter((p) =>
      getPokemonLabel(p.name, p.form).toLowerCase().includes(q)
    );
  }, [sortedPokemonList, pokemonFilterQuery]);

  // Reset per-profile UI state when navigating between profiles. All data
  // fetching above is keyed by `profileUserId` and cached by React Query.
  useEffect(() => {
    setExpandedTeamId(null);
    setBossBattleHistoryOverrides(new Map());
  }, [profileUserId]);

  // Open the specific race linked from the Draft Breakdown page.
  useEffect(() => {
    if (initialTeamId == null || !playerMatchHistory || playerMatchHistoryLoading) return;
    const linkedTeam = playerMatchHistory.find(
      (team) => team.team_id === initialTeamId && !junkDraftIds.has(team.draft_id)
    );
    if (linkedTeam) {
      setExpandedTeamId(linkedTeam.team_id);
      window.setTimeout(() => {
        document
          .querySelector(`[data-team-id="${linkedTeam.team_id}"]`)
          ?.scrollIntoView({ block: 'center' });
      }, 0);
    }
  }, [initialTeamId, junkDraftIds, playerMatchHistory, playerMatchHistoryLoading]);

  const handleBackToList = () => {
    navigate('/Stats/PlayerProfiles');
  };
  const toggleExpandedTeam = async (teamId: number, draftId: string) => {
    const isExpanding = expandedTeamId !== teamId;
    setExpandedTeamId((current) => current === teamId ? null : teamId);

    if (isExpanding) {
      setBossBattleHistoryLoading(true);
      try {
        const history = await fetchBossBattleHistory(draftId, profileUserId);
        setBossBattleHistoryOverrides(prev => new Map(prev).set(teamId, history));
      } catch (e) {
        console.error('[PlayerProfileStatsTab] Error fetching boss battle history:', e);
      } finally {
        setBossBattleHistoryLoading(false);
      }
    }
  };

  const toggleRunSort = (column: RunSortColumn) => {
    setRunSort((current) => {
      if (current?.column !== column) return { column, direction: 'desc' };
      return { column, direction: current.direction === 'desc' ? 'asc' : 'desc' };
    });
  };
  return (
    <section className="player-search-stats-tab stats-content-grid">
      <article className="stats-panel player-search-panel">
        <h2>Player Match History</h2>
        <div className="player-search-wrapper">
          <div className="player-search-controls">
            <button
              type="button"
              className="player-search-back"
              onClick={handleBackToList}
              aria-label="Back to player list"
              title="Back to player list"
            >
              &#8592;
            </button>
          </div>

          {playerMatchHistoryLoading && (
            <div className="match-history-message">Loading match history...</div>
          )}

          {playerMatchHistoryError && (
            <div className="match-history-message error">{playerMatchHistoryError}</div>
          )}

          {!selectedPlayer && !playerMatchHistoryLoading && (
            <div className="match-history-message">Player not found.</div>
          )}

          {selectedPlayer && !playerMatchHistoryLoading && displayMatchHistory && (
            <>
              {(
                <div className="player-draft-overview">
                  <div className="player-draft-overview-content">
                    <div className="player-draft-overview-header">
                      <div>
                        {selectedPlayer && (
                          <>
                          <div className="player-draft-overview-profile-name" style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '8px 12px', marginBottom: '8px' }}>
                            <div className="profile-avatar-wrapper">
                              <img
                                key={`${selectedPlayer.user_id}-${avatarVersion}`}
                                src={`${getAvatarUrl(selectedPlayer.user_id)}?v=${avatarVersion}`}
                                alt=""
                                className="profile-avatar-image"
                                onError={onAvatarError}
                              />
                              {avatarEditor && (avatarEditor.userId === selectedPlayer.user_id || avatarEditor.isFranklyNathan) && (
                                <>
                                  <button type="button" className="profile-avatar-edit" title="Change profile picture" aria-label="Change profile picture" disabled={avatarUploading} onClick={() => avatarInputRef.current?.click()}>
                                    <FiCamera aria-hidden="true" />
                                  </button>
                                  <input ref={avatarInputRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp" className="profile-avatar-input" onChange={uploadAvatar} />
                                </>
                              )}
                            </div>
                            <div>
                              <div style={{ fontSize: '1.2rem', fontWeight: 'bold' }}>{selectedPlayer.user_name}</div>
                              {selectedPlayer.global_name && <div style={{ fontSize: '1rem', opacity: 0.8 }}>({selectedPlayer.global_name})</div>}
                            </div>
                          </div>
                          <div className="player-achievements-section">
                            <AchievementsPanel
                              key={selectedPlayer.user_id}
                              achievements={playerAchievements}
                              canEdit={isAchievementAdmin}
                              savingIds={achievementSavingIds}
                              editError={achievementEditError}
                              onToggleAchievement={handleToggleAchievement}
                            />
                          </div>
                          </>
                        )}
                        {avatarError && <div className="profile-avatar-error" role="alert">{avatarError}</div>}
                        <div className="player-draft-overview-kickers">
                          <div className="player-draft-overview-kicker-group">
                            <span className="player-draft-overview-kicker">Most Drafted</span>
                            {featuredPokemon && (
                              <h3>{getPokemonLabel(featuredPokemon.name, featuredPokemon.form)}</h3>
                            )}
                          </div>
                          {signaturePokemon && (
                            <div className="player-draft-overview-kicker-group">
                              <span className="player-draft-overview-kicker">Signature Pokemon</span>
                              <h3>{getPokemonLabel(signaturePokemon.name, signaturePokemon.form)} ({signaturePokemon.pctDrafted}%)</h3>
                            </div>
                          )}
                          {personalBestTime && (
                            <div className="player-draft-overview-kicker-group">
                              <span className="player-draft-overview-kicker">Personal Best Time</span>
                              <h3>{personalBestTime}</h3>
                            </div>
                          )}
                          <div className="player-draft-overview-kicker-group stat-with-breakdown">
                            <span className="player-draft-overview-kicker">Races Played</span>
                            <h3>{totalGames}</h3>
                            <button
                              type="button"
                              className={`stat-breakdown-toggle ${showGamesBreakdown ? 'open' : ''}`}
                              aria-label={`${showGamesBreakdown ? 'Hide' : 'Show'} races played breakdown`}
                              aria-expanded={showGamesBreakdown}
                              aria-controls="races-played-breakdown"
                              onClick={() => setShowGamesBreakdown((open) => !open)}
                            >
                              <FiChevronDown aria-hidden="true" />
                            </button>
                          </div>
                          <div className="player-draft-overview-kicker-group stat-with-breakdown">
                            <span className="player-draft-overview-kicker">Hall of Fames</span>
                            <h3>{hallOfFameCount}</h3>
                            <button
                              type="button"
                              className={`stat-breakdown-toggle ${showHofBreakdown ? 'open' : ''}`}
                              aria-label={`${showHofBreakdown ? 'Hide' : 'Show'} Hall of Fames breakdown`}
                              aria-expanded={showHofBreakdown}
                              aria-controls="hall-of-fames-breakdown"
                              onClick={() => setShowHofBreakdown((open) => !open)}
                            >
                              <FiChevronDown aria-hidden="true" />
                            </button>
                          </div>
                          <div className="player-draft-overview-kicker-group">
                            <span className="player-draft-overview-kicker">
                              Average RMV
                              <span className="rmv-info-icon" tabIndex={0}>
                                i
                                <span className="rmv-tooltip">
                                  Roster Market Value is the sum of the average price of every Pokemon you win in a given draft. For example, if you purchase 10 Pokemon, and each of them have an average sale price of 2,500, your RMV for that draft is $25,000.
                                  <br /><br />
                                  Average RMV is calculated using exclusively competitive auction data. 1v1 and casual draft data isn't considered.
                                </span>
                              </span>
                            </span>
                            <h3>{averageRmv !== null ? `$${averageRmv.toLocaleString()}` : '---'}</h3>
                          </div>
                          <div className="player-draft-overview-kicker-group">
                            <span
                              className="player-draft-overview-kicker"
                              title={
                                selectedPlayer
                                  ? `${selectedPlayer.rps_wins ?? 0} wins / ${(selectedPlayer.rps_wins ?? 0) + (selectedPlayer.rps_losses ?? 0)} decisive rounds`
                                  : undefined
                              }
                            >
                              RPS Win Rate
                            </span>
                            <h3>{rpsWinRate !== null ? `${rpsWinRate}%` : '---'}</h3>
                          </div>
                        </div>

                        {showGamesBreakdown && (
                          <div
                            id="races-played-breakdown"
                            className="player-draft-overview-kickers player-draft-overview-sub-kickers"
                          >
                            {gamesBreakdownItems.map((item) => (
                              <div className="player-draft-overview-kicker-group" key={item.label}>
                                <span className="player-draft-overview-kicker">{item.label}</span>
                                <h3>{item.value}</h3>
                              </div>
                            ))}
                          </div>
                        )}

                        {showHofBreakdown && (
                          <div
                            id="hall-of-fames-breakdown"
                            className="player-draft-overview-kickers player-draft-overview-sub-kickers"
                          >
                            {hofBreakdownItems.map((item) => (
                              <div className="player-draft-overview-kicker-group" key={item.label}>
                                <span className="player-draft-overview-kicker">{item.label}</span>
                                <h3>{item.value}</h3>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    {pokemonDraftSummary.length > 0 && (
                    <div className="player-draft-overview-table-wrapper">
                    <input
                      type="text"
                      className="pokemon-filter-input"
                      placeholder="Search pokemon..."
                      value={pokemonFilterQuery}
                      onChange={(e) => setPokemonFilterQuery(e.target.value)}
                    />
                    <div className="player-draft-overview-table">
                      <div className="player-draft-overview-table-header">
                        <span className="sortable" onClick={() => handleTableSort('name')}>
                          Pokemon{renderSortArrow('name')}
                        </span>
                        <span className="sortable" onClick={() => handleTableSort('playerGames')}>
                          Times Drafted{renderSortArrow('playerGames')}
                        </span>
                        <span className="sortable" onClick={() => handleTableSort('appearances')}>
                          Appearances{renderSortArrow('appearances')}
                        </span>
                        <span className="sortable" onClick={() => handleTableSort('pctDrafted')}>
                          % Drafted{renderSortArrow('pctDrafted')}
                        </span>
                        <span className="sortable" onClick={() => handleTableSort('avgPaid')}>
                          Avg Paid{renderSortArrow('avgPaid')}
                        </span>
                        <span className="sortable" onClick={() => handleTableSort('avgPrice')}>
                          Avg Price{renderSortArrow('avgPrice')}
                        </span>
                        <span className="sortable" onClick={() => handleTableSort('diff')}>
                          Diff{renderSortArrow('diff')}
                        </span>
                        <span className="sortable" onClick={() => handleTableSort('timesPicked')}>
                          Times Picked{renderSortArrow('timesPicked')}
                        </span>
                        <span className="sortable" onClick={() => handleTableSort('oneVOneAppearances')}>
                          Appearances{renderSortArrow('oneVOneAppearances')}
                        </span>
                        <span className="sortable" onClick={() => handleTableSort('pctPicked')}>
                          % Picked{renderSortArrow('pctPicked')}
                        </span>
                        <span className="sortable" onClick={() => handleTableSort('wins')}>
                          Wins{renderSortArrow('wins')}
                        </span>
                      </div>

                      {filteredPokemonList.map((pokemon) => (
                        <div className="player-draft-overview-row" key={pokemon.key}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                              <img
                                src={`/MiniIcons/${formatPokemonName(pokemon.name)}.png`}
                                alt={pokemon.name}
                                style={{ width: '20px', height: '20px', objectFit: 'contain' }}
                              />
                              <span style={{
                                position: 'absolute',
                                top: '-8px',
                                right: '-8px',
                                background: '#222',
                                color: '#fff',
                                fontSize: '0.8rem',
                                padding: '1px 3px',
                                borderRadius: '3px',
                                fontWeight: 'bold',
                                border: '1px solid #555',
                                lineHeight: '1'
                              }}>{pokemon.playerGames}</span>
                            </div>
                            <span>{getPokemonLabel(pokemon.name, pokemon.form)}</span>
                          </div>
                          <span>{pokemon.playerGames}</span>
                          <span>{pokemon.appearances}</span>
                          <span>{pokemon.pctDrafted !== null ? `${pokemon.pctDrafted}%` : '---'}</span>
                          <span>{pokemon.avgPaid !== null ? `$${pokemon.avgPaid.toLocaleString()}` : '---'}</span>
                          <span>{pokemon.avgPrice !== null ? `$${pokemon.avgPrice.toLocaleString()}` : '---'}</span>
                          <span className={pokemon.diff !== null ? (pokemon.diff < 0 ? 'diff-negative' : pokemon.diff > 0 ? 'diff-positive' : '') : ''} style={{ padding: '2px 6px' }}>
                            {pokemon.diff !== null
                              ? (pokemon.diff < 0 ? `-$${Math.abs(pokemon.diff).toLocaleString()}` : pokemon.diff > 0 ? `+$${pokemon.diff.toLocaleString()}` : '$0')
                              : '---'}
                          </span>
                          <span>{pokemon.timesPicked}</span>
                          <span>{pokemon.oneVOneAppearances}</span>
                          <span>{pokemon.pctPicked !== null ? `${pokemon.pctPicked}%` : '---'}</span>
                          <span>{pokemon.wins}</span>
                        </div>
                      ))}
                    </div>
                    </div>
                    )}
                  </div>
                </div>
              )}

              <div className="match-timeline">
                {displayMatchHistory.length === 0 && (
                  <div className="match-history-message">No match history found.</div>
                )}

                {displayMatchHistory.map((team) => {
                  const auctions = team.pokemon_drafted || [];
                  const is1v1 = team.draft_type === '1v1';
                  const isBooster = team.draft_type === 'booster';
                  const isCasual = isCasualTeam(team);
                  const listAuctions = is1v1 || isBooster ? auctions.filter(a => a.action === 'PICK') : auctions;
                  const isRanked = team.pre_match_mmr !== null || team.placement !== null;
                  const result = is1v1
                    ? (casual1v1DraftIds.has(team.draft_id) ? 'Casual 1v1' : '1v1')
                    : isBooster
                      ? (casualBoosterIds.has(team.draft_id) ? 'Casual Booster' : 'Booster')
                      : isCasual
                        ? 'Casual'
                        : getPlacementLabel(team.placement, isRanked);
                  const resultClass = getPlacementClass(team.placement, isRanked);
                  const isExpanded = expandedTeamId === team.team_id;
                  const battles = bossBattleHistory.get(team.team_id);
                  const bossVictory = getBossBattleVictory(battles);
                  const hallOfFameTeam = team.hall_of_fame_team;
                  const runStatsByIcon = getRunStatsByIcon(team.run_stats, runStatLineage);
                  const eeveeGift = getEeveeGiftStats(team.run_stats);
                  const eggHatch = listAuctions.some(isEggAuction)
                    ? findEggHatchStats(team.run_stats, listAuctions, runStatLineage)
                    : null;
                  const sortedRunRows = sortRunRows(listAuctions, runStatsByIcon, runSort, is1v1 || isBooster, eeveeGift, eggHatch, team.rental_stats ?? []);
                  const opponents = (opponentsByDraftId.get(team.draft_id) ?? [])
                    .filter((opponent) => opponent.teamId !== team.team_id);

                  return (
                    <div className="match-timeline-entry" key={team.team_id} data-team-id={team.team_id}>
                      <button
                        type="button"
                        className={`match-timeline-row ${resultClass} ${isExpanded ? 'expanded' : ''}`}
                        onClick={() => toggleExpandedTeam(team.team_id, team.draft_id)}
                      >
                        <div className="match-result-badge">
                          <span className="result-text">{result}</span>
                          {isCasual && (
                            <span className="rmv-info-icon casual-info-icon" tabIndex={0}>
                              i
                              <span className="rmv-tooltip">
                                Casual drafts aren't used when calculating stats.
                              </span>
                            </span>
                          )}
                        </div>

                        <div className="match-info">
                          <div className="match-row-details">
                            <span className="draft-id">
                              {draftDateMap.get(team.draft_id)
                                || (team.created_at ? new Date(team.created_at).toLocaleDateString() : 'Unknown Date')}
                            </span>
                            <span className="separator">&#8226;</span>
                            <span className="team-count">{team.team_count} players</span>
                            <span className="separator">&#8226;</span>
                            <span className="match-rmv">${(draftRmvMap.get(team.team_id) ?? 0).toLocaleString()} RMV</span>
                            {bossVictory && (
                              <>
                                <span className="separator">&#8226;</span>
                                <span className="placement" style={{ color: '#90EE90' }}>{bossVictory}</span>
                              </>
                            )}
                          </div>
                        </div>

                        <div className="match-pokemon-picks">
                          {listAuctions.length === 0 && (
                            <span className="no-picks-label">{is1v1 || isBooster ? 'No picks' : 'No wins'}</span>
                          )}
                          {listAuctions.map((auction: StatsAuction, pickIdx) => (
                            <div
                              className="match-pick"
                              key={auction.auction_id}
                              title={is1v1 || isBooster ? `#${auction.pokedex_id} - Pick ${pickIdx + 1}` : `#${auction.pokedex_id} - $${auction.winning_bid ?? 0}`}
                            >
                              <img
                                src={`/MiniIcons/${formatPokemonName(auction.name)}.png`}
                                alt={auction.name}
                                onError={(ev) => {
                                  (ev.currentTarget as HTMLImageElement).style.display = 'none';
                                }}
                              />
                            </div>
                          ))}
                        </div>
                      </button>

                      {isExpanded && (
                        <div className="match-draft-details">
                          <div className="match-opponents">
                            <span className="match-opponents-label">vs&nbsp;</span>
                            {opponents.length === 0 ? (
                              <span className="match-opponents-empty">Unknown</span>
                            ) : opponents.map((opponent, index) => (
                              <React.Fragment key={opponent.teamId}>
                                {index > 0 && <span className="match-opponents-separator">&#8226;</span>}
                                <a
                                  className="match-opponents-link"
                                  href={`/Stats/PlayerProfiles/${encodeURIComponent(opponent.name)}?userId=${encodeURIComponent(opponent.userId)}`}
                                  title={`Open ${opponent.name}'s profile`}
                                >
                                  <img
                                    className="match-opponents-avatar"
                                    src={getAvatarUrl(opponent.userId)}
                                    alt=""
                                    onError={onAvatarError}
                                  />
                                  <span>{opponent.name}</span>
                                </a>
                              </React.Fragment>
                            ))}
                          </div>
                          <div className="match-draft-details-columns" style={{ display: 'flex', gap: '1rem' }}>
                            {/* Pokemon Section + Hall of Fame Team */}
                            <div style={{ flex: 6, display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                              <div>
                                <div className="match-draft-details-header">
                                  <span>Pokemon</span>
                                  <button
                                    type="button"
                                    className={`match-draft-details-sort ${runSort?.column === 'slot' ? 'sorted' : ''}`}
                                    onClick={() => toggleRunSort('slot')}
                                    title={is1v1 || isBooster ? 'Sort by pick number' : 'Sort by cost'}
                                  >
                                    {is1v1 || isBooster ? 'Pick' : 'Paid'}{runSort?.column === 'slot' ? (runSort.direction === 'desc' ? ' â–¼' : ' â–²') : ''}
                                  </button>
                                  <button
                                    type="button"
                                    className={`match-draft-details-sort ${runSort?.column === 'turns' ? 'sorted' : ''}`}
                                    onClick={() => toggleRunSort('turns')}
                                    title="Sort by turn count"
                                  >
                                    Turn Count{runSort?.column === 'turns' ? (runSort.direction === 'desc' ? ' â–¼' : ' â–²') : ''}
                                  </button>
                                  <button
                                    type="button"
                                    className={`match-draft-details-sort ${runSort?.column === 'kos' ? 'sorted' : ''}`}
                                    onClick={() => toggleRunSort('kos')}
                                    title="Sort by KOs"
                                  >
                                    KOs{runSort?.column === 'kos' ? (runSort.direction === 'desc' ? ' â–¼' : ' â–²') : ''}
                                  </button>
                                  <span>Fainted</span>
                                </div>
                                {sortedRunRows.length === 0 && (
                                  <div className="match-draft-details-empty">{is1v1 || isBooster ? 'No Pokemon picked in this draft.' : 'No Pokemon won in this draft.'}</div>
                                )}
                                {sortedRunRows.map(({ key, icon, name, form, label, pickLabel, monStats }) => (
                                  <div className="match-draft-details-row" key={key}>
                                    <div className="match-draft-details-pokemon">
                                      <img
                                        src={`/MiniIcons/${icon}.png`}
                                        alt={name}
                                        onError={(ev) => {
                                          (ev.currentTarget as HTMLImageElement).style.display = 'none';
                                        }}
                                      />
                                      <span>{label ?? getPokemonLabel(name, form)}</span>
                                    </div>
                                    <span className="match-draft-details-cost">{pickLabel}</span>
                                    <span className="match-draft-details-stat">{monStats?.totalTurns ?? '\u2014'}</span>
                                    <span className="match-draft-details-stat">{monStats?.koCount ?? '\u2014'}</span>
                                    <span className="match-draft-details-stat">
                                      {!monStats
                                        ? '\u2014'
                                        : monStats.fainted
                                          ? monStats.faintedLevel != null
                                            ? `lvl ${monStats.faintedLevel}`
                                            : 'Fainted'
                                          : '\u2014'}
                                    </span>
                                  </div>
                                ))}
                              </div>

                              {bossVictory && hallOfFameTeam && hallOfFameTeam.length > 0 && (
                                <div className="match-hall-of-fame">
                                  <div className="match-hall-of-fame-header">Hall of Fame Team</div>
                                  <div className="match-hall-of-fame-icons">
                                    {hallOfFameTeam.map((mon, idx) => (
                                      <div className="match-hall-of-fame-icon" key={idx} title={mon.name}>
                                        <img
                                          src={`/MiniIcons/${getIconName(mon.name)}.png`}
                                          alt={mon.name}
                                          onError={(ev) => {
                                            (ev.currentTarget as HTMLImageElement).src = '/MiniIcons/question.png';
                                          }}
                                        />
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>

                            {/* Boss Battle History Section */}
                            <div style={{ flex: 4 }}>
                              {bossBattleHistoryLoading && (
                                <div className="match-draft-details-empty">Loading boss battles...</div>
                              )}
                              {!bossBattleHistoryLoading && bossBattleHistory.has(team.team_id) && (
                                <>
                                  <div className="match-draft-details-header boss-battle-header">
                                    <span>Boss Battles</span>
                                    <span>Time</span>
                                  </div>
                                   {(() => {
                                     const battles = bossBattleHistory.get(team.team_id);
                                     const hasBattles = battles && battles.length > 0;
                                     const finished = isRunFinished(battles);
                                     const pending = mySubmissions.get(team.team_id);
                                     const isOwnProfile = selectedPlayer?.user_id === currentUserId;
                                     const isSiteAdmin = currentUserId === SITE_ADMIN_USER_ID;
                                     // The site admin can add or edit splits on any player's run,
                                     // including finished runs, the same way they can edit any profile's avatar.
                                     const canSubmitBattles =
                                       !mySubmissionsLoading && (isOwnProfile || isSiteAdmin);
                                     if (pending && canSubmitBattles) {
                                       return (
                                         <div className="boss-submission-status">
                                           <span className="boss-submission-pending">Pending Confirmation</span>
                                           <button
                                             type="button"
                                             className="boss-submission-action"
                                             onClick={() => openUploadModal(team.team_id, team.draft_id, pending)}
                                           >
                                             Edit
                                           </button>
                                           <button
                                             type="button"
                                             className="boss-submission-action"
                                             onClick={() => handleWithdraw(team.team_id)}
                                           >
                                             Withdraw
                                           </button>
                                         </div>
                                       );
                                     }
                                     if (!canSubmitBattles) {
                                       if (!hasBattles) {
                                         return <div className="match-draft-details-empty">No boss battles recorded</div>;
                                       }
                                       return null;
                                     }
                                     if (isSiteAdmin) {
                                       return (
                                         <div className="boss-submission-empty">
                                           <span>{hasBattles ? 'Edit boss battles' : 'No boss battles recorded'}</span>
                                           <button
                                             type="button"
                                             className="boss-submission-add"
                                             title="Edit boss battles"
                                             aria-label="Edit boss battles"
                                             onClick={() => openUploadModal(team.team_id, team.draft_id, undefined, false, true)}
                                           >
                                             +
                                           </button>
                                         </div>
                                       );
                                     }
                                     // Owner (not site admin), no pending submission
                                     if (!hasBattles) {
                                       return (
                                         <div className="boss-submission-empty">
                                           <span>No boss battles recorded</span>
                                           <button
                                             type="button"
                                             className="boss-submission-add"
                                             title="Upload boss battle history"
                                             aria-label="Upload boss battle history"
                                             onClick={() => openUploadModal(team.team_id, team.draft_id)}
                                           >
                                             +
                                           </button>
                                         </div>
                                       );
                                     }
                                     // Has battles; show + only if not finished (additive case)
                                     if (!finished) {
                                       return (
                                         <div className="boss-submission-empty">
                                           <span>Add boss battles played on local emulator</span>
                                           <button
                                             type="button"
                                             className="boss-submission-add"
                                             title="Upload boss battle history"
                                             aria-label="Upload boss battle history"
                                             onClick={() => openUploadModal(team.team_id, team.draft_id, undefined, true)}
                                           >
                                             +
                                           </button>
                                         </div>
                                       );
                                     }
                                     return null;
                                   })()}
                                  {bossBattleHistory.get(team.team_id)?.map((battle, idx) => {
                                    const sprite = getTrainerSpriteName(battle.trainer_id, battle.version);
                                    return (
                                      <div className="match-draft-details-row boss-battle-row" key={idx}>
                                        <div className="match-draft-details-pokemon trainer-name">
                                          {sprite && (
                                            <img
                                              className="trainer-sprite"
                                              src={`/TrainerSprites/${sprite}.png`}
                                              alt=""
                                              onError={(ev) => {
                                                (ev.currentTarget as HTMLImageElement).style.display = 'none';
                                              }}
                                            />
                                          )}
                                          <span className={battle.is_loss ? 'loss' : 'win'}>
                                            {getTrainerNameById(battle.trainer_id, battle.version)}
                                          </span>
                                        </div>
                                        <span
                                          className={`match-draft-details-cost ${battle.hours === 5 && battle.minutes === 0 && battle.seconds === 0 ? 'forfeit' : ''}`}
                                        >
                                          {battle.hours === 5 && battle.minutes === 0 && battle.seconds === 0
                                            ? 'Forfeit'
                                            : `${battle.hours > 0 ? `${battle.hours}h ` : ''}${battle.minutes}m ${battle.seconds}s`}
                                        </span>
                                      </div>
                                    );
                                  })}
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {uploadTeam && (
          <div className="boss-battle-modal-backdrop" onClick={closeUploadModal}>
            <div className="boss-battle-modal" onClick={(e) => e.stopPropagation()}>
              <div className="boss-battle-modal-header">
                <span>Submit Splits</span>
                <button type="button" className="boss-battle-modal-close" onClick={closeUploadModal}>
                  &times;
                </button>
              </div>
              <p className="boss-battle-modal-hint">
                If you draft via the website but then play your run on a local emulator, you can submit your
                splits to this module to have your results recorded on the website. After you submit, send Nathan
                a screenshot of your trainer card over Discord so that he can verify it. Once approved, the
                results will be added to your profile.
              </p>
              <BossBattleEditor
                battles={uploadTeam.battles}
                lockedCount={uploadTeam.lockedCount}
                onChange={(battles) => setUploadTeam((prev) => (prev ? { ...prev, battles } : prev))}
              />
              <div className="boss-battle-hof-section">
                <h3 className="boss-battle-section-title">Hall of Fame Team (optional)</h3>
                <p className="boss-battle-modal-hint">
                  If this run champed, enter your Hall of Fame team here.
                </p>
                <HallOfFameTeamEditor
                  key={uploadTeam.teamId}
                  initialTeam={uploadTeam.hallOfFameTeam}
                  disabled={uploadSaving}
                  onChange={(hallOfFameTeam) =>
                    setUploadTeam((prev) => (prev ? { ...prev, hallOfFameTeam } : prev))
                  }
                />
              </div>
              <input
                type="text"
                className="boss-battle-note-input"
                placeholder="Note (optional)"
                value={uploadTeam.note}
                disabled={uploadSaving}
                onChange={(e) => setUploadTeam((prev) => (prev ? { ...prev, note: e.target.value } : prev))}
              />
              {uploadError && <div className="boss-battle-modal-error">{uploadError}</div>}
              <div className="boss-battle-modal-actions">
                <button type="button" className="button" onClick={closeUploadModal} disabled={uploadSaving}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="button boss-battle-modal-submit"
                  onClick={handleSubmitUpload}
                  disabled={uploadSaving}
                >
                  {uploadSaving ? 'Submitting...' : 'Submit'}
                </button>
              </div>
            </div>
          </div>
        )}
      </article>
    </section>
  );
};
export default PlayerProfileStatsTab;
