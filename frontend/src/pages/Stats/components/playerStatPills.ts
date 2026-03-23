import { fetchPokemonList } from '../../../shared/api/pokemon';
import { Pokemon } from '../../../types';

export type PlayerStatPillTone = 'green' | 'gold' | 'rose' | 'blue' | 'purple' | 'orange' | 'indigo';

export interface PlayerPillPokemonSummary {
  key: string;
  name: string;
  form: string;
  games: number;
}

export interface PlayerStatPill {
  key: string;
  label: string;
  tone: PlayerStatPillTone;
  title: string;
}

type StatKey = 'hp' | 'attack' | 'defense' | 'spDefense' | 'spAttack' | 'speed';

interface StatArchetype {
  key: StatKey;
  label: string;
  tone: PlayerStatPillTone;
  tooltip: string;
}

const STAT_ARCHETYPES: StatArchetype[] = [
  {
    key: 'hp',
    label: 'Bulky Wall',
    tone: 'green',
    tooltip: 'A majority of your favorite pokemon specialize in HP.',
  },
  {
    key: 'defense',
    label: 'Physical Wall',
    tone: 'purple',
    tooltip: 'A majority of your favorite pokemon specialize in defense.',
  },
  {
    key: 'spDefense',
    label: 'Special Wall',
    tone: 'indigo',
    tooltip: 'A majority of your favorite pokemon specialize in special defense.',
  },
  {
    key: 'attack',
    label: 'Physical Attacker',
    tone: 'rose',
    tooltip: 'A majority of your favorite pokemon specialize in attack.',
  },
  {
    key: 'spAttack',
    label: 'Special Attacker',
    tone: 'orange',
    tooltip: 'A majority of your favorite pokemon specialize in special attack.',
  },
  {
    key: 'speed',
    label: 'Speed Control',
    tone: 'blue',
    tooltip: 'A majority of your favorite pokemon specialize in speed.',
  },
];

const DEFENSE_STATS: StatKey[] = ['hp', 'defense', 'spDefense'];

interface CompositeRule {
  key: string;
  label: string;
  tone: PlayerStatPillTone;
  tooltip: string;
  /** Returns the stats to consume if this composite matches, or null if it doesn't. */
  test: (winners: Set<StatKey>) => StatKey[] | null;
}

/**
 * Composite archetypes are checked first, ordered from most-specific to least.
 * A stat consumed by a composite will not generate an individual pill.
 */
const COMPOSITE_ARCHETYPES: CompositeRule[] = [
  {
    key: 'unbreakable-wall',
    label: 'Unbreakable Wall',
    tone: 'gold',
    tooltip: 'A majority of the pokemon you draft specialize in all forms of defense. You can take so many attacks!',
    test: (w) => {
      const hit = DEFENSE_STATS.filter((s) => w.has(s));
      return hit.length >= 2 ? hit : null;
    },
  },
  {
    key: 'hyper-offense',
    label: 'Hyper Offense',
    tone: 'gold',
    tooltip: 'A majority of the pokemon you draft specialize in attack and special attack. KO them before they KO you!',
    test: (w) => (w.has('attack') && w.has('spAttack') ? ['attack', 'spAttack'] : null),
  },
  {
    key: 'dragon-dancer',
    label: 'Dragon Dancer',
    tone: 'gold',
    tooltip: 'A majority of the pokemon you draft specialize in attack and speed. Hit hard and hit first!',
    test: (w) => (w.has('attack') && w.has('speed') ? ['attack', 'speed'] : null),
  },
  {
    key: 'quiver-dancer',
    label: 'Quiver Dancer',
    tone: 'gold',
    tooltip: 'A majority of the pokemon you draft specialize in special attack and speed. Blow them away with your dancing!',
    test: (w) => (w.has('spAttack') && w.has('speed') ? ['spAttack', 'speed'] : null),
  },
  {
    key: 'calm-mind',
    label: 'Calm Mind',
    tone: 'gold',
    tooltip: 'A majority of the pokemon you draft specialize in special attack and bulk. Break them down slowly!',
    test: (w) => {
      if (!w.has('spAttack')) return null;
      const def = DEFENSE_STATS.find((s) => w.has(s));
      return def ? ['spAttack', def] : null;
    },
  },
  {
    key: 'bulk-up',
    label: 'Bulk Up',
    tone: 'gold',
    tooltip: 'A majority of the pokemon you draft specialize in attack and bulk. Hit hard and take hits!',
    test: (w) => {
      if (!w.has('attack')) return null;
      const def = DEFENSE_STATS.find((s) => w.has(s));
      return def ? ['attack', def] : null;
    },
  },
];

// Module-level cache so the list is fetched at most once per page session.
let pokemonListPromise: Promise<Pokemon[]> | null = null;

function getCachedPokemonList(): Promise<Pokemon[]> {
  if (!pokemonListPromise) {
    pokemonListPromise = fetchPokemonList();
  }
  return pokemonListPromise;
}

