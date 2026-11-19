import { Pokemon } from '../../../types';
import index from './shuffleIconIndex.json';

const iconByDex: Record<string, string> = index;
const ROOT = '/Pokemon%20Shuffle%20Icons/';

/**
 * Resolves a pool entry to a Shuffle icon URL.
 *
 * The website identifies Pokémon by pokedex number, while the local gen 8-9
 * folder is named by Pokémon name; shuffleIconIndex.json bridges the two.
 * A Pokémon with a form never reuses its base icon, so entries without a
 * matching form return undefined and fall back to standard art rather than
 * showing the wrong form.
 */
export function getShuffleIcon(pokemon: Pokemon): string | undefined {
  const dex = pokemon.pokedex_id ?? pokemon.id;
  if (!dex) return undefined;

  const form = (pokemon.form || '').trim();
  const key = form ? `${dex}|${form}` : String(dex);
  const filename = iconByDex[key];
  if (!filename) return undefined;

  return `${ROOT}${encodeURIComponent(filename)}`;
}
