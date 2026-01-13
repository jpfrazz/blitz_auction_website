import React, { useState } from 'react';
import Select, { MultiValue, ActionMeta } from 'react-select';
import Header from '../../shared/components/Header';
import Footer from '../../shared/components/Footer';
import './TeamPlanner.scss';

type PokemonOption = {
  value: string;
  label: string;
};

const pokemonOptions: PokemonOption[] = [
  { value: 'bulbasaur', label: 'Bulbasaur' },
  { value: 'charmander', label: 'Charmander' },
  { value: 'squirtle', label: 'Squirtle' },
];

const TeamPlanner = () => {
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedPokemon, setSelectedPokemon] = useState<readonly PokemonOption[]>([]);

  const handleOpenModal = () => setModalOpen(true);
  const handleCloseModal = () => setModalOpen(false);

  // react-select returns a readonly array, so type accordingly
  const handleSelectChange = (
    newValue: MultiValue<PokemonOption>,
    _actionMeta: ActionMeta<PokemonOption>
  ) => {
    setSelectedPokemon(newValue);
  };

  return (
    <>
      <Header />
      <main className="teamplanner-main">
        <h1 className="teamplanner-title">Team Planner</h1>
        <button className="button" onClick={handleOpenModal}>Add to Team</button>

        {modalOpen && (
          <div className="teamplanner-modal-overlay">
            <div className="teamplanner-modal-content">
              <button
                className="teamplanner-modal-close"
                onClick={handleCloseModal}
                aria-label="Close"
                type="button"
              >
                &times;
              </button>
              <h2 style={{ marginTop: 0 }}>Select Pokemon</h2>
              <label className="teamplanner-modal-label">
                Choose your Pokemon team:
              </label>
              <Select
                classNamePrefix="teamplanner-modal-select"
                options={pokemonOptions}
                isMulti
                value={selectedPokemon}
                onChange={handleSelectChange}
                placeholder="Select Pokemon"
                styles={{
                  control: (base) => ({
                    ...base,
                    background: 'var(--eb-bg, #18191a)',
                    color: 'var(--eb-text, #f1f1f1)',
                    borderColor: 'var(--eb-border, #2a2d31)',
                    borderRadius: 6,
                    minHeight: '48px',
                  }),
                  menu: (base) => ({
                    ...base,
                    background: 'var(--eb-surface, #232527)',
                    color: 'var(--eb-text, #f1f1f1)',
                  }),
                  multiValue: (base) => ({
                    ...base,
                    background: 'var(--eb-surface, #232527)',
                  }),
                  multiValueLabel: (base) => ({
                    ...base,
                    color: 'var(--eb-text, #f1f1f1)',
                  }),
                  option: (base, state) => ({
                    ...base,
                    background: state.isFocused
                      ? 'var(--eb-border, #2a2d31)'
                      : 'var(--eb-surface, #232527)',
                    color: 'var(--eb-text, #f1f1f1)',
                  }),
                  input: (base) => ({
                    ...base,
                    color: 'var(--eb-text, #f1f1f1)',
                  }),
                }}
              />
              <div className="teamplanner-modal-actions">
                <button className="button" onClick={handleCloseModal}>Cancel</button>
                <button className="button" onClick={handleCloseModal}>Continue</button>
              </div>
            </div>
          </div>
        )}
      </main>
      <Footer />
    </>
  );
};

export default TeamPlanner;