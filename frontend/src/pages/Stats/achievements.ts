import type {
  AdminHallOfFameEligibleEntry,
  HallOfFamePokemon,
  MatchHistoryTeam,
  Pokemon,
  RunMonStat,
  StatsAuction,
  StatsPagePlayer,
  StatsPageTeamRow,
} from '../../types';
import type { BossBattleHistoryEntry } from '../../shared/api/stats';
import { SPECIES_BY_ID } from '../../utils/speciesIdMap';
import { buildOpponentsByDraftId, getSelectedPlayerIdentityIds } from './opponentLinks';
import { resolvePokemonIdentity } from '../../shared/utils/pokemonIdentity';
import { computePersonalBestSeconds, isChampionWin, isNonCasualRace } from './raceEligibility';
import { isRentalPokemonName } from './rentalPool';

export interface AchievementDefinition {
  id: string;
  name: string;
  description: string;
  /** File name inside frontend/public/Achievements. */
  icon: string;
}

export interface PlayerAchievement extends AchievementDefinition {
  earned: boolean;
  /** True when a site-owner override is driving the earned state. */
  manuallySet: boolean;
}

export interface AchievementContext {
  player: StatsPagePlayer;
  /** Discord id plus any linked guest ids belonging to the profile. */
  identityIds: Set<string>;
  /** Junk drafts already removed, matching the profile's match history. */
  matchHistory: MatchHistoryTeam[];
  bossBattleHistory: Map<number, BossBattleHistoryEntry[]>;
  hallOfFame: AdminHallOfFameEligibleEntry[];
  /** Ids appearing on either the season 1 or season 2 leaderboard. */
  leaderboardIds: Set<string>;
  /** All teams in every draft, used for head-to-head placement checks. */
  allTeams: StatsPageTeamRow[];
  /** All auction sale rows, used for mid-draft spending checks. */
  auctions: StatsAuction[];
  /** All profiles, used to resolve linked guest accounts. */
  allPlayers: StatsPagePlayer[];
  pokemon: Pokemon[];
  validDraftIds: Set<string>;
  casual1v1DraftIds: Set<string>;
  rmvByTeamId: Map<number, number>;
  /** Manual grants/revokes keyed by achievement id. */
  manualOverrides: Map<string, boolean>;
}

const STREAM_LEGEND_USER_ID = '310960489628696576';
const EASY_AS_PIE_USER_ID = '306547404595920896';
const WALLY_TRAINER_ID = 656;
const MUDKIP_POKEDEX_ID = 258;
const STINGY_MAX_SINGLE_PURCHASE = 2000;
const WORTH_EVERY_PENNY_MIN_PREMIUM = 2000;
const RPS_CHAMPION_REQUIRED_WINS = 10;
const IMPATIENT_SPEND_TARGET = 20000;
const OLD_FAITHFUL_REQUIRED_WINS = 10;
const EEVEE_POKEDEX_ID = 133;
const WISHIWASHI_POKEDEX_ID = 746;
const SCHOOLIN_ON_EM_MIN_KOS = 11;
const TRUE_LOVE_SHARED_RACES = 10;
const DEATHLESS_START_DATE = '2026-08-10';
const BATTLE_FRONTIER_BRAIN_IDS = new Set([806, 807, 810, 811]);
/** All boss trainer splits tracked in gyms.txt. */
const ALL_BOSS_TRAINER_IDS = new Set([
  // Roxanne 1-8
  265, 770, 771, 772, 773, 812, 813, 814,
  // Viola 1-8
  855, 856, 857, 858, 859, 860, 861, 862,
  // Brawly 1-8
  266, 774, 775, 776, 777, 815, 816, 817,
  // Wattson 1-8
  267, 778, 779, 780, 781, 818, 819, 820,
  // Flannery 1-8
  268, 782, 783, 784, 785, 821, 822, 823,
  // Norman 1-8
  269, 786, 787, 788, 789, 824, 825, 826,
  // Winona 1-8
  270, 790, 791, 792, 793, 827, 828, 829,
  // Tate & Liza 1-8
  271, 794, 795, 796, 797, 830, 831, 832,
  // Juan & Wallace 1-8
  272, 798, 799, 800, 801, 833, 834, 835,
  // Story bosses / rivals
  34, 601,
  // Elite Four / Frontier Brains
  261, 807, 262, 810, 263, 806, 264, 811,
  // Champions
  804, 656,
]);
const ORIGINAL_151_MAX_DEX_ID = 151;
const REGIONAL_FORMS = new Set(['alola', 'galar', 'hisui', 'paldea']);

type StarterType = 'grass' | 'fire' | 'water';

/** National dex ranges for every starter family, including evolutions and forms. */
const STARTER_TYPE_RANGES: Array<{ type: StarterType; ranges: Array<[number, number]> }> = [
  {
    type: 'grass',
    ranges: [
      [1, 3], [152, 154], [252, 254], [387, 389], [495, 497],
      [650, 652], [722, 724], [810, 812], [906, 908],
    ],
  },
  {
    type: 'fire',
    ranges: [
      [4, 6], [155, 157], [255, 257], [390, 392], [498, 500],
      [653, 655], [725, 727], [813, 815], [909, 911],
    ],
  },
  {
    type: 'water',
    ranges: [
      [7, 9], [158, 160], [258, 260], [393, 395], [501, 503],
      [656, 658], [728, 730], [816, 818], [912, 914],
    ],
  },
];

const STARTER_TYPE_BY_DEX_ID = new Map<number, StarterType>();
STARTER_TYPE_RANGES.forEach(({ type, ranges }) => {
  ranges.forEach(([start, end]) => {
    for (let dexId = start; dexId <= end; dexId += 1) {
      STARTER_TYPE_BY_DEX_ID.set(dexId, type);
    }
  });
});

