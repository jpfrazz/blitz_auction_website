import type {
  AdminHallOfFameEligibleEntry,
  HallOfFamePokemon,
  MatchHistoryTeam,
  Pokemon,
  RentalStat,
  RunMonStat,
  StatsAuction,
  StatsPagePlayer,
  StatsPageTeamRow,
  WinningRace,
} from '../../types';
import type { BossBattleHistoryEntry } from '../../shared/api/stats';
import {
  ACHIEVEMENT_DEFINITIONS,
  AchievementContext,
  BOSS_TRAINER_GROUPS,
  computePlayerAchievements,
  getSeenItAllProgress,
} from './achievements';

const player: StatsPagePlayer = {
  user_id: 'player-1',
  user_name: 'Player One',
  is_guest: false,
  rps_wins: 0,
  rps_losses: 0,
};

function team(
  overrides: Partial<MatchHistoryTeam> & Pick<MatchHistoryTeam, 'team_id' | 'draft_id'>,
): MatchHistoryTeam {
  const { team_id, draft_id, ...rest } = overrides;
  return {
    user_id: 'player-1',
    guest_id: null,
    ranked: false,
    draft_type: 'auction',
    team_count: 8,
    money_remaining: 0,
    pokemon_drafted: [],
    placement: null,
    pre_match_mmr: null,
    hall_of_fame_team: null,
    run_stats: null,
    updated_at: '2026-04-15T00:00:00Z',
    created_at: '2026-04-15T00:00:00Z',
    team_id,
    draft_id,
    ...rest,
  };
}

function statsTeam(
  team_id: number,
  draft_id: string,
  placement: number | null,
  playerId: string | null,
  guestId: string | null = null,
): StatsPageTeamRow {
  return {
    team_id,
    user_id: playerId,
    guest_id: guestId,
    draft_id,
    money_remaining: 0,
    pokemon_drafted: 0,
    placement,
    pre_match_mmr: null,
    updated_at: '2026-04-15T00:00:00Z',
    created_at: '2026-04-15T00:00:00Z',
    has_boss_battles: false,
  };
}

const SHARTWAGON_ID = '306547404595920896';

function pick(winning_bid: number | null, overrides: Partial<StatsAuction> = {}): StatsAuction {
  return {
    auction_id: 1,
    pokedex_id: 25,
    name: 'Pikachu',
    form: '',
    draft_id: 'stingy-race',
    draft_order: 1,
    state: 'COMPLETED',
    paused_time_remaining: null,
    winning_bid,
    winning_user_id: 'player-1',
    winning_guest_id: null,
    updated_at: '2026-04-15T00:00:00Z',
    created_at: '2026-04-15T00:00:00Z',
    draft_type: 'auction',
    season: 1,
    action: null,
    ...overrides,
  };
}

function hofMon(name: string): HallOfFamePokemon {
  return { name, icon: name.toLowerCase(), ko_count: null };
}

function rental(species_id: number, personality: number): RentalStat {
  return {
    species_id,
    personality,
    nickname: null,
    ko_count: null,
    total_turns: null,
    level: 15,
    fainted: false,
    badge_count: 1,
  };
}

function championWin(totalSeconds: number): BossBattleHistoryEntry {
  return {
    trainer_id: 804,
    version: null,
    hours: Math.floor(totalSeconds / 3600),
    minutes: Math.floor((totalSeconds % 3600) / 60),
    seconds: totalSeconds % 60,
    is_loss: false,
  };
}

function brainWin(trainerId: number, totalSeconds: number): BossBattleHistoryEntry {
  return {
    trainer_id: trainerId,
    version: null,
    hours: 0,
    minutes: Math.floor(totalSeconds / 60),
    seconds: totalSeconds % 60,
    is_loss: false,
  };
}

function gymWin(totalSeconds: number): BossBattleHistoryEntry {
  return {
    trainer_id: 265,
    version: 1,
    hours: Math.floor(totalSeconds / 3600),
    minutes: Math.floor((totalSeconds % 3600) / 60),
    seconds: totalSeconds % 60,
    is_loss: false,
  };
}

function gymSplitWin(
  baseTrainerId: number,
  version: number,
  seconds: number,
  isLoss = false,
): BossBattleHistoryEntry {
  return {
    trainer_id: baseTrainerId,
    version,
    hours: 0,
    minutes: Math.floor(seconds / 60),
    seconds: seconds % 60,
    is_loss: isLoss,
  };
}

function wallyWin(): BossBattleHistoryEntry {
  return brainWin(656, 0);
}

function baseContext(overrides: Partial<AchievementContext> = {}): AchievementContext {
  return {
    player,
    identityIds: new Set(['player-1']),
    matchHistory: [],
    winningRaces: [],
    bossBattleHistory: new Map(),
    hallOfFame: [],
    leaderboardIds: new Set(),
    allTeams: [],
    auctions: [],
    allPlayers: [],
    pokemon: [],
    validDraftIds: new Set(),
    casual1v1DraftIds: new Set(),
    rmvByTeamId: new Map(),
    manualOverrides: new Map(),
    ...overrides,
  };
}

function earnedIds(context: AchievementContext): Set<string> {
  return new Set(
    computePlayerAchievements(context)
      .filter((achievement) => achievement.earned)
      .map((achievement) => achievement.id),
  );
}

describe('achievement definitions', () => {
  it('has one definition per achievement with a unique id and icon', () => {
    expect(ACHIEVEMENT_DEFINITIONS).toHaveLength(57);
    expect(new Set(ACHIEVEMENT_DEFINITIONS.map((achievement) => achievement.id)).size).toBe(57);
    expect(new Set(ACHIEVEMENT_DEFINITIONS.map((achievement) => achievement.icon)).size).toBe(57);
    expect(ACHIEVEMENT_DEFINITIONS.find((achievement) => achievement.id === 'around-the-world')).toEqual({
      id: 'around-the-world',
      name: 'Around the World',
      description: 'Win with every Pokémon in the pool',
      icon: 'AroundTheWorld.png',
    });
    expect(ACHIEVEMENT_DEFINITIONS.find((achievement) => achievement.id === 'traitor')).toEqual({
      id: 'traitor',
      name: 'Traitor',
      description: 'Ban your most drafted Pokémon in a 1v1, then beat the game',
      icon: 'Traitor.png',
    });
    expect(ACHIEVEMENT_DEFINITIONS.find((achievement) => achievement.id === 'true-nuzlocker')).toEqual({
      id: 'true-nuzlocker',
      name: 'True Nuzlocker',
      description: 'Play a race in which all of your Pokémon are nicknamed',
      icon: 'TrueNuzlocker.png',
    });
    expect(ACHIEVEMENT_DEFINITIONS.find((achievement) => achievement.id === 'against-all-odds')).toEqual({
      id: 'against-all-odds',
      name: 'Against All Odds',
      description: 'Enter the Hall of Fame with a Pokémon whose IVs are all single digit',
      icon: 'AgainstAllOdds.png',
    });
    expect(ACHIEVEMENT_DEFINITIONS.find((achievement) => achievement.id === 'topsy-turvy')).toEqual({
      id: 'topsy-turvy',
      name: 'Topsy Turvy',
      description: "In a 1v1, enter the Hall of Fame with your opponent's signature Pokémon",
      icon: 'TopsyTurvy.png',
    });
    expect(ACHIEVEMENT_DEFINITIONS.find((achievement) => achievement.id === 'vanilla-gamer')).toEqual({
      id: 'vanilla-gamer',
      name: 'Vanilla Gamer',
      description: "Earn Hoenn's 8 badges in their original order",
      icon: 'VanillaGamer.png',
    });
    expect(ACHIEVEMENT_DEFINITIONS.find((achievement) => achievement.id === 'loyal-customer')).toEqual({
      id: 'loyal-customer',
      name: 'Loyal Customer',
      description: 'Rent 3 Pokémon from the Slateport Black Market in a single run',
      icon: 'LoyalCustomer.png',
    });
  });

});

