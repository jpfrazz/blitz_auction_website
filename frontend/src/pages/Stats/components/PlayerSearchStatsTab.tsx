import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { StatsPagePlayer, StatsPageResponse } from '../../../types';
import { getAvatarUrl, onAvatarError } from '../../../shared/utils/user';
import '../Stats.scss';
import './PlayerSearchStatsTab.scss';

interface PlayerSearchStatsTabProps {
  stats: StatsPageResponse | null;
  loading?: boolean;
  error?: string | null;
}

/**
 * Directory view for /Stats/PlayerProfiles. It only searches and lists racers;
 * selecting one navigates to the dedicated profile route, which owns the
 * match-history request and all profile-only UI.
 */
const PlayerSearchStatsTab: React.FC<PlayerSearchStatsTabProps> = ({
  stats,
  loading = false,
  error = null,
}) => {
  const navigate = useNavigate();
  const [searchInput, setSearchInput] = useState('');
  const [isAutocompleteOpen, setIsAutocompleteOpen] = useState(false);

  const filteredPlayers = useMemo(() => {
    if (!searchInput.trim() || !stats?.players) {
      return [];
    }
    const query = searchInput.toLowerCase();
    return stats.players
      .filter((player) => !player.is_guest)
      .filter((player) =>
        player.user_name.toLowerCase().includes(query) ||
        (player.global_name ?? '').toLowerCase().includes(query)
      )
      .slice(0, 10);
  }, [searchInput, stats?.players]);

  const junkDraftIds = useMemo(() => {
    const soldCount = new Map<string, number>();
    (stats?.auctions ?? []).forEach((a) => {
      if (a.winning_bid === null) return;
      soldCount.set(a.draft_id, (soldCount.get(a.draft_id) || 0) + 1);
    });
    const junk = new Set<string>();
    soldCount.forEach((count, draftId) => {
      if (count < 16 || count > 150) junk.add(draftId);
    });
    return junk;
  }, [stats?.auctions]);

  const playerGamesMap = useMemo(() => {
    const map = new Map<string, number>();
    if (!stats) return map;
    (stats.teams ?? []).forEach((team) => {
      const id = team.user_id || team.guest_id;
      if (id && !junkDraftIds.has(team.draft_id)) {
        map.set(id, (map.get(id) || 0) + 1);
      }
    });
    return map;
  }, [stats, junkDraftIds]);

  const topPlayers = useMemo(() => {
    if (!stats?.players) return [];
    return stats.players
      .filter((player) => !player.is_guest)
      .map((player) => ({ ...player, gamesPlayed: playerGamesMap.get(player.user_id) || 0 }))
      .filter((player) => player.gamesPlayed > 0)
      .sort((a, b) => b.gamesPlayed - a.gamesPlayed)
      .slice(0, 150);
  }, [stats?.players, playerGamesMap]);

  const handleSelectPlayer = (player: StatsPagePlayer) => {
    setIsAutocompleteOpen(false);
    const displayName = player.global_name || player.user_name;
    // Keep the id in the URL so the profile page never has to guess by name.
    navigate(`/Stats/PlayerProfiles/${encodeURIComponent(displayName)}?userId=${encodeURIComponent(player.user_id)}`);
  };

  const handleSubmitSearch = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedInput = searchInput.trim().toLowerCase();
    const selectedMatch = filteredPlayers.find(
      (player) => player.user_name.trim().toLowerCase() === normalizedInput,
    ) ?? filteredPlayers[0];

    if (!selectedMatch) {
      setIsAutocompleteOpen(false);
      return;
    }
    handleSelectPlayer(selectedMatch);
  };

  if (loading) {
    return <section className="player-search-stats-tab stats-content-grid">Loading stats...</section>;
  }

  if (error) {
    return (
      <section className="player-search-stats-tab stats-content-grid">
        <div className="match-history-error">{error}</div>
      </section>
    );
  }

  return (
    <section className="player-search-stats-tab stats-content-grid">
      <article className="stats-panel player-search-panel">
        <h2>Player Match History</h2>
        <div className="player-search-wrapper player-search-wrapper--directory">
          <div className="player-search-controls">
            <form className="player-search-form" onSubmit={handleSubmitSearch}>
              <div className="player-search-input-wrapper">
                <input
                  type="text"
                  className="player-search-input"
                  placeholder="Search player name..."
                  value={searchInput}
                  onChange={(event) => {
                    setSearchInput(event.target.value);
                    setIsAutocompleteOpen(true);
                  }}
                  onFocus={() => setIsAutocompleteOpen(true)}
                />
                {isAutocompleteOpen && filteredPlayers.length > 0 && (
                  <div className="search-autocomplete">
                    {filteredPlayers.map((player) => (
                      <div
                        key={player.user_id}
                        className="autocomplete-item"
                        onClick={() => handleSelectPlayer(player)}
                      >
                        {player.global_name || player.user_name}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </form>
          </div>

          {topPlayers.length > 0 && (
            <div className="player-search-suggestions">
              <p className="player-search-suggestions-title">Blitz Racers (Top Games Played)</p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '10px' }}>
                {topPlayers.map((player) => (
                  <button
                    key={player.user_id}
                    type="button"
                    className="suggestion-item"
                    onClick={() => handleSelectPlayer(player)}
                  >
                    <img
                      src={getAvatarUrl(player.user_id)}
                      alt=""
                      style={{ width: '32px', height: '32px', borderRadius: '50%' }}
                      onError={onAvatarError}
                    />
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <span style={{ fontWeight: 'bold', fontSize: '1.1rem' }}>{player.global_name || player.user_name}</span>
                      <span style={{ fontSize: '0.95rem', opacity: 0.7 }}>{player.gamesPlayed} games</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </article>
    </section>
  );
};

export default PlayerSearchStatsTab;