const EEVEELUTION_ICONS = [
  'vaporeon',
  'jolteon',
  'flareon',
  'espeon',
  'umbreon',
  'leafeon',
  'glaceon',
  'sylveon',
];

/**
 * The order here is the order achievements appear on a profile. `icon` is the
 * exact file name in `frontend/public/Achievements`.
 */
export const ACHIEVEMENT_DEFINITIONS: AchievementDefinition[] = [
  {
    id: 'stream-legend',
    name: 'Stream Legend',
    description: 'Host an epic Blitz event',
    icon: 'StreamLegend.png',
  },
  {
    id: 'grand-prix-racer',
    name: 'Grande Prix Racer',
    description: 'Play in an Ever Grande Prix race',
    icon: 'GrandPrixRacer.png',
  },
  { id: '250-club', name: '250+ Club', description: 'Play 250 races', icon: '250+.png' },
  { id: '100-club', name: '100+ Club', description: 'Play 100 races', icon: '100+.png' },
  { id: '25-club', name: '25+ Club', description: 'Play 25 races', icon: '25+.png' },
  { id: '10-club', name: '10+ Club', description: 'Play 10 races', icon: '10+.png' },
  {
    id: 'true-love',
    name: 'True Love',
    description: 'Play 10 races with another specific player',
    icon: 'TrueLove.png',
  },
  {
    id: 'blitz-legend',
    name: 'Blitz Legend',
    description: 'Beat the game 100 times',
    icon: 'BlitzLegend.png',
  },
  {
    id: 'blitz-champion',
    name: 'Blitz Champion',
    description: 'Beat the game 50 times',
    icon: 'BlitzChampion.png',
  },
  {
    id: 'blitz-hero',
    name: 'Blitz Hero',
    description: 'Beat the game 10 times',
    icon: 'BlitzHero.png',
  },
  {
    id: 'winner',
    name: 'Blitz Winner',
    description: 'Beat the game',
    icon: 'Winner.png',
  },
  {
    id: 'sub-100-club',
    name: 'Sub-100 Club',
    description: 'Get a personal best time under 100 minutes',
    icon: 'Sub100.png',
  },
  {
    id: 'sub-90-club',
    name: 'Sub-90 Club',
    description: 'Get a personal best time under 90 minutes',
    icon: 'Sub90.png',
  },
  {
    id: 'sub-80-club',
    name: 'Sub-80 Club',
    description: 'Get a personal best time under 80 minutes',
    icon: 'Sub80.png',
  },
  {
    id: 'sub-70-club',
    name: 'Sub-70 Club',
    description: 'Get a personal best time under 70 minutes',
    icon: 'Sub70.png',
  },
  {
    id: 'sub-hour-club',
    name: 'Sub-Hour Club',
    description: 'Get a personal best time under 60 minutes',
    icon: 'Sub60.png',
  },
  {
    id: 'speed-freak',
    name: 'Speed Freak',
    description: 'Beat the first gym in under 2 minutes and 30 seconds',
    icon: 'SpeedFreak.png',
  },
  {
    id: 'back-to-back',
    name: 'Back to Back',
    description: 'Beat the game twice in one day',
    icon: 'BacktoBack.png',
  },
  {
    id: 'impressive-host',
    name: 'Impressive Host',
    description: 'Host and win your own auction draft race',
    icon: 'ImpressiveHost.png',
  },
  {
    id: 'moneyballer',
    name: 'Moneyballer',
    description: 'Get an RMV of over $25,000 in a competitive draft',
    icon: 'Moneyballer.png',
  },
  {
    id: 'worth-every-penny',
    name: 'Worth Every Penny',
    description: 'Win a Pokemon in auction for at least $2000 more than its average price',
    icon: 'WorthEveryPenny.png',
  },
  {
    id: 'stingy',
    name: 'Stingy',
    description: "Win a race in which you don't spend more than $2000 on a single Pokémon",
    icon: 'Stingy.png',
  },
  {
    id: 'impatient',
    name: 'Impatient',
    description: 'Spend $20,000 before an auction is halfway over',
    icon: 'Impatient.png',
  },
  {
    id: 'easy-as-pie',
    name: 'Easy As Pie',
    description: 'Defeat the user Shartwagon in a race',
    icon: 'EasyAsPie.png',
  },
  {
    id: 'who-are-you',
    name: 'Who Are You?',
    description: 'Defeat Wally using 3 of his own Pokémon',
    icon: 'WhoAreYou.png',
  },
  {
    id: 'the-chosen-one',
    name: 'The Chosen One',
    description: 'Win a 1v1 in which you first pick Mudkip',
    icon: 'ChosenOne.png',
  },
  {
    id: 'type-loyalist',
    name: 'Type Loyalist',
    description: 'Win a race in which you draft 4 Pokemon of the same type',
    icon: 'TypeLoyalist.png',
  },
  {
    id: 'pokemon-professor',
    name: 'Pokémon Professor',
    description: 'Win a race in which you draft a starter of all 3 types',
    icon: 'PokemonProfessor.png',
  },
  {
    id: 'old-head',
    name: 'Old Head',
    description: 'Win a race in which you only use Pokémon from the original 151',
    icon: 'OldHead.png',
  },
  {
    id: 'clutch-master',
    name: 'Clutch God',
    description: 'Win a race in which you have at least 10 deaths',
    icon: 'ClutchMaster.png',
  },
  {
    id: 'untiltable',
    name: 'Untiltable',
    description: 'Beat the game after losing three Pokémon to the first gym leader',
    icon: 'Untiltable.png',
  },
  {
    id: 'deathless',
    name: 'Deathless',
    description: 'Beat the game without any Pokémon fainting',
    icon: 'Deathless.png',
  },
  {
    id: 'hard-carried',
    name: 'Hard Carried',
    description: 'Win a race in which one Pokemon earns at least 20 KOs',
    icon: 'HardCarried.png',
  },
  {
    id: 'schoolin-on-em',
    name: "Schoolin' On Em",
    description: 'Win a race in which Wishiwashi earns at least 11 KOs',
    icon: 'SchoolinOnEm.png',
  },
  {
    id: 'old-faithful',
    name: 'Old Faithful',
    description: 'Win 10 races with the same Pokémon',
    icon: 'OldFaithful.png',
  },
  {
    id: 'artisan',
    name: 'Artisan',
    description: 'Win a race with Smeargle on your Hall of Fame team',
    icon: 'Artisan.png',
  },
  {
    id: 'criminal',
    name: 'Criminal',
    description: 'Enter the Hall of Fame with a stolen Pokemon',
    icon: 'Criminal.png',
  },
  {
    id: 'good-as-new',
    name: 'Good as New',
    description: 'Enter the Hall of Fame with Corsola',
    icon: 'GoodAsNew.png',
  },
  {
    id: 'rainbow-warrior',
    name: 'Rainbow Warrior',
    description: 'Enter the Hall of Fame with all 8 Eeveelutions across your races',
    icon: 'RainbowWarrior.png',
  },
  {
    id: 'appliance-master',
    name: 'Appliance Master',
    description: "Enter the Hall of Fame with all 5 of Rotom's appliance forms across your races",
    icon: 'ApplianceMaster.png',
  },
  {
    id: 'doctors-worst-nightmare',
    name: "Doctor's Worst Nightmare",
    description: "Enter the Hall of Fame with all 3 of Applin's evolutions across your races",
    icon: 'DoctorsWorstNightmare.png',
  },
  {
    id: 'natural-born-gambler',
    name: 'Natural Born Gambler',
    description: 'Enter the Hall of Fame with Azumarill, Clefable, Togekiss, and Wigglytuff across your races',
    icon: 'NaturalBornGambler.png',
  },
  {
    id: 'big-year',
    name: 'Big Year',
    description: 'Enter the Hall of Fame with at least 3 flying-type Pokémon on your team',
    icon: 'BigYear.png',
  },
  {
    id: 'night-owl',
    name: 'Night Owl',
    description: 'Enter the Hall of Fame with at least 2 Pokémon who evolve only at night',
    icon: 'NightOwl.png',
  },
  {
    id: 'elite-mind',
    name: 'Elite Mind',
    description: 'Win a run in which you defeat all four Battle Frontier Brains consecutively',
    icon: 'EliteMind.png',
  },
  {
    id: 'seen-it-all',
    name: 'Seen It All',
    description: 'Face every boss trainer',
    icon: 'SeenItAll.png',
  },
  {
    id: 'close-combatant',
    name: 'Close Combatant',
    description: 'Enter the Hall of Fame with multiple Pokémon from Close Combat on your team',
    icon: 'CloseCombatant.png',
  },
  {
    id: 'rps-champion',
    name: 'RPS Champion',
    description: 'Win 10 rounds of Rock Paper Scissors',
    icon: 'RPSChampion.png',
  },
  {
    id: 'infinite-wisdom',
    name: 'Infinite Wisdom',
    description: 'Coach in a Little Cup Race',
    icon: 'InfiniteWisdom.png',
  },
  {
    id: 'early-bird',
    name: 'Early Bird',
    description: 'Play a race in March or April 2026',
    icon: 'EarlyBird.png',
  },
];

function normalizeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

const WALLY_MON_POOL = new Set([
  'Gallade', 'Roserade', 'Garchomp', 'Talonflame', 'Azumarill', 'Magnezone',
].map(normalizeName));
const WALLY_REQUIRED_MONS = 3;

const ROTOM_APPLIANCE_FORM_KEYS = ['Heat', 'Wash', 'Mow', 'Frost', 'Fan']
  .map((form) => normalizeName(`Rotom-${form}`));

const APPLIN_EVOLUTION_KEYS = ['Hydrapple', 'Appletun', 'Flapple'].map(normalizeName);

const NATURAL_BORN_GAMBLER_KEYS = ['Azumarill', 'Clefable', 'Togekiss', 'Wigglytuff']
  .map(normalizeName);

const GOOD_AS_NEW_KEYS = ['Corsola'].map(normalizeName);

const NIGHT_OWL_KEYS = new Set([
  'Decidueye',
  'Typhlosion-Hisui',
  'Braviary-Hisui',
  'Samurott-Hisui',
  'Mr. Rime',
  'Marowak-Alola',
  'Lycanroc-Midnight',
].map(normalizeName));

const WISHIWASHI_ROM_IDS = new Set<number>([
  WISHIWASHI_POKEDEX_ID,
  ...Object.entries(SPECIES_BY_ID)
    .filter(([, info]) => info.baseId === WISHIWASHI_POKEDEX_ID)
    .map(([id]) => Number(id)),
]);
const WISHIWASHI_NAME_KEYS = new Set<string>(['wishiwashi']);
Object.values(SPECIES_BY_ID).forEach((info) => {
  if (info.baseId !== WISHIWASHI_POKEDEX_ID) return;
  WISHIWASHI_NAME_KEYS.add(normalizeName(info.name));
  WISHIWASHI_NAME_KEYS.add(normalizeName(info.icon));
});

function didBeatWally(
  team: MatchHistoryTeam,
  bossBattleHistory: Map<number, BossBattleHistoryEntry[]>,
): boolean {
  return (bossBattleHistory.get(team.team_id) ?? []).some(
    (battle) => battle.trainer_id === WALLY_TRAINER_ID && !battle.is_loss,
  );
}

