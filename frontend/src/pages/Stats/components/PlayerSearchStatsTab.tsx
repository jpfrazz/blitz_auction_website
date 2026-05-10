import React, { useEffect, useMemo, useState } from 'react';
import { fetchMatchHistoryByUserId } from '../../../shared/api/stats';
import { MatchHistoryTeam, StatsAuction, StatsPagePlayer, StatsPageResponse } from '../../../types';
import type { PlayerStatPill } from './playerStatPills';
import { getPlayerStatPills } from './playerStatPills';
import '../Stats.scss';
import './PlayerSearchStatsTab.scss';

interface PlayerSearchStatsTabProps {
  stats: StatsPageResponse | null;
  loading?: boolean;
  error?: string | null;
  validDraftIds: Set<string>;
}

interface PokemonDraftSummary {
  key: string;
  name: string;
  form: string;
  games: number;
  totalSpend: number;
  avgSpend: number;
}

function formatPokemonName(name: string | undefined): string {
  if (!name) return '';
  const lower = name.toLowerCase();
  if (lower.startsWith("farfetch'd")) {
    return "farfetch'd";
  }
  return lower.replace(/'/g, '');
}

function getPlacementLabel(placement: number | null, isRanked: boolean): string {
  if (!isRanked || placement === null) {
    return 'Normal';
  }

  const suffix = placement % 10 === 1 && placement % 100 !== 11
    ? 'st'
    : placement % 10 === 2 && placement % 100 !== 12
      ? 'nd'
      : placement % 10 === 3 && placement % 100 !== 13
        ? 'rd'
        : 'th';

  return `${placement}${suffix}`;
}

function getPlacementClass(placement: number | null, isRanked: boolean): string {
  if (!isRanked || placement === null || placement > 3) {
    return 'normal';
  }

  if (placement === 1) return 'first';
  if (placement === 2) return 'second';
  return 'third';
}

function getPokemonLabel(name: string, form: string): string {
  return form ? `${name} (${form})` : name;
}

const PlayerSearchStatsTab: React.FC<PlayerSearchStatsTabProps> = ({
  stats,
  loading = false,
  error = null,
  validDraftIds,
}) => {
  const [searchInput, setSearchInput] = useState('');
  const [isAutocompleteOpen, setIsAutocompleteOpen] = useState(false);
  const [expandedTeamId, setExpandedTeamId] = useState<number | null>(null);
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

  const filteredMatchHistory = useMemo(() => {
    if (!playerMatchHistory) return null;
    return playerMatchHistory.filter(team => validDraftIds.has(team.draft_id));
  }, [playerMatchHistory, validDraftIds]);

  const playerGamesMap = useMemo(() => {
    const map = new Map<string, number>();
    if (!stats) return map;
    stats.teams.forEach((team) => {
      const id = team.user_id || team.guest_id;
      if (id && validDraftIds.has(team.draft_id)) {
        map.set(id, (map.get(id) || 0) + 1);
      }
    });
    return map;
  }, [stats, validDraftIds]);

  const draftDateMap = useMemo(() => {
    const map = new Map<string, string>();
    if (!stats?.auctions) return map;
    stats.auctions.forEach(a => {
      if (a.created_at && !map.has(a.draft_id)) {
        map.set(a.draft_id, new Date(a.created_at).toLocaleDateString());
      }
    });
    return map;
  }, [stats?.auctions]);

  const topPlayers = useMemo(() => {
    if (!stats?.players) return [];
    return stats.players
      .filter((p) => !p.is_guest)
      .map((p) => ({ ...p, gamesPlayed: playerGamesMap.get(p.user_id) || 0 }))
      .filter((p) => p.gamesPlayed > 0)
      .sort((a, b) => b.gamesPlayed - a.gamesPlayed)
      .slice(0, 20);
  }, [stats?.players, playerGamesMap]);

  const pokemonDraftSummary = useMemo<PokemonDraftSummary[]>(() => {
    if (!filteredMatchHistory?.length) {
      return [];
    }

    const summary = new Map<string, PokemonDraftSummary>();

    filteredMatchHistory.forEach((team) => {
      // Count pokemon from any valid draft

      (team.pokemon_drafted ?? []).forEach((auction) => {
        const key = `${auction.name}::${auction.form}`;
        const existing = summary.get(key);

        if (existing) {
          existing.games += 1;
          existing.totalSpend += auction.winning_bid ?? 0;
          existing.avgSpend = existing.games === 0 ? 0 : existing.totalSpend / existing.games;
          return;
        }

        summary.set(key, {
          key,
          name: auction.name,
          form: auction.form,
          games: 1,
          totalSpend: auction.winning_bid ?? 0,
          avgSpend: auction.winning_bid ?? 0,
        });
      });
    });

    return Array.from(summary.values()).sort((left, right) => {
      if (right.games !== left.games) {
        return right.games - left.games;
      }

      return getPokemonLabel(left.name, left.form).localeCompare(getPokemonLabel(right.name, right.form));
    });
  }, [filteredMatchHistory]);

  const featuredPokemon = pokemonDraftSummary[0] ?? null;

  const handleSelectPlayer = async (player: StatsPagePlayer) => {
    setIsAutocompleteOpen(false);
    setExpandedTeamId(null);
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

  const handleSubmitSearch = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const normalizedInput = searchInput.trim().toLowerCase();
    const selectedMatch = filteredPlayers.find(
      (player) => player.user_name.trim().toLowerCase() === normalizedInput,
    ) ?? filteredPlayers[0];

    if (!selectedMatch) {
      setIsAutocompleteOpen(false);
      return;
    }

    await handleSelectPlayer(selectedMatch);
  };

  const toggleExpandedTeam = (teamId: number) => {
    setExpandedTeamId((current) => current === teamId ? null : teamId);
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
          <form className="player-search-form" onSubmit={handleSubmitSearch}>
            <div className="player-search-input-wrapper">
              <input
                type="text"
                className="player-search-input"
                placeholder="Search player name..."
                value={searchInput}
                onChange={(e) => {
                  const val = e.target.value;
                  setSearchInput(val);
                  setIsAutocompleteOpen(true);
                  if (!val.trim()) {
                    setSelectedPlayer(null);
                    setPlayerMatchHistory(null);
                  }
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
                    {player.user_name}
                  </div>
                ))}
              </div>
              )}
            </div>
          </form>

          {playerMatchHistoryLoading && (
            <div className="match-history-message">Loading match history...</div>
          )}

          {playerMatchHistoryError && (
            <div className="match-history-message error">{playerMatchHistoryError}</div>
          )}

          {!selectedPlayer && !playerMatchHistoryLoading && topPlayers.length > 0 && (
            <div className="player-search-suggestions" style={{ marginTop: '0.3rem' }}>
              <p style={{ opacity: 0.6, fontSize: '1.1rem', marginBottom: '1rem' }}>Active Racers (Top Games Played)</p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '10px' }}>
                {topPlayers.map((player) => (
                  <button
                    key={player.user_id}
                    type="button"
                    className="suggestion-item"
                    onClick={() => handleSelectPlayer(player as any)}
                  >
                    {(player as any).avatar ? (
                      <img
                        src={`https://cdn.discordapp.com/avatars/${player.user_id}/${(player as any).avatar}.png`}
                        alt=""
                        style={{ width: '32px', height: '32px', borderRadius: '50%' }}
                      />
                    ) : (
                      <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: '#333' }} />
                    )}
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <span style={{ fontWeight: 'bold', fontSize: '1rem' }}>{player.user_name}</span>
                      <span style={{ fontSize: '0.85rem', opacity: 0.7 }}>{player.gamesPlayed} games</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {selectedPlayer && !playerMatchHistoryLoading && filteredMatchHistory && (
            <>
              {pokemonDraftSummary.length > 0 && (
                <div className="player-draft-overview">
                 {featuredPokemon && (
                    <div
                      className="player-draft-overview-background"
                      style={{
                        backgroundImage: `url(/baseforms/${featuredPokemon.name}.png)`,
                      }}
                      aria-hidden="true"
                    />
                  )}

                  <div className="player-draft-overview-content">
                    <div className="player-draft-overview-header">
                      <div>
                        {selectedPlayer && (
                          <div className="player-draft-overview-profile-name" style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
                            {(selectedPlayer as any).avatar && (
                              <img
                                src={`https://cdn.discordapp.com/avatars/${selectedPlayer.user_id}/${(selectedPlayer as any).avatar}.png`}
                                alt=""
                                style={{ width: '40px', height: '40px', borderRadius: '50%', border: '2px solid rgba(255,255,255,0.2)' }}
                              />
                            )}
                            <div>
                              <div style={{ fontSize: '1.2rem', fontWeight: 'bold' }}>{selectedPlayer.user_name}</div>
                              {selectedPlayer.global_name && <div style={{ fontSize: '1rem', opacity: 0.8 }}>({selectedPlayer.global_name})</div>}
                            </div>
                          </div>
                        )}
                        <span className="player-draft-overview-kicker">Most Drafted Pokemon</span>
                        {featuredPokemon && (
                          <h3>{getPokemonLabel(featuredPokemon.name, featuredPokemon.form)}</h3>
                        )}
                      </div>
                      {featuredPokemon && (
                        <div className="player-draft-overview-featured-stats">
                          <span className="player-draft-overview-featured-count">
                            {featuredPokemon.games} game{featuredPokemon.games !== 1 ? 's' : ''}
                          </span>
                          <span className="player-draft-overview-featured-count">
                            Avg ${Math.round(featuredPokemon.avgSpend).toLocaleString()}
                          </span>
                        </div>
                      )}
                    </div>

                    <div className="player-draft-overview-table">
                      <div className="player-draft-overview-table-header">
                        <span>Pokemon</span>
                        <span>Games</span>
                        <span>Avg</span>
                      </div>

                      {pokemonDraftSummary.slice(0, 10).map((pokemon) => (
                        <div className="player-draft-overview-row" key={pokemon.key}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                              <img
                                src={`/MiniIcons/${formatPokemonName(pokemon.name)}.png`}
                                alt={pokemon.name}
                                style={{ width: '20px', height: '20px', objectFit: 'contain' }}
                              />
                              <span style={{
                                position: 'absolute',
                                top: '-6px',
                                right: '-6px',
                                background: '#222',
                                color: '#fff',
                                fontSize: '0.7rem',
                                padding: '1px 3px',
                                borderRadius: '3px',
                                fontWeight: 'bold',
                                border: '1px solid #555',
                                lineHeight: '1'
                              }}>{pokemon.games}</span>
                            </div>
                            <span>{getPokemonLabel(pokemon.name, pokemon.form)}</span>
                          </div>
                          <span>{pokemon.games}</span>
                          <span>${Math.round(pokemon.avgSpend).toLocaleString()}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              <div className="player-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  {(selectedPlayer as any).avatar && (
                    <img
                      src={`https://cdn.discordapp.com/avatars/${selectedPlayer.user_id}/${(selectedPlayer as any).avatar}.png`}
                      alt=""
                      style={{ width: '32px', height: '32px', borderRadius: '50%' }}
                    />
                  )}
                  <div>
                    <h3 style={{ margin: 0 }}>
                      {selectedPlayer.user_name}
                      {selectedPlayer.global_name && <span style={{ fontSize: '0.8em', opacity: 0.7, marginLeft: '8px' }}>({selectedPlayer.global_name})</span>}
                    </h3>
                    <span className="player-stats">
                      {filteredMatchHistory.length} game{filteredMatchHistory.length !== 1 ? 's' : ''}
                    </span>
                  </div>
                </div>
              </div>

              <div className="match-timeline">
                {filteredMatchHistory.length === 0 && (
                  <div className="match-history-message">No match history found.</div>
                )}

                {filteredMatchHistory.map((team) => {
                  const auctions = team.pokemon_drafted || [];
                  const isRanked = team.pre_match_mmr !== null || team.placement !== null;
                  const result = getPlacementLabel(team.placement, isRanked);
                  const resultClass = getPlacementClass(team.placement, isRanked);
                  const isExpanded = expandedTeamId === team.team_id;

                  return (
                    <div className="match-timeline-entry" key={team.team_id}>
                      <button
                        type="button"
                        className={`match-timeline-row ${resultClass} ${isExpanded ? 'expanded' : ''}`}
                        onClick={() => toggleExpandedTeam(team.team_id)}
                      >
                        <div className="match-result-badge">
                          <span className="result-text">{result}</span>
                        </div>

                        <div className="match-info">
                          <div className="match-row-details">
                            <span className="draft-id">{draftDateMap.get(team.draft_id) || 'Unknown Date'}</span>
                            <span className="separator">•</span>
                            <span className="placement">{result}</span>
                            <span className="separator">•</span>
                            <span className="team-count">{team.team_count} players</span>
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
                      </button>

                      {isExpanded && (
                        <div className="match-draft-details">
                          <div className="match-draft-details-header">
                            <span>Pokemon</span>
                            <span>Paid</span>
                          </div>
                          {auctions.length === 0 && (
                            <div className="match-draft-details-empty">No Pokemon won in this draft.</div>
                          )}
                          {auctions.map((auction) => (
                            <div className="match-draft-details-row" key={auction.auction_id}>
                              <div className="match-draft-details-pokemon">
                                <img
                                  src={`/MiniIcons/${formatPokemonName(auction.name)}.png`}
                                  alt={auction.name}
                                  onError={(ev) => {
                                    (ev.currentTarget as HTMLImageElement).style.display = 'none';
                                  }}
                                />
                                <span>{getPokemonLabel(auction.name, auction.form)}</span>
                              </div>
                              <span className="match-draft-details-cost">${(auction.winning_bid ?? 0).toLocaleString()}</span>
                            </div>
                          ))}
                        </div>
                      )}
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
