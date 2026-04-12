import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import Select, { MultiValue, ActionMeta } from 'react-select';
import Header from '../../shared/components/Header';
import Footer from '../../shared/components/Footer';
import TeamPlannerTab from '../Auction/components/PokemonTablePanel/TeamPlannerTab';
import { Pokemon, Team } from '../../types';
import { fetchPokemonList } from '../../shared/api/pokemon';
import './TeamPlanner.scss';

type PokemonOption = {
  value: string;
  label: string;
  pokemon: Pokemon;
};

const TeamPlanner = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [allPokemon, setAllPokemon] = useState<Pokemon[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [minimizedPokemon, setMinimizedPokemon] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetchPokemonList()
      .then(setAllPokemon)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const baseFormPokemon = useMemo(() => 
    allPokemon.filter((p) => !p.stage || p.stage === 'base'),
    [allPokemon]
  );

  const pokemonOptions: PokemonOption[] = useMemo(() => 
    baseFormPokemon.map(p => ({
      value: p.name.toLowerCase(),
      label: p.name,
      pokemon: p,
    })),
    [baseFormPokemon]
  );

  const selectedPokemon: PokemonOption[] = useMemo(() => {
    const urlPokemonNames = searchParams.getAll('pokemon');
    return urlPokemonNames
      .map(name => pokemonOptions.find(o => o.value === name))
      .filter((o): o is PokemonOption => o !== undefined);
  }, [searchParams, pokemonOptions]);

  const handleOpenModal = () => setModalOpen(true);

  const handleCloseModal = () => setModalOpen(false);

  const handleSelectChange = (
    newValue: MultiValue<PokemonOption>,
    _actionMeta: ActionMeta<PokemonOption>
  ) => {
    const params = new URLSearchParams();
    newValue.forEach(o => params.append('pokemon', o.value));
    setSearchParams(params);
  };

  const handleToggleMinimize = useCallback((pokemonName: string) => {
    setMinimizedPokemon(prev => {
      const next = new Set(prev);
      if (next.has(pokemonName)) next.delete(pokemonName);
      else next.add(pokemonName);
      return next;
    });
  }, []);

  const soloTeam: Team[] = [
    {
      user_id: 'solo-user',
      username: 'Solo',
      budget_remaining: 0,
      auctions_won: selectedPokemon.map(o => o.pokemon),
    },
  ];

  return (
    <div className="teamplanner-page">
      <Header />
      <main className="teamplanner-main">
        <div className="teamplanner-card" style={{ maxWidth: '1250px', margin: '0 auto', width: 'calc(100% - 2rem)', boxSizing: 'border-box' }}>
          <h1 className="teamplanner-title">Team Planner</h1>
          {loading ? (
            <p className="teamplanner-loading">Loading Pokémon...</p>
          ) : (
            <button className="button teamplanner-add-btn" onClick={handleOpenModal}>
              {selectedPokemon.length > 0 ? 'Edit Team' : 'Add Pokémon'}
            </button>
          )}

          {!loading && (
            <section className="teamplanner-team-section">
              <h2 className="teamplanner-team-subtitle">Your Team ({selectedPokemon.length})</h2>
              <TeamPlannerTab 
                teams={soloTeam} 
                currentUserId="solo-user" 
                allPokemon={allPokemon} 
                minimizedPokemon={minimizedPokemon}
                onToggleMinimize={handleToggleMinimize}
              />
            </section>
          )}
        </div>
      </main>

      {modalOpen && (
        <div className="teamplanner-modal-overlay" onClick={handleCloseModal}>
          <div className="teamplanner-modal-content" onClick={e => e.stopPropagation()}>
            <button
              className="teamplanner-modal-close"
              onClick={handleCloseModal}
              aria-label="Close"
              type="button"
            >
              &times;
            </button>
            <h2 className="teamplanner-modal-title">Select Pokémon</h2>
            <label className="teamplanner-modal-label">
              Choose your Pokémon team:
            </label>
            <Select
              options={pokemonOptions}
              isMulti
              closeMenuOnSelect={false}
              value={selectedPokemon}
              onChange={handleSelectChange}
              placeholder="Search Pokémon..."
              menuPortalTarget={document.body}
              menuPosition="fixed"
              styles={{
                menuPortal: (base) => ({ ...base, zIndex: 9999 }),
                control: (base) => ({
                  ...base,
                  background: '#131415',
                  color: '#f1f1f1',
                  borderColor: '#2a2d31',
                  borderRadius: 6,
                  minHeight: '48px',
                  fontSize: '1.08rem',
                  boxShadow: 'none',
                  '&:hover': { borderColor: '#7CB946' },
                }),
                menu: (base) => ({
                  ...base,
                  background: '#26282b',
                  color: '#f1f1f1',
                  border: '1px solid #2a2d31',
                  fontSize: '1.05rem',
                }),
                multiValue: (base) => ({
                  ...base,
                  background: '#2a2d31',
                }),
                multiValueLabel: (base) => ({
                  ...base,
                  color: '#f1f1f1',
                  fontSize: '1rem',
                }),
                multiValueRemove: (base) => ({
                  ...base,
                  color: '#b0b0b0',
                  '&:hover': { background: '#7CB946', color: '#111' },
                }),
                option: (base, state) => ({
                  ...base,
                  background: state.isSelected
                    ? '#7CB946'
                    : state.isFocused
                    ? '#2a2d31'
                    : '#26282b',
                  color: state.isSelected ? '#111' : '#f1f1f1',
                  cursor: 'pointer',
                  fontSize: '1.05rem',
                }),
                input: (base) => ({
                  ...base,
                  color: '#f1f1f1',
                  fontSize: '1.08rem',
                }),
                placeholder: (base) => ({
                  ...base,
                  color: '#b0b0b0',
                  fontSize: '1.05rem',
                }),
              }}
            />
            <div className="teamplanner-modal-actions">
              <button className="button" onClick={handleCloseModal}>Done</button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default TeamPlanner;
