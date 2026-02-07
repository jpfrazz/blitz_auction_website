
// Stub for fetching Pokémon from backend
// This will be replaced with a real API call
import { Pokemon } from '../../types';

export async function fetchPokemonList(): Promise<Pokemon[]> {
  // Return a stubbed list with only the properties on the Pokemon type
  return [
    {
      id: 1,
      name: 'Bulbasaur',
      type1: 'Grass',
      type2: 'Poison',
      ability: 'Overgrow',
      stats: {
        hp: 45,
        attack: 49,
        defense: 49,
        specialAttack: 65,
        specialDefense: 65,
        speed: 45,
      },
      description: 'A strange seed was planted on its back at birth. The plant sprouts and grows with this Pokémon.',
    },
    {
      id: 4,
      name: 'Charmander',
      type1: 'Fire',
      ability: 'Blaze',
      stats: {
        hp: 39,
        attack: 52,
        defense: 43,
        specialAttack: 60,
        specialDefense: 50,
        speed: 65,
      },
      description: 'Obviously prefers hot places. When it rains, steam is said to spout from the tip of its tail.',
    },
    {
      id: 7,
      name: 'Squirtle',
      type1: 'Water',
      ability: 'Torrent',
      stats: {
        hp: 44,
        attack: 48,
        defense: 65,
        specialAttack: 50,
        specialDefense: 64,
        speed: 43,
      },
      description: 'After birth, its back swells and hardens into a shell. Powerfully sprays foam from its mouth.',
    },
    {
      id: 25,
      name: 'Pichu',
      type1: 'Electric',
      ability: 'Static',
      stats: {
        hp: 20,
        attack: 40,
        defense: 15,
        specialAttack: 35,
        specialDefense: 35,
        speed: 60,
      },
      description: 'Despite its small size, it can zap even adult humans. However, if it does so, it also surprises itself.',
    },
    {
      id: 133,
      name: 'Eevee',
      type1: 'Normal',
      ability: 'Run Away',
      stats: {
        hp: 55,
        attack: 55,
        defense: 50,
        specialAttack: 45,
        specialDefense: 65,
        speed: 200,
      },
      description: 'Its genetic code is irregular. It may mutate if it is exposed to radiation from element stones.',
    },
  ];
}
