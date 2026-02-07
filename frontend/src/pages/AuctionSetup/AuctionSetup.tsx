// Auction setup form logic
import React, { useState } from 'react';
import { useEffect } from 'react';
import { fetchPokemonList } from '../../shared/api/pokemon';
import { Pokemon } from '../../types';
import { useNavigate } from 'react-router-dom';
// import { AuthContext } from '../../shared/AuthContext';
import Header from '../../shared/components/Header';
import Footer from '../../shared/components/Footer';
import './AuctionSetup.scss';
import '../../shared/style/theme.scss';
import { createDraft, CreateDraftRequest } from '../../shared/api/draft';

const MIN_TEAM_SIZE = 6;
const MAX_TEAM_SIZE = 8;

const AuctionSetup = () => (
  <>
    <Header />
    <main style={{
      minHeight: 'calc(100vh - 180px)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '0 16px',
    }}>
      <AuctionSetupForm />
    </main>
    <Footer />
  </>
);

const AuctionSetupForm: React.FC = () => {
  // Replace with actual auth context
  const isLoggedIn = true; // Example: useContext(AuthContext)?.isLoggedIn;
  const navigate = useNavigate();

  const [numTeams, setNumTeams] = useState(8);
  const [defaultFunds, setDefaultFunds] = useState(20000);
  const [numPokemon, setNumPokemon] = useState(64);
  const [draftName, setDraftName] = useState('');
  const [password, setPassword] = useState('');
  const [secondsToDraft, setSecondsToDraft] = useState(10);
  const [ranked, setRanked] = useState(false);

  React.useEffect(() => {
    if (ranked) {
      setDefaultFunds(20000);
      setNumPokemon(8 * numTeams);
      setExcludedPokemon(new Set());
    }
  }, [ranked, defaultFunds, numTeams]);

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
      !defaultFunds ||
      !numPokemon ||
      !draftName.trim() ||
      !secondsToDraft
    ) {
      setSubmitError('Please fill out all required fields.');
      return;
    }

    try {
      // Compose the data object to match API expectations
      const data: CreateDraftRequest = {
        num_teams: numTeams,
        starting_money: defaultFunds,
        excluded_pokemon: Array.from(excludedPokemon).map(id => ({
          pokedex_id: id,
          form: null, // Default to empty form, update if you have form data
        })),
        patch_version: '7.91', // Update with actual version if available
        num_auctions: numPokemon,
        auction_length: {
          secs: secondsToDraft,
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
      <h2 className="auction-setup-title">Set Up Auction</h2>
      <form className="auction-setup-form" onSubmit={handleSubmit}>
        {submitError && <div style={{ color: 'red', marginBottom: 8 }}>{submitError}</div>}
        {createdAuctionId && <div style={{ color: 'lime', marginBottom: 8 }}>Auction Created! ID: {createdAuctionId}</div>}
        <div className="auction-setup-field">
          <label className="auction-setup-label">Number of Teams:
            <input
              className="auction-setup-input"
              type="number"
              min={ranked ? MIN_TEAM_SIZE : 2}
              max={ranked ? MAX_TEAM_SIZE : 16}
              value={numTeams}
              onChange={e => setNumTeams(Number(e.target.value))}
              required
            />
          </label>
        </div>
        <div className="auction-setup-field">
          <label className="auction-setup-label">Default Funds:
            <input
              className="auction-setup-input"
              type="number"
              min={5000}
              max={30000}
              value={defaultFunds}
              onChange={e => setDefaultFunds(Number(e.target.value))}
              required
              disabled={ranked}
            />
          </label>
        </div>
        <div className="auction-setup-field">
          <label className="auction-setup-label">Number of Pokémon Drafted:
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
        <div className="auction-setup-field">
          <label className="auction-setup-label">Draft Name:
            <input
              className="auction-setup-input"
              type="text"
              value={draftName}
              onChange={e => setDraftName(e.target.value)}
              required
            />
          </label>
        </div>
        <div className="auction-setup-field">
          <label className="auction-setup-label">Password (optional):
            <input
              className="auction-setup-input"
              type="text"
              value={password}
              onChange={e => setPassword(e.target.value)}
            />
          </label>
        </div>
        <div className="auction-setup-field">
          <label className="auction-setup-label">Seconds to Draft:
            <input
              className="auction-setup-input"
              type="number"
              min={5}
              max={20}
              value={secondsToDraft}
              onChange={e => setSecondsToDraft(Number(e.target.value))}
              required
            />
          </label>
        </div>
        {isLoggedIn && (
          <div className="auction-setup-field auction-setup-checkbox-row">
            <label className="auction-setup-label auction-setup-checkbox-label">
              <input
                type="checkbox"
                checked={ranked}
                onChange={e => setRanked(e.target.checked)}
              />
              Ranked Draft
            </label>
          </div>
        )}
        <div className="auction-setup-field auction-setup-btn-row">
          <button
            type="button"
            className="auction-setup-btn navButton"
            onClick={() => setShowModal(true)}
            disabled={ranked}
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
                {pokemonList.map((pokemon) => {
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
