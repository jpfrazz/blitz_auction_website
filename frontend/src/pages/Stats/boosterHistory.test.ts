import {
  averagePickNumber,
  boosterPickSlot,
  buildBoosterPickMap,
  buildBoosterPickStats,
  casualBoosterDraftIds,
  playedBoosterDraftIds,
} from './boosterHistory';

const boosterAuction = (draft_id: string, action: string, draft_order: number, name = 'Pikachu') =>
  ({ draft_id, draft_type: 'booster', action, draft_order, name, form: '' }) as any;

const boosterTeams = (draftId: string, count: number) =>
  Array.from({ length: count }, () => ({ draft_id: draftId }) as any);

describe('casualBoosterDraftIds', () => {
  test('team-8 boosters are competitive when every player has eight picks', () => {
    const auctions = [
      ...Array.from({ length: 24 }, (_, i) => boosterAuction('d8', 'PICK', i + 1)),
      boosterAuction('d8', 'LEFTOVER', 25),
    ];

    expect(casualBoosterDraftIds(auctions as any, boosterTeams('d8', 3))).toEqual(new Set());
  });

  test('four-player team-8 boosters use two circuits', () => {
    const auctions = [
      ...Array.from({ length: 32 }, (_, i) => boosterAuction('d4', 'PICK', i + 1)),
      boosterAuction('d4', 'LEFTOVER', 33),
    ];

    expect(casualBoosterDraftIds(auctions as any, boosterTeams('d4', 4))).toEqual(new Set());
  });

  test('team-9 boosters are casual from their later leftover order', () => {
    const auctions = [
      ...Array.from({ length: 27 }, (_, i) => boosterAuction('d9', 'PICK', i + 1)),
      boosterAuction('d9', 'LEFTOVER', 28),
    ];

    expect(casualBoosterDraftIds(auctions as any, boosterTeams('d9', 3))).toEqual(new Set(['d9']));
  });

  test('team-10 boosters are casual from leftover order or completed picks', () => {
    const withLeftovers = [
      ...Array.from({ length: 30 }, (_, i) => boosterAuction('d10', 'PICK', i + 1)),
      boosterAuction('d10', 'LEFTOVER', 31),
    ];
    const withoutLeftovers = Array.from({ length: 30 }, (_, i) =>
      boosterAuction('d10-no-leftover', 'PICK', i + 1),
    );
    const auctions = [...withLeftovers, ...withoutLeftovers];
    const teams = [
      ...boosterTeams('d10', 3),
      ...boosterTeams('d10-no-leftover', 3),
    ];

    expect(casualBoosterDraftIds(auctions as any, teams as any)).toEqual(
      new Set(['d10', 'd10-no-leftover']),
    );
  });

  test('an unfinished booster without leftovers is not treated as casual', () => {
    const auctions = Array.from({ length: 25 }, (_, i) => boosterAuction('partial', 'PICK', i + 1));

    expect(casualBoosterDraftIds(auctions as any, boosterTeams('partial', 3))).toEqual(new Set());
  });
});

describe('booster average pick tracking', () => {
  test('only positive booster PICK rows count as pick slots', () => {
    expect(boosterPickSlot(boosterAuction('draft', 'PICK', 7) as any)).toBe(7);
    expect(boosterPickSlot(boosterAuction('draft', 'BAN', -1) as any)).toBeNull();
    expect(boosterPickSlot(boosterAuction('draft', 'LEFTOVER', 25) as any)).toBeNull();
    expect(boosterPickSlot({ ...boosterAuction('draft', 'PICK', 2), draft_type: 'auction' } as any)).toBeNull();
  });

  test('builds per-Pokémon pick numbers and excludes casual/lookback drafts', () => {
    const auctions = [
      boosterAuction('played', 'PICK', 3, 'Pikachu'),
      boosterAuction('played', 'PICK', 9, 'Pikachu'),
      boosterAuction('played', 'BAN', -1, 'Pikachu'),
      boosterAuction('recent', 'PICK', 1, 'Pikachu'),
    ];
    const played = playedBoosterDraftIds(
      auctions as any,
      [
        { draft_id: 'played', has_save: true },
        { draft_id: 'recent', has_save: true },
      ] as any,
    );

    expect(played).toEqual(new Set(['played', 'recent']));
    expect(buildBoosterPickMap(auctions as any, played).get('Pikachu')).toEqual([3, 9, 1]);
    expect(buildBoosterPickMap(auctions as any, played, new Set(['recent'])).get('Pikachu')).toEqual([3, 9]);
    expect(averagePickNumber([3, 9])).toBe(6);
  });

  test('reports average and movement for a future cost breakdown column', () => {
    const current = buildBoosterPickMap([
      boosterAuction('played', 'PICK', 2, 'Pikachu'),
      boosterAuction('played', 'PICK', 6, 'Pikachu'),
    ] as any, new Set(['played']));
    const historic = buildBoosterPickMap([
      boosterAuction('old', 'PICK', 10, 'Pikachu'),
    ] as any, new Set(['old']));

    expect(buildBoosterPickStats(current, historic).get('Pikachu')).toEqual({
      average: 4,
      total: 2,
      movement: -6,
    });
  });
});
