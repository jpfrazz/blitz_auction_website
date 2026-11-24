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
