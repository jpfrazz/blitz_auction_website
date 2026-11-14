import { Pokemon } from '../../../types';
import index from './tcgArtIndex.json';

const artByName: Record<string, string | string[]> = index;
const regionalForms: Record<string, string> = {
  alola: 'alolan', galar: 'galarian', hisui: 'hisuian', paldea: 'paldean',
};

function slug(value: string): string {
  return value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function getTcgArt(pokemon: Pokemon, seed: number): string | undefined {
  const name = slug(pokemon.name.replace(/\s*\(.*\)\s*/, ''));
  const form = slug(pokemon.form || '');
  const prefix = regionalForms[form];
  const key = !form || form === 'base' || form === 'normal' ? name : prefix ? `${prefix}-${name}` : `${name}-${form}`;
  const choices = artByName[key];
  if (!Array.isArray(choices)) return choices;
  let hash = seed;
  for (const character of key) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return choices[(hash >>> 0) % choices.length];
}