import {
  boosterActionBadgeByPokemon,
  orderPacksForViewer,
  orderSlotsForHolder,
} from './boosterPackOrder';

const pack = (packIndex: number, holderId: string) => ({
  pack_index: packIndex,
  owner_id: `owner-${packIndex}`,
  holder_id: holderId,
  slots: [],
}) as any;

const slot = (pokedexId: number, status: any) => ({
  pokemon: { pokedex_id: pokedexId, name: `Mon${pokedexId}`, form: '' },
  status,
}) as any;

describe('orderPacksForViewer', () => {
  const players = ['p1', 'p2', 'p3'];

  test('puts your pack first and the pack you receive next second', () => {
    const packs = [pack(0, 'p1'), pack(1, 'p2'), pack(2, 'p3')];
    expect(orderPacksForViewer(packs, players, 'p2').map((p) => p.pack_index)).toEqual([1, 0, 2]);
  });

  test('moves the pack you just passed to the bottom', () => {
    const packs = [pack(0, 'p3'), pack(1, 'p1'), pack(2, 'p2')];
    expect(orderPacksForViewer(packs, players, 'p2').map((p) => p.pack_index)).toEqual([2, 1, 0]);
  });

  test('spectators keep engine order', () => {
    const packs = [pack(0, 'p1'), pack(1, 'p2'), pack(2, 'p3')];
    expect(orderPacksForViewer(packs, players, null).map((p) => p.pack_index)).toEqual([0, 1, 2]);
  });
});

describe('orderSlotsForHolder', () => {
  const players = ['p1', 'p2', 'p3'];

  test('puts available first, then picks, then bans, then leftovers', () => {
    const slots = [
      slot(4, { Picked: 'p2' }),
      slot(1, { Picked: 'p1' }),
      slot(2, { Picked: 'p3' }),
      slot(3, 'Available'),
      slot(5, { Banned: 'p2' }),
      slot(6, { Banned: 'p1' }),
      slot(7, 'Leftover'),
    ];
    const history = [
      { pack_index: 0, action: 'Pick', player_id: 'p2', pokemon: slots[0].pokemon },
      { pack_index: 0, action: 'Pick', player_id: 'p1', pokemon: slots[1].pokemon },
      { pack_index: 0, action: 'Pick', player_id: 'p3', pokemon: slots[2].pokemon },
      { pack_index: 0, action: 'Ban', player_id: 'p2', pokemon: slots[4].pokemon },
      { pack_index: 0, action: 'Ban', player_id: 'p1', pokemon: slots[5].pokemon },
    ] as any;

    expect(orderSlotsForHolder(slots, history, players, 'p2', 0).map((s) => s.pokemon.pokedex_id))
      .toEqual([3, 4, 1, 2, 5, 6, 7]);
  });

  test('uses history order as the tie-break inside a section', () => {
    const first = slot(20, { Picked: 'p2' });
    const second = slot(10, { Picked: 'p2' });
    const history = [
      { pack_index: 2, action: 'Pick', player_id: 'p2', pokemon: first.pokemon },
      { pack_index: 2, action: 'Pick', player_id: 'p2', pokemon: second.pokemon },
    ] as any;

    expect(orderSlotsForHolder([second, first], history, players, 'p2', 2).map((s) => s.pokemon.pokedex_id))
      .toEqual([20, 10]);
  });
});

describe('boosterActionBadgeByPokemon', () => {
  test('counts picks and bans separately per pack while ignoring leftovers and other packs', () => {
    const history = [
      { pack_index: 1, action: 'Pick', pokemon: { pokedex_id: 1, form: '' } },
      { pack_index: 0, action: 'Ban', pokemon: { pokedex_id: 2, form: '' } },
      { pack_index: 1, action: 'Ban', pokemon: { pokedex_id: 3, form: '' } },
      { pack_index: 1, action: 'Leftover', pokemon: { pokedex_id: 4, form: '' } },
      { pack_index: 1, action: 'Pick', pokemon: { pokedex_id: 5, form: '' } },
    ] as any;

    expect(boosterActionBadgeByPokemon(history, [], 1)).toEqual(new Map([
      ['1-', 'p1'],
      ['3-', 'b1'],
      ['5-', 'p2'],
    ]));
  });

  test('counts the viewer\'s pending slots before the pass is revealed', () => {
    const history = [
      { pack_index: 0, action: 'Pick', pokemon: { pokedex_id: 1, form: '' } },
    ] as any;
    const slots = [
      slot(2, { Picked: 'p1' }),
      slot(3, { Banned: 'p1' }),
    ];

    expect(boosterActionBadgeByPokemon(history, slots, 0)).toEqual(new Map([
      ['1-', 'p1'],
      ['2-', 'p2'],
      ['3-', 'b1'],
    ]));
  });

  test('supports action numbers beyond a single digit', () => {
    const history = Array.from({ length: 12 }, (_, index) => ({
      pack_index: 0,
      action: index % 2 === 0 ? 'Pick' : 'Ban',
      pokemon: { pokedex_id: index + 1, form: '' },
    })) as any;
    const badges = boosterActionBadgeByPokemon(history, [], 0);

    expect(badges.get('11-')).toBe('p6');
    expect(badges.get('12-')).toBe('b6');
  });
});
