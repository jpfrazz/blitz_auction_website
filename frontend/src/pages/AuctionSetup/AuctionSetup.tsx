// Auction setup form logic
import React, { useState, useEffect } from 'react';
import { fetchPokemonList } from '../../shared/api/pokemon';
import { Pokemon } from '../../types';
import { useNavigate } from 'react-router-dom';
import { fetchCurrentUser } from '../../shared/api/draftData';
import Header from '../../shared/components/Header';
import Footer from '../../shared/components/Footer';
import './AuctionSetup.scss';
import '../../shared/style/theme.scss';
import { createDraft, CreateDraftRequest } from '../../shared/api/draft';

const MIN_TEAM_SIZE = 6;
const MAX_TEAM_SIZE = 8;
const DEFAULT_STARTING_MONEY = 20000;
const DEFAULT_AUCTION_SECONDS = 10;

const AuctionSetup = () => (
  <>
    <Header />
    <main className="auction-setup-main">
      <AuctionSetupForm />
    </main>
    <Footer />
  </>
);

const AuctionSetupForm: React.FC = () => {
  const [isGuest, setIsGuest] = useState<boolean | null>(null);
  const navigate = useNavigate();
  useEffect(() => {
    fetchCurrentUser()
      .then(user => setIsGuest(user.is_guest))
      .catch(() => setIsGuest(null));
  }, []);

  const [numTeams, setNumTeams] = useState(8);
  const [numPokemon, setNumPokemon] = useState(64);
  const [draftName, setDraftName] = useState('');
  const [password, setPassword] = useState('');
  const [ranked, setRanked] = useState(false);

  React.useEffect(() => {
    if (ranked) {
      setNumPokemon(8 * numTeams);
      setExcludedPokemon(new Set());
    }
  }, [ranked, numTeams]);

  const [submitError, setSubmitError] = useState<string | null>(null);
  const [createdAuctionId, setCreatedAuctionId] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [pokemonList, setPokemonList] = useState<Pokemon[]>([]);
  const [excludedPokemon, setExcludedPokemon] = useState<Set<number>>(new Set());

  // Load Pokémon list from API
  useEffect(() => {
    fetchPokemonList().then(setPokemonList);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);
    setCreatedAuctionId(null);

    // Validate required fields (userId and password are optional)
    if (
      !numTeams ||
      !numPokemon ||
      !draftName.trim()
    ) {
      setSubmitError('Please fill out all required fields.');
      return;
    }

    try {
      // Compose the data object to match API expectations
      const data: CreateDraftRequest = {
        num_teams: numTeams,
        starting_money: DEFAULT_STARTING_MONEY,
        draft_name: draftName.trim(),
        ranked,
        password: password.trim() || null,
        excluded_pokemon: Array.from(excludedPokemon).map(id => ({
          pokedex_id: id,
          form: null, // Default to empty form, update if you have form data
        })),
        num_auctions: numPokemon,
        auction_length: {
          secs: DEFAULT_AUCTION_SECONDS,
          nanos: 0,
        },
      };
      // POST to backend
      const response = await createDraft(data);
      console.log(response)
      // Redirect to /auction?{auctionId}
      if (response) {
        navigate(`/Auction?${response}`);
      }
    } catch (err: any) {
      setSubmitError(err?.message || 'Failed to create auction.');
    }
  };

  return (
    <div className="auction-setup-card">
      <h2 className="auction-setup-title">Auction Setup</h2>
      <form className="auction-setup-form" onSubmit={handleSubmit} autoComplete="off">
        {submitError && <div style={{ color: 'red', marginBottom: 8 }}>{submitError}</div>}
        {createdAuctionId && <div style={{ color: 'lime', marginBottom: 8 }}>Auction Created! ID: {createdAuctionId}</div>}
        <div style={{ display: 'flex', gap: '10px', width: '100%' }}>
          <div className="auction-setup-field" style={{ flex: 1 }}>
            <label className="auction-setup-label">Draft Name:
              <input
                className="auction-setup-input"
                type="text"
                name="draft-name"
                autoComplete="off"
                value={draftName}
                onChange={e => setDraftName(e.target.value)}
                required
              />
            </label>
          </div>
          <div className="auction-setup-field" style={{ flex: 1 }}>
            <label className="auction-setup-label">Password (optional):
              <input
                className="auction-setup-input"
                type="password"
                name="draft-password"
                autoComplete="new-password"
                value={password}
                onChange={e => setPassword(e.target.value)}
              />
            </label>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '10px', width: '100%', alignItems: 'flex-end' }}>
          <div className="auction-setup-field" style={{ flex: 1 }}>
            <label className="auction-setup-label">Number of Teams:
              <input
                className="auction-setup-input"
                type="number"
                min={ranked ? MIN_TEAM_SIZE : 2}
                max={ranked ? MAX_TEAM_SIZE : 16}
                value={numTeams}
                onChange={e => {
                  const val = Number(e.target.value);
                  setNumTeams(val);
                  setNumPokemon(val * 8);
                }}
                required
              />
            </label>
          </div>
          <div className="auction-setup-field" style={{ flex: 1 }}>
            <label className="auction-setup-label">Total Pokémon:
              <input
                className="auction-setup-input"
                type="number"
                min={1}
                max={256}
                value={numPokemon}
                onChange={e => setNumPokemon(Number(e.target.value))}
                required
                disabled={ranked}
              />
            </label>
          </div>
          <div className="auction-setup-field" style={{ flex: 0.5 }}>
            <label className="auction-setup-label">Ranked Race
              <div className="auction-setup-checkbox-row" style={{ marginLeft: '12px' }}>
                <input
                  type="checkbox"
                  checked={ranked}
                  onChange={e => setRanked(e.target.checked)}
                  disabled={/*isGuest === true*/true} // TODO: Re-enable once auth is working
                  title={isGuest === true ? 'You must be logged in to enable ranked' : ''}
                />
              </div>
            </label>
          </div>
        </div>
        <div className="auction-setup-field auction-setup-btn-row">
          <button
            type="button"
            className="auction-setup-btn navButton"
            onClick={() => setShowModal(true)}
            disabled={/*ranked*/true} // TODO: Re-enable once auth is working
          >
            Select Pokémon
          </button>
          <button type="submit" className="auction-setup-btn navButton">Create Auction</button>
          
        </div>

        {/* Modal for selecting Pokémon */}
        {showModal && (
          <div className="auction-modal-overlay" onClick={() => setShowModal(false)}>
            <div className="auction-modal" onClick={e => e.stopPropagation()}>
              <div className="auction-modal-header">
                <span>Select Pokémon</span>
                <button className="auction-modal-close" onClick={() => setShowModal(false)}>&times;</button>
              </div>
              <div className="auction-modal-grid">
                {pokemonList
                  .filter(p => (p as any).stage === 'base')
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((pokemon) => {
                  const isExcluded = excludedPokemon.has(pokemon.id);
                  return (
                    <div
                      className={`auction-modal-grid-item${isExcluded ? ' auction-modal-grid-item-excluded' : ''}`}
                      key={pokemon.id}
                      title={pokemon.name}
                      onClick={() => {
                        setExcludedPokemon(prev => {
                          const next = new Set(prev);
                          if (next.has(pokemon.id)) next.delete(pokemon.id); else next.add(pokemon.id);
                          return next;
                        });
                      }}
                    >
                      <img
                        src={`/baseforms/${pokemon.name}.png`}
                        alt={pokemon.name}
                        className="auction-modal-pokemon-img"
                      />
                      <div className="auction-modal-pokemon-name">{pokemon.name}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </form>
    </div>
  );
};

export default AuctionSetup;