function hasThreeOfWallysMons(team: MatchHistoryTeam): boolean {
  const matched = new Set<string>();
  (team.hall_of_fame_team ?? []).forEach((mon) => {
    const nameKey = normalizeName(mon.name);
    const iconKey = normalizeName(mon.icon);
    if (WALLY_MON_POOL.has(nameKey)) matched.add(nameKey);
    else if (WALLY_MON_POOL.has(iconKey)) matched.add(iconKey);
  });
  return matched.size >= WALLY_REQUIRED_MONS;
}

/** Collects Hall of Fame Pokémon from every provided run, including casual runs. */
function hasAllHallOfFameKeys(teams: MatchHistoryTeam[], keys: string[]): boolean {
  const seen = new Set<string>();
  teams.forEach((team) => {
    (team.hall_of_fame_team ?? []).forEach((mon) => {
      seen.add(normalizeName(mon.icon));
      seen.add(normalizeName(mon.name));
    });
  });
  return keys.every((key) => seen.has(key));
}

function didWishiwashiEarnOverTenKos(team: MatchHistoryTeam): boolean {
  const hasEnoughKos = (kos: number | null | undefined) =>
    (kos ?? 0) >= SCHOOLIN_ON_EM_MIN_KOS;

  return (
    (team.run_stats ?? []).some(
      (mon) => WISHIWASHI_ROM_IDS.has(mon.species_id) && hasEnoughKos(mon.ko_count),
    ) ||
    (team.hall_of_fame_team ?? []).some(
      (mon) =>
        (WISHIWASHI_NAME_KEYS.has(normalizeName(mon.name)) ||
          WISHIWASHI_NAME_KEYS.has(normalizeName(mon.icon))) &&
        hasEnoughKos(mon.ko_count),
    )
  );
}

function isRegionalForm(form: string | null | undefined): boolean {
  return REGIONAL_FORMS.has((form ?? '').trim().toLowerCase());
}

/** Kanto dex ids only; a regional form of a Kanto species does not count. */
function isOriginal151DexId(dexId: number | null | undefined, form?: string | null): boolean {
  return (
    typeof dexId === 'number' &&
    Number.isInteger(dexId) &&
    dexId >= 1 &&
    dexId <= ORIGINAL_151_MAX_DEX_ID &&
    !isRegionalForm(form)
  );
}

/**
 * ROM species ids that still represent a Kanto Pokemon. Mega forms keep their
 * original species, while regional forms (Exeggutor-Alola, etc.) do not.
 */
const ORIGINAL_151_ROM_IDS = new Set(
  Object.entries(SPECIES_BY_ID)
    .filter(([, info]) => isOriginal151DexId(info.baseId, info.form))
    .map(([id]) => Number(id)),
);

const ORIGINAL_151_NAME_IDS = new Map<string, boolean>();
const ORIGINAL_151_ICON_IDS = new Map<string, boolean>();
Object.entries(SPECIES_BY_ID).forEach(([id, info]) => {
  const allowed = ORIGINAL_151_ROM_IDS.has(Number(id));
  const nameKey = normalizeName(info.name);
  ORIGINAL_151_NAME_IDS.set(nameKey, allowed || (ORIGINAL_151_NAME_IDS.get(nameKey) ?? false));
  const iconKey = normalizeName(info.icon);
  ORIGINAL_151_ICON_IDS.set(iconKey, allowed || (ORIGINAL_151_ICON_IDS.get(iconKey) ?? false));
});

function isOriginal151Pick(auction: StatsAuction): boolean {
  if (auction.action === 'BAN' || auction.action === 'LEFTOVER') return false;
  return isOriginal151DexId(auction.pokedex_id, auction.form);
}

function isOriginal151HofMon(
  mon: HallOfFamePokemon,
  pokemonLookup: Map<string, Pokemon>,
): boolean {
  const byName = ORIGINAL_151_NAME_IDS.get(normalizeName(mon.name));
  if (byName !== undefined) return byName;
  const byIcon = ORIGINAL_151_ICON_IDS.get(normalizeName(mon.icon));
  if (byIcon !== undefined) return byIcon;
  const match =
    pokemonLookup.get(normalizeName(mon.name)) ?? pokemonLookup.get(normalizeName(mon.icon));
  return match ? isOriginal151DexId(match.pokedex_id ?? match.id, match.form) : false;
}

/** Drafts, evolutions, and any recorded Hall of Fame team must all be Kanto species. */
function onlyUsedOriginal151(team: MatchHistoryTeam, pokemonLookup: Map<string, Pokemon>): boolean {
  const picks = (team.pokemon_drafted ?? []).filter(
    (auction) => team.draft_type !== '1v1' || auction.action === 'PICK',
  );
  if (picks.length === 0 || !picks.every(isOriginal151Pick)) return false;

  const usedSpecies: RunMonStat[] = team.run_stats ?? [];
  if (usedSpecies.some((mon) => !ORIGINAL_151_ROM_IDS.has(mon.species_id))) return false;

  return (team.hall_of_fame_team ?? []).every((mon) => isOriginal151HofMon(mon, pokemonLookup));
}

const CLOSE_COMBAT_POOL = new Set([
  'Bewear', 'Blaziken', 'Breloom', 'Chesnaught', 'Falinks', 'Heracross', 'Hawlucha',
  'Kommo-o', 'Lopunny', 'Medicham', 'Poliwrath', 'Primeape', 'Scrafty', 'Toxicroak',
  'Hitmonchan', 'Hitmontop', 'Hitmonlee', 'Tyrogue',
].map(normalizeName));

