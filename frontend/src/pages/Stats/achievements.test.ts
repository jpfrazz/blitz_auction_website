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
import { ACHIEVEMENT_DEFINITIONS, AchievementContext, computePlayerAchievements } from './achievements';

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

function wallyWin(): BossBattleHistoryEntry {
  return brainWin(656, 0);
}

function baseContext(overrides: Partial<AchievementContext> = {}): AchievementContext {
  return {
    player,
    identityIds: new Set(['player-1']),
    matchHistory: [],
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
    expect(ACHIEVEMENT_DEFINITIONS).toHaveLength(37);
    expect(new Set(ACHIEVEMENT_DEFINITIONS.map((achievement) => achievement.id)).size).toBe(37);
    expect(new Set(ACHIEVEMENT_DEFINITIONS.map((achievement) => achievement.icon)).size).toBe(37);
  });

  it('puts Stream Legend first, Early Bird last, and Sub-90 with the personal-best clubs', () => {
    expect(ACHIEVEMENT_DEFINITIONS[0].id).toBe('stream-legend');
    expect(ACHIEVEMENT_DEFINITIONS[ACHIEVEMENT_DEFINITIONS.length - 1].id).toBe('early-bird');

    const sub90 = ACHIEVEMENT_DEFINITIONS.find((achievement) => achievement.id === 'sub-90-club');
    expect(sub90).toEqual({
      id: 'sub-90-club',
      name: 'Sub-90 Club',
      description: 'Get a personal best time under 90 minutes',
      icon: 'Sub90.png',
    });
    expect(ACHIEVEMENT_DEFINITIONS.map((achievement) => achievement.id)).toEqual(
      expect.arrayContaining([
        'sub-90-club',
        'sub-80-club',
        'sub-70-club',
        'sub-hour-club',
      ]),
    );

    expect(ACHIEVEMENT_DEFINITIONS.find((achievement) => achievement.id === 'true-love')).toEqual({
      id: 'true-love',
      name: 'True Love',
      description: 'Play 10 races with another specific player',
      icon: 'TrueLove.png',
    });

    expect(ACHIEVEMENT_DEFINITIONS.find((achievement) => achievement.id === 'who-are-you')).toEqual({
      id: 'who-are-you',
      name: 'Who Are You?',
      description: 'Defeat Wally using 3 of his own Pokémon',
      icon: 'WhoAreYou.png',
    });

    expect(ACHIEVEMENT_DEFINITIONS.find((achievement) => achievement.id === 'pokemon-professor')).toEqual({
      id: 'pokemon-professor',
      name: 'Pokémon Professor',
      description: 'Win a race in which you draft a starter of all 3 types',
      icon: 'PokemonProfessor.png',
    });

    expect(ACHIEVEMENT_DEFINITIONS.find((achievement) => achievement.id === 'old-head')).toEqual({
      id: 'old-head',
      name: 'Old Head',
      description: 'Win a race in which you only use Pokémon from the original 151',
      icon: 'OldHead.png',
    });

    expect(ACHIEVEMENT_DEFINITIONS.find((achievement) => achievement.id === 'deathless')).toEqual({
      id: 'deathless',
      name: 'Deathless',
      description: 'Beat the game without any Pokémon fainting',
      icon: 'Deathless.png',
    });

    expect(ACHIEVEMENT_DEFINITIONS.find((achievement) => achievement.id === 'old-faithful')).toEqual({
      id: 'old-faithful',
      name: 'Old Faithful',
      description: 'Win 10 races with the same Pokémon',
      icon: 'OldFaithful.png',
    });

    expect(ACHIEVEMENT_DEFINITIONS.find((achievement) => achievement.id === 'impatient')).toEqual({
      id: 'impatient',
      name: 'Impatient',
      description: 'Spend $20,000 before an auction is halfway over',
      icon: 'Impatient.png',
    });

    expect(ACHIEVEMENT_DEFINITIONS.find((achievement) => achievement.id === 'rps-champion')).toEqual({
      id: 'rps-champion',
      name: 'RPS Champion',
      description: 'Win 10 rounds of Rock Paper Scissors',
      icon: 'RPSChampion.png',
    });

    const ids = ACHIEVEMENT_DEFINITIONS.map((achievement) => achievement.id);
    expect(ids.indexOf('impatient')).toBe(ids.indexOf('stingy') + 1);
    expect(ids.indexOf('sub-90-club')).toBe(ids.indexOf('impatient') + 1);
    expect(ids.indexOf('true-love')).toBe(ids.indexOf('25-club') + 1);
    expect(ids.indexOf('blitz-legend')).toBe(ids.indexOf('true-love') + 1);
    expect(ids.indexOf('who-are-you')).toBe(ids.indexOf('easy-as-pie') + 1);
    expect(ids.indexOf('the-chosen-one')).toBe(ids.indexOf('who-are-you') + 1);
    expect(ids.indexOf('pokemon-professor')).toBe(ids.indexOf('type-loyalist') + 1);
    expect(ids.indexOf('old-head')).toBe(ids.indexOf('pokemon-professor') + 1);
    expect(ids.indexOf('clutch-master')).toBe(ids.indexOf('old-head') + 1);
    expect(ids.indexOf('deathless')).toBe(ids.indexOf('clutch-master') + 1);
    expect(ids.indexOf('hard-carried')).toBe(ids.indexOf('deathless') + 1);
    expect(ids.indexOf('old-faithful')).toBe(ids.indexOf('hard-carried') + 1);
    expect(ids.indexOf('artisan')).toBe(ids.indexOf('old-faithful') + 1);
  });
});

