import React, { useEffect, useMemo, useState } from 'react';
import Header from '../../shared/components/Header';
import { fetchStatsPageData, fetchMatchHistoryByUserId } from '../../shared/api/stats';
import { StatsAuction, StatsPagePlayer, StatsPageResponse, StatsPageTeamRow, MatchHistoryTeam } from '../../types';
import './Stats.scss';

type StatsTab = 'overview' | 'players' | 'pokemon' | 'drafts' | 'player-search';

interface PokemonAggregate {
  key: string;
  pokedex_id: number;
  form: string;
  bidsWon: number;
  totalSpend: number;
  avgWinningBid: number;
}

interface PlayerAggregate {
  key: string;
  name: string;
  draftsPlayed: number;
  wins: number;
  topFour: number;
  avgPlacement: number | null;
  totalSpend: number;
  avgSpendPerDraft: number;
}

function getPokemonSprite(pokedexId: number): string {
  return `/baseforms/${pokedexId}.png`;
}

function toLabel(value: string): string {
  return value
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

const Stats: React.FC = () => {
  const [stats, setStats] = useState<StatsPageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<StatsTab>('overview');
  const [searchInput, setSearchInput] = useState('');
  const [selectedPlayer, setSelectedPlayer] = useState<StatsPagePlayer | null>(null);
  const [playerMatchHistory, setPlayerMatchHistory] = useState<MatchHistoryTeam[] | null>(null);
  const [playerMatchHistoryLoading, setPlayerMatchHistoryLoading] = useState(false);
  const [playerMatchHistoryError, setPlayerMatchHistoryError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        console.log('[Stats] Starting stats data fetch...');
        setLoading(true);
        const data = await fetchStatsPageData();
        console.log('[Stats] Fetched stats data successfully:', {
          playerCount: data.players.length,
          teamCount: data.teams.length,
          auctionCount: data.auctions.length,
        });
        setStats(data);
      } catch (e: any) {
        console.error('[Stats] Error fetching stats data:', e);
        setError('Failed to load stats data.');
      } finally {
        setLoading(false);
      }
    };

    load();
  }, []);

  const playersById = useMemo(() => {
    console.log('[Stats] Building playersById map from', stats?.players?.length ?? 0, 'players');
    const map = new Map<string, StatsPagePlayer>();
    (stats?.players ?? []).forEach((player) => {
      map.set(player.user_id, player);
    });
    console.log('[Stats] playersById map created with', map.size, 'entries');
    return map;
  }, [stats?.players]);

  const filteredPlayers = useMemo(() => {
    if (!searchInput.trim() || !stats?.players) {
      console.log('[Stats] Filtered players cleared - empty search or no stats');
      return [];
    }
    const query = searchInput.toLowerCase();
    const filtered = stats.players
      .filter((player) => player.user_name.toLowerCase().includes(query))
      .slice(0, 10);
    console.log('[Stats] Filtered players for query "' + query + '":', filtered.length, 'results');
    return filtered;
  }, [searchInput, stats?.players]);

  const handleSelectPlayer = async (player: StatsPagePlayer) => {
    console.log('[Stats] Selected player:', player.user_id, player.user_name);
    setSelectedPlayer(player);
    setSearchInput(player.user_name);
    setPlayerMatchHistoryLoading(true);
    setPlayerMatchHistoryError(null);
    try {
      console.log('[Stats] Fetching match history for user_id:', player.user_id);
      const history = await fetchMatchHistoryByUserId(player.user_id);
      console.log('[Stats] Fetched match history:', {
        userId: player.user_id,
        matchCount: history.length,
        totalAuctions: history.reduce((sum, team) => sum + (team.pokemon_drafted?.length ?? 0), 0),
      });
      setPlayerMatchHistory(history);
    } catch (e: any) {
      console.error('[Stats] Error fetching player match history:', e);
      setPlayerMatchHistoryError('Failed to load player match history.');
    } finally {
      setPlayerMatchHistoryLoading(false);
    }
  };

  const sortedAuctions = useMemo(() => {
    const sorted = [...(stats?.auctions ?? [])]
      .filter((auction) => auction.winning_bid !== null)
      .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
    console.log('[Stats] Computed sortedAuctions:', sorted.length, 'auctions with winning bids');
    return sorted;
  }, [stats?.auctions]);

  const pokemonSummary = useMemo<PokemonAggregate[]>(() => {
    const grouped = new Map<string, PokemonAggregate>();

    sortedAuctions.forEach((auction) => {
      const key = `${auction.pokedex_id}:${auction.form || ''}`;
      const existing = grouped.get(key);
      if (existing) {
        existing.bidsWon += 1;
        existing.totalSpend += auction.winning_bid ?? 0;
      } else {
        grouped.set(key, {
          key,
          pokedex_id: auction.pokedex_id,
          form: auction.form,
          bidsWon: 1,
          totalSpend: auction.winning_bid ?? 0,
          avgWinningBid: 0,
        });
      }
    });

    const result = Array.from(grouped.values())
      .map((entry) => ({
        ...entry,
        avgWinningBid: entry.bidsWon > 0 ? Math.round(entry.totalSpend / entry.bidsWon) : 0,
      }))
      .sort((a, b) => {
        if (b.bidsWon !== a.bidsWon) {
          return b.bidsWon - a.bidsWon;
        }
        return b.totalSpend - a.totalSpend;
      });
    console.log('[Stats] Computed pokemonSummary:', result.length, 'unique pokemon');
    return result;
  }, [sortedAuctions]);

  const playerSummary = useMemo<PlayerAggregate[]>(() => {
    const grouped = new Map<string, {
      key: string;
      name: string;
      draftsPlayed: number;
      wins: number;
      topFour: number;
      placementSum: number;
      placementsCount: number;
      totalSpend: number;
    }>();

    const addTeamAggregate = (team: StatsPageTeamRow) => {
      const key = team.user_id || team.guest_id;
      if (!key) {
        return;
      }

      const existing = grouped.get(key) || {
        key,
        name: playersById.get(key)?.user_name || key,
        draftsPlayed: 0,
        wins: 0,
        topFour: 0,
        placementSum: 0,
        placementsCount: 0,
        totalSpend: 0,
      };

      existing.draftsPlayed += 1;

      if (team.placement !== null) {
        existing.placementSum += team.placement;
        existing.placementsCount += 1;
        if (team.placement === 1) {
          existing.wins += 1;
        }
        if (team.placement <= 4) {
          existing.topFour += 1;
        }
      }

      grouped.set(key, existing);
    };

    (stats?.teams ?? []).forEach(addTeamAggregate);

    sortedAuctions.forEach((auction) => {
      const key = auction.winning_user_id || auction.winning_guest_id;
      if (!key) {
        return;
      }
      const existing = grouped.get(key);
      if (existing) {
        existing.totalSpend += auction.winning_bid ?? 0;
      }
    });

    const result = Array.from(grouped.values())
      .map((entry) => ({
        key: entry.key,
        name: entry.name,
        draftsPlayed: entry.draftsPlayed,
        wins: entry.wins,
        topFour: entry.topFour,
        avgPlacement: entry.placementsCount > 0
          ? Number((entry.placementSum / entry.placementsCount).toFixed(2))
          : null,
        totalSpend: entry.totalSpend,
        avgSpendPerDraft: entry.draftsPlayed > 0
          ? Math.round(entry.totalSpend / entry.draftsPlayed)
          : 0,
      }))
      .sort((a, b) => {
        if (b.wins !== a.wins) {
          return b.wins - a.wins;
        }
        if (a.avgPlacement === null && b.avgPlacement !== null) {
          return 1;
        }
        if (a.avgPlacement !== null && b.avgPlacement === null) {
          return -1;
        }
        if (a.avgPlacement !== null && b.avgPlacement !== null && a.avgPlacement !== b.avgPlacement) {
          return a.avgPlacement - b.avgPlacement;
        }
        return b.totalSpend - a.totalSpend;
      });
    console.log('[Stats] Computed playerSummary:', result.length, 'players:', {
      totalWins: result.reduce((sum, p) => sum + p.wins, 0),
      totalDraftsPlayed: result.reduce((sum, p) => sum + p.draftsPlayed, 0),
    });
    return result;
  }, [playersById, sortedAuctions, stats?.teams]);

  const draftSummary = useMemo(() => {
    const drafts = new Map<string, {
      draftId: string;
      teamCount: number;
      auctionCount: number;
      winningBidSum: number;
      highestBid: number;
    }>();

    (stats?.teams ?? []).forEach((team) => {
      const existing = drafts.get(team.draft_id) || {
        draftId: team.draft_id,
        teamCount: 0,
        auctionCount: 0,
        winningBidSum: 0,
        highestBid: 0,
      };
      existing.teamCount += 1;
      drafts.set(team.draft_id, existing);
    });

    sortedAuctions.forEach((auction) => {
      const existing = drafts.get(auction.draft_id) || {
        draftId: auction.draft_id,
        teamCount: 0,
        auctionCount: 0,
        winningBidSum: 0,
        highestBid: 0,
      };

      const winningBid = auction.winning_bid ?? 0;
      existing.auctionCount += 1;
      existing.winningBidSum += winningBid;
      if (winningBid > existing.highestBid) {
        existing.highestBid = winningBid;
      }

      drafts.set(auction.draft_id, existing);
    });

    const result = Array.from(drafts.values())
      .map((draft) => ({
        ...draft,
        avgWinningBid: draft.auctionCount > 0
          ? Math.round(draft.winningBidSum / draft.auctionCount)
          : 0,
      }))
      .sort((a, b) => b.auctionCount - a.auctionCount);
    
    console.log('[Stats] draftSummary computed:', {
      draftCount: result.length,
      totalAuctions: result.reduce((sum, d) => sum + d.auctionCount, 0),
      totalTeams: result.reduce((sum, d) => sum + d.teamCount, 0),
      results: result,
    });

    return result;
  }, [sortedAuctions, stats?.teams]);

  const topPokemon = pokemonSummary.slice(0, 8);
  const recentWinningAuctions = sortedAuctions.slice(0, 12);

  const kpis = useMemo(() => {
    const uniqueDrafts = new Set((stats?.teams ?? []).map((team) => team.draft_id)).size;
    const uniquePlayers = playerSummary.length;
    const avgWinningBid = sortedAuctions.length > 0
      ? Math.round(
        sortedAuctions.reduce((sum, auction) => sum + (auction.winning_bid ?? 0), 0) / sortedAuctions.length,
      )
      : 0;

    const result = {
      uniqueDrafts,
      uniquePlayers,
      totalWinningAuctions: sortedAuctions.length,
      avgWinningBid,
    };

    console.log('[Stats] KPIs computed:', {
      uniqueDrafts,
      uniquePlayers,
      totalWinningAuctions: sortedAuctions.length,
      avgWinningBid,
    });

    return result;
  }, [playerSummary.length, sortedAuctions, stats?.teams]);

  if (loading) {
    return (
      <div className="match-history-page">
        <Header />
        <main className="match-history-main">Loading stats...</main>
      </div>
    );
  }

  if (error) {
    return (
      <div className="match-history-page">
        <Header />
        <main className="match-history-main">
          <div className="match-history-error">{error}</div>
        </main>
      </div>
    );
  }

  return (
    <div className="match-history-page">
      <Header />
      <main className="match-history-main">
        <section className="stats-hero-card">
          <div>
            <h1>Draft Stats</h1>
            <p>Global Emerald Blitz auction analytics across completed drafts.</p>
          </div>
          <div className="stats-hero-meta">Live from completed draft data</div>
        </section>

        <section className="stats-kpi-grid">
          <article className="kpi-card">
            <div className="kpi-label">Completed Drafts</div>
            <div className="kpi-value">{kpis.uniqueDrafts}</div>
          </article>
          <article className="kpi-card">
            <div className="kpi-label">Tracked Players</div>
            <div className="kpi-value">{kpis.uniquePlayers}</div>
          </article>
          <article className="kpi-card">
            <div className="kpi-label">Winning Auctions</div>
            <div className="kpi-value">{kpis.totalWinningAuctions}</div>
          </article>
          <article className="kpi-card">
            <div className="kpi-label">Average Winning Bid</div>
            <div className="kpi-value">${kpis.avgWinningBid.toLocaleString()}</div>
          </article>
        </section>

        <section className="stats-tab-bar" aria-label="Stats tabs">
          <button
            className={`tab-chip ${activeTab === 'overview' ? 'active' : ''}`}
            type="button"
            onClick={() => setActiveTab('overview')}
          >
            Overview
          </button>
          <button
            className={`tab-chip ${activeTab === 'players' ? 'active' : ''}`}
            type="button"
            onClick={() => setActiveTab('players')}
          >
            Players
          </button>
          <button
            className={`tab-chip ${activeTab === 'pokemon' ? 'active' : ''}`}
            type="button"
            onClick={() => setActiveTab('pokemon')}
          >
            Pokemon
          </button>
          <button
            className={`tab-chip ${activeTab === 'drafts' ? 'active' : ''}`}
            type="button"
            onClick={() => setActiveTab('drafts')}
          >
            Drafts
          </button>
          <button
            className={`tab-chip ${activeTab === 'player-search' ? 'active' : ''}`}
            type="button"
            onClick={() => setActiveTab('player-search')}
          >
            Player Search
          </button>
        </section>

        {activeTab === 'overview' && (
          <section className="stats-content-grid two-col">
            <article className="stats-panel">
              <h2>Most Picked Pokemon</h2>
              <div className="panel-list">
                {topPokemon.map((entry) => (
                  <div className="pokemon-row" key={entry.key}>
                    <div className="pokemon-ident">
                      <img
                        src={getPokemonSprite(entry.pokedex_id)}
                        alt={`${entry.pokedex_id}`}
                        onError={(ev) => {
                          (ev.currentTarget as HTMLImageElement).style.opacity = '0.35';
                        }}
                      />
                      <div>
                        <div className="strong">#{entry.pokedex_id}</div>
                        <div className="muted">{toLabel(entry.form || 'base')}</div>
                      </div>
                    </div>
                    <div className="pokemon-metrics">
                      <span>{entry.bidsWon} wins</span>
                      <span>${entry.avgWinningBid.toLocaleString()} avg</span>
                    </div>
                  </div>
                ))}
                {topPokemon.length === 0 && <div className="match-history-empty">No auction data yet.</div>}
              </div>
            </article>
            <article className="stats-panel">
              <h2>Recent Winning Auctions</h2>
              <div className="panel-list compact">
                {recentWinningAuctions.map((auction: StatsAuction) => {
                  const winnerKey = auction.winning_user_id || auction.winning_guest_id || '';
                  const winnerName = playersById.get(winnerKey)?.user_name || winnerKey || 'Unknown';
                  return (
                    <div className="auction-row" key={auction.auction_id}>
                      <div>
                        <div className="strong">#{auction.pokedex_id} {toLabel(auction.form || 'base')}</div>
                        <div className="muted mono">Draft {auction.draft_id}</div>
                      </div>
                      <div className="auction-metrics">
                        <span>${(auction.winning_bid ?? 0).toLocaleString()}</span>
                        <span>{winnerName}</span>
                      </div>
                    </div>
                  );
                })}
                {recentWinningAuctions.length === 0 && <div className="match-history-empty">No recent wins yet.</div>}
              </div>
            </article>
          </section>
        )}

        {activeTab === 'players' && (
          <section className="stats-content-grid">
            <article className="stats-panel">
              <h2>Player Performance</h2>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Player</th>
                      <th>Drafts</th>
                      <th>Wins</th>
                      <th>Top 4</th>
                      <th>Avg Placement</th>
                      <th>Total Spend</th>
                      <th>Spend / Draft</th>
                    </tr>
                  </thead>
                  <tbody>
                    {playerSummary.map((player) => (
                      <tr key={player.key}>
                        <td>{player.name}</td>
                        <td>{player.draftsPlayed}</td>
                        <td>{player.wins}</td>
                        <td>{player.topFour}</td>
                        <td>{player.avgPlacement ?? '-'}</td>
                        <td>${player.totalSpend.toLocaleString()}</td>
                        <td>${player.avgSpendPerDraft.toLocaleString()}</td>
                      </tr>
                    ))}
                    {playerSummary.length === 0 && (
                      <tr>
                        <td colSpan={7} className="empty-cell">No player stats available.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </article>
          </section>
        )}

        {activeTab === 'pokemon' && (
          <section className="stats-content-grid">
            <article className="stats-panel">
              <h2>Pokemon Auction Outcomes</h2>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Pokemon</th>
                      <th>Form</th>
                      <th>Auctions Won</th>
                      <th>Total Spend</th>
                      <th>Avg Winning Bid</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pokemonSummary.map((entry) => (
                      <tr key={entry.key}>
                        <td>#{entry.pokedex_id}</td>
                        <td>{toLabel(entry.form || 'base')}</td>
                        <td>{entry.bidsWon}</td>
                        <td>${entry.totalSpend.toLocaleString()}</td>
                        <td>${entry.avgWinningBid.toLocaleString()}</td>
                      </tr>
                    ))}
                    {pokemonSummary.length === 0 && (
                      <tr>
                        <td colSpan={5} className="empty-cell">No pokemon stats available.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </article>
          </section>
        )}

        {activeTab === 'drafts' && (
          <section className="stats-content-grid">
            <article className="stats-panel">
              <h2>Draft Breakdown</h2>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Draft ID</th>
                      <th>Teams</th>
                      <th>Winning Auctions</th>
                      <th>Avg Winning Bid</th>
                      <th>Highest Bid</th>
                    </tr>
                  </thead>
                  <tbody>
                    {draftSummary.map((draft) => (
                      <tr key={draft.draftId}>
                        <td className="mono">{draft.draftId}</td>
                        <td>{draft.teamCount}</td>
                        <td>{draft.auctionCount}</td>
                        <td>${draft.avgWinningBid.toLocaleString()}</td>
                        <td>${draft.highestBid.toLocaleString()}</td>
                      </tr>
                    ))}
                    {draftSummary.length === 0 && (
                      <tr>
                        <td colSpan={5} className="empty-cell">No draft stats available.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </article>
          </section>
        )}

        {activeTab === 'player-search' && (
          <section className="stats-content-grid">
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
                        const isRanked = team.post_match_mmr !== null || team.placement !== null;
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
                                <span className="mmr">{team.post_match_mmr ?? '-'} MMR</span>
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
                                    src={getPokemonSprite(auction.pokedex_id)}
                                    alt={`${auction.pokedex_id}`}
                                    onError={(ev) => {
                                      (ev.currentTarget as HTMLImageElement).style.opacity = '0.35';
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
        )}
      </main>
    </div>
  );
};

export default Stats;
