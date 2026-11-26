import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createDraft, CreateDraftRequest, isLobbyLimitError } from '../../shared/api/draft';
import { fetchPokemonList } from '../../shared/api/pokemon';
import { Pokemon } from '../../types';
import { generateRandomDraftName } from '../../shared/utils/draftNameGenerator';
import LobbyLimitModal from '../../shared/components/LobbyLimitModal';
import '../AuctionSetup/AuctionSetup.scss';
import '../Draft1v1Setup/Draft1v1Setup.scss';
import './BoosterSetup.scss';

const PLAYER_COUNTS = [3, 4];
const TEAM_SIZES = [8, 9, 10];

export const BoosterSetupForm: React.FC = () => {
  const navigate = useNavigate();
  const [draftName, setDraftName] = useState('');
  const [password, setPassword] = useState('');
  const [numPlayers, setNumPlayers] = useState(4);
  const [teamSize, setTeamSize] = useState(8);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [showLobbyLimit, setShowLobbyLimit] = useState(false);
  const [pokemonList, setPokemonList] = useState<Pokemon[]>([]);

  useEffect(() => {
    fetchPokemonList().then(setPokemonList);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);

    if (!draftName.trim()) {
      setSubmitError('Please enter a draft name.');
      return;
    }
    if (numPlayers < 3 || numPlayers > 4) {
      setSubmitError('Number of players must be between 3 and 4.');
      return;
    }

    const data: CreateDraftRequest = {
      num_teams: numPlayers,
      starting_money: 20000,
      draft_name: draftName.trim(),
      ranked: false,
      password: password.trim() || null,
      excluded_pokemon: [],
      num_auctions: 30,
      auction_length: 10,
      draft_type: 'booster',
      booster_team_size: teamSize,
    };

    try {
      const draftId = await createDraft(data);
      navigate(`/BoosterDraft?${draftId}`);
    } catch (err: any) {
      if (isLobbyLimitError(err)) {
        setShowLobbyLimit(true);
        return;
      }
      const errorMessage = err.response?.data || err.message || 'Failed to create booster draft.';
      setSubmitError(typeof errorMessage === 'string' ? errorMessage : 'Failed to create booster draft.');
    }
  };

  const form = (
    <form className="auction-setup-form" onSubmit={handleSubmit} autoComplete="off">
        {submitError && <div style={{ color: 'red', marginBottom: 8 }}>{submitError}</div>}
        <div style={{ display: 'flex', gap: '10px', width: '100%' }}>
          <div className="auction-setup-field" style={{ flex: 1 }}>
            <label className="auction-setup-label">
              Draft Name:
              <div className="auction-setup-input-wrapper">
                <input
                  className="auction-setup-input"
                  type="text"
                  name="draft-name"
                  autoComplete="off"
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  required
                />
                <button
                  type="button"
                  className="auction-setup-refresh-btn"
                  onClick={() => {
                    const names = pokemonList.map((p) => p.name);
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
            <label className="auction-setup-label">
              Password (optional):
              <input
                className="auction-setup-input"
                type="password"
                name="draft-password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
          </div>
        </div>
        <div className="booster-options-row">
          <div className="auction-setup-field" style={{ flex: 1 }}>
            <span className="auction-setup-label" id="booster-player-count-label">Number of Players:</span>
            <div className="pool-size-options" role="group" aria-labelledby="booster-player-count-label">
              {PLAYER_COUNTS.map((count) => (
                <button
                  key={count}
                  type="button"
                  aria-pressed={numPlayers === count}
                  className={numPlayers === count ? 'selected' : ''}
                  onClick={() => setNumPlayers(count)}
                >
                  {count}
                </button>
              ))}
            </div>
          </div>
          <div className="auction-setup-field booster-team-size-field" style={{ flex: 1 }}>
            <span className="auction-setup-label" id="booster-team-size-label">Team Size</span>
            <div className="pool-size-options" role="group" aria-labelledby="booster-team-size-label">
              {TEAM_SIZES.map((size) => (
                <button
                  key={size}
                  type="button"
                  aria-pressed={teamSize === size}
                  className={teamSize === size ? 'selected' : ''}
                  onClick={() => setTeamSize(size)}
                >
                  {size}
                </button>
              ))}
            </div>
            <span className="pool-size-description">
              {teamSize} Pokémon per player{teamSize >= 9 ? ' (Casual)' : ''}
            </span>
          </div>
        </div>
        <div className="auction-setup-field auction-setup-btn-row">
          <button type="submit" className="auction-setup-btn navButton">
            Create Booster Draft
          </button>
        </div>
      </form>
  );

  const lobbyLimitModal = showLobbyLimit && <LobbyLimitModal onClose={() => setShowLobbyLimit(false)} />;

  return (
    <>
      {form}
      {lobbyLimitModal}
    </>
  );
};