function hasMultipleCloseCombatMons(team: MatchHistoryTeam): boolean {
  const matching = new Set<string>();
  (team.hall_of_fame_team ?? []).forEach((mon) => {
    const key = normalizeName(mon.name) || normalizeName(mon.icon);
    if (CLOSE_COMBAT_POOL.has(key)) matching.add(key);
  });
  return matching.size >= 2;
}

function hasTwoNightEvolutionMons(team: MatchHistoryTeam): boolean {
  const matching = new Set<string>();
  (team.hall_of_fame_team ?? []).forEach((mon) => {
    const nameKey = normalizeName(mon.name);
    const iconKey = normalizeName(mon.icon);
    if (NIGHT_OWL_KEYS.has(nameKey)) matching.add(nameKey);
    else if (NIGHT_OWL_KEYS.has(iconKey)) matching.add(iconKey);
  });
  return matching.size >= 2;
}

function didBeatGame(
  team: MatchHistoryTeam,
  bossBattleHistory: Map<number, BossBattleHistoryEntry[]>,
): boolean {
  if ((team.hall_of_fame_team?.length ?? 0) > 0) return true;
  const battles = bossBattleHistory.get(team.team_id) ?? [];
  const lastBattle = battles[battles.length - 1];
  return Boolean(lastBattle && isChampionWin(lastBattle));
}

const FIRST_SPLIT_LIMIT_SECONDS = 2 * 60 + 30;

/** Boss history is ordered by in-game time, so the first entry is the first split. */
function beatFirstGymUnderTwoThirty(battles: BossBattleHistoryEntry[]): boolean {
  const firstSplit = battles[0];
  if (!firstSplit || firstSplit.is_loss) return false;
  const seconds = firstSplit.hours * 3600 + firstSplit.minutes * 60 + firstSplit.seconds;
  return seconds < FIRST_SPLIT_LIMIT_SECONDS;
}

function defeatedAllFrontierBrainsConsecutively(
  battles: BossBattleHistoryEntry[],
): boolean {
  for (let start = 0; start <= battles.length - BATTLE_FRONTIER_BRAIN_IDS.size; start++) {
    const window = battles.slice(start, start + BATTLE_FRONTIER_BRAIN_IDS.size);
    if (window.some((battle) => battle.is_loss)) continue;

    const ids = new Set(window.map((battle) => battle.trainer_id));
    if (
      ids.size === BATTLE_FRONTIER_BRAIN_IDS.size &&
      Array.from(ids).every((id) => BATTLE_FRONTIER_BRAIN_IDS.has(id))
    ) {
      return true;
    }
  }
  return false;
}

function draftYearMonth(value: string): { year: number; month: number } | null {
  // Both ISO ("2026-03-14T...") and SQL ("2026-03-14 12:00:00") timestamps
  // start with the calendar date, so avoid timezone shifting the month.
  const match = value.match(/^(\d{4})-(\d{2})/);
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]) };
}

/** Inclusive calendar-date check that avoids timezone-shifting the timestamp. */
function isDraftOnOrAfter(value: string, startDate: string): boolean {
  return value.slice(0, 10) >= startDate;
}

function hadNoFaints(team: MatchHistoryTeam): boolean {
  const runStats = team.run_stats ?? [];
  return runStats.length > 0 && runStats.every((mon) => !mon.fainted);
}

function firstPickIsMudkip(team: MatchHistoryTeam): boolean {
  const picks = (team.pokemon_drafted ?? []).filter((auction) => {
    if (team.draft_type !== '1v1') return true;
    return auction.action === 'PICK';
  });
  if (picks.length === 0) return false;

  const firstOrder = Math.min(...picks.map((auction) => auction.draft_order));
  return picks.some(
    (auction) => auction.draft_order === firstOrder && auction.pokedex_id === MUDKIP_POKEDEX_ID,
  );
}

function neverSpentOverTwoThousandOnOnePokemon(team: MatchHistoryTeam): boolean {
  const picks = team.pokemon_drafted ?? [];
  if (picks.length === 0) return false;
  return picks.every(
    (auction) =>
      auction.winning_bid !== null &&
      auction.winning_bid !== undefined &&
      auction.winning_bid <= STINGY_MAX_SINGLE_PURCHASE,
  );
}

/**
 * Auction drafts only. Replay each non-casual draft in sale order and look for
 * the exact moment the selected player's spending hits $20,000 while strictly
 * fewer than half of that draft's Pokemon have sold.
 */
function spentTwentyThousandBeforeHalfway(ctx: AchievementContext): boolean {
  const salesByDraftId = new Map<string, StatsAuction[]>();

  ctx.auctions.forEach((auction) => {
    if (typeof auction.winning_bid !== 'number') return;
    if (auction.draft_type === '1v1') return;
    if (!isNonCasualRace(auction, ctx.validDraftIds, ctx.casual1v1DraftIds)) return;

    const sales = salesByDraftId.get(auction.draft_id) ?? [];
    sales.push(auction);
    salesByDraftId.set(auction.draft_id, sales);
  });

  for (const sales of Array.from(salesByDraftId.values())) {
    sales.sort(
      (a, b) => a.draft_order - b.draft_order || a.auction_id - b.auction_id,
    );
    const halfwayPoint = sales.length / 2;
    let spent = 0;

    for (let index = 0; index < sales.length; index++) {
      const sale = sales[index];
      const wonByPlayer =
        Boolean(sale.winning_user_id && ctx.identityIds.has(sale.winning_user_id)) ||
        Boolean(sale.winning_guest_id && ctx.identityIds.has(sale.winning_guest_id));
      if (wonByPlayer) spent += sale.winning_bid!;

      // `index + 1` is the number of Pokemon sold after this sale.
      if (spent === IMPATIENT_SPEND_TARGET && index + 1 < halfwayPoint) return true;
    }
  }

  return false;
}

