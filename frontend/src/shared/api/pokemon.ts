import axios from 'axios';
import { Pokemon } from '../../types';

export async function fetchPokemonList(): Promise<Pokemon[]> {
  const response = await axios.get('/api/pokemon');

  return response.data.map((pokemon: any) => ({
    ...pokemon,
    id: pokemon.pokedex_id,
  }));
}
