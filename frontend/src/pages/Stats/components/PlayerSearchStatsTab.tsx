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

  const pokemonDraftSummary = useMemo<PokemonDraftSummary[]>(() => {
    if (!playerMatchHistory?.length) {
      return [];
    }

    const summary = new Map<string, PokemonDraftSummary>();

    playerMatchHistory.forEach((team) => {
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
  }, [playerMatchHistory]);

  const [playerStatPills, setPlayerStatPills] = useState<PlayerStatPill[]>([]);

  useEffect(() => {
    if (!pokemonDraftSummary.length) {
      setPlayerStatPills([]);
      return;
    }

    let cancelled = false;
    getPlayerStatPills(pokemonDraftSummary).then((pills) => {
      if (!cancelled) setPlayerStatPills(pills);
    });

    return () => { cancelled = true; };
  }, [pokemonDraftSummary]);

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
                  setSearchInput(e.target.value);
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

          {selectedPlayer && !playerMatchHistoryLoading && playerMatchHistory && (
            <>
              {pokemonDraftSummary.length > 0 && (
                <div className="player-draft-overview">
                  {featuredPokemon && (
                    <div
                      className="player-draft-overview-background"
                      style={{
                        backgroundImage: `url(/MiniIcons/${formatPokemonName(featuredPokemon.name)}.png)`,
                      }}
                      aria-hidden="true"
                    />
                  )}

                  <div className="player-draft-overview-content">
                    <div className="player-draft-overview-header">
                      <div>
                        {selectedPlayer && (
                          <div className="player-draft-overview-profile-name">{selectedPlayer.user_name}</div>
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

                    {playerStatPills.length > 0 && (
                      <div className="player-stat-pill-grid">
                        {playerStatPills.map((pill: PlayerStatPill) => (
                          <div
                            className={`player-stat-pill player-stat-pill--${pill.tone}`}
                            key={pill.key}
                            title={pill.title}
                          >
                            {pill.label}
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="player-draft-overview-table">
                      <div className="player-draft-overview-table-header">
                        <span>Pokemon</span>
                        <span>Games</span>
                        <span>Avg</span>
                      </div>

                      {pokemonDraftSummary.slice(0, 5).map((pokemon) => (
                        <div className="player-draft-overview-row" key={pokemon.key}>
                          <span>{getPokemonLabel(pokemon.name, pokemon.form)}</span>
                          <span>{pokemon.games}</span>
                          <span>${Math.round(pokemon.avgSpend).toLocaleString()}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

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
                            <span className="draft-id mono">{team.draft_id}</span>
                            <span className="separator">•</span>
                            <span className="placement">{result}</span>
                            <span className="separator">•</span>
                            <span className="team-count">{team.team_count} teams</span>
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
