import { getShuffleIcon } from './shuffleIcons';
import { Pokemon } from '../../../types';

const pokemon = (pokedex_id: number, name: string, form?: string): Pokemon => ({
  id: pokedex_id,
  pokedex_id,
  name,
  ...(form ? { form } : {}),
} as Pokemon);

test('maps generations 1-7 by pokedex number', () => {
  expect(getShuffleIcon(pokemon(25, 'Pikachu'))).toBe('/ShuffleIcons/Shuffle025.png');
  expect(getShuffleIcon(pokemon(1, 'Bulbasaur'))).toBe('/ShuffleIcons/Shuffle001.png');
});

test('maps generations 8-9 by name through the generated index', () => {
  expect(getShuffleIcon(pokemon(824, 'Blipbug'))).toBe('/ShuffleIcons/Blipbug.png');
  expect(getShuffleIcon(pokemon(979, 'Annihilape'))).toBe('/ShuffleIcons/anihilape.png');
  expect(getShuffleIcon(pokemon(1019, 'Hydrapple'))).toBe(
    '/ShuffleIcons/Hydrapple2.png',
  );
});

test('uses Alolan form art for every Alolan form in the pool', () => {
  for (const dex of [26, 27, 28, 37, 38, 103, 105]) {
    expect(getShuffleIcon(pokemon(dex, 'Alolan', 'Alola'))).toBe(
      `/ShuffleIcons/Shuffle${String(dex).padStart(3, '0')}A.png`,
    );
  }
  expect(getShuffleIcon(pokemon(37, 'Vulpix'))).toBe('/ShuffleIcons/Shuffle037.png');
});

test('uses form-specific art without falling back to the base form', () => {
  expect(getShuffleIcon(pokemon(83, "Farfetch'd", 'Galar'))).toBe(
    '/ShuffleIcons/G%20-%20Farfetchd.png',
  );
  expect(getShuffleIcon(pokemon(263, 'Zigzagoon', 'Galar'))).toBe(
    '/ShuffleIcons/G%20-%20Zigzagoon.png',
  );
  expect(getShuffleIcon(pokemon(902, 'Basculegion-F', 'F'))).toBe(
    '/ShuffleIcons/Basculegion%20Fe.png',
  );
  expect(getShuffleIcon(pokemon(80, 'Slowbro', 'Galar'))).toBeUndefined();
  expect(getShuffleIcon(pokemon(6, 'Charizard', 'Mega X'))).toBeUndefined();
});

test('has no icon for entries outside the index', () => {
  expect(getShuffleIcon(pokemon(65536, 'Egg'))).toBeUndefined();
  expect(getShuffleIcon({ id: 0, name: 'Unknown' } as Pokemon)).toBeUndefined();
});