function hostedDraftIds(ctx: AchievementContext): Set<string> {
  const hosted = new Set<string>();
  ctx.allTeams.forEach((team) => {
    if (team.host && ctx.identityIds.has(team.host)) {
      hosted.add(team.draft_id);
    }
  });
  return hosted;
}

function hasHostedAndWonOwnAuction(
  ctx: AchievementContext,
  winningTeams: MatchHistoryTeam[],
): boolean {
  const hosted = hostedDraftIds(ctx);
  return winningTeams.some((team) => team.draft_type !== '1v1' && hosted.has(team.draft_id));
}

function wonPokemonForAtLeastTwoThousandOverAverage(ctx: AchievementContext): boolean {
  const competitiveSalesByKey = new Map<string, { total: number; count: number }>();

  ctx.auctions.forEach((auction) => {
    if (typeof auction.winning_bid !== 'number') return;
    if (auction.draft_type === '1v1') return;
    if (auction.action === 'BAN' || auction.action === 'LEFTOVER') return;
    if (!isNonCasualRace(auction, ctx.validDraftIds, ctx.casual1v1DraftIds)) return;

    const { key } = resolvePokemonIdentity(auction.name, auction.form || '');
    const sales = competitiveSalesByKey.get(key) ?? { total: 0, count: 0 };
    sales.total += auction.winning_bid;
    sales.count += 1;
    competitiveSalesByKey.set(key, sales);
  });

  return ctx.auctions.some((auction) => {
    if (typeof auction.winning_bid !== 'number') return false;
    if (auction.draft_type === '1v1') return false;
    if (auction.action === 'BAN' || auction.action === 'LEFTOVER') return false;
    if (!isNonCasualRace(auction, ctx.validDraftIds, ctx.casual1v1DraftIds)) return false;

    const winnerId = auction.winning_user_id ?? auction.winning_guest_id;
    if (!winnerId || !ctx.identityIds.has(winnerId)) return false;

    const { key } = resolvePokemonIdentity(auction.name, auction.form || '');
    const sales = competitiveSalesByKey.get(key);
    if (!sales || sales.count === 0) return false;
    const avgPrice = sales.total / sales.count;
    return auction.winning_bid >= avgPrice + WORTH_EVERY_PENNY_MIN_PREMIUM;
  });
}

function hasFourSameTypePicks(team: MatchHistoryTeam, pokemonById: Map<number, Pokemon>): boolean {
  const typeToSpecies = new Map<string, Set<number>>();

  (team.pokemon_drafted ?? []).forEach((auction) => {
    if (team.draft_type === '1v1' && auction.action !== 'PICK') return;
    const pokemon = pokemonById.get(auction.pokedex_id);
    if (!pokemon) return;

    const types = [pokemon.type1, pokemon.type2].filter((type): type is string => Boolean(type));
    types.forEach((type) => {
      const key = type.toLowerCase();
      const species = typeToSpecies.get(key) ?? new Set<number>();
      species.add(auction.pokedex_id);
      typeToSpecies.set(key, species);
    });
  });

  return Array.from(typeToSpecies.values()).some((species) => species.size >= 4);
}

/** Auction drafts and 1v1 PICKs can qualify; bans and leftovers cannot. */
function hasAllThreeStarterTypes(team: MatchHistoryTeam): boolean {
  const types = new Set<StarterType>();

  (team.pokemon_drafted ?? []).forEach((pick) => {
    if (pick.action === 'BAN' || pick.action === 'LEFTOVER') return;
    if (team.draft_type === '1v1' && pick.action !== 'PICK') return;

    const starterType = STARTER_TYPE_BY_DEX_ID.get(pick.pokedex_id);
    if (starterType) types.add(starterType);
  });

  return types.size === 3;
}

function pokemonByName(pokemon: Pokemon[]): Map<string, Pokemon> {
  const map = new Map<string, Pokemon>();
  pokemon.forEach((mon) => {
    map.set(normalizeName(mon.name), mon);
    if (mon.form) map.set(normalizeName(`${mon.name}-${mon.form}`), mon);
  });
  return map;
}

function isFlyingType(mon: HallOfFamePokemon, pokemonLookup: Map<string, Pokemon>): boolean {
  const match =
    pokemonLookup.get(normalizeName(mon.name)) ??
    pokemonLookup.get(normalizeName(mon.icon));
  if (!match) return false;
  return [match.type1, match.type2].some((type) => type?.toLowerCase() === 'flying');
}

/** Drafted picks only. 1v1 bans/leftovers and Eevee never count. */
function draftedMonKeys(team: MatchHistoryTeam): string[] {
  return (team.pokemon_drafted ?? [])
    .filter((pick) => {
      if (pick.pokedex_id === EEVEE_POKEDEX_ID) return false;
      if (team.draft_type === '1v1') return pick.action === 'PICK';
      return pick.action !== 'BAN' && pick.action !== 'LEFTOVER';
    })
    .map((pick) => `${pick.pokedex_id}:${(pick.form ?? '').trim().toLowerCase()}`);
}

function wonTenRacesWithSameDraftPick(winningTeams: MatchHistoryTeam[]): boolean {
  const draftsByPick = new Map<string, Set<string>>();

  winningTeams.forEach((team) => {
    new Set(draftedMonKeys(team)).forEach((key) => {
      const drafts = draftsByPick.get(key) ?? new Set<string>();
      drafts.add(team.draft_id);
      draftsByPick.set(key, drafts);
    });
  });

  return Array.from(draftsByPick.values()).some(
    (drafts) => drafts.size >= OLD_FAITHFUL_REQUIRED_WINS,
  );
}

