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
import { generateRandomDraftName } from '../../shared/utils/draftNameGenerator';
import { getTipMessagesEnabled } from '../../shared/utils/tipMessages';

const MIN_TEAM_SIZE = 2;
const MAX_TEAM_SIZE = 10;
const DEFAULT_STARTING_MONEY = 20000;
const DEFAULT_AUCTION_SECONDS = 10;

const AuctionSetup = () => (
  <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
    <Header />
    <main className="auction-setup-main">
      <AuctionSetupForm />
    </main>
    <Footer />
  </div>
);

const AuctionSetupForm: React.FC = () => {
  const [tipsEnabled, setTipsEnabled] = useState(getTipMessagesEnabled);
  const [hasRefereeRole, setHasRefereeRole] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const handleSettingsChanged = () => setTipsEnabled(getTipMessagesEnabled());
    window.addEventListener('eb-settings-changed', handleSettingsChanged);
    window.addEventListener('storage', handleSettingsChanged);
    return () => {
      window.removeEventListener('eb-settings-changed', handleSettingsChanged);
      window.removeEventListener('storage', handleSettingsChanged);
    };
  }, []);

  useEffect(() => {
    fetchCurrentUser()
      .then((user) => {
        const roles = user.roles ?? [];
        const isReferee = roles.some((role) => role.role_name === 'Referee') || user.username === 'franklynathan' || user.username === 'jage04' || user.username === 'Jason' || user.username === 'mfrazz' || user.username === 'manthief';
        setHasRefereeRole(isReferee);
      })
      .catch(() => setHasRefereeRole(false));
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
  const [excludedPokemon, setExcludedPokemon] = useState<Set<string>>(new Set());

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
        excluded_pokemon: Array.from(excludedPokemon).map(key => {
          const [pokedexIdStr, form] = key.split(':');
          return {
            pokedex_id: parseInt(pokedexIdStr, 10),
            form: form || null,
          };
        }),
        num_auctions: numPokemon,
        auction_length: DEFAULT_AUCTION_SECONDS,
      };
      // POST to backend
      const response = await createDraft(data);
      console.log(response)
      // Redirect to /auction?{auctionId}
      if (response) {
        navigate(`/Auction?${response}`);
      }
    } catch (err: any) {
      // If the backend returned a specific error string (like a profanity warning), use it.
      const errorMessage = err.response?.data || err.message || 'Failed to create auction.';
      setSubmitError(typeof errorMessage === 'string' ? errorMessage : 'Failed to create auction.');
    }
  };

  return (
    <>
    <div className="auction-setup-card">
      <h2 className="auction-setup-title">Auction Setup</h2>
      <form className="auction-setup-form" onSubmit={handleSubmit} autoComplete="off">
        {submitError && <div style={{ color: 'red', marginBottom: 8 }}>{submitError}</div>}
        {createdAuctionId && <div style={{ color: 'lime', marginBottom: 8 }}>Auction Created! ID: {createdAuctionId}</div>}
        <div style={{ display: 'flex', gap: '10px', width: '100%' }}>
          <div className="auction-setup-field" style={{ flex: 1 }}>
            <label className="auction-setup-label">Draft Name:
              <div className="auction-setup-input-wrapper">
                <input
                  className="auction-setup-input"
                  type="text"
                  name="draft-name"
                  autoComplete="off"
                  value={draftName}
                  onChange={e => setDraftName(e.target.value)}
                  required
                />
                <button
                  type="button"
                  className="auction-setup-refresh-btn"
                  onClick={() => {
                    const names = pokemonList.map(p => p.name);
                    setDraftName(generateRandomDraftName(names));
                  }}
                  title="Generate random name"
                  aria-label="Generate random draft name"
                >
                  ⟳
                </button>
              </div>
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
        <div style={{ display: 'flex', gap: '10px', width: '100%' }}>
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
          {hasRefereeRole && (
            <div className="auction-setup-field" style={{ flex: 0.5 }}>
              <label className="auction-setup-label">Ranked Race
                <div className="auction-setup-checkbox-row">
                  <input
                    type="checkbox"
                    checked={ranked}
                    onChange={e => setRanked(e.target.checked)}
                  />
                </div>
              </label>
            </div>
          )}
        </div>
        <div className="auction-setup-field auction-setup-btn-row">
          {hasRefereeRole && (
            <button
              type="button"
              className="auction-setup-btn navButton"
              onClick={() => setShowModal(true)}
            >
              Select Pokémon
            </button>
          )}
          <button type="submit" className="auction-setup-btn navButton">Create Auction</button>
          
        </div>

        {/* Modal for selecting Pokémon */}
        {showModal && (
          <div className="auction-modal-overlay" onClick={() => setShowModal(false)}>
            <div className="auction-modal" onClick={e => e.stopPropagation()}>
              <div className="auction-modal-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <span>Select Pokémon</span>
                  <button
                    type="button"
                    onClick={() => {
                      const basePokemon = pokemonList.filter(p => (p as any).stage === 'base');
                      const allKeys = basePokemon.map(p => `${p.id}:${(p as any).form || ''}`);
                      setExcludedPokemon(new Set(allKeys));
                    }}
                    disabled={excludedPokemon.size === pokemonList.filter(p => (p as any).stage === 'base').length}
                    style={{
                      fontSize: '0.75rem', padding: '2px 8px', background: '#333', border: '1px solid #555', color: '#fff', borderRadius: '4px', 
                      cursor: excludedPokemon.size === pokemonList.filter(p => (p as any).stage === 'base').length ? 'default' : 'pointer', 
                      opacity: excludedPokemon.size === pokemonList.filter(p => (p as any).stage === 'base').length ? 0.5 : 1
                    }}
                  >
                    Exclude All
                  </button>
                  <button
                    type="button"
                    onClick={() => setExcludedPokemon(new Set())}
                    disabled={excludedPokemon.size === 0}
                    style={{
                      fontSize: '0.75rem', padding: '2px 8px', background: '#333', border: '1px solid #555', color: '#fff', borderRadius: '4px', cursor: excludedPokemon.size === 0 ? 'default' : 'pointer', opacity: excludedPokemon.size === 0 ? 0.5 : 1
                    }}
                  >
                    Include All
                  </button>
                </div>
                <button className="auction-modal-close" onClick={() => setShowModal(false)}>&times;</button>
              </div>
              <div className="auction-modal-grid">
                {pokemonList
                  .filter(p => (p as any).stage === 'base')
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((pokemon) => {
                  const form = (pokemon as any).form || '';
                  const compositeKey = `${pokemon.id}:${form}`;
                  const isExcluded = excludedPokemon.has(compositeKey);
                  const displayName = form ? `${pokemon.name} (${form})` : pokemon.name;
                  return (
                    <div
                      className={`auction-modal-grid-item${isExcluded ? ' auction-modal-grid-item-excluded' : ''}`}
                      key={compositeKey}
                      title={displayName}
                      onClick={() => {
                        setExcludedPokemon(prev => {
                          const next = new Set(prev);
                          if (next.has(compositeKey)) next.delete(compositeKey); else next.add(compositeKey);
                          return next;
                        });
                      }}
                    >
                      <img
                        src={`/baseforms/${pokemon.name}.png`}
                        alt={displayName}
                        className="auction-modal-pokemon-img"
                      />
                      <div className="auction-modal-pokemon-name">{displayName}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </form>
    </div>
    {tipsEnabled && (
      <div className="auction-setup-tip" style={{
        marginTop: '20px',
        padding: '16px 20px',
        borderRadius: '8px',
        background: 'rgba(255, 255, 255, 0.05)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        fontSize: '1.25rem',
        lineHeight: '1.5',
        color: 'var(--sl-color-neutral-300)',
        maxWidth: '70%',
      }}>
        <strong>TIP:</strong> Don't cap how many Pokemon a player can win in the auction! Some players will finish the auction with more Pokémon than others, and that's essential to the strategy. If one player drafts lots of weak, cheap Pokémon, they're able to play with more than a player who drafts powerful, expensive ones!
      </div>
    )}
    </>
  );
};

export default AuctionSetup;
