import { SPECIES_BY_ID } from './speciesIdMap';

/** Pokémon available in the rental pool. Keep in sync with the tier list UI. */
export const RENTAL_POOL = [
  'Absol', 'Drampa', 'Falinks', 'Hawlucha', 'Heracross', 'Kangaskhan', 'Pinsir', 'Skarmory',
  'Alomomola', 'Bombirdier', 'Bouffalant', 'Carnivine', 'Comfey', 'Cryogonal', 'Dhelmise',
  'Durant', 'Heatmor', 'Lapras', 'Miltank', 'Mimikyu', 'Relicanth', 'Seviper',
  'Stonjourner', 'Stunfisk', 'Togedemaru', 'Torkoal', 'Tropius', 'Turtonator', 'Zangoose',
];

function normalizeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

const RENTAL_POOL_NAMES = new Set(RENTAL_POOL.map(normalizeName));

/** Hall-of-Fame names/icons are normalized before checking against the pool. */
export function isRentalPokemonName(value: string | null | undefined): boolean {
  if (!value) return false;
  return RENTAL_POOL_NAMES.has(normalizeName(value));
}

/**
 * Every ROM species ID belonging to a rental-pool species, including forms.
 * `SPECIES_BY_ID` keys are the game's species constants (forms included), and
 * `baseId` collapses those forms back to one species. Matching by `baseId`'s
 * name means e.g. every Mimikyu form is recognized as a rental even though only
 * "Mimikyu-Disguised"/"Mimikyu-Busted" appear in the species table.
 */
const RENTAL_SPECIES_IDS: Set<number> = (() => {
  const ids = new Set<number>();
  for (const [rawId, info] of Object.entries(SPECIES_BY_ID)) {
    const speciesId = Number(rawId);
    const baseName = normalizeName(info.name.split('-')[0]);
    if (RENTAL_POOL_NAMES.has(baseName)) {
      ids.add(speciesId);
      ids.add(info.baseId);
    }
  }
  return ids;
})();

/** True when a species ID belongs to a rental-pool Pokémon. */
export function isRentalSpeciesId(speciesId: number | null | undefined): boolean {
  return speciesId != null && RENTAL_SPECIES_IDS.has(speciesId);
}
