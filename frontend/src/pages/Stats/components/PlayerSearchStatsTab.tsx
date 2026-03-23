import React, { useMemo, useState } from 'react';
import { fetchMatchHistoryByUserId } from '../../../shared/api/stats';
import { MatchHistoryTeam, StatsAuction, StatsPagePlayer, StatsPageResponse } from '../../../types';
import '../Stats.scss';
import './PlayerSearchStatsTab.scss';

interface PlayerSearchStatsTabProps {
  stats: StatsPageResponse | null;
  loading?: boolean;
  error?: string | null;
}

function formatPokemonName(name: string): string {
  const cleaned = name.toLowerCase().replace(/'/g, '');
  if (cleaned === 'farfetchd galar' || cleaned === 'farfetchd-galar') {
    return 'farfetch\'d';
  }
  return cleaned;
}

const PlayerSearchStatsTab: React.FC<PlayerSearchStatsTabProps> = ({
  stats,
  loading = false,
  error = null,
}) => {
  const [searchInput, setSearchInput] = useState('');
  const [selectedPlayer, setSelectedPlayer] = useState<StatsPagePlayer | null>(null);
  const [playerMatchHistory, setPlayerMatchHistory] = useState<MatchHistoryTeam[] | null>(null);
  const [playerMatchHistoryLoading, setPlayerMatchHistoryLoading] = useState(false);
  const [playerMatchHistoryError, setPlayerMatchHistoryError] = useState<string | null>(null);

  const filteredPlayers = useMemo(() => {
    if (!searchInput.trim() || !stats?.players) {
      return [];
    }
    const query = searchInput.toLowerCase();
    return stats.players
      .filter((player) => !player.is_guest)
      .filter((player) => player.user_name.toLowerCase().includes(query))
      .slice(0, 10);
  }, [searchInput, stats?.players]);

  const handleSelectPlayer = async (player: StatsPagePlayer) => {
    setSelectedPlayer(player);
    setSearchInput(player.user_name);
    setPlayerMatchHistoryLoading(true);
    setPlayerMatchHistoryError(null);

    try {
      const history = await fetchMatchHistoryByUserId(player.user_id);
      setPlayerMatchHistory(history);
    } catch (e: any) {
      console.error('[PlayerSearchStatsTab] Error fetching player match history:', e);
      setPlayerMatchHistoryError('Failed to load player match history.');
    } finally {
      setPlayerMatchHistoryLoading(false);
    }
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
        <div className="player-search-wrapper">
          <div className="player-search-input-wrapper">
            <input
              type="text"
              className="player-search-input"
              placeholder="Search player name..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onFocus={() => setSearchInput('')}
            />
            {filteredPlayers.length > 0 && (
              <div className="search-autocomplete">
                {filteredPlayers.map((player) => (
                  <div
                    key={player.user_id}
                    className="autocomplete-item"
                    onClick={() => handleSelectPlayer(player)}
                  >
                    {player.user_name}
                  </div>
                ))}
              </div>
            )}
          </div>

          {playerMatchHistoryLoading && (
            <div className="match-history-message">Loading match history...</div>
          )}

          {playerMatchHistoryError && (
            <div className="match-history-message error">{playerMatchHistoryError}</div>
          )}

          {selectedPlayer && !playerMatchHistoryLoading && playerMatchHistory && (
            <>
              <div className="player-header">
                <h3>{selectedPlayer.user_name}</h3>
                <span className="player-stats">
                  {playerMatchHistory.length} game{playerMatchHistory.length !== 1 ? 's' : ''}
                </span>
              </div>

              <div className="match-timeline">
                {playerMatchHistory.length === 0 && (
                  <div className="match-history-message">No match history found.</div>
                )}

                {playerMatchHistory.map((team) => {
                  const auctions = team.pokemon_drafted || [];
                  const isRanked = team.pre_match_mmr !== null || team.placement !== null;
                  const result = !isRanked ? 'Unknown' : team.placement === 1 ? 'Win' : 'Loss';
                  const resultClass = result === 'Win' ? 'win' : result === 'Loss' ? 'loss' : 'unknown';

                  return (
                    <div className={`match-timeline-row ${resultClass}`} key={team.team_id}>
                      <div className="match-result-badge">
                        <span className="result-text">{result}</span>
                      </div>

                      <div className="match-info">
                        <div className="match-row-details">
                          <span className="draft-id mono">{team.draft_id}</span>
                          <span className="separator">•</span>
                          <span className="placement">{isRanked ? `#${team.placement}` : 'Unranked'}</span>
                          <span className="separator">•</span>
                          <span className="mmr">{team.pre_match_mmr ?? '-'} MMR</span>
                        </div>
                        <div>
                          <span className="budget-remaining">${team.money_remaining.toLocaleString()} left</span>
                        </div>
                      </div>

                      <div className="match-pokemon-picks">
                        {auctions.length === 0 && (
                          <span className="no-picks-label">No wins</span>
                        )}
                        {auctions.map((auction: StatsAuction) => (
                          <div
                            className="match-pick"
                            key={auction.auction_id}
                            title={`#${auction.pokedex_id} - $${auction.winning_bid ?? 0}`}
                          >
                            <img
                              src={`/MiniIcons/${formatPokemonName(auction.name)}.png`}
                              alt={auction.name}
                              onError={(ev) => {
                                (ev.currentTarget as HTMLImageElement).style.display = 'none';
                              }}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </article>
    </section>
  );
};

export default PlayerSearchStatsTab;
