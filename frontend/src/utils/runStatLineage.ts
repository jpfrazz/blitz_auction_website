import { fetchPokemonList } from '../shared/api/pokemon';
import type { Pokemon } from '../types';
import { SPECIES_BY_ID, SpeciesInfo } from './speciesIdMap';
import { getIconName } from './speciesUtils';

/**
 * The run summary keys stats by the MiniIcons name of the drafted pick, but a
 * stored save holds the species the mon is *now* (usually an evolution of what
 * was drafted). This maps a save species id to the icons of every species in
 * its evolution line so an evolved mon's turn/KO totals still land on the row
 * for the Pokémon that was actually drafted.
 */
export interface RunStatLineage {
  /** MiniIcons names for the species itself and all of its pre-evolutions. */
  getIcons(romSpeciesId: number): string[];
}

const NINCADA_DEX_ID = 290;

// These families can change form mid-run with an item (Burmy Binder / Rotom
// Catalog). The save stores whichever form the mon currently has, so a saved
// form has to map back to every drafted form of that species too.
const FORM_CHANGING_BASE_IDS = new Set([412, 413, 414, 479]);

let lineagePromise: Promise<RunStatLineage> | null = null;

export function buildRunStatLineage(list: Pokemon[]): RunStatLineage {
  const byDexId = new Map<number, Pokemon[]>();
  const byName = new Map<string, Pokemon[]>();

  for (const pokemon of list) {
    const dexId = Number(pokemon.pokedex_id ?? pokemon.id);
    if (Number.isInteger(dexId) && dexId > 0) {
      const bucket = byDexId.get(dexId) ?? [];
      bucket.push(pokemon);
      byDexId.set(dexId, bucket);
    }
    const nameKey = (pokemon.name ?? '').trim().toLowerCase();
    if (nameKey) {
      const bucket = byName.get(nameKey) ?? [];
      bucket.push(pokemon);
      byName.set(nameKey, bucket);
    }
  }

  // ROM form names are suffixed ("Wooper-Paldea") while the database keeps the
  // form in its own column ("Wooper" + "Paldea").
  const resolveDbEntry = (info: SpeciesInfo): Pokemon | undefined => {
    let name = info.name;
    const form = (info.form ?? '').trim().toLowerCase();
    if (form && name.toLowerCase().endsWith(`-${form}`)) {
      name = name.slice(0, -(form.length + 1));
    }

    const candidates = byName.get(name.trim().toLowerCase()) ?? [];
    if (candidates.length === 0) return undefined;
    if (form) {
      const exact = candidates.find(
        (candidate) => (candidate.form ?? '').trim().toLowerCase() === form
      );
      if (exact) return exact;
    }
    return candidates.find((candidate) => !(candidate.form ?? '').trim()) ?? candidates[0];
  };

  const iconForDbEntry = (pokemon: Pokemon): string => {
    const form = (pokemon.form ?? '').trim();
    return getIconName(form ? `${pokemon.name}-${form}` : pokemon.name);
  };

  const formFamilyIconsByBaseId = new Map<number, string[]>();
  for (const formInfo of Object.values(SPECIES_BY_ID)) {
    if (!FORM_CHANGING_BASE_IDS.has(formInfo.baseId)) continue;
    const icons = formFamilyIconsByBaseId.get(formInfo.baseId) ?? [];
    if (!icons.includes(formInfo.icon)) icons.push(formInfo.icon);
    formFamilyIconsByBaseId.set(formInfo.baseId, icons);
  }

  const cache = new Map<number, string[]>();

  const getIcons = (romSpeciesId: number): string[] => {
    const cached = cache.get(romSpeciesId);
    if (cached) return cached;

    const info = SPECIES_BY_ID[romSpeciesId];
    if (!info) {
      cache.set(romSpeciesId, []);
      return [];
    }

    const icons: string[] = [];
    const seenIcons = new Set<string>();
    const push = (icon: string) => {
      if (icon && !seenIcons.has(icon)) {
        seenIcons.add(icon);
        icons.push(icon);
      }
    };

    if (info?.icon) push(info.icon);

    let current = info ? resolveDbEntry(info) : undefined;
    const seenDexIds = new Set<number>();
    while (current) {
      const dexId = Number(current.pokedex_id ?? current.id);
      if (Number.isInteger(dexId) && dexId > 0) {
        if (seenDexIds.has(dexId)) break;
        seenDexIds.add(dexId);
      }

      push(iconForDbEntry(current));

      let parentId = current.evolves_from_id
        ? Number(current.evolves_from_id)
        : Number.NaN;
      // Shedinja is created alongside Ninjask from Nincada; a few datasets
      // leave its parent blank. Seed it so the split still resolves.
      if (!Number.isInteger(parentId) && iconForDbEntry(current) === 'shedinja') {
        parentId = NINCADA_DEX_ID;
      }
      if (!Number.isInteger(parentId) || parentId <= 0) break;

      const candidates = byDexId.get(parentId) ?? [];
      const parentForm = (current.evolves_from_form ?? '').trim().toLowerCase();
      current =
        (parentForm
          ? candidates.find(
              (candidate) => (candidate.form ?? '').trim().toLowerCase() === parentForm
            )
          : undefined) ??
        candidates.find((candidate) => !(candidate.form ?? '').trim()) ??
        candidates[0];
    }

    for (const icon of formFamilyIconsByBaseId.get(info.baseId) ?? []) {
      push(icon);
    }

    const result = icons.length > 0 ? icons : [getIconName(info.name, romSpeciesId)];
    cache.set(romSpeciesId, result);
    return result;
  };

  return { getIcons };
}

/** Fetches the species catalog once per page session. */
export function getRunStatLineage(): Promise<RunStatLineage> {
  if (!lineagePromise) {
    lineagePromise = fetchPokemonList()
      .then(buildRunStatLineage)
      .catch((error) => {
        lineagePromise = null;
        throw error;
      });
  }
  return lineagePromise;
}
