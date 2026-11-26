import {
  BoosterHistoryEntry,
  BoosterPackState,
  BoosterPoolSlot,
  BoosterSlotStatus,
  Pokemon,
} from '../../types';

type SlotActor = {
  actor: string | null;
  kind: 'pick' | 'ban' | 'leftover' | 'available';
};

function pokemonKey(pokemon: Pick<Pokemon, 'pokedex_id' | 'form'>): string {
  return `${pokemon.pokedex_id}-${pokemon.form ?? ''}`;
}

/**
 * Label each pack's picks and bans separately in the order they happened.
 * Leftovers are not actions and other packs do not affect the count, so a
 * pack's second pick is p2 and its first ban is b1 even if other packs acted
 * in between. Current-pass choices are hidden from history until the whole
 * table submits, so the viewer's own pending slots are counted as well.
 */
export function boosterActionBadgeByPokemon(
  history: BoosterHistoryEntry[],
  slots: BoosterPoolSlot[],
  packIndex: number,
): Map<string, string> {
  const badgeByPokemon = new Map<string, string>();
  const seen = new Set<string>();
  const counts = { Pick: 0, Ban: 0 };

  const record = (action: 'Pick' | 'Ban', pokemon: Pick<Pokemon, 'pokedex_id' | 'form'>): void => {
    const key = pokemonKey(pokemon);
    if (seen.has(key)) return;
    seen.add(key);
    counts[action] += 1;
    badgeByPokemon.set(key, `${action === 'Pick' ? 'p' : 'b'}${counts[action]}`);
  };

  for (const entry of history) {
    if (entry.pack_index !== packIndex || entry.action === 'Leftover') continue;
    record(entry.action, entry.pokemon);
  }

  for (const slot of slots) {
    const { kind } = statusActor(slot.status);
    if (kind === 'pick') record('Pick', slot.pokemon);
    if (kind === 'ban') record('Ban', slot.pokemon);
  }

  return badgeByPokemon;
}

function statusActor(status: BoosterSlotStatus): SlotActor {
  if (typeof status === 'object' && status !== null) {
    if ('Picked' in status) return { actor: status.Picked, kind: 'pick' };
    if ('Banned' in status) return { actor: status.Banned, kind: 'ban' };
  }
  if (status === 'Leftover') return { actor: null, kind: 'leftover' };
  return { actor: null, kind: 'available' };
}

/**
 * Order packs by how many passes until the viewer holds each one. The viewer's
 * own pack is first, the pack they receive next is second, and the pack they
 * just passed sits at the bottom. Spectators keep the engine's pack order.
 */
export function orderPacksForViewer(
  packs: BoosterPackState[],
  playerIds: string[],
  viewerId: string | null,
): BoosterPackState[] {
  const viewerSeat = playerIds.indexOf(viewerId ?? '');
  if (viewerSeat < 0 || playerIds.length === 0) {
    return [...packs].sort((a, b) => a.pack_index - b.pack_index);
  }

  const passesUntilHeld = (pack: BoosterPackState): number => {
    const holderSeat = playerIds.indexOf(pack.holder_id);
    if (holderSeat < 0) return Number.MAX_SAFE_INTEGER;
    return (viewerSeat - holderSeat + playerIds.length) % playerIds.length;
  };

  return [...packs].sort((a, b) =>
    passesUntilHeld(a) - passesUntilHeld(b) || a.pack_index - b.pack_index,
  );
}

function historyOrder(
  slot: BoosterPoolSlot,
  history: BoosterHistoryEntry[],
  packIndex: number,
  action: BoosterHistoryEntry['action'],
  actor: string | null,
): number {
  const key = pokemonKey(slot.pokemon);
  let index = history.findIndex((entry) =>
    entry.pack_index === packIndex &&
    entry.action === action &&
    pokemonKey(entry.pokemon) === key &&
    (actor === null || entry.player_id === actor),
  );
  if (index < 0) {
    index = history.findIndex((entry) =>
      entry.pack_index === packIndex && pokemonKey(entry.pokemon) === key,
    );
  }
  return index < 0 ? Number.MAX_SAFE_INTEGER : index;
}

/**
 * Slots are grouped so the pack always reads from useful to spent: available
 * cards first, then picks, then bans, and finally leftovers. Within a group,
 * picks and bans keep the order they were taken in.
 */
export function orderSlotsForHolder(
  slots: BoosterPoolSlot[],
  history: BoosterHistoryEntry[],
  _playerIds: string[],
  _holderId: string,
  packIndex: number,
): BoosterPoolSlot[] {
  const section = (slot: BoosterPoolSlot): number => {
    const { kind } = statusActor(slot.status);
    if (kind === 'available') return 0;
    if (kind === 'pick') return 1;
    if (kind === 'ban') return 2;
    return 3;
  };

  return [...slots].sort((a, b) => {
    const sectionA = section(a);
    const sectionB = section(b);
    if (sectionA !== sectionB) return sectionA - sectionB;

    if (sectionA === 0) {
      const dexA = a.pokemon.pokedex_id ?? Number.MAX_SAFE_INTEGER;
      const dexB = b.pokemon.pokedex_id ?? Number.MAX_SAFE_INTEGER;
      return dexA - dexB || a.pokemon.name.localeCompare(b.pokemon.name);
    }

    const { actor, kind } = statusActor(a.status);
    const action: BoosterHistoryEntry['action'] =
      kind === 'pick' ? 'Pick' : kind === 'ban' ? 'Ban' : 'Leftover';
    return (
      historyOrder(a, history, packIndex, action, actor) -
      historyOrder(b, history, packIndex, action, actor)
    );
  });
}
