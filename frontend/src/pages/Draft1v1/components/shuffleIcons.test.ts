import { getShuffleIcon } from './shuffleIcons';
import { Pokemon } from '../../../types';

const pokemon = (pokedex_id: number, name: string, form?: string): Pokemon => ({
  id: pokedex_id,
  pokedex_id,
  name,
  ...(form ? { form } : {}),
} as Pokemon);

test('maps generations 1-7 by pokedex number', () => {
  expect(getShuffleIcon(pokemon(25, 'Pikachu'))).toBe('/Pokemon%20Shuffle%20Icons/Shuffle025.png');
  expect(getShuffleIcon(pokemon(1, 'Bulbasaur'))).toBe('/Pokemon%20Shuffle%20Icons/Shuffle001.png');
});

test('maps generations 8-9 by name through the generated index', () => {
  expect(getShuffleIcon(pokemon(824, 'Blipbug'))).toBe('/Pokemon%20Shuffle%20Icons/Blipbug.png');
  expect(getShuffleIcon(pokemon(979, 'Annihilape'))).toBe('/Pokemon%20Shuffle%20Icons/anihilape.png');
  expect(getShuffleIcon(pokemon(1019, 'Hydrapple'))).toBe(
    '/Pokemon%20Shuffle%20Icons/Hydrapple2.png',
  );
});

test('uses form-specific art without falling back to the base form', () => {
  expect(getShuffleIcon(pokemon(83, "Farfetch'd", 'Galar'))).toBe(
    '/Pokemon%20Shuffle%20Icons/G%20-%20Farfetchd.png',
  );
  expect(getShuffleIcon(pokemon(263, 'Zigzagoon', 'Galar'))).toBe(
    '/Pokemon%20Shuffle%20Icons/G%20-%20Zigzagoon.png',
  );
  expect(getShuffleIcon(pokemon(902, 'Basculegion-F', 'F'))).toBe(
    '/Pokemon%20Shuffle%20Icons/Basculegion%20Fe.png',
  );
  expect(getShuffleIcon(pokemon(80, 'Slowbro', 'Galar'))).toBeUndefined();
  expect(getShuffleIcon(pokemon(6, 'Charizard', 'Mega X'))).toBeUndefined();
});

test('has no icon for entries outside the index', () => {
  expect(getShuffleIcon(pokemon(65536, 'Egg'))).toBeUndefined();
  expect(getShuffleIcon({ id: 0, name: 'Unknown' } as Pokemon)).toBeUndefined();
});