describe('computePlayerAchievements', () => {
  it('finds any race from March and April 2026, including casual races', () => {
    const race = (created_at: string, overrides: Partial<MatchHistoryTeam> = {}) =>
      team({ team_id: 1, draft_id: 'd1', created_at, ...overrides });
    const validDraftIds = new Set(['d1']);

    expect(earnedIds(baseContext({ matchHistory: [race('2026-03-02T12:00:00Z')], validDraftIds }))).toContain('early-bird');
    expect(earnedIds(baseContext({ matchHistory: [race('2026-04-30T12:00:00Z')], validDraftIds }))).toContain('early-bird');
    expect(earnedIds(baseContext({ matchHistory: [race('2026-05-01T12:00:00Z')], validDraftIds }))).not.toContain('early-bird');
    // A casual auction (no valid draft id) still counts.
    expect(earnedIds(baseContext({ matchHistory: [race('2026-03-02T12:00:00Z')] }))).toContain('early-bird');
    // So does a casual 1v1.
    expect(earnedIds(baseContext({
      matchHistory: [race('2026-04-15T12:00:00Z', { draft_id: 'casual-1v1', draft_type: '1v1' })],
      casual1v1DraftIds: new Set(['casual-1v1']),
    }))).toContain('early-bird');
  });

  it('awards True Nuzlocker when every saved Pokemon is nicknamed, including casual races', () => {
    const mon = (species_id: number, nickname: string | null): RunMonStat => ({
      species_id,
      personality: species_id,
      nickname,
      ko_count: null,
      total_turns: null,
      level: 50,
      fainted: false,
    });
    const race = (run_stats: RunMonStat[], overrides: Partial<MatchHistoryTeam> = {}) =>
      team({ team_id: 1, draft_id: 'nuzlocker-race', run_stats, ...overrides });
    const earnedFor = (races: MatchHistoryTeam[], casual1v1 = false) => earnedIds(baseContext({
      matchHistory: races,
      casual1v1DraftIds: casual1v1 ? new Set(races.map((entry) => entry.draft_id)) : new Set(),
    }));

    expect(earnedFor([race([mon(25, 'Sparky'), mon(133, 'Vee')])]).has('true-nuzlocker')).toBe(true);
    // The species name and a truncated form name are not real nicknames.
    expect(earnedFor([race([mon(25, 'Pikachu')])]).has('true-nuzlocker')).toBe(false);
    expect(earnedFor([race([mon(83, 'Farfetch')])]).has('true-nuzlocker')).toBe(false);
    expect(earnedFor([race([mon(25, 'Sparky'), mon(133, null)])]).has('true-nuzlocker')).toBe(false);
    expect(earnedFor([race([mon(99999, 'Sparky')])]).has('true-nuzlocker')).toBe(false);
    expect(earnedFor([race([])]).has('true-nuzlocker')).toBe(false);
    // Casual auctions and casual 1v1s both count.
    expect(earnedFor([race([mon(25, 'Sparky')], { draft_id: 'casual-auction' })])
      .has('true-nuzlocker')).toBe(true);
    expect(earnedFor([race([mon(25, 'Sparky')], { draft_id: 'casual-1v1', draft_type: '1v1' })], true)
      .has('true-nuzlocker')).toBe(true);
  });

  it('awards Against All Odds for a single-digit-IV Hall of Fame mon, including casual races', () => {
    const ivs = (hp: number, atk = 9, def = 9, spa = 9, spd = 9, spe = 9) =>
      ({ hp, atk, def, spa, spd, spe });
    const hofMonWithIvs = (values: ReturnType<typeof ivs> | null): HallOfFamePokemon => ({
      ...hofMon('Pikachu'),
      ivs: values,
    });
    const race = (hall_of_fame_team: HallOfFamePokemon[], overrides: Partial<MatchHistoryTeam> = {}) =>
      team({ team_id: 1, draft_id: 'odds-race', hall_of_fame_team, ...overrides });
    const earnedFor = (races: MatchHistoryTeam[], casual1v1 = false) => earnedIds(baseContext({
      matchHistory: races,
      casual1v1DraftIds: casual1v1 ? new Set(races.map((entry) => entry.draft_id)) : new Set(),
    }));

    expect(earnedFor([race([hofMonWithIvs(ivs(0))])]).has('against-all-odds')).toBe(true);
    // Any IV of 10 or higher disqualifies the mon.
    expect(earnedFor([race([hofMonWithIvs(ivs(9, 10))])]).has('against-all-odds')).toBe(false);
    expect(earnedFor([race([hofMonWithIvs(ivs(31))])]).has('against-all-odds')).toBe(false);
    expect(earnedFor([race([hofMonWithIvs(null)])]).has('against-all-odds')).toBe(false);
    // Only one Hall of Fame mon needs the all-single-digit spread.
    expect(earnedFor([race([hofMonWithIvs(null), hofMonWithIvs(ivs(7))])])
      .has('against-all-odds')).toBe(true);
    // Casual auctions and casual 1v1s both count.
    expect(earnedFor([race([hofMonWithIvs(ivs(5))], { draft_id: 'casual-auction' })])
      .has('against-all-odds')).toBe(true);
    expect(earnedFor([race([hofMonWithIvs(ivs(5))], { draft_id: 'casual-1v1', draft_type: '1v1' })], true)
      .has('against-all-odds')).toBe(true);
  });

  it('awards Blitz Winner for beating the game in a competitive or casual run', () => {
    const won = (draftId: string) => team({
      team_id: 1,
      draft_id: draftId,
      hall_of_fame_team: [hofMon('Pikachu')],
    });

    expect(earnedIds(baseContext({
      matchHistory: [won('competitive')],
      validDraftIds: new Set(['competitive']),
    })).has('winner')).toBe(true);

    expect(earnedIds(baseContext({
      matchHistory: [won('casual')],
      validDraftIds: new Set(),
    })).has('winner')).toBe(true);

    expect(earnedIds(baseContext({
      matchHistory: [
        team({
          team_id: 1,
          draft_id: 'casual-1v1',
          draft_type: '1v1',
        }),
      ],
      bossBattleHistory: new Map([[1, [championWin(90 * 60)]]]),
    })).has('winner')).toBe(true);

    expect(earnedIds(baseContext({
      matchHistory: [team({ team_id: 1, draft_id: 'unfinished' })],
      bossBattleHistory: new Map([[1, [{ ...championWin(90 * 60), is_loss: true }]]]),
    })).has('winner')).toBe(false);
  });

  it('awards Impressive Host only for winning a hosted competitive auction draft', () => {
    const hostedRace = (
      draftId: string,
      options: { draftType?: string; host?: string | null; won?: boolean } = {},
    ) => {
      const draftType = options.draftType ?? 'auction';
      const won = options.won ?? true;
      const host = options.host === undefined ? 'player-1' : options.host;
      return {
        matchHistory: [team({
          team_id: 1,
          draft_id: draftId,
          draft_type: draftType,
          hall_of_fame_team: won ? [hofMon('Pikachu')] : null,
        })],
        allTeams: [{
          ...statsTeam(1, draftId, null, 'player-1'),
          draft_type: draftType,
          host,
        }],
      };
    };
    const earnedFor = (
      race: ReturnType<typeof hostedRace>,
      options: { identityIds?: Set<string>; validDraftIds?: Set<string> } = {},
    ) => earnedIds(baseContext({
      matchHistory: race.matchHistory,
      allTeams: race.allTeams,
      identityIds: options.identityIds ?? new Set(['player-1']),
      validDraftIds: options.validDraftIds ?? new Set(['competitive']),
    }));

    expect(earnedFor(hostedRace('competitive')).has('impressive-host')).toBe(true);
    expect(earnedFor(hostedRace('competitive', { host: 'guest-1' }), {
      identityIds: new Set(['player-1', 'guest-1']),
    }).has('impressive-host')).toBe(true);

    expect(earnedFor(hostedRace('competitive', { host: 'someone-else' })).has('impressive-host')).toBe(false);
    expect(earnedFor(hostedRace('competitive', { won: false })).has('impressive-host')).toBe(false);
    expect(earnedFor(hostedRace('casual'), { validDraftIds: new Set() }).has('impressive-host')).toBe(false);
    expect(earnedFor(hostedRace('one-v-one', { draftType: '1v1' })).has('impressive-host')).toBe(false);
  });

  it('awards the race-count clubs at their thresholds and counts casual races', () => {
    const races = (count: number, draftType: 'auction' | '1v1' = 'auction') =>
      Array.from({ length: count }, (_, index) => team({
        team_id: index,
        draft_id: `d${index}`,
        draft_type: draftType,
      }));
    const earnedFor = (
      count: number,
      options: { valid?: boolean; casual1v1?: boolean } = {},
    ) => {
      const matchHistory = races(count, options.casual1v1 ? '1v1' : 'auction');
      const draftIds = matchHistory.map((race) => race.draft_id);
      return earnedIds(baseContext({
        matchHistory,
        validDraftIds: options.valid === false ? new Set() : new Set(draftIds),
        casual1v1DraftIds: options.casual1v1 ? new Set(draftIds) : new Set(),
      }));
    };

    expect(earnedFor(9).has('10-club')).toBe(false);
    expect(earnedFor(10).has('10-club')).toBe(true);
    expect(earnedFor(10).has('25-club')).toBe(false);

    expect(earnedFor(24).has('25-club')).toBe(false);
    expect(earnedFor(25).has('25-club')).toBe(true);
    expect(earnedFor(25).has('100-club')).toBe(false);

    expect(earnedFor(99).has('100-club')).toBe(false);
    expect(earnedFor(100).has('100-club')).toBe(true);
    expect(earnedFor(100).has('250-club')).toBe(false);

    expect(earnedFor(249).has('250-club')).toBe(false);
    expect(earnedFor(250).has('250-club')).toBe(true);

    // All four clubs count casual auction drafts.
    expect(earnedFor(10, { valid: false }).has('10-club')).toBe(true);
    expect(earnedFor(25, { valid: false }).has('25-club')).toBe(true);
    expect(earnedFor(100, { valid: false }).has('100-club')).toBe(true);
    expect(earnedFor(250, { valid: false }).has('250-club')).toBe(true);

    // All four clubs count casual 1v1 drafts.
    expect(earnedFor(10, { casual1v1: true }).has('10-club')).toBe(true);
    expect(earnedFor(25, { casual1v1: true }).has('25-club')).toBe(true);
    expect(earnedFor(100, { casual1v1: true }).has('100-club')).toBe(true);
    expect(earnedFor(250, { casual1v1: true }).has('250-club')).toBe(true);
  });

  it('uses Hall of Fame wins from non-casual races for the beat-the-game achievements', () => {
    const wins = Array.from({ length: 10 }, (_, index) =>
      team({ team_id: index, draft_id: `d${index}`, hall_of_fame_team: [hofMon('Pikachu')] }),
    );
    const validDraftIds = new Set(wins.map((win) => win.draft_id));
    const earned = earnedIds(baseContext({ matchHistory: wins, validDraftIds }));
    expect(earned.has('blitz-hero')).toBe(true);
    expect(earned.has('blitz-champion')).toBe(false);
    expect(earned.has('blitz-legend')).toBe(false);

    const casualWins = wins.map((win) => ({ ...win, draft_id: `casual-${win.draft_id}` }));
    expect(earnedIds(baseContext({ matchHistory: casualWins })).has('blitz-hero')).toBe(false);
  });

  it('awards Criminal for a rental Pokemon on the Hall of Fame team', () => {
    const rentalWinner = team({
      team_id: 1,
      draft_id: 'rental-win',
      hall_of_fame_team: [hofMon('Heracross')],
    });
    expect(earnedIds(baseContext({
      matchHistory: [rentalWinner],
      validDraftIds: new Set(['rental-win']),
    })).has('criminal')).toBe(true);

    const nonRentalWinner = team({
      team_id: 2,
      draft_id: 'normal-win',
      hall_of_fame_team: [hofMon('Pikachu')],
    });
    expect(earnedIds(baseContext({
      matchHistory: [nonRentalWinner],
      validDraftIds: new Set(['normal-win']),
    })).has('criminal')).toBe(false);

    expect(earnedIds(baseContext({
      matchHistory: [{ ...rentalWinner, draft_id: 'casual' }],
    })).has('criminal')).toBe(false);
  });

  it('awards Close Combatant for multiple Close Combat Pokemon on the Hall of Fame team', () => {
    const earnedFor = (names: string[], valid = true) => {
      const winner = team({
        team_id: 1,
        draft_id: 'close-win',
        hall_of_fame_team: names.map(hofMon),
      });
      return earnedIds(baseContext({
        matchHistory: [winner],
        validDraftIds: valid ? new Set(['close-win']) : new Set(),
      }));
    };

    expect(earnedFor(['Blaziken', 'Hawlucha', 'Pikachu']).has('close-combatant')).toBe(true);
    expect(earnedFor(['Blaziken', 'Pikachu']).has('close-combatant')).toBe(false);
    expect(earnedFor(['Primeape', 'Annihilape']).has('close-combatant')).toBe(false);
    expect(earnedFor(['Blaziken', 'Hawlucha'], false).has('close-combatant')).toBe(false);
  });

  it('awards Elite Mind for four consecutive Brain wins in a winning run', () => {
    const winner = team({ team_id: 1, draft_id: 'brain-win' });
    const brains = [
      brainWin(806, 60),
      brainWin(807, 120),
      brainWin(810, 180),
      brainWin(811, 240),
    ];
    const earnedFor = (battles: BossBattleHistoryEntry[], valid = true) =>
      earnedIds(baseContext({
        matchHistory: [winner],
        validDraftIds: valid ? new Set(['brain-win']) : new Set(),
        bossBattleHistory: new Map([[1, battles]]),
      }));

    const champion = championWin(90 * 60);
    expect(earnedFor([...brains, champion]).has('elite-mind')).toBe(true);
    expect(earnedFor([...brains.slice(0, 3), champion]).has('elite-mind')).toBe(false);
    expect(earnedFor([
      brainWin(806, 60),
      brainWin(807, 120),
      { ...brainWin(810, 180), is_loss: true },
      brainWin(811, 240),
      champion,
    ]).has('elite-mind')).toBe(false);
    expect(earnedFor([...brains, champion], false).has('elite-mind')).toBe(false);
  });

  it('awards Seen It All for facing every boss trainer across any runs', () => {
    const bossTrainerIds = [
      // Gym leaders 1-8
      265, 770, 771, 772, 773, 812, 813, 814,
      855, 856, 857, 858, 859, 860, 861, 862,
      266, 774, 775, 776, 777, 815, 816, 817,
      267, 778, 779, 780, 781, 818, 819, 820,
      268, 782, 783, 784, 785, 821, 822, 823,
      269, 786, 787, 788, 789, 824, 825, 826,
      270, 790, 791, 792, 793, 827, 828, 829,
      271, 794, 795, 796, 797, 830, 831, 832,
      272, 798, 799, 800, 801, 833, 834, 835,
      // Maxie / Archie, Elite Four, Frontier Brains, champions
      34, 601, 261, 807, 262, 810, 263, 806, 264, 811, 804, 656,
    ];
    const battle = (trainer_id: number): BossBattleHistoryEntry => ({
      trainer_id,
      version: null,
      hours: 1,
      minutes: 0,
      seconds: 0,
      is_loss: false,
    });

    // Split across competitive and casual runs, with losses counting as faced.
    const contextWith = (trainerIds: number[], options: { losses?: boolean } = {}) => {
      const matchHistory = trainerIds.map((_, index) =>
        team({ team_id: index + 1, draft_id: `draft-${index + 1}` }),
      );
      const bossBattleHistory = new Map<number, BossBattleHistoryEntry[]>(
        trainerIds.map((trainerId, index) => [
          index + 1,
          [{ ...battle(trainerId), is_loss: Boolean(options.losses) }],
        ]),
      );
      return baseContext({ matchHistory, bossBattleHistory });
    };

    expect(earnedIds(contextWith(bossTrainerIds)).has('seen-it-all')).toBe(true);
    expect(earnedIds(contextWith(bossTrainerIds, { losses: true })).has('seen-it-all')).toBe(true);
    expect(earnedIds(contextWith(bossTrainerIds.slice(0, -1))).has('seen-it-all')).toBe(false);
    expect(earnedIds(contextWith([...bossTrainerIds.slice(0, -1), 9999])).has('seen-it-all')).toBe(false);
  });

  it('credits versioned gym leader battles as the matching split trainer', () => {
    const battle = (trainer_id: number, version: number | null): BossBattleHistoryEntry => ({
      trainer_id,
      version,
      hours: 0,
      minutes: 1,
      seconds: 0,
      is_loss: false,
    });

    // Boss battle rows store the base gym leader id plus the fight's run-wide
    // version index, which the profile displays as e.g. "Norman 7".
    const runs = [
      [
        battle(266, 1), battle(855, 2), battle(272, 3), battle(267, 4),
        battle(268, 5), battle(270, 6), battle(269, 7), battle(271, 8),
      ],
      [battle(269, 1), battle(270, 3)],
    ];
    const matchHistory = runs.map((_, index) =>
      team({ team_id: index + 1, draft_id: `versioned-${index + 1}` }),
    );
    const bossBattleHistory = new Map<number, BossBattleHistoryEntry[]>(
      runs.map((battles, index) => [index + 1, battles]),
    );
    const progress = getSeenItAllProgress(matchHistory, bossBattleHistory);

    expect(progress.seenIds).toEqual(new Set([
      266, 856, 799, 780, 785, 827, 825, 832,
      269, 791,
    ]));
    expect(progress.seenDetails.get(825)).toMatchObject({
      teamId: 1,
      draftId: 'versioned-1',
      version: 7,
      storedTrainerId: 269,
    });
    expect(progress.seenDetails.get(827)).toMatchObject({ version: 6, storedTrainerId: 270 });
  });

  it('awards Seen It All when versioned gym fights cover every split', () => {
    const battles: BossBattleHistoryEntry[] = [];
    BOSS_TRAINER_GROUPS.forEach((group) => {
      if (group.baseTrainerId === undefined) {
        group.ids.forEach((id) => battles.push({
          trainer_id: id,
          version: null,
          hours: 0,
          minutes: 1,
          seconds: 0,
          is_loss: false,
        }));
        return;
      }
      for (let version = 1; version <= group.ids.length; version += 1) {
        battles.push({
          trainer_id: group.baseTrainerId,
          version,
          hours: 0,
          minutes: 1,
          seconds: 0,
          is_loss: false,
        });
      }
    });

    expect(earnedIds(baseContext({
      matchHistory: [team({ team_id: 1, draft_id: 'all-splits' })],
      bossBattleHistory: new Map([[1, battles]]),
    })).has('seen-it-all')).toBe(true);
  });

  it('reports Seen It All progress from the same grouped trainer ids', () => {
    const allIds = BOSS_TRAINER_GROUPS.reduce<number[]>((ids, group) => ids.concat(group.ids), []);
    expect(allIds).toHaveLength(84);
    expect(new Set(allIds).size).toBe(84);

    const battle = (trainerId: number, isLoss: boolean): BossBattleHistoryEntry => ({
      trainer_id: trainerId,
      version: null,
      hours: 0,
      minutes: 1,
      seconds: 0,
      is_loss: isLoss,
    });
    const progress = getSeenItAllProgress(
      [team({ team_id: 1, draft_id: 'draft-1' }), team({ team_id: 2, draft_id: 'draft-2' })],
      new Map([
        [1, [battle(265, false), battle(9999, false)]],
        [2, [battle(804, true)]],
      ]),
    );

    expect(progress.total).toBe(84);
    expect(progress.seenIds).toEqual(new Set([265, 804]));
    expect(progress.missingIds).toHaveLength(82);
    expect(progress.missingIds).not.toContain(265);
    expect(progress.seenDetails.get(265)).toMatchObject({ teamId: 1, draftId: 'draft-1', isLoss: false });
    expect(progress.seenDetails.get(804)).toMatchObject({ teamId: 2, draftId: 'draft-2', isLoss: true });
    expect(progress.seenDetails.has(9999)).toBe(false);
  });

  it('awards Speed Freak for a sub-2:30 first split in a non-casual race without requiring a win', () => {
    // No Hall of Fame team and no champion win: the run was never completed.
    const race = team({ team_id: 1, draft_id: 'fast-draft' });
    const earnedFor = (
      battles: BossBattleHistoryEntry[],
      options: { valid?: boolean; draftType?: string; casual1v1?: boolean } = {},
    ) => {
      const { valid = true, draftType = 'auction', casual1v1 = false } = options;
      return earnedIds(baseContext({
        matchHistory: [{ ...race, draft_type: draftType }],
        validDraftIds: valid ? new Set(['fast-draft']) : new Set(),
        casual1v1DraftIds: casual1v1 ? new Set(['fast-draft']) : new Set(),
        bossBattleHistory: new Map([[1, battles]]),
      }));
    };

    expect(earnedFor([gymWin(2 * 60 + 29)]).has('speed-freak')).toBe(true);
    expect(earnedFor([gymWin(2 * 60 + 30)]).has('speed-freak')).toBe(false);
    expect(earnedFor([gymWin(2 * 60 + 29)], { valid: false }).has('speed-freak')).toBe(false);
    // Non-casual 1v1s count, but casual 1v1s do not.
    expect(earnedFor([gymWin(2 * 60 + 29)], { draftType: '1v1' }).has('speed-freak')).toBe(true);
    expect(earnedFor([gymWin(2 * 60 + 29)], { draftType: '1v1', casual1v1: true }).has('speed-freak')).toBe(false);
    expect(earnedFor([{ ...gymWin(2 * 60 + 29), is_loss: true }]).has('speed-freak')).toBe(false);
    expect(earnedFor([]).has('speed-freak')).toBe(false);
    // A fast later split does not count; only the first split matters.
    expect(earnedFor([gymWin(3 * 60), gymWin(60)]).has('speed-freak')).toBe(false);
  });

  it('awards Easy As Pie! only when outplacing Shartwagon in the same non-casual race', () => {
    const shartwagon: StatsPagePlayer = {
      user_id: SHARTWAGON_ID,
      user_name: 'shartwagon',
      is_guest: false,
      rps_wins: 0,
      rps_losses: 0,
    };
    const race = (placement: number | null, draftId = 'shared-race', draftType = 'auction') =>
      team({ team_id: 1, draft_id: draftId, placement, draft_type: draftType });
    const opponent = (draftId: string, placement: number | null) =>
      statsTeam(2, draftId, placement, SHARTWAGON_ID);
    const earnedFor = (
      raceTeam: MatchHistoryTeam,
      opponentTeams: StatsPageTeamRow[],
      overrides: Partial<AchievementContext> = {},
    ) => earnedIds(baseContext({
      matchHistory: [raceTeam],
      validDraftIds: new Set(['shared-race']),
      allPlayers: [shartwagon],
      allTeams: opponentTeams,
      ...overrides,
    }));

    expect(earnedFor(race(2), [opponent('shared-race', 5)]).has('easy-as-pie')).toBe(true);
    expect(earnedFor(race(5), [opponent('shared-race', 2)]).has('easy-as-pie')).toBe(false);
    expect(earnedFor(race(2), [opponent('shared-race', 2)]).has('easy-as-pie')).toBe(false);
    expect(earnedFor(race(2), [opponent('shared-race', null)]).has('easy-as-pie')).toBe(false);
    expect(earnedFor(race(2), [opponent('other-race', 5)]).has('easy-as-pie')).toBe(false);
    expect(earnedFor(race(null), [opponent('shared-race', 5)]).has('easy-as-pie')).toBe(false);

    expect(earnedFor(
      race(2),
      [opponent('shared-race', 5)],
      { validDraftIds: new Set() },
    ).has('easy-as-pie')).toBe(false);
    expect(earnedFor(
      race(2, 'shared-race', '1v1'),
      [opponent('shared-race', 5)],
      { casual1v1DraftIds: new Set(['shared-race']) },
    ).has('easy-as-pie')).toBe(false);

    // A profile cannot defeat itself, even when it is Shartwagon's profile.
    expect(earnedFor(
      race(2),
      [opponent('shared-race', 5)],
      { identityIds: new Set(['player-1', SHARTWAGON_ID]) },
    ).has('easy-as-pie')).toBe(false);

    // Linked guest accounts belonging to Shartwagon also count.
    const guest: StatsPagePlayer = {
      user_id: 'shart-guest',
      user_name: 'shartwagon (guest)',
      is_guest: true,
      linked_user_id: SHARTWAGON_ID,
      rps_wins: 0,
      rps_losses: 0,
    };
    expect(earnedFor(
      race(2),
      [statsTeam(2, 'shared-race', 5, null, 'shart-guest')],
      { allPlayers: [shartwagon, guest] },
    ).has('easy-as-pie')).toBe(true);
  });

  it('awards True Love for 10 distinct casual-or-competitive races with one player', () => {
    const partner: StatsPagePlayer = {
      user_id: 'partner-1',
      user_name: 'Partner',
      is_guest: false,
      rps_wins: 0,
      rps_losses: 0,
    };
    const stranger: StatsPagePlayer = {
      user_id: 'stranger-1',
      user_name: 'Stranger',
      is_guest: false,
      rps_wins: 0,
      rps_losses: 0,
    };
    const ownRace = (index: number): MatchHistoryTeam => team({
      team_id: index + 1,
      draft_id: `race-${index}`,
      // Half invalid auctions and half casual 1v1s: both must still count.
      draft_type: index % 2 === 0 ? 'auction' : '1v1',
    });
    const partnerTeam = (index: number) =>
      statsTeam(100 + index, `race-${index}`, null, partner.user_id);
    const earnedFor = (
      races: MatchHistoryTeam[],
      partnerTeams: StatsPageTeamRow[],
      otherTeams: StatsPageTeamRow[] = [],
      overrides: Partial<AchievementContext> = {},
    ) => earnedIds(baseContext({
      matchHistory: races,
      allTeams: [
        ...races.map((race) => statsTeam(race.team_id, race.draft_id, null, 'player-1')),
        ...partnerTeams,
        ...otherTeams,
      ],
      allPlayers: [partner, stranger],
      casual1v1DraftIds: new Set(
        races.filter((race) => race.draft_type === '1v1').map((race) => race.draft_id),
      ),
      ...overrides,
    }));

    const tenRaces = Array.from({ length: 10 }, (_, index) => ownRace(index));
    expect(earnedFor(tenRaces, tenRaces.map((_, index) => partnerTeam(index))).has('true-love'))
      .toBe(true);

    const nineRaces = tenRaces.slice(0, 9);
    expect(earnedFor(nineRaces, nineRaces.map((_, index) => partnerTeam(index))).has('true-love'))
      .toBe(false);

    // Five races with one person and five with another is not ten with one specific player.
    expect(earnedFor(
      tenRaces,
      tenRaces.slice(0, 5).map((_, index) => partnerTeam(index)),
      tenRaces.slice(5).map((_, index) =>
        statsTeam(200 + index, `race-${index + 5}`, null, stranger.user_id)),
    ).has('true-love')).toBe(false);

    // Two rows in the same lobby count once.
    expect(earnedFor(
      tenRaces,
      [
        partnerTeam(0),
        { ...partnerTeam(0), team_id: 999 },
        ...tenRaces.slice(1, 9).map((_, index) => partnerTeam(index + 1)),
      ],
    ).has('true-love')).toBe(false);

    // Linked guest accounts roll up to the same profile.
    const guest: StatsPagePlayer = {
      user_id: 'partner-guest',
      user_name: 'Partner (guest)',
      is_guest: true,
      linked_user_id: partner.user_id,
      rps_wins: 0,
      rps_losses: 0,
    };
    expect(earnedFor(
      tenRaces,
      tenRaces.map((_, index) =>
        statsTeam(300 + index, `race-${index}`, null, null, guest.user_id)),
      [],
      { allPlayers: [partner, stranger, guest] },
    ).has('true-love')).toBe(true);
  });

  it('detects two Hall of Fame wins on the same day', () => {
    const hallOfFame: AdminHallOfFameEligibleEntry[] = [
      { team_id: 1, draft_id: 'd1', draft_name: '', draft_type: 'auction', user_id: 'player-1', user_name: 'Player One', trainer_id: 804, beat_name: 'Steven', hours: 1, minutes: 0, seconds: 0, beat_date: '2026-04-01T12:00:00Z', hall_of_fame_team: [] },
      { team_id: 2, draft_id: 'd2', draft_name: '', draft_type: 'auction', user_id: 'guest-1', user_name: 'Guest', trainer_id: 804, beat_name: 'Steven', hours: 1, minutes: 0, seconds: 0, beat_date: '2026-04-01T18:00:00Z', hall_of_fame_team: [] },
    ];
    const validDraftIds = new Set(['d1', 'd2']);
    expect(earnedIds(baseContext({ hallOfFame, identityIds: new Set(['player-1', 'guest-1']), validDraftIds })).has('back-to-back')).toBe(true);
    expect(earnedIds(baseContext({ hallOfFame })).has('back-to-back')).toBe(false);
    expect(earnedIds(baseContext({
      hallOfFame,
      identityIds: new Set(['player-1', 'guest-1']),
      validDraftIds: new Set(['d1']),
    })).has('back-to-back')).toBe(false);
  });

  it('only counts competitive auctions for Moneyballer', () => {
    const auctionTeam = team({ team_id: 1, draft_id: 'competitive' });
    const context = baseContext({
      matchHistory: [auctionTeam],
      validDraftIds: new Set(['competitive']),
      rmvByTeamId: new Map([[1, 25_001]]),
    });
    expect(earnedIds(context).has('moneyballer')).toBe(true);

    context.rmvByTeamId = new Map([[1, 25_000]]);
    expect(earnedIds(context).has('moneyballer')).toBe(false);

    const oneVOne = team({ team_id: 2, draft_id: 'competitive', draft_type: '1v1' });
    expect(earnedIds(baseContext({
      matchHistory: [oneVOne],
      validDraftIds: new Set(['competitive']),
      rmvByTeamId: new Map([[2, 30_000]]),
    })).has('moneyballer')).toBe(false);
  });

  it('awards Worth Every Penny for competitive auction wins at least $2000 over average', () => {
    const draftId = 'competitive-auction';
    const sale = (overrides: Partial<StatsAuction> = {}) =>
      pick(3000, { draft_id: draftId, auction_id: 1, name: 'Pikachu', form: '', pokedex_id: 25, ...overrides });
    const earnedFor = (auctions: StatsAuction[], options: { valid?: boolean } = {}) =>
      earnedIds(baseContext({
        auctions,
        validDraftIds: options.valid === false ? new Set() : new Set([draftId]),
      }));

    // Avg 1000 across competitive sales, win 3000 => +2000.
    expect(earnedFor([
      sale({ auction_id: 1, winning_bid: 500, winning_user_id: 'other' }),
      sale({ auction_id: 2, winning_bid: 500, winning_user_id: 'other' }),
      sale({ auction_id: 3, winning_bid: 500, winning_user_id: 'other' }),
      sale({ auction_id: 4, winning_bid: 500, winning_user_id: 'other' }),
      sale({ auction_id: 5, winning_bid: 3000, winning_user_id: 'player-1' }),
    ]).has('worth-every-penny')).toBe(true);

    expect(earnedFor([
      sale({ auction_id: 1, winning_bid: 500, winning_user_id: 'other' }),
      sale({ auction_id: 2, winning_bid: 500, winning_user_id: 'other' }),
      sale({ auction_id: 3, winning_bid: 500, winning_user_id: 'other' }),
      sale({ auction_id: 4, winning_bid: 500, winning_user_id: 'other' }),
      sale({ auction_id: 5, winning_bid: 2999, winning_user_id: 'player-1' }),
    ]).has('worth-every-penny')).toBe(false);

    const qualifying = [
      sale({ auction_id: 1, winning_bid: 500, winning_user_id: 'other' }),
      sale({ auction_id: 2, winning_bid: 500, winning_user_id: 'other' }),
      sale({ auction_id: 3, winning_bid: 500, winning_user_id: 'other' }),
      sale({ auction_id: 4, winning_bid: 500, winning_user_id: 'other' }),
      sale({ auction_id: 5, winning_bid: 3000, winning_user_id: 'player-1' }),
    ];

    // Only count competitive drafts.
    expect(earnedFor(qualifying, { valid: false }).has('worth-every-penny')).toBe(false);

    expect(earnedFor(qualifying.map((auction) => ({ ...auction, draft_type: '1v1' as const })))
      .has('worth-every-penny')).toBe(false);

    expect(earnedFor([
      ...qualifying.slice(0, 4),
      { ...qualifying[4], action: 'BAN' as const },
    ]).has('worth-every-penny')).toBe(false);
  });

  it('keeps Worth Every Penny when later sales raise the average price', () => {
    const draftId = 'worth-early';
    const laterDraftId = 'worth-later';
    const sale = (overrides: Partial<StatsAuction> = {}) =>
      pick(500, {
        draft_id: draftId,
        auction_id: 1,
        name: 'Pikachu',
        form: '',
        pokedex_id: 25,
        ...overrides,
      });
    const earlySales: StatsAuction[] = [
      sale({ auction_id: 1, created_at: '2026-01-01T00:00:00Z', winning_bid: 500, winning_user_id: 'other' }),
      sale({ auction_id: 2, created_at: '2026-01-01T00:00:00Z', winning_bid: 500, winning_user_id: 'other' }),
      sale({ auction_id: 3, created_at: '2026-01-01T00:00:00Z', winning_bid: 500, winning_user_id: 'other' }),
      sale({ auction_id: 4, created_at: '2026-01-01T00:00:00Z', winning_bid: 500, winning_user_id: 'other' }),
      sale({ auction_id: 5, created_at: '2026-01-15T00:00:00Z', winning_bid: 3000, winning_user_id: 'player-1' }),
    ];
    const laterSales = Array.from({ length: 10 }, (_, index) =>
      sale({
        auction_id: 10 + index,
        draft_id: laterDraftId,
        created_at: '2026-03-01T00:00:00Z',
        winning_bid: 10_000,
        winning_user_id: 'other',
      }),
    );
    const earnedFor = (auctions: StatsAuction[]) => earnedIds(baseContext({
      auctions,
      validDraftIds: new Set([draftId, laterDraftId]),
    }));

    expect(earnedFor(earlySales).has('worth-every-penny')).toBe(true);
    expect(earnedFor([...earlySales, ...laterSales]).has('worth-every-penny')).toBe(true);
  });

  it('does not retroactively award Worth Every Penny when later sales lower the average price', () => {
    const draftId = 'worth-early';
    const laterDraftId = 'worth-later';
    const sale = (overrides: Partial<StatsAuction> = {}) =>
      pick(500, {
        draft_id: draftId,
        auction_id: 1,
        name: 'Pikachu',
        form: '',
        pokedex_id: 25,
        ...overrides,
      });
    const earlySales: StatsAuction[] = [
      sale({ auction_id: 1, created_at: '2026-01-01T00:00:00Z', winning_bid: 5000, winning_user_id: 'other' }),
      sale({ auction_id: 2, created_at: '2026-01-01T00:00:00Z', winning_bid: 5000, winning_user_id: 'other' }),
      sale({ auction_id: 3, created_at: '2026-01-01T00:00:00Z', winning_bid: 5000, winning_user_id: 'other' }),
      sale({ auction_id: 4, created_at: '2026-01-01T00:00:00Z', winning_bid: 5000, winning_user_id: 'other' }),
      sale({ auction_id: 5, created_at: '2026-01-15T00:00:00Z', winning_bid: 6000, winning_user_id: 'player-1' }),
    ];
    const laterSales = Array.from({ length: 20 }, (_, index) =>
      sale({
        auction_id: 10 + index,
        draft_id: laterDraftId,
        created_at: '2026-03-01T00:00:00Z',
        winning_bid: 100,
        winning_user_id: 'other',
      }),
    );
    const earnedFor = (auctions: StatsAuction[]) => earnedIds(baseContext({
      auctions,
      validDraftIds: new Set([draftId, laterDraftId]),
    }));

    expect(earnedFor(earlySales).has('worth-every-penny')).toBe(false);
    expect(earnedFor([...earlySales, ...laterSales]).has('worth-every-penny')).toBe(false);
  });

  it('awards Stingy for a win with no single Pokemon costing over $2000', () => {
    const winner = (picks: StatsAuction[], overrides: Partial<MatchHistoryTeam> = {}) =>
      team({
        team_id: 1,
        draft_id: 'stingy-race',
        hall_of_fame_team: [hofMon('Pikachu')],
        pokemon_drafted: picks,
        ...overrides,
      });
    const earnedFor = (race: MatchHistoryTeam, valid = true) => earnedIds(baseContext({
      matchHistory: [race],
      validDraftIds: valid ? new Set(['stingy-race']) : new Set(),
    }));

    expect(earnedFor(winner([pick(2000)])).has('stingy')).toBe(true);
    expect(earnedFor(winner([pick(100), pick(2000), pick(500)])).has('stingy')).toBe(true);
    expect(earnedFor(winner([pick(2001)])).has('stingy')).toBe(false);
    expect(earnedFor(winner([pick(100), pick(2500)])).has('stingy')).toBe(false);
    expect(earnedFor(winner([pick(null)])).has('stingy')).toBe(false);
    expect(earnedFor(winner([])).has('stingy')).toBe(false);
    // 1v1s are excluded even when every pick is cheap.
    expect(earnedFor(winner([pick(100)], { draft_type: '1v1' })).has('stingy')).toBe(false);
    // The run must be a win and the draft must be valid.
    expect(earnedFor(winner([pick(100)], { hall_of_fame_team: null })).has('stingy')).toBe(false);
    expect(earnedFor(winner([pick(100)]), false).has('stingy')).toBe(false);
  });

  it('awards Impatient only at exactly $20,000 before half the auction has sold', () => {
    const draftId = 'impatient-auction';
    const totalSales = 40;
    const bidsFor = (orders: number[], bid = 2000): Record<number, number> =>
      orders.reduce<Record<number, number>>((bids, order) => {
        bids[order] = bid;
        return bids;
      }, {});
    const makeSales = (
      playerBids: Record<number, number>,
      options: { draftType?: string; guestId?: string } = {},
    ): StatsAuction[] =>
      Array.from({ length: totalSales }, (_, index) => {
        const draft_order = index + 1;
        const bid = playerBids[draft_order];
        const isPlayerSale = bid !== undefined;
        return pick(bid ?? 100, {
          auction_id: draft_order,
          draft_id: draftId,
          draft_order,
          draft_type: options.draftType ?? 'auction',
          winning_user_id: isPlayerSale
            ? options.guestId
              ? null
              : 'player-1'
            : `other-${draft_order}`,
          winning_guest_id: isPlayerSale ? options.guestId ?? null : null,
        });
      });
    const earnedFor = (sales: StatsAuction[], valid = true) => earnedIds(baseContext({
      auctions: sales,
      validDraftIds: valid ? new Set([draftId]) : new Set(),
    }));

    const beforeHalf = makeSales(bidsFor([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]));
    expect(earnedFor(beforeHalf).has('impatient')).toBe(true);

    // Sale 20 is the halfway point in a 40-Pokemon auction, not before it.
    expect(earnedFor(makeSales(bidsFor([11, 12, 13, 14, 15, 16, 17, 18, 19, 20]))).has('impatient')).toBe(false);
    expect(earnedFor(makeSales(bidsFor([21, 22, 23, 24, 25, 26, 27, 28, 29, 30]))).has('impatient')).toBe(false);

    const overshoot = bidsFor([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    overshoot[10] = 3000;
    expect(earnedFor(makeSales(overshoot)).has('impatient')).toBe(false);

    // Casual/junk drafts and 1v1 drafts never qualify.
    expect(earnedFor(beforeHalf, false).has('impatient')).toBe(false);
    expect(earnedFor(makeSales(bidsFor([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), { draftType: '1v1' })).has('impatient')).toBe(false);

    // Linked guest purchases roll up to the selected profile.
    const guestSales = makeSales(bidsFor([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), { guestId: 'guest-1' });
    expect(earnedIds(baseContext({
      auctions: guestSales,
      identityIds: new Set(['player-1', 'guest-1']),
      validDraftIds: new Set([draftId]),
    })).has('impatient')).toBe(true);
  });

  it('awards Old Head only when drafts and evolutions stay in the original 151', () => {
    const pickFor = (pokedex_id: number, overrides: Partial<StatsAuction> = {}): StatsAuction =>
      pick(100, { pokedex_id, draft_id: 'old-head-race', ...overrides });
    const monStat = (species_id: number): RunMonStat => ({
      species_id,
      personality: 1,
      ko_count: null,
      total_turns: null,
      level: 50,
      fainted: false,
    });
    const win = (
      picks: StatsAuction[],
      run_stats: RunMonStat[],
      hallOfFameTeam: HallOfFamePokemon[] = [hofMon('Pikachu')],
      overrides: Partial<MatchHistoryTeam> = {},
    ) => team({
      team_id: 1,
      draft_id: 'old-head-race',
      pokemon_drafted: picks,
      run_stats,
      hall_of_fame_team: hallOfFameTeam,
      ...overrides,
    });
    const earnedFor = (race: MatchHistoryTeam, valid = true) => earnedIds(baseContext({
      matchHistory: [race],
      validDraftIds: valid ? new Set(['old-head-race']) : new Set(),
    }));

    const pikachu = pickFor(25, { name: 'Pikachu' });
    const eevee = pickFor(133, { name: 'Eevee' });

    expect(earnedFor(win(
      [pikachu, eevee],
      [monStat(25), monStat(134)],
      [hofMon('Vaporeon')],
    )).has('old-head')).toBe(true);
    // The gifted Eevee is allowed to stay unevolved.
    expect(earnedFor(win(
      [pikachu, eevee],
      [monStat(25), monStat(133)],
    )).has('old-head')).toBe(true);
    // Mega evolutions keep their original Kanto species.
    expect(earnedFor(win(
      [pickFor(3, { name: 'Venusaur', form: 'Mega' })],
      [monStat(906)],
      [hofMon('Venusaur-Mega')],
    )).has('old-head')).toBe(true);

    // Eevee may only become one of the three Kanto eeveelutions.
    [196, 197, 470, 471, 700].forEach((evolvedId) => {
      expect(earnedFor(win(
        [pikachu, eevee],
        [monStat(25), monStat(evolvedId)],
        [hofMon('Espeon')],
      )).has('old-head')).toBe(false);
    });
    expect(earnedFor(win([pickFor(258, { name: 'Mudkip' })], [monStat(258)])).has('old-head')).toBe(false);
    expect(earnedFor(win(
      [pickFor(103, { name: 'Exeggutor', form: 'Alola' })],
      [monStat(972)],
    )).has('old-head')).toBe(false);
    expect(earnedFor(win([pikachu], [monStat(25)], [hofMon('Tyranitar')])).has('old-head')).toBe(false);

    // 1v1 bans and leftovers are never used, even when they are non-Kanto.
    expect(earnedFor(win(
      [pickFor(25, { name: 'Pikachu', action: 'PICK' }), pickFor(258, { name: 'Mudkip', action: 'BAN' })],
      [monStat(25)],
      [hofMon('Pikachu')],
      { draft_type: '1v1' },
    )).has('old-head')).toBe(true);

    expect(earnedFor(win([], [monStat(25)])).has('old-head')).toBe(false);
    expect(earnedFor(win([pikachu], [monStat(25)]), false).has('old-head')).toBe(false);
    expect(earnedFor(win(
      [pikachu],
      [monStat(25)],
      [hofMon('Pikachu')],
      { hall_of_fame_team: null },
    )).has('old-head')).toBe(false);
  });

  it('awards Pokémon Professor for a win with grass, fire, and water starters', () => {
    const draftId = 'professor-race';
    const starterPick = (pokedex_id: number, overrides: Partial<StatsAuction> = {}) =>
      pick(100, { pokedex_id, draft_id: draftId, ...overrides });
    const earnedFor = (
      pokemon_drafted: StatsAuction[],
      overrides: Partial<MatchHistoryTeam> = {},
      options: { valid?: boolean; casual?: boolean } = {},
    ) => earnedIds(baseContext({
      matchHistory: [team({
        team_id: 1,
        draft_id: draftId,
        pokemon_drafted,
        hall_of_fame_team: [hofMon('Pikachu')],
        ...overrides,
      })],
      validDraftIds: options.valid === false ? new Set() : new Set([draftId]),
      casual1v1DraftIds: options.casual ? new Set([draftId]) : new Set(),
    }));

    const grass = starterPick(1, { name: 'Bulbasaur' });
    const fire = starterPick(4, { name: 'Charmander' });
    const water = starterPick(7, { name: 'Squirtle' });

    expect(earnedFor([grass, fire, water]).has('pokemon-professor')).toBe(true);
    expect(earnedFor([grass, fire]).has('pokemon-professor')).toBe(false);

    // Starter evolutions and later generations still count as their starter type.
    expect(earnedFor([
      starterPick(3, { name: 'Venusaur', form: 'Mega' }),
      starterPick(257, { name: 'Blaziken' }),
      starterPick(260, { name: 'Swampert' }),
    ]).has('pokemon-professor')).toBe(true);
    expect(earnedFor([
      starterPick(906, { name: 'Sprigatito' }),
      starterPick(909, { name: 'Fuecoco' }),
      starterPick(912, { name: 'Quaxly' }),
    ]).has('pokemon-professor')).toBe(true);

    // Matching types are not enough when the Pokemon are not starter families.
    expect(earnedFor([
      starterPick(43, { name: 'Oddish' }),
      starterPick(37, { name: 'Vulpix' }),
      starterPick(120, { name: 'Staryu' }),
    ]).has('pokemon-professor')).toBe(false);

    // Only 1v1 picks actually played with count.
    expect(earnedFor([
      starterPick(252, { name: 'Treecko', action: 'PICK' }),
      starterPick(255, { name: 'Torchic', action: 'PICK' }),
      starterPick(258, { name: 'Mudkip', action: 'PICK' }),
    ], { draft_type: '1v1' }).has('pokemon-professor')).toBe(true);
    expect(earnedFor([
      starterPick(252, { name: 'Treecko', action: 'PICK' }),
      starterPick(255, { name: 'Torchic', action: 'BAN' }),
      starterPick(258, { name: 'Mudkip', action: 'LEFTOVER' }),
    ], { draft_type: '1v1' }).has('pokemon-professor')).toBe(false);

    // It must be a non-casual win.
    expect(earnedFor([grass, fire, water], { hall_of_fame_team: null })
      .has('pokemon-professor')).toBe(false);
    expect(earnedFor([grass, fire, water], {}, { valid: false })
      .has('pokemon-professor')).toBe(false);
    expect(earnedFor([
      starterPick(252, { action: 'PICK' }),
      starterPick(255, { action: 'PICK' }),
      starterPick(258, { action: 'PICK' }),
    ], { draft_type: '1v1' }, { casual: true }).has('pokemon-professor')).toBe(false);
  });

  it('awards Who Are You? for beating Wally with 3 of his own Pokemon', () => {
    const draftId = 'wally-race';
    const wallyMons = [
      'Gallade', 'Roserade', 'Garchomp', 'Talonflame', 'Azumarill', 'Magnezone',
    ].map(hofMon);
    const earnedFor = (
      hallOfFameTeam: HallOfFamePokemon[],
      battles: BossBattleHistoryEntry[],
      options: { valid?: boolean } = {},
    ) => earnedIds(baseContext({
      matchHistory: [team({
        team_id: 1,
        draft_id: draftId,
        hall_of_fame_team: hallOfFameTeam,
      })],
      bossBattleHistory: new Map([[1, battles]]),
      validDraftIds: options.valid === false ? new Set() : new Set([draftId]),
    }));

    expect(earnedFor(wallyMons.slice(0, 3), [wallyWin()]).has('who-are-you')).toBe(true);
    expect(earnedFor(wallyMons.slice(0, 2), [wallyWin()]).has('who-are-you')).toBe(false);
    // Three copies of the same Pokemon are not three of Wally's Pokemon.
    expect(earnedFor([wallyMons[0], wallyMons[0], wallyMons[0]], [wallyWin()])
      .has('who-are-you')).toBe(false);
    expect(earnedFor(wallyMons.slice(0, 3), [{ ...wallyWin(), is_loss: true }])
      .has('who-are-you')).toBe(false);
    expect(earnedFor(wallyMons.slice(0, 3), [championWin(3600)])
      .has('who-are-you')).toBe(false);
    expect(earnedFor(wallyMons.slice(0, 3), [wallyWin()], { valid: false })
      .has('who-are-you')).toBe(false);
  });

  it('awards Deathless only for tracked non-casual wins with no faints', () => {
    const cleanRun = (): RunMonStat[] => [
      { species_id: 25, personality: 1, ko_count: null, total_turns: null, level: 50, fainted: false },
      { species_id: 133, personality: 2, ko_count: null, total_turns: null, level: 24, fainted: false },
    ];
    const win = (overrides: Partial<MatchHistoryTeam> = {}) => team({
      team_id: 1,
      draft_id: 'deathless-race',
      draft_type: 'auction',
      created_at: '2026-08-10T12:00:00Z',
      hall_of_fame_team: [hofMon('Pikachu')],
      run_stats: cleanRun(),
      ...overrides,
    });
    const earnedFor = (
      race: MatchHistoryTeam,
      options: { valid?: boolean; casual?: boolean } = {},
    ) => earnedIds(baseContext({
      matchHistory: [race],
      validDraftIds: options.valid === false ? new Set() : new Set(['deathless-race']),
      casual1v1DraftIds: options.casual ? new Set(['deathless-race']) : new Set(),
    }));

    // The cutoff is inclusive, and SQL-style timestamps count too.
    expect(earnedFor(win()).has('deathless')).toBe(true);
    expect(earnedFor(win({ created_at: '2026-08-10 09:30:00' })).has('deathless')).toBe(true);

    expect(earnedFor(win({ created_at: '2026-08-09T23:59:59Z' })).has('deathless')).toBe(false);

    const faintedRun = cleanRun();
    faintedRun[1].fainted = true;
    expect(earnedFor(win({ run_stats: faintedRun })).has('deathless')).toBe(false);

    expect(earnedFor(win({ run_stats: [] })).has('deathless')).toBe(false);
    expect(earnedFor(win(), { valid: false }).has('deathless')).toBe(false);
    expect(earnedFor(win({ draft_type: '1v1' }), { casual: true }).has('deathless')).toBe(false);
  });

  it('awards Untiltable for beating the game with three level 15 faints', () => {
    const draftId = 'untiltable-race';
    const run = (faints: Array<{ level: number | null; fainted: boolean }>) =>
      team({
        team_id: 1,
        draft_id: draftId,
        run_stats: faints.map((mon, index) => ({
          species_id: index + 1,
          personality: index,
          ko_count: 0,
          total_turns: 0,
          level: mon.level,
          fainted: mon.fainted,
        })),
      });
    const earnedFor = (runStats: Array<{ level: number | null; fainted: boolean }>, win = true) =>
      earnedIds(baseContext({
        matchHistory: [run(runStats)],
        bossBattleHistory: new Map([[1, win ? [championWin(3600)] : []]]),
        validDraftIds: new Set([draftId]),
      }));

    expect(earnedFor([
      { level: 15, fainted: true },
      { level: 15, fainted: true },
      { level: 15, fainted: true },
    ]).has('untiltable')).toBe(true);

    expect(earnedFor([
      { level: 15, fainted: true },
      { level: 15, fainted: true },
    ]).has('untiltable')).toBe(false);

    expect(earnedFor([
      { level: 15, fainted: true },
      { level: 15, fainted: true },
      { level: 16, fainted: true },
    ]).has('untiltable')).toBe(false);

    expect(earnedFor([
      { level: 15, fainted: true },
      { level: 15, fainted: true },
      { level: 15, fainted: false },
    ]).has('untiltable')).toBe(false);

    expect(earnedFor([
      { level: 15, fainted: true },
      { level: 15, fainted: true },
      { level: 15, fainted: true },
    ], false).has('untiltable')).toBe(false);
  });

  it("awards Schoolin' On Em for a win with at least 11 Wishiwashi KOs", () => {
    const race = (
      options: {
        speciesId?: number;
        runKos?: number;
        hofKos?: number;
        hofName?: string;
        hofIcon?: string;
        won?: boolean;
      } = {},
    ) => team({
      team_id: 1,
      draft_id: `schoolin-${options.speciesId ?? 746}-${options.runKos ?? 0}-${options.hofKos ?? 0}`,
      run_stats: [{
        species_id: options.speciesId ?? 746,
        personality: 1,
        ko_count: options.runKos ?? 0,
        total_turns: null,
        level: 50,
        fainted: false,
      }],
      hall_of_fame_team: options.won === false ? null : [{
        name: options.hofName ?? 'Wishiwashi-School',
        icon: options.hofIcon ?? 'wishiwashi',
        ko_count: options.hofKos ?? 0,
      }],
    });
    const earnedFor = (
      races: MatchHistoryTeam[],
      options: { valid?: boolean } = {},
    ) => earnedIds(baseContext({
      matchHistory: races,
      validDraftIds: options.valid === false
        ? new Set()
        : new Set(races.map((entry) => entry.draft_id)),
    }));

    // Both Solo (746) and School (1175) ROM species ids count.
    expect(earnedFor([race({ runKos: 11 })]).has('schoolin-on-em')).toBe(true);
    expect(earnedFor([race({ speciesId: 1175, runKos: 11 })]).has('schoolin-on-em')).toBe(true);

    // Hall of Fame KO counts also qualify.
    expect(earnedFor([race({ hofKos: 11 })]).has('schoolin-on-em')).toBe(true);

    // 10 is not enough, and other Pokémon do not count.
    expect(earnedFor([race({ runKos: 10, hofKos: 10 })]).has('schoolin-on-em')).toBe(false);
    expect(earnedFor([race({
      speciesId: 25,
      runKos: 11,
      hofName: 'Pikachu',
      hofIcon: 'pikachu',
      hofKos: 11,
    })]).has('schoolin-on-em')).toBe(false);

    // Only competitive wins count.
    expect(earnedFor([race({ runKos: 11 })], { valid: false }).has('schoolin-on-em')).toBe(false);
    expect(earnedFor([race({ runKos: 11, won: false })]).has('schoolin-on-em')).toBe(false);
  });

  it('awards Old Faithful for 10 non-casual wins with the same draft pick', () => {
    const race = (index: number, pokedex_id: number, overrides: Partial<MatchHistoryTeam> = {}) => {
      const draft_id = `faithful-${index}`;
      return team({
        team_id: index + 1,
        draft_id,
        draft_type: 'auction',
        pokemon_drafted: [pick(null, { pokedex_id, draft_id, draft_order: 1 })],
        ...overrides,
      });
    };
    const earnedFor = (races: MatchHistoryTeam[], valid = true) => earnedIds(baseContext({
      matchHistory: races,
      validDraftIds: valid ? new Set(races.map((item) => item.draft_id)) : new Set(),
      // No Hall of Fame team: the champion battle alone proves the win.
      bossBattleHistory: new Map(races.map((item) => [item.team_id, [championWin(3600)]])),
    }));
    const tenSnorlax = Array.from({ length: 10 }, (_, index) => race(index, 143));

    expect(earnedFor(tenSnorlax).has('old-faithful')).toBe(true);
    expect(earnedFor(tenSnorlax.slice(0, 9)).has('old-faithful')).toBe(false);
    expect(earnedFor(tenSnorlax, false).has('old-faithful')).toBe(false);

    // Eevee is explicitly excluded, even when drafted.
    expect(earnedFor(
      Array.from({ length: 10 }, (_, index) => race(index, 133)),
    ).has('old-faithful')).toBe(false);

    // Five wins with each of two Pokemon is not ten with the same one.
    expect(earnedFor([
      ...Array.from({ length: 5 }, (_, index) => race(index, 143)),
      ...Array.from({ length: 5 }, (_, index) => race(index + 5, 248)),
    ]).has('old-faithful')).toBe(false);

    // 1v1 PICK rows count, but BAN rows do not.
    expect(earnedFor(
      Array.from({ length: 10 }, (_, index) => race(index, 143, {
        draft_type: '1v1',
        pokemon_drafted: [pick(null, {
          pokedex_id: 143,
          draft_id: `faithful-${index}`,
          draft_order: 1,
          action: 'PICK',
        })],
      })),
    ).has('old-faithful')).toBe(true);
    expect(earnedFor(
      Array.from({ length: 10 }, (_, index) => race(index, 143, {
        draft_type: '1v1',
        pokemon_drafted: [pick(null, {
          pokedex_id: 143,
          draft_id: `faithful-${index}`,
          draft_order: 1,
          action: 'BAN',
        })],
      })),
    ).has('old-faithful')).toBe(false);

    // Two team rows in the same draft still count as one race.
    expect(earnedFor([
      race(0, 143),
      { ...race(0, 143), team_id: 100 },
      ...Array.from({ length: 8 }, (_, index) => race(index + 1, 143)),
    ]).has('old-faithful')).toBe(false);
  });

  it('uses strict personal-best thresholds from non-casual races', () => {
    const personalBestContext = (seconds: number) => baseContext({
      matchHistory: [team({ team_id: 1, draft_id: 'competitive' })],
      validDraftIds: new Set(['competitive']),
      bossBattleHistory: new Map([[1, [championWin(seconds)]]]),
    });

    expect(earnedIds(personalBestContext(99 * 60 + 59)).has('sub-100-club')).toBe(true);
    expect(earnedIds(personalBestContext(100 * 60)).has('sub-100-club')).toBe(false);
    expect(earnedIds(personalBestContext(89 * 60 + 59)).has('sub-90-club')).toBe(true);
    expect(earnedIds(personalBestContext(90 * 60)).has('sub-90-club')).toBe(false);
    expect(earnedIds(personalBestContext(79 * 60 + 59)).has('sub-80-club')).toBe(true);
    expect(earnedIds(personalBestContext(79 * 60 + 59)).has('sub-70-club')).toBe(false);
    expect(earnedIds(personalBestContext(59 * 60 + 59)).has('sub-hour-club')).toBe(true);
    expect(earnedIds(personalBestContext(60 * 60)).has('sub-hour-club')).toBe(false);
  });

  it('ignores casual races when calculating personal-best achievements', () => {
    const earned = earnedIds(baseContext({
      matchHistory: [
        team({ team_id: 1, draft_id: 'competitive' }),
        team({ team_id: 2, draft_id: 'casual-1v1', draft_type: '1v1' }),
      ],
      validDraftIds: new Set(['competitive']),
      casual1v1DraftIds: new Set(['casual-1v1']),
      bossBattleHistory: new Map([
        [1, [championWin(90 * 60)]],
        [2, [championWin(50 * 60)]],
      ]),
    }));

    expect(earned.has('sub-90-club')).toBe(false);
    expect(earned.has('sub-80-club')).toBe(false);
    expect(earned.has('sub-hour-club')).toBe(false);
  });

  it('awards RPS Champion at 10 wins', () => {
    expect(earnedIds(baseContext({
      player: { ...player, rps_wins: 9 },
    })).has('rps-champion')).toBe(false);
    expect(earnedIds(baseContext({
      player: { ...player, rps_wins: 10 },
    })).has('rps-champion')).toBe(true);
  });

  it('awards the leaderboard and identity-based achievements', () => {
    const leaderboardEarned = earnedIds(baseContext({ leaderboardIds: new Set(['player-1']) }));
    expect(leaderboardEarned.has('grand-prix-racer')).toBe(true);

    const specialEarned = earnedIds(baseContext({
      player: { ...player, user_id: '310960489628696576', rps_wins: 10 },
      identityIds: new Set(['310960489628696576', '683893212414476317']),
    }));
    expect(specialEarned.has('stream-legend')).toBe(true);
    expect(specialEarned.has('close-combatant')).toBe(false);
    expect(specialEarned.has('rps-champion')).toBe(true);
  });

  it('lets manual overrides grant and revoke achievements', () => {
    const granted = earnedIds(baseContext({
      manualOverrides: new Map([['infinite-wisdom', true]]),
    }));
    expect(granted.has('infinite-wisdom')).toBe(true);

    const revoked = earnedIds(baseContext({
      player: { ...player, rps_wins: 10 },
      manualOverrides: new Map([['rps-champion', false]]),
    }));
    expect(revoked.has('rps-champion')).toBe(false);

    const results = computePlayerAchievements(baseContext({
      manualOverrides: new Map([['infinite-wisdom', true]]),
    }));
    expect(results.find((achievement) => achievement.id === 'infinite-wisdom')?.manuallySet).toBe(true);
    expect(results.find((achievement) => achievement.id === 'early-bird')?.manuallySet).toBe(false);
  });

  it('awards win-based achievements from the winning run', () => {
    const pokemon: Pokemon[] = [
      { id: 1, name: 'Pidgeot', type1: 'Flying' },
      { id: 2, name: 'Fearow', type1: 'Flying' },
      { id: 3, name: 'Altaria', type1: 'Dragon', type2: 'Flying' },
      { id: 4, name: 'Swellow', type1: 'Normal', type2: 'Flying' },
    ];
    const hallOfFameTeam: HallOfFamePokemon[] = [
      { name: 'Smeargle', icon: 'smeargle', ko_count: 20 },
      { name: 'Vaporeon', icon: 'vaporeon', ko_count: null },
      { name: 'Jolteon', icon: 'jolteon', ko_count: null },
      { name: 'Flareon', icon: 'flareon', ko_count: null },
      { name: 'Espeon', icon: 'espeon', ko_count: null },
      { name: 'Umbreon', icon: 'umbreon', ko_count: null },
      { name: 'Leafeon', icon: 'leafeon', ko_count: null },
      { name: 'Glaceon', icon: 'glaceon', ko_count: null },
      { name: 'Sylveon', icon: 'sylveon', ko_count: null },
      { name: 'Pidgeot', icon: 'pidgeot', ko_count: null },
      { name: 'Fearow', icon: 'fearow', ko_count: null },
      { name: 'Altaria', icon: 'altaria', ko_count: null },
    ];
    const battles: BossBattleHistoryEntry[] = [
      { trainer_id: 804, version: null, hours: 1, minutes: 12, seconds: 30, is_loss: false },
    ];
    const winningTeam = team({
      team_id: 1,
      draft_id: 'd1',
      draft_type: '1v1',
      hall_of_fame_team: hallOfFameTeam,
      run_stats: Array.from({ length: 10 }, (_, index) => ({
        species_id: index + 1,
        personality: index,
        ko_count: 0,
        total_turns: 0,
        level: 50,
        fainted: true,
      })),
      pokemon_drafted: [
        { ...({} as any), pokedex_id: 258, draft_order: 1, action: 'PICK', name: 'Mudkip', form: '' },
        ...[1, 2, 3, 4].map((id, index) => ({ ...({} as any), pokedex_id: id, draft_order: index + 2, action: 'PICK', name: pokemon[index].name, form: '' })),
      ],
    });
    const earned = earnedIds(baseContext({
      matchHistory: [winningTeam],
      bossBattleHistory: new Map([[1, battles]]),
      pokemon,
    }));

    expect(earned.has('the-chosen-one')).toBe(true);
    expect(earned.has('type-loyalist')).toBe(true);
    expect(earned.has('clutch-master')).toBe(true);
    expect(earned.has('hard-carried')).toBe(true);
    expect(earned.has('artisan')).toBe(true);
    expect(earned.has('rainbow-warrior')).toBe(true);
    expect(earned.has('big-year')).toBe(true);
  });

  describe('Around the World', () => {
    const entry = (options: {
      teamId: number;
      draftId: string;
      name: string;
      date?: string;
      draftType?: string;
    }) => {
      const {
        teamId,
        draftId,
        name,
        date = '2026-01-01T00:00:00Z',
        draftType = 'auction',
      } = options;
      const auction = pick(1000, {
        auction_id: teamId,
        draft_id: draftId,
        draft_type: draftType,
        name,
        form: '',
        pokedex_id: 25,
        action: draftType === '1v1' ? 'PICK' : null,
        winning_user_id: 'player-1',
        created_at: date,
      });
      return {
        teamId,
        draftId,
        matchTeam: team({
          team_id: teamId,
          draft_id: draftId,
          draft_type: draftType,
          created_at: date,
          hall_of_fame_team: [hofMon(name)],
          pokemon_drafted: [auction],
        }),
        statsTeam: {
          ...statsTeam(teamId, draftId, null, 'player-1'),
          draft_type: draftType,
          created_at: date,
        },
        race: {
          team_id: teamId,
          draft_id: draftId,
          user_id: 'player-1',
          guest_id: null,
          draft_type: draftType,
        } as WinningRace,
        auction,
      };
    };

    const contextFor = (
      entries: ReturnType<typeof entry>[],
      options: { winningTeamIds?: number[]; casual1v1DraftIds?: Set<string> } = {},
    ) => {
      const winningTeamIds = options.winningTeamIds ?? entries.map((item) => item.teamId);
      return baseContext({
        matchHistory: entries.map((item) => item.matchTeam),
        winningRaces: entries
          .filter((item) => winningTeamIds.includes(item.teamId))
          .map((item) => item.race),
        allTeams: entries.map((item) => item.statsTeam),
        auctions: entries.map((item) => item.auction),
        validDraftIds: new Set(entries.map((item) => item.draftId)),
        casual1v1DraftIds: options.casual1v1DraftIds ?? new Set(),
      });
    };

    it('does not award without a pool or winning races', () => {
      expect(earnedIds(baseContext()).has('around-the-world')).toBe(false);
    });

    it('awards when every stats-chart pool Pokemon has at least one non-casual win', () => {
      const entries = [
        entry({ teamId: 1, draftId: 'draft-1', name: 'Pikachu' }),
        entry({ teamId: 2, draftId: 'draft-2', name: 'Charmander' }),
        entry({ teamId: 3, draftId: 'draft-3', name: 'Squirtle', draftType: '1v1' }),
      ];

      expect(earnedIds(contextFor(entries)).has('around-the-world')).toBe(true);
    });

    it('does not award when one pool Pokemon has no win', () => {
      const entries = [
        entry({ teamId: 1, draftId: 'draft-1', name: 'Pikachu' }),
        entry({ teamId: 2, draftId: 'draft-2', name: 'Charmander' }),
        entry({ teamId: 3, draftId: 'draft-3', name: 'Squirtle' }),
      ];

      expect(earnedIds(contextFor(entries, { winningTeamIds: [1, 2] }))
        .has('around-the-world')).toBe(false);
    });

    it('does not count casual 1v1 races toward the win requirement', () => {
      const entries = [
        entry({ teamId: 1, draftId: 'draft-1', name: 'Pikachu' }),
        entry({ teamId: 2, draftId: 'draft-2', name: 'Charmander' }),
        entry({ teamId: 3, draftId: 'casual-1v1', name: 'Squirtle', draftType: '1v1' }),
      ];

      expect(earnedIds(contextFor(entries, { casual1v1DraftIds: new Set(['casual-1v1']) }))
        .has('around-the-world')).toBe(false);
    });

    it('stays earned when a later draft adds another Pokemon to the pool', () => {
      const entries = [
        entry({ teamId: 1, draftId: 'draft-1', name: 'Pikachu', date: '2026-01-01T00:00:00Z' }),
        entry({ teamId: 2, draftId: 'draft-2', name: 'Charmander', date: '2026-01-01T00:00:00Z' }),
        entry({ teamId: 3, draftId: 'draft-3', name: 'Squirtle', date: '2026-03-01T00:00:00Z' }),
      ];

      expect(earnedIds(contextFor(entries, { winningTeamIds: [1, 2] }))
        .has('around-the-world')).toBe(true);
    });
  });

  describe('Traitor', () => {
    const context = (options: {
      banName?: string;
      banForm?: string;
      banUser?: string;
      win1v1?: boolean;
      casual?: boolean;
      includeAuctionPicks?: boolean;
    } = {}): AchievementContext => {
      const {
        banName = 'Pikachu',
        banForm = '',
        banUser = 'player-1',
        win1v1 = true,
        casual = false,
        includeAuctionPicks = true,
      } = options;
      const oneVOneDraftId = casual ? 'casual-1v1' : 'regular-1v1';
      const auctionTeams = includeAuctionPicks
        ? [
            team({
              team_id: 1,
              draft_id: 'auction-1',
              pokemon_drafted: [
                pick(null, { draft_id: 'auction-1', name: 'Pikachu', action: 'PICK' }),
                pick(null, { draft_id: 'auction-1', name: 'Charizard', action: 'PICK' }),
              ],
            }),
            team({
              team_id: 2,
              draft_id: 'auction-2',
              pokemon_drafted: [
                pick(null, { draft_id: 'auction-2', name: 'Pikachu', action: 'PICK' }),
              ],
            }),
          ]
        : [];
      const oneVOneTeam = team({
        team_id: 3,
        draft_id: oneVOneDraftId,
        draft_type: '1v1',
        pokemon_drafted: [
          pick(null, {
            draft_id: oneVOneDraftId,
            draft_type: '1v1',
            draft_order: 5,
            action: 'BAN',
            name: banName,
            form: banForm,
            winning_user_id: banUser,
          }),
        ],
      });

      return baseContext({
        matchHistory: [...auctionTeams, oneVOneTeam],
        validDraftIds: new Set(['auction-1', 'auction-2']),
        casual1v1DraftIds: casual ? new Set([oneVOneDraftId]) : new Set(),
        bossBattleHistory: win1v1 ? new Map([[3, [championWin(90 * 60)]]]) : new Map(),
        auctions: [
          pick(null, {
            draft_id: oneVOneDraftId,
            draft_type: '1v1',
            draft_order: casual ? 37 : 29,
            action: 'LEFTOVER',
          }),
        ],
      });
    };

    it('awards for banning your most drafted Pokemon in a winning 1v1', () => {
      expect(earnedIds(context()).has('traitor')).toBe(true);
    });

    it('counts casual 1v1s as well as regular 1v1s', () => {
      expect(earnedIds(context({ casual: true })).has('traitor')).toBe(true);
    });

    it('does not award for banning a different Pokemon', () => {
      expect(earnedIds(context({ banName: 'Charizard' })).has('traitor')).toBe(false);
    });

    it('does not award unless the same 1v1 was won', () => {
      expect(earnedIds(context({ win1v1: false })).has('traitor')).toBe(false);
    });

    it('does not award when someone else made the ban', () => {
      expect(earnedIds(context({ banUser: 'opponent' })).has('traitor')).toBe(false);
    });

    it('does not award without a most drafted Pokemon to betray', () => {
      expect(earnedIds(context({ includeAuctionPicks: false })).has('traitor')).toBe(false);
    });

    it('stays earned when a later draft changes the most drafted Pokemon', () => {
      const earlyAuction = team({
        team_id: 1,
        draft_id: 'early-auction',
        created_at: '2026-01-01T00:00:00Z',
        pokemon_drafted: [
          pick(null, { draft_id: 'early-auction', name: 'Pikachu', action: 'PICK' }),
          pick(null, { draft_id: 'early-auction', name: 'Pikachu', action: 'PICK' }),
          pick(null, { draft_id: 'early-auction', name: 'Charizard', action: 'PICK' }),
        ],
      });
      const winningOneVOne = team({
        team_id: 2,
        draft_id: 'traitor-1v1',
        draft_type: '1v1',
        created_at: '2026-02-01T00:00:00Z',
        pokemon_drafted: [
          pick(null, {
            draft_id: 'traitor-1v1',
            draft_type: '1v1',
            draft_order: 5,
            action: 'BAN',
            name: 'Pikachu',
          }),
        ],
      });
      const laterAuction = team({
        team_id: 3,
        draft_id: 'later-auction',
        created_at: '2026-03-01T00:00:00Z',
        pokemon_drafted: Array.from({ length: 5 }, () =>
          pick(null, { draft_id: 'later-auction', name: 'Charizard', action: 'PICK' }),
        ),
      });

      expect(earnedIds(baseContext({
        matchHistory: [earlyAuction, winningOneVOne, laterAuction],
        validDraftIds: new Set(['early-auction', 'later-auction']),
        bossBattleHistory: new Map([[2, [championWin(90 * 60)]]]),
      })).has('traitor')).toBe(true);
    });

    it('does not retroactively award when the banned Pokemon only becomes most drafted later', () => {
      const earlyAuction = team({
        team_id: 1,
        draft_id: 'early-auction',
        created_at: '2026-01-01T00:00:00Z',
        pokemon_drafted: [
          pick(null, { draft_id: 'early-auction', name: 'Charizard', action: 'PICK' }),
          pick(null, { draft_id: 'early-auction', name: 'Pikachu', action: 'PICK' }),
        ],
      });
      const winningOneVOne = team({
        team_id: 2,
        draft_id: 'traitor-1v1',
        draft_type: '1v1',
        created_at: '2026-02-01T00:00:00Z',
        pokemon_drafted: [
          pick(null, {
            draft_id: 'traitor-1v1',
            draft_type: '1v1',
            draft_order: 5,
            action: 'BAN',
            name: 'Pikachu',
          }),
        ],
      });
      const laterAuction = team({
        team_id: 3,
        draft_id: 'later-auction',
        created_at: '2026-03-01T00:00:00Z',
        pokemon_drafted: Array.from({ length: 5 }, () =>
          pick(null, { draft_id: 'later-auction', name: 'Pikachu', action: 'PICK' }),
        ),
      });

      expect(earnedIds(baseContext({
        matchHistory: [earlyAuction, winningOneVOne, laterAuction],
        validDraftIds: new Set(['early-auction', 'later-auction']),
        bossBattleHistory: new Map([[2, [championWin(90 * 60)]]]),
      })).has('traitor')).toBe(false);
    });
  });

  describe('Topsy Turvy', () => {
    const context = (options: {
      casual?: boolean;
      hofMons?: HallOfFamePokemon[];
      signatureKey?: string | null;
      draftType?: string;
    } = {}): AchievementContext => {
      const {
        casual = false,
        hofMons = [hofMon('Pikachu')],
        signatureKey = 'Pikachu',
        draftType = '1v1',
      } = options;
      const draftId = casual ? 'casual-1v1' : 'competitive-1v1';
      return baseContext({
        matchHistory: [team({
          team_id: 1,
          draft_id: draftId,
          draft_type: draftType,
          created_at: '2026-04-15T00:00:00Z',
          hall_of_fame_team: hofMons,
        })],
        casual1v1DraftIds: casual ? new Set([draftId]) : new Set(),
        bossBattleHistory: new Map([[1, [championWin(90 * 60)]]]),
        oneVOneOpponentSignatures:
          signatureKey === null ? new Map() : new Map([[draftId, signatureKey]]),
      });
    };

    it('awards for beating the game with the opponent signature in a 1v1', () => {
      expect(earnedIds(context()).has('topsy-turvy')).toBe(true);
    });

    it('counts casual 1v1s as well as competitive 1v1s', () => {
      expect(earnedIds(context({ casual: true })).has('topsy-turvy')).toBe(true);
    });

    it('matches regional form signatures', () => {
      expect(earnedIds(context({
        signatureKey: 'Meowth-Galar',
        hofMons: [hofMon('Meowth-Galar')],
      })).has('topsy-turvy')).toBe(true);
    });

    it('does not award for a different Hall of Fame Pokemon', () => {
      expect(earnedIds(context({ hofMons: [hofMon('Charizard')] })).has('topsy-turvy')).toBe(false);
    });

    it('does not award without a signature for that draft', () => {
      expect(earnedIds(context({ signatureKey: null })).has('topsy-turvy')).toBe(false);
    });

    it('does not award outside 1v1 drafts', () => {
      expect(earnedIds(context({ draftType: 'auction' })).has('topsy-turvy')).toBe(false);
    });

    it('does not award without a Hall of Fame team', () => {
      expect(earnedIds(context({ hofMons: [] })).has('topsy-turvy')).toBe(false);
    });
  });

  describe('Vanilla Gamer', () => {
    // Roxanne 1, Brawly 2, Wattson 3, Flannery 4, Norman 5, Winona 6,
    // Tate & Liza 7, Juan & Wallace 8. Viola 1 and Archie can substitute
    // for the first and eighth badges respectively.
    const vanillaSplits = [265, 774, 779, 784, 789, 827, 831, 835];
    const wins = (ids: number[]): BossBattleHistoryEntry[] =>
      ids.map((trainer_id, index) => ({
        trainer_id,
        version: null,
        hours: 0,
        minutes: index,
        seconds: 0,
        is_loss: false,
      }));
    const context = (options: {
      ids?: number[];
      draftType?: string;
      validDraftId?: boolean;
      casual1v1?: boolean;
      extraBattles?: BossBattleHistoryEntry[];
    } = {}): AchievementContext => {
      const {
        ids = vanillaSplits,
        draftType = 'auction',
        validDraftId = true,
        casual1v1 = false,
        extraBattles = [],
      } = options;
      return baseContext({
        matchHistory: [team({ team_id: 1, draft_id: 'd1', draft_type: draftType })],
        validDraftIds: validDraftId ? new Set(['d1']) : new Set(),
        casual1v1DraftIds: casual1v1 ? new Set(['d1']) : new Set(),
        bossBattleHistory: new Map([[1, [...extraBattles, ...wins(ids)]]]),
      });
    };

    it('awards for the eight vanilla gym wins in order without beating the game', () => {
      expect(earnedIds(context()).has('vanilla-gamer')).toBe(true);
    });

    it('accepts Viola 1 in place of Roxanne 1', () => {
      expect(earnedIds(context({
        ids: [855, ...vanillaSplits.slice(1)],
      })).has('vanilla-gamer')).toBe(true);
    });

    it('accepts Archie in place of Juan & Wallace 8', () => {
      expect(earnedIds(context({
        ids: [...vanillaSplits.slice(0, 7), 34],
      })).has('vanilla-gamer')).toBe(true);
    });

    it('accepts both substitutes together', () => {
      expect(earnedIds(context({
        ids: [855, ...vanillaSplits.slice(1, 7), 34],
      })).has('vanilla-gamer')).toBe(true);
    });

    it('does not accept Viola 2 for the first badge', () => {
      expect(earnedIds(context({
        ids: [856, ...vanillaSplits.slice(1)],
      })).has('vanilla-gamer')).toBe(false);
    });

    it('does not accept Maxie for the eighth badge', () => {
      expect(earnedIds(context({
        ids: [...vanillaSplits.slice(0, 7), 601],
      })).has('vanilla-gamer')).toBe(false);
    });

    it('does not count an early Archie win as the eighth badge', () => {
      expect(earnedIds(context({
        ids: [34, ...vanillaSplits.slice(0, 7)],
      })).has('vanilla-gamer')).toBe(false);
    });

    it('accepts versioned base gym leader ids', () => {
      const versioned = [
        gymSplitWin(265, 1, 10),
        gymSplitWin(266, 2, 20),
        gymSplitWin(267, 3, 30),
        gymSplitWin(268, 4, 40),
        gymSplitWin(269, 5, 50),
        gymSplitWin(270, 6, 60),
        gymSplitWin(271, 7, 70),
        gymSplitWin(272, 8, 80),
      ];
      expect(earnedIds(baseContext({
        matchHistory: [team({ team_id: 1, draft_id: 'd1' })],
        validDraftIds: new Set(['d1']),
        bossBattleHistory: new Map([[1, versioned]]),
      })).has('vanilla-gamer')).toBe(true);
    });

    it('does not award when the gym wins happen out of order', () => {
      const reordered = [vanillaSplits[1], vanillaSplits[0], ...vanillaSplits.slice(2)];
      expect(earnedIds(context({ ids: reordered })).has('vanilla-gamer')).toBe(false);
    });

    it('does not award when one of the eight gym wins is missing', () => {
      expect(earnedIds(context({ ids: vanillaSplits.slice(0, 7) })).has('vanilla-gamer')).toBe(false);
    });

    it('does not count casual 1v1s', () => {
      expect(earnedIds(context({
        draftType: '1v1',
        casual1v1: true,
      })).has('vanilla-gamer')).toBe(false);
    });

    it('does not count casual auctions', () => {
      expect(earnedIds(context({ validDraftId: false })).has('vanilla-gamer')).toBe(false);
    });

    it('ignores unrelated losses between the ordered gym wins', () => {
      expect(earnedIds(context({
        extraBattles: [gymSplitWin(265, 1, 5, true)],
      })).has('vanilla-gamer')).toBe(true);
    });
  });

  describe('Loyal Customer', () => {
    const race = (
      teamId: number,
      draftId: string,
      rentals: RentalStat[] = [],
      draftType = 'auction',
    ) => team({ team_id: teamId, draft_id: draftId, draft_type: draftType, rental_stats: rentals });

    const contextFor = (
      teams: MatchHistoryTeam[],
      validDraftIds = new Set(teams.filter((t) => t.draft_type === 'auction').map((t) => t.draft_id)),
      casual1v1DraftIds = new Set<string>(),
    ) => baseContext({ matchHistory: teams, validDraftIds, casual1v1DraftIds });

    it('awards for three distinct rental species in one non-casual race', () => {
      expect(earnedIds(contextFor([
        race(1, 'race-1', [rental(359, 1), rental(780, 2), rental(870, 3)]),
      ])).has('loyal-customer')).toBe(true);
    });

    it('does not count two rentals of the same species as two rentals', () => {
      expect(earnedIds(contextFor([
        race(1, 'race-1', [rental(359, 1), rental(359, 2), rental(780, 3)]),
      ])).has('loyal-customer')).toBe(false);
    });

    it('collapses forms of the same species', () => {
      expect(earnedIds(contextFor([
        race(1, 'race-1', [rental(359, 1), rental(940, 2), rental(780, 3)]),
      ])).has('loyal-customer')).toBe(false);
    });

    it('does not count rentals outside the rental pool', () => {
      expect(earnedIds(contextFor([
        race(1, 'race-1', [rental(359, 1), rental(25, 2), rental(780, 3)]),
      ])).has('loyal-customer')).toBe(false);
    });

    it('does not combine rentals from separate races', () => {
      expect(earnedIds(contextFor([
        race(1, 'race-1', [rental(359, 1), rental(780, 2)]),
        race(2, 'race-2', [rental(870, 3)]),
      ])).has('loyal-customer')).toBe(false);
    });

    it('does not count casual auctions', () => {
      expect(earnedIds(contextFor(
        [race(1, 'race-1', [rental(359, 1), rental(780, 2), rental(870, 3)])],
        new Set(),
      )).has('loyal-customer')).toBe(false);
    });

    it('does not count casual 1v1s', () => {
      expect(earnedIds(contextFor(
        [race(1, 'race-1', [rental(359, 1), rental(780, 2), rental(870, 3)], '1v1')],
        new Set(),
        new Set(['race-1']),
      )).has('loyal-customer')).toBe(false);
    });

    it('counts three rentals in a competitive 1v1', () => {
      expect(earnedIds(contextFor([
        race(1, 'race-1', [rental(359, 1), rental(780, 2), rental(870, 3)], '1v1'),
      ])).has('loyal-customer')).toBe(true);
    });
  });

  it('accumulates Rainbow Warrior eeveelutions across winning races, including casual races', () => {
    const battles: BossBattleHistoryEntry[] = [
      { trainer_id: 804, version: null, hours: 1, minutes: 0, seconds: 0, is_loss: false },
    ];
    const firstWin = team({
      team_id: 1,
      draft_id: 'd1',
      hall_of_fame_team: [
        { name: 'Vaporeon', icon: 'vaporeon', ko_count: null },
        { name: 'Jolteon', icon: 'jolteon', ko_count: null },
        { name: 'Flareon', icon: 'flareon', ko_count: null },
        { name: 'Espeon', icon: 'espeon', ko_count: null },
      ],
    });
    const secondWin = team({
      team_id: 2,
      draft_id: 'd2',
      hall_of_fame_team: [
        { name: 'Umbreon', icon: 'umbreon', ko_count: null },
        { name: 'Leafeon', icon: 'leafeon', ko_count: null },
        { name: 'Glaceon', icon: 'glaceon', ko_count: null },
        { name: 'Sylveon', icon: 'sylveon', ko_count: null },
      ],
    });

    expect(earnedIds(baseContext({
      matchHistory: [firstWin, secondWin],
      validDraftIds: new Set(['d1', 'd2']),
      bossBattleHistory: new Map([[1, battles], [2, battles]]),
    })).has('rainbow-warrior')).toBe(true);

    // Casual races count too.
    expect(earnedIds(baseContext({
      matchHistory: [firstWin, secondWin],
      validDraftIds: new Set(),
      bossBattleHistory: new Map([[1, battles], [2, battles]]),
    })).has('rainbow-warrior')).toBe(true);

    // Not all 8 seen yet.
    expect(earnedIds(baseContext({
      matchHistory: [firstWin],
      validDraftIds: new Set(['d1']),
      bossBattleHistory: new Map([[1, battles]]),
    })).has('rainbow-warrior')).toBe(false);

    // Losing/non-winning runs do not contribute.
    expect(earnedIds(baseContext({
      matchHistory: [
        firstWin,
        { ...secondWin, draft_id: 'd2-loss', hall_of_fame_team: [] },
      ],
      validDraftIds: new Set(['d1', 'd2-loss']),
      bossBattleHistory: new Map([
        [1, battles],
        [2, [{ trainer_id: 804, version: null, hours: 1, minutes: 0, seconds: 0, is_loss: true }]],
      ]),
    })).has('rainbow-warrior')).toBe(false);
  });

  it('accumulates Appliance Master forms across winning races, including casual races', () => {
    const forms: HallOfFamePokemon[] = [
      { name: 'Rotom-Heat', icon: 'rotom-heat', ko_count: null },
      { name: 'Rotom-Wash', icon: 'rotom-wash', ko_count: null },
      { name: 'Rotom-Mow', icon: 'rotom-mow', ko_count: null },
      { name: 'Rotom-Frost', icon: 'rotom-frost', ko_count: null },
      { name: 'Rotom-Fan', icon: 'rotom-fan', ko_count: null },
    ];
    const winningTeam = (teamId: number, hallOfFameTeam: HallOfFamePokemon[]) =>
      team({
        team_id: teamId,
        draft_id: `d${teamId}`,
        hall_of_fame_team: hallOfFameTeam,
      });
    const earnedFor = (
      teams: MatchHistoryTeam[],
      options: { validDraftIds?: Set<string> } = {},
    ) =>
      earnedIds(baseContext({
        matchHistory: teams,
        validDraftIds: options.validDraftIds ?? new Set(teams.map((entry) => entry.draft_id)),
      }));

    expect(earnedFor([winningTeam(1, forms)]).has('appliance-master')).toBe(true);

    // Form can be recognized from the icon alone.
    expect(earnedFor([winningTeam(1, forms.map((mon) => ({ ...mon, name: 'Rotom' })))]).has('appliance-master')).toBe(true);

    // Forms accumulate across winning runs, and casual races count.
    expect(earnedFor([
      winningTeam(1, forms.slice(0, 3)),
      winningTeam(2, forms.slice(3)),
    ]).has('appliance-master')).toBe(true);
    expect(earnedFor([winningTeam(1, forms)], { validDraftIds: new Set() }).has('appliance-master')).toBe(true);

    // Missing a form does not count, even when spread across runs.
    expect(earnedFor([winningTeam(1, forms.slice(0, 4))]).has('appliance-master')).toBe(false);
    expect(earnedFor([
      winningTeam(1, forms.slice(0, 3)),
      winningTeam(2, forms.slice(3, 4)),
    ]).has('appliance-master')).toBe(false);

    // Non-winning runs do not contribute.
    expect(earnedFor([
      winningTeam(1, forms.slice(0, 4)),
      { ...winningTeam(2, forms.slice(4)), hall_of_fame_team: [] },
    ]).has('appliance-master')).toBe(false);
  });

  it("accumulates Doctor's Worst Nightmare evolutions across winning races, including casual races", () => {
    const evolutions: HallOfFamePokemon[] = [
      { name: 'Hydrapple', icon: 'hydrapple', ko_count: null },
      { name: 'Appletun', icon: 'appletun', ko_count: null },
      { name: 'Flapple', icon: 'flapple', ko_count: null },
    ];
    const winningTeam = (teamId: number, hallOfFameTeam: HallOfFamePokemon[]) =>
      team({
        team_id: teamId,
        draft_id: `d${teamId}`,
        hall_of_fame_team: hallOfFameTeam,
      });
    const earnedFor = (
      teams: MatchHistoryTeam[],
      options: { validDraftIds?: Set<string> } = {},
    ) =>
      earnedIds(baseContext({
        matchHistory: teams,
        validDraftIds: options.validDraftIds ?? new Set(teams.map((entry) => entry.draft_id)),
      }));

    expect(earnedFor([winningTeam(1, evolutions)]).has('doctors-worst-nightmare')).toBe(true);

    // Evolution can be recognized from the icon alone.
    expect(earnedFor([winningTeam(1, evolutions.map((mon) => ({ ...mon, name: 'Applin' })))]).has('doctors-worst-nightmare')).toBe(true);

    // Evolutions accumulate across winning runs, and casual races count.
    expect(earnedFor([
      winningTeam(1, evolutions.slice(0, 2)),
      winningTeam(2, evolutions.slice(2)),
    ]).has('doctors-worst-nightmare')).toBe(true);
    expect(earnedFor([winningTeam(1, evolutions)], { validDraftIds: new Set() }).has('doctors-worst-nightmare')).toBe(true);

    // Missing an evolution or using Applin itself does not count.
    expect(earnedFor([winningTeam(1, evolutions.slice(0, 2))]).has('doctors-worst-nightmare')).toBe(false);
    expect(earnedFor([winningTeam(1, [
      evolutions[0],
      evolutions[1],
      { name: 'Applin', icon: 'applin', ko_count: null },
    ])]).has('doctors-worst-nightmare')).toBe(false);

    // Non-winning runs do not contribute.
    expect(earnedFor([
      winningTeam(1, evolutions.slice(0, 2)),
      { ...winningTeam(2, evolutions.slice(2)), hall_of_fame_team: [] },
    ]).has('doctors-worst-nightmare')).toBe(false);
  });

  it('accumulates Natural Born Gambler across winning races, including casual races', () => {
    const mons: HallOfFamePokemon[] = [
      { name: 'Azumarill', icon: 'azumarill', ko_count: null },
      { name: 'Clefable', icon: 'clefable', ko_count: null },
      { name: 'Togekiss', icon: 'togekiss', ko_count: null },
      { name: 'Wigglytuff', icon: 'wigglytuff', ko_count: null },
    ];
    const winningTeam = (teamId: number, hallOfFameTeam: HallOfFamePokemon[]) =>
      team({
        team_id: teamId,
        draft_id: `d${teamId}`,
        hall_of_fame_team: hallOfFameTeam,
      });
    const earnedFor = (
      teams: MatchHistoryTeam[],
      options: { validDraftIds?: Set<string> } = {},
    ) =>
      earnedIds(baseContext({
        matchHistory: teams,
        validDraftIds: options.validDraftIds ?? new Set(teams.map((entry) => entry.draft_id)),
      }));

    expect(earnedFor([winningTeam(1, mons)]).has('natural-born-gambler')).toBe(true);

    // Pokémon can be recognized from their icons alone.
    expect(earnedFor([winningTeam(1, mons.map((mon) => ({ ...mon, name: 'Unknown' })))]).has('natural-born-gambler')).toBe(true);

    // Collected Pokémon accumulate across winning runs, and casual races count.
    expect(earnedFor([
      winningTeam(1, mons.slice(0, 2)),
      winningTeam(2, mons.slice(2)),
    ]).has('natural-born-gambler')).toBe(true);
    expect(earnedFor([winningTeam(1, mons)], { validDraftIds: new Set() }).has('natural-born-gambler')).toBe(true);

    // Missing one, or using pre-evolutions instead, does not count.
    expect(earnedFor([winningTeam(1, mons.slice(0, 3))]).has('natural-born-gambler')).toBe(false);
    expect(earnedFor([winningTeam(1, [
      { name: 'Marill', icon: 'marill', ko_count: null },
      { name: 'Clefairy', icon: 'clefairy', ko_count: null },
      { name: 'Togetic', icon: 'togetic', ko_count: null },
      { name: 'Jigglypuff', icon: 'jigglypuff', ko_count: null },
    ])]).has('natural-born-gambler')).toBe(false);

    // Non-winning runs do not contribute.
    expect(earnedFor([
      winningTeam(1, mons.slice(0, 3)),
      { ...winningTeam(2, mons.slice(3)), hall_of_fame_team: [] },
    ]).has('natural-born-gambler')).toBe(false);
  });

  it('awards Good as New for Corsola in any Hall of Fame team, including casual races', () => {
    const corsola: HallOfFamePokemon = { name: 'Corsola', icon: 'corsola', ko_count: null };
    const winningTeam = (
      teamId: number,
      hallOfFameTeam: HallOfFamePokemon[],
      draftType = 'auction',
    ) => team({
      team_id: teamId,
      draft_id: `d${teamId}`,
      draft_type: draftType,
      hall_of_fame_team: hallOfFameTeam,
    });
    const earnedFor = (
      teams: MatchHistoryTeam[],
      options: { validDraftIds?: Set<string>; casual1v1DraftIds?: Set<string> } = {},
    ) => earnedIds(baseContext({
      matchHistory: teams,
      validDraftIds: options.validDraftIds ?? new Set(teams.map((entry) => entry.draft_id)),
      casual1v1DraftIds: options.casual1v1DraftIds ?? new Set(),
    }));

    expect(earnedFor([winningTeam(1, [corsola])]).has('good-as-new')).toBe(true);
    expect(earnedFor([winningTeam(1, [corsola])], { validDraftIds: new Set() }).has('good-as-new')).toBe(true);
    expect(earnedFor([winningTeam(1, [corsola], '1v1')], {
      validDraftIds: new Set(),
      casual1v1DraftIds: new Set(['d1']),
    }).has('good-as-new')).toBe(true);

    // Name or icon alone is enough.
    expect(earnedFor([winningTeam(1, [{ name: 'Unknown', icon: 'corsola', ko_count: null }])])
      .has('good-as-new')).toBe(true);
    expect(earnedFor([winningTeam(1, [{ name: 'Corsola', icon: 'unknown', ko_count: null }])])
      .has('good-as-new')).toBe(true);

    // Galar form and other Pokémon do not count.
    const galarCorsola: HallOfFamePokemon = {
      name: 'Corsola-Galar',
      icon: 'corsola-galar',
      ko_count: null,
    };
    expect(earnedFor([winningTeam(1, [galarCorsola])]).has('good-as-new')).toBe(false);
    expect(earnedFor([winningTeam(1, [{ name: 'Pikachu', icon: 'pikachu', ko_count: null }])])
      .has('good-as-new')).toBe(false);

    // Non-winning runs do not contribute.
    expect(earnedFor([{ ...winningTeam(1, [corsola]), hall_of_fame_team: [] }])
      .has('good-as-new')).toBe(false);
  });

  it('awards Night Owl for two night-evolving Pokémon on one Hall of Fame team', () => {
    const nightMons: HallOfFamePokemon[] = [
      { name: 'Decidueye', icon: 'decidueye', ko_count: null },
      { name: 'Typhlosion-Hisui', icon: 'typhlosion-hisui', ko_count: null },
      { name: 'Braviary-Hisui', icon: 'braviary-hisui', ko_count: null },
      { name: 'Samurott-Hisui', icon: 'samurott-hisui', ko_count: null },
      { name: 'Mr. Rime', icon: 'mr-rime', ko_count: null },
      { name: 'Marowak-Alola', icon: 'marowak-alola', ko_count: null },
      { name: 'Lycanroc-Midnight', icon: 'lycanroc-midnight', ko_count: null },
    ];
    const winningTeam = (teamId: number, hallOfFameTeam: HallOfFamePokemon[]) =>
      team({
        team_id: teamId,
        draft_id: `d${teamId}`,
        hall_of_fame_team: hallOfFameTeam,
      });
    const earnedFor = (
      teams: MatchHistoryTeam[],
      options: { validDraftIds?: Set<string> } = {},
    ) =>
      earnedIds(baseContext({
        matchHistory: teams,
        validDraftIds: options.validDraftIds ?? new Set(teams.map((entry) => entry.draft_id)),
      }));

    expect(earnedFor([winningTeam(1, nightMons.slice(0, 2))]).has('night-owl')).toBe(true);
    expect(earnedFor([winningTeam(1, [nightMons[5], nightMons[6]])]).has('night-owl')).toBe(true);

    // Pokémon can be recognized from their icons alone.
    expect(earnedFor([winningTeam(1, nightMons.slice(0, 2).map((mon) => ({
      ...mon,
      name: 'Unknown',
    })))]).has('night-owl')).toBe(true);

    // One qualifying Pokémon or a duplicate does not count.
    expect(earnedFor([winningTeam(1, nightMons.slice(0, 1))]).has('night-owl')).toBe(false);
    expect(earnedFor([winningTeam(1, [nightMons[0], nightMons[0]])]).has('night-owl')).toBe(false);

    // Not cumulative: the pair must be on the same Hall of Fame team.
    expect(earnedFor([
      winningTeam(1, nightMons.slice(0, 1)),
      winningTeam(2, nightMons.slice(1, 2)),
    ]).has('night-owl')).toBe(false);

    // Similar but non-qualifying forms do not count.
    expect(earnedFor([winningTeam(1, [
      { name: 'Decidueye-Hisui', icon: 'decidueye-hisui', ko_count: null },
      { name: 'Lycanroc-Midday', icon: 'lycanroc-midday', ko_count: null },
    ])]).has('night-owl')).toBe(false);

    // Casual wins do not count.
    expect(earnedFor(
      [winningTeam(1, nightMons.slice(0, 2))],
      { validDraftIds: new Set() },
    ).has('night-owl')).toBe(false);
  });

  it('does not award win-based achievements for unfinished races', () => {
    const unfinished = team({ team_id: 1, draft_id: 'd1' });
    const battles: BossBattleHistoryEntry[] = [
      { trainer_id: 804, version: null, hours: 1, minutes: 0, seconds: 0, is_loss: true },
    ];
    const earned = earnedIds(baseContext({
      matchHistory: [unfinished],
      validDraftIds: new Set(['d1']),
      bossBattleHistory: new Map([[1, battles]]),
    }));
    expect(earned.has('blitz-hero')).toBe(false);
    expect(earned.has('artisan')).toBe(false);
    expect(earned.has('type-loyalist')).toBe(false);
  });
});