/**
 * Casual races count for this one. Count distinct drafts shared with each
 * resolved opponent profile, so linked guest accounts roll up to one player.
 */
function hasTenRacesWithSamePlayer(ctx: AchievementContext): boolean {
  const opponentsByDraftId = buildOpponentsByDraftId(
    ctx.allTeams,
    ctx.allPlayers,
    ctx.identityIds,
  );
  const draftsByOpponent = new Map<string, Set<string>>();

  ctx.matchHistory.forEach((team) => {
    (opponentsByDraftId.get(team.draft_id) ?? []).forEach((opponent) => {
      const drafts = draftsByOpponent.get(opponent.userId) ?? new Set<string>();
      drafts.add(team.draft_id);
      draftsByOpponent.set(opponent.userId, drafts);
    });
  });

  return Array.from(draftsByOpponent.values()).some(
    (drafts) => drafts.size >= TRUE_LOVE_SHARED_RACES,
  );
}

function outplacedShartwagonInRace(
  ctx: AchievementContext,
  matchHistory: MatchHistoryTeam[],
): boolean {
  const targetIdentityIds = getSelectedPlayerIdentityIds(
    {
      user_id: EASY_AS_PIE_USER_ID,
      user_name: 'Shartwagon',
      is_guest: false,
      rps_wins: 0,
      rps_losses: 0,
    },
    ctx.allPlayers,
  );
  if (targetIdentityIds.size === 0) return false;

  const teamsByDraftId = new Map<string, StatsPageTeamRow[]>();
  ctx.allTeams.forEach((team) => {
    const teams = teamsByDraftId.get(team.draft_id) ?? [];
    teams.push(team);
    teamsByDraftId.set(team.draft_id, teams);
  });

  return matchHistory.some((team) => {
    const placement = team.placement;
    if (placement === null) return false;

    return (teamsByDraftId.get(team.draft_id) ?? []).some((opponent) => {
      const opponentId = opponent.user_id ?? opponent.guest_id;
      return (
        opponent.placement !== null &&
        placement < opponent.placement &&
        Boolean(opponentId) &&
        targetIdentityIds.has(opponentId!) &&
        !ctx.identityIds.has(opponentId!)
      );
    });
  });
}