function normalizeName(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

/** Keyed by "normalizedName::normalizedForm" for initial lookup of the drafted Pokémon. */
function buildNameLookup(list: Pokemon[]): Map<string, Pokemon> {
  const map = new Map<string, Pokemon>();
  for (const p of list) {
    map.set(`${normalizeName(p.name)}::${normalizeName(p.form)}`, p);
  }
  return map;
}

function lookupByName(
  map: Map<string, Pokemon>,
  name: string,
  form: string,
): Pokemon | undefined {
  return (
    map.get(`${normalizeName(name)}::${normalizeName(form)}`) ??
    map.get(`${normalizeName(name)}::`)
  );
}

/**
 * Maps "parentPokedexId::parentForm" → direct children (Mega forms excluded).
 * This mirrors the logic in CurrentPokemonPanel.tsx which matches:
 *   child.evolves_from_id === (parent.pokedex_id ?? parent.id)
 *   child.evolves_from_form === parent.form
 */
function buildChildrenMap(list: Pokemon[]): Map<string, Pokemon[]> {
  const map = new Map<string, Pokemon[]>();
  for (const p of list) {
    if (!p.evolves_from_id) continue;
    const form = (p.form ?? '').toLowerCase();
    if (form === 'mega' || form === 'mega x' || form === 'mega y') continue;

    const parentKey = `${p.evolves_from_id}::${p.evolves_from_form ?? ''}`;
    const bucket = map.get(parentKey);
    if (bucket) {
      bucket.push(p);
    } else {
      map.set(parentKey, [p]);
    }
  }
  return map;
}

/**
 * Recursively collects all leaf nodes (final evolutions) reachable from `pokemon`.
 * A visited set guards against cycles in malformed data.
 */
function getFinalEvolutions(
  pokemon: Pokemon,
  childrenMap: Map<string, Pokemon[]>,
  visited = new Set<number>(),
): Pokemon[] {
  const nodeId = pokemon.pokedex_id ?? pokemon.id;
  if (visited.has(nodeId)) return [];
  visited.add(nodeId);

  const childKey = `${nodeId}::${pokemon.form ?? ''}`;
  const children = childrenMap.get(childKey) ?? [];

  if (children.length === 0) {
    return [pokemon];
  }

  const result: Pokemon[] = [];
  for (const child of children) {
    result.push(...getFinalEvolutions(child, childrenMap, visited));
  }
  return result;
}

function getDominantStat(pokemon: Pokemon): StatKey | null {
  const s = pokemon.stats;
  if (!s) return null;

  const spAtk = s.sp_attack ?? s.specialAttack;
  const spDef = s.sp_defense ?? s.specialDefense;

  const values: Record<StatKey, number> = {
    hp: s.hp,
    attack: s.attack,
    defense: s.defense,
    spAttack: spAtk,
    spDefense: spDef,
    speed: s.speed,
  };

  let topKey: StatKey = 'hp';
  let topVal = -1;
  for (const [key, val] of Object.entries(values) as [StatKey, number][]) {
    if (val > topVal) {
      topVal = val;
      topKey = key;
    }
  }

  return topKey;
}

export async function getPlayerStatPills(
  pokemonSummary: PlayerPillPokemonSummary[],
): Promise<PlayerStatPill[]> {
  const top5 = pokemonSummary.slice(0, 5);
  if (top5.length === 0) return [];

  const list = await getCachedPokemonList();
  const nameLookup = buildNameLookup(list);
  const childrenMap = buildChildrenMap(list);

  const tally = new Map<StatKey, number>();

  for (const summary of top5) {
    const match = lookupByName(nameLookup, summary.name, summary.form);
    if (!match) continue;

    // Use final evolution(s) so base-form weak stats don't skew results.
    // Branching lines (e.g. Ralts → Gardevoir / Gallade) each contribute +1.
    const finals = getFinalEvolutions(match, childrenMap);
    for (const final of finals) {
      const dominant = getDominantStat(final);
      if (!dominant) continue;
      tally.set(dominant, (tally.get(dominant) ?? 0) + 1);
    }
  }

  if (tally.size === 0) return [];

  const maxCount = Math.max(...Array.from(tally.values()));

  const winners = new Set<StatKey>(
    Array.from(tally.entries())
      .filter(([, count]) => count === maxCount)
      .map(([key]) => key),
  );

  const claimed = new Set<StatKey>();
  const pills: PlayerStatPill[] = [];

  // Resolve composite patterns first (most-specific order).
  for (const composite of COMPOSITE_ARCHETYPES) {
    const unclaimed = new Set(Array.from(winners).filter((s) => !claimed.has(s)));
    const consumed = composite.test(unclaimed);
    if (consumed) {
      for (const s of consumed) claimed.add(s);
      pills.push({ key: composite.key, label: composite.label, tone: composite.tone, title: composite.tooltip });
    }
  }

  // Fall back to individual archetype pills for any unclaimed winning stats.
  for (const archetype of STAT_ARCHETYPES) {
    if (winners.has(archetype.key) && !claimed.has(archetype.key)) {
      pills.push({ key: archetype.key, label: archetype.label, tone: archetype.tone, title: archetype.tooltip });
    }
  }

  return pills;
}