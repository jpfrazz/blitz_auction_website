import React, { useEffect, useMemo, useState } from 'react';
import Header from '../../shared/components/Header';
import { fetchPokemonList, fetchRentalPokemonList } from '../../shared/api/pokemon';
import { Auction, Pokemon } from '../../types';
import AllPokemonTab from '../Auction/components/PokemonTablePanel/AllPokemonTab';
import './Pokedex.scss';

const Pokedex: React.FC = () => {
  const [pokemon, setPokemon] = useState<Pokemon[]>([]);
  const [rentalPokemon, setRentalPokemon] = useState<Pokemon[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'all' | 'rental'>('all');

  useEffect(() => {
    Promise.all([
      fetchPokemonList(),
      fetchRentalPokemonList()
    ])
      .then(([allPokemon, rental]) => {
        setPokemon(allPokemon);
        setRentalPokemon(rental);
      })
      .catch(error => console.error('Error fetching pokemon lists:', error))
      .finally(() => setLoading(false));
  }, []);

  const auctions = useMemo<Auction[]>(() => [], []);

  return (
    <>
      <Header />
      <main
        className="pokedex-main"
        style={{ padding: '7.5rem 16px 1rem' }}
      >
        {loading ? (
          <div>Loading Pokédex...</div>
        ) : (
          <div className="pokedex-layout">
            <div className="tabs">
              <button
                className={`tab-button ${activeTab === 'all' ? 'active' : ''}`}
                onClick={() => setActiveTab('all')}
              >
                All Pokémon
              </button>
              <button
                className={`tab-button ${activeTab === 'rental' ? 'active' : ''}`}
                onClick={() => setActiveTab('rental')}
              >
                Rental Pokémon
              </button>
            </div>
            <div className="pokedex-content">
              {activeTab === 'all' && <AllPokemonTab pokemon={pokemon} auctions={auctions} isPokedex={true} />}
              {activeTab === 'rental' && (
                <AllPokemonTab pokemon={rentalPokemon} auctions={auctions} isPokedex={true} />
              )}
            </div>
          </div>
        )}
      </main>
    </>
  );
};

export default Pokedex;
