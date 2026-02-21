import React, { useEffect, useMemo, useState } from 'react';
import Header from '../../shared/components/Header';
import Footer from '../../shared/components/Footer';
import { fetchPokemonList } from '../../shared/api/pokemon';
import { Auction, Pokemon } from '../../types';
import AllPokemonTab from '../Auction/components/PokemonTablePanel/AllPokemonTab';
import './Pokedex.scss';

const Pokedex: React.FC = () => {
  const [pokemon, setPokemon] = useState<Pokemon[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchPokemonList()
      .then(setPokemon)
      .catch(error => console.error('Error fetching pokemon list:', error))
      .finally(() => setLoading(false));
  }, []);

  const auctions = useMemo<Auction[]>(() => [], []);

  return (
    <>
      <Header />
      <main
        className="pokedex-main"
        style={{ padding: '7.5rem 16px 0' }}
      >
        {loading ? (
          <div>Loading Pokédex...</div>
        ) : (
          <AllPokemonTab pokemon={pokemon} auctions={auctions} />
        )}
      </main>
    </>
  );
};

export default Pokedex;