/** Derive every earned achievement for a player from data already on the stats page. */
export function computePlayerAchievements(ctx: AchievementContext): PlayerAchievement[] {
  const nonCasualMatchHistory = ctx.matchHistory.filter((team) =>
    isNonCasualRace(team, ctx.validDraftIds, ctx.casual1v1DraftIds),
  );
  const personalBestSeconds = computePersonalBestSeconds(
    ctx.matchHistory,
    ctx.bossBattleHistory,
    ctx.validDraftIds,
    ctx.casual1v1DraftIds,
  );
  // The X+ clubs count every recorded race, including casual drafts and casual 1v1s.
  const clubRacesPlayed = ctx.matchHistory.length;
  const hallOfFameCount = nonCasualMatchHistory.filter((team) =>
    didBeatGame(team, ctx.bossBattleHistory),
  ).length;

  const hallOfFameEntries = ctx.hallOfFame.filter(
    (entry) =>
      entry.user_id &&
      ctx.identityIds.has(entry.user_id) &&
      isNonCasualRace(entry, ctx.validDraftIds, ctx.casual1v1DraftIds),
  );

  const hallOfFameDays = new Map<string, number>();
  hallOfFameEntries.forEach((entry) => {
    const day = entry.beat_date?.slice(0, 10);
    if (!day) return;
    hallOfFameDays.set(day, (hallOfFameDays.get(day) ?? 0) + 1);
  });
  const beatGameTwiceInOneDay = Array.from(hallOfFameDays.values()).some((count) => count >= 2);

  const winningTeams = nonCasualMatchHistory.filter((team) =>
    didBeatGame(team, ctx.bossBattleHistory),
  );
  // Collection achievements count every completed run, including casual drafts and 1v1s.
  const allWinningTeams = ctx.matchHistory.filter((team) =>
    didBeatGame(team, ctx.bossBattleHistory),
  );
  const pokemonById = new Map(ctx.pokemon.map((mon) => [mon.id, mon]));
  const pokemonLookup = pokemonByName(ctx.pokemon);

  const earned: Record<string, boolean> = {
    'early-bird': nonCasualMatchHistory.some((team) => {
      const date = draftYearMonth(team.created_at);
      return date?.year === 2026 && (date.month === 3 || date.month === 4);
    }),
    // Unlike the Blitz X achievements, this counts any completed run.
    winner: ctx.matchHistory.some((team) => didBeatGame(team, ctx.bossBattleHistory)),
    'grand-prix-racer': Array.from(ctx.identityIds).some((id) => ctx.leaderboardIds.has(id)),
    '250-club': clubRacesPlayed >= 250,
    '100-club': clubRacesPlayed >= 100,
    '25-club': clubRacesPlayed >= 25,
    '10-club': clubRacesPlayed >= 10,
    'true-love': hasTenRacesWithSamePlayer(ctx),
    'blitz-legend': hallOfFameCount >= 100,
    'blitz-champion': hallOfFameCount >= 50,
    'blitz-hero': hallOfFameCount >= 10,
    'back-to-back': beatGameTwiceInOneDay,
    'impressive-host': hasHostedAndWonOwnAuction(ctx, winningTeams),
    moneyballer: nonCasualMatchHistory.some(
      (team) =>
        team.draft_type !== '1v1' && (ctx.rmvByTeamId.get(team.team_id) ?? 0) > 25_000,
    ),
    'worth-every-penny': wonPokemonForAtLeastTwoThousandOverAverage(ctx),
    'stingy': winningTeams.some(
      (team) => team.draft_type !== '1v1' && neverSpentOverTwoThousandOnOnePokemon(team),
    ),
    impatient: spentTwentyThousandBeforeHalfway(ctx),
    'sub-100-club': personalBestSeconds !== null && personalBestSeconds < 100 * 60,
    'sub-90-club': personalBestSeconds !== null && personalBestSeconds < 90 * 60,
    'sub-80-club': personalBestSeconds !== null && personalBestSeconds < 80 * 60,
    'sub-70-club': personalBestSeconds !== null && personalBestSeconds < 70 * 60,
    'sub-hour-club': personalBestSeconds !== null && personalBestSeconds < 60 * 60,
    // Only a valid auction draft is required; the run does not need to be completed.
    'speed-freak': ctx.matchHistory.some(
      (team) =>
        team.draft_type !== '1v1' &&
        ctx.validDraftIds.has(team.draft_id) &&
        beatFirstGymUnderTwoThirty(ctx.bossBattleHistory.get(team.team_id) ?? []),
    ),
    'easy-as-pie': outplacedShartwagonInRace(ctx, nonCasualMatchHistory),
    'who-are-you': winningTeams.some(
      (team) => didBeatWally(team, ctx.bossBattleHistory) && hasThreeOfWallysMons(team),
    ),
    'the-chosen-one': winningTeams.some(
      (team) => team.draft_type === '1v1' && firstPickIsMudkip(team),
    ),
    'type-loyalist': winningTeams.some((team) => hasFourSameTypePicks(team, pokemonById)),
    'pokemon-professor': winningTeams.some(hasAllThreeStarterTypes),
    'old-head': winningTeams.some((team) => onlyUsedOriginal151(team, pokemonLookup)),
    'clutch-master': winningTeams.some(
      (team) => (team.run_stats ?? []).filter((mon) => mon.fainted).length >= 10,
    ),
    'untiltable': winningTeams.some(
      (team) => (team.run_stats ?? []).filter((mon) => mon.fainted && mon.level === 15).length >= 3,
    ),
    'deathless': winningTeams.some(
      (team) =>
        isDraftOnOrAfter(team.created_at, DEATHLESS_START_DATE) && hadNoFaints(team),
    ),
    'hard-carried': winningTeams.some((team) => {
      const koCounts = [
        ...(team.run_stats ?? []).map((mon) => mon.ko_count ?? 0),
        ...(team.hall_of_fame_team ?? []).map((mon) => mon.ko_count ?? 0),
      ];
      return koCounts.some((kos) => kos >= 20);
    }),
    'schoolin-on-em': winningTeams.some(didWishiwashiEarnOverTenKos),
    'old-faithful': wonTenRacesWithSameDraftPick(winningTeams),
    artisan: winningTeams.some((team) =>
      (team.hall_of_fame_team ?? []).some(
        (mon) => normalizeName(mon.name) === 'smeargle' || normalizeName(mon.icon) === 'smeargle',
      ),
    ),
    criminal: winningTeams.some((team) =>
      (team.hall_of_fame_team ?? []).some(
        (mon) => isRentalPokemonName(mon.name) || isRentalPokemonName(mon.icon),
      ),
    ),
    'good-as-new': hasAllHallOfFameKeys(allWinningTeams, GOOD_AS_NEW_KEYS),
    'rainbow-warrior': hasAllHallOfFameKeys(allWinningTeams, EEVEELUTION_ICONS),
    'appliance-master': hasAllHallOfFameKeys(allWinningTeams, ROTOM_APPLIANCE_FORM_KEYS),
    'doctors-worst-nightmare': hasAllHallOfFameKeys(allWinningTeams, APPLIN_EVOLUTION_KEYS),
    'natural-born-gambler': hasAllHallOfFameKeys(allWinningTeams, NATURAL_BORN_GAMBLER_KEYS),
    'big-year': winningTeams.some(
      (team) =>
        (team.hall_of_fame_team ?? []).filter((mon) => isFlyingType(mon, pokemonLookup)).length >= 3,
    ),
    'night-owl': winningTeams.some(hasTwoNightEvolutionMons),
    'elite-mind': winningTeams.some((team) =>
      defeatedAllFrontierBrainsConsecutively(ctx.bossBattleHistory.get(team.team_id) ?? []),
    ),
    'seen-it-all': (() => {
      const facedBossTrainers = new Set<number>();
      ctx.matchHistory.forEach((team) => {
        (ctx.bossBattleHistory.get(team.team_id) ?? []).forEach((battle) => {
          if (ALL_BOSS_TRAINER_IDS.has(battle.trainer_id)) {
            facedBossTrainers.add(battle.trainer_id);
          }
        });
      });
      return ALL_BOSS_TRAINER_IDS.size > 0 && facedBossTrainers.size >= ALL_BOSS_TRAINER_IDS.size;
    })(),
    'stream-legend': ctx.identityIds.has(STREAM_LEGEND_USER_ID),
    'close-combatant': winningTeams.some(hasMultipleCloseCombatMons),
    'rps-champion': (ctx.player.rps_wins ?? 0) >= RPS_CHAMPION_REQUIRED_WINS,
    // This achievement can only be granted manually.
    'infinite-wisdom': false,
  };

  return ACHIEVEMENT_DEFINITIONS.map((definition) => ({
    ...definition,
    earned: ctx.manualOverrides.has(definition.id)
      ? Boolean(ctx.manualOverrides.get(definition.id))
      : Boolean(earned[definition.id]),
    manuallySet: ctx.manualOverrides.has(definition.id),
  }));
}