describe('computePlayerAchievements', () => {
  it('finds non-casual races from March and April 2026', () => {
    const race = (created_at: string) =>
      team({ team_id: 1, draft_id: 'd1', created_at });
    const validDraftIds = new Set(['d1']);

    expect(earnedIds(baseContext({ matchHistory: [race('2026-03-02T12:00:00Z')], validDraftIds }))).toContain('early-bird');
    expect(earnedIds(baseContext({ matchHistory: [race('2026-04-30T12:00:00Z')], validDraftIds }))).toContain('early-bird');
    expect(earnedIds(baseContext({ matchHistory: [race('2026-05-01T12:00:00Z')], validDraftIds }))).not.toContain('early-bird');
    expect(earnedIds(baseContext({ matchHistory: [race('2026-03-02T12:00:00Z')] }))).not.toContain('early-bird');
  });

  it('awards the race-count clubs at their thresholds', () => {
    const races = (count: number) =>
      Array.from({ length: count }, (_, index) => team({ team_id: index, draft_id: `d${index}` }));
    const earnedFor = (count: number, valid = true) =>
      earnedIds(baseContext({
        matchHistory: races(count),
        validDraftIds: valid ? new Set(races(count).map((race) => race.draft_id)) : new Set(),
      }));

    expect(earnedFor(24).has('25-club')).toBe(false);
    expect(earnedFor(25).has('25-club')).toBe(true);
    expect(earnedFor(25).has('100-club')).toBe(false);

    expect(earnedFor(99).has('100-club')).toBe(false);
    expect(earnedFor(100).has('100-club')).toBe(true);
    expect(earnedFor(100).has('200-club')).toBe(false);

    expect(earnedFor(199).has('200-club')).toBe(false);
    expect(earnedFor(200).has('200-club')).toBe(true);

    // Casual drafts do not count, no matter how many were played.
    expect(earnedFor(200, false).has('25-club')).toBe(false);
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

  it('awards Speed Freak for a sub-2:30 first split in a valid draft without requiring a win', () => {
    // No Hall of Fame team and no champion win: the run was never completed.
    const race = team({ team_id: 1, draft_id: 'fast-draft' });
    const earnedFor = (battles: BossBattleHistoryEntry[], valid = true, draftType = 'auction') =>
      earnedIds(baseContext({
        matchHistory: [{ ...race, draft_type: draftType }],
        validDraftIds: valid ? new Set(['fast-draft']) : new Set(),
        bossBattleHistory: new Map([[1, battles]]),
      }));

    expect(earnedFor([gymWin(2 * 60 + 29)]).has('speed-freak')).toBe(true);
    expect(earnedFor([gymWin(2 * 60 + 30)]).has('speed-freak')).toBe(false);
    expect(earnedFor([gymWin(2 * 60 + 29)], false).has('speed-freak')).toBe(false);
    expect(earnedFor([gymWin(2 * 60 + 29)], true, '1v1').has('speed-freak')).toBe(false);
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
