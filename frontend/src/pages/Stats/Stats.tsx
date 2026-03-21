import React, { useEffect, useMemo, useState } from 'react';
import Header from '../../shared/components/Header';
import { fetchStatsPageData, fetchMatchHistoryByUserId } from '../../shared/api/stats';
import { StatsAuction, StatsPagePlayer, StatsPageResponse, StatsPageTeamRow, MatchHistoryTeam } from '../../types';
import './Stats.scss';

type StatsTab = 'overview' | 'pokemon' | 'drafts' | 'player-search';

interface PokemonAggregate {
  key: string;
  pokedex_id: number;
  name: string;
  form: string;
  bidsWon: number;
  totalSpend: number;
  avgWinningBid: number;
  minBid: number;
  maxBid: number;
  priceVariance: number;
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

function formatPokemonName(name: string): string {
  return name.toLowerCase()
    .replace(/ /g, '-')
    .replace(/[.:']/g, '')
    .replace(/♀/g, '-f')
    .replace(/♂/g, '-m');
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
  const [minAuctionsFilter, setMinAuctionsFilter] = useState<number>(40);
  const [sortConfig, setSortConfig] = useState<{ key: keyof PokemonAggregate; direction: 'asc' | 'desc' }>({
    key: 'avgWinningBid',
    direction: 'desc',
  });
  const [expandedDraftId, setExpandedDraftId] = useState<string | null>(null);

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

  const handleSort = (key: keyof PokemonAggregate) => {
    setSortConfig((current) => ({
      key,
      direction: current.key === key && current.direction === 'desc' ? 'asc' : 'desc',
    }));
  };

  const validDraftIds = useMemo(() => {
    if (!stats?.auctions) return new Set<string>();

    const counts = new Map<string, number>();
    stats.auctions.forEach((a) => {
      if (a.winning_bid !== null) {
        counts.set(a.draft_id, (counts.get(a.draft_id) || 0) + 1);
      }
    });

    const valid = new Set<string>();
    counts.forEach((count, id) => {
      if (count >= minAuctionsFilter) {
        valid.add(id);
      }
    });
    return valid;
  }, [stats?.auctions, minAuctionsFilter]);

  const sortedAuctions = useMemo(() => {
    const sorted = [...(stats?.auctions ?? [])]
      .filter((auction) => auction.winning_bid !== null && validDraftIds.has(auction.draft_id))
      .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
    console.log('[Stats] Computed sortedAuctions:', sorted.length, 'auctions with winning bids');
    return sorted;
  }, [stats?.auctions, validDraftIds]);

  const aggregatedPokemon = useMemo<PokemonAggregate[]>(() => {
    const grouped = new Map<string, {
      key: string;
      pokedex_id: number;
      name: string;
      form: string;
      bids: number[];
    }>();

    sortedAuctions.forEach((auction) => {
      const key = `${auction.pokedex_id}:${auction.form || ''}`;
      let existing = grouped.get(key);
      if (!existing) {
        existing = {
          key,
          pokedex_id: auction.pokedex_id,
          name: auction.name,
          form: auction.form,
          bids: []
        };
        grouped.set(key, existing);
      }
      if (auction.winning_bid !== null) {
        existing.bids.push(auction.winning_bid);
      }
    });

    return Array.from(grouped.values())
      .map((entry) => {
        const count = entry.bids.length;
        const sum = entry.bids.reduce((a, b) => a + b, 0);
        const avg = count > 0 ? Math.round(sum / count) : 0;
        const min = count > 0 ? Math.min(...entry.bids) : 0;
        const max = count > 0 ? Math.max(...entry.bids) : 0;
        
        // Calculate Standard Deviation for Price Variance
        let stdDev = 0;
        if (count > 0) {
          const sqDiffSum = entry.bids.reduce((a, b) => a + Math.pow(b - avg, 2), 0);
          stdDev = Math.sqrt(sqDiffSum / count);
        }

        return {
          key: entry.key,
          pokedex_id: entry.pokedex_id,
          name: entry.name,
          form: entry.form,
          bidsWon: count,
          totalSpend: sum,
          avgWinningBid: avg,
          minBid: min,
          maxBid: max,
          priceVariance: Math.round(stdDev),
        };
      });
  }, [sortedAuctions]);

  const pokemonSummary = useMemo<PokemonAggregate[]>(() => {
    const result = [...aggregatedPokemon].sort((a, b) => {
      const { key, direction } = sortConfig;
      if (a[key] < b[key]) return direction === 'asc' ? -1 : 1;
      if (a[key] > b[key]) return direction === 'asc' ? 1 : -1;
      return 0;
    });
    console.log('[Stats] Computed pokemonSummary:', result.length, 'unique pokemon');
    return result;
  }, [aggregatedPokemon, sortConfig]);

  const topPokemon = useMemo(() => {
    return [...aggregatedPokemon].sort((a, b) => b.avgWinningBid - a.avgWinningBid).slice(0, 8);
  }, [aggregatedPokemon]);

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

    (stats?.teams ?? [])
      .filter((team) => validDraftIds.has(team.draft_id))
      .forEach(addTeamAggregate);

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
      if (!validDraftIds.has(team.draft_id)) return;
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
  }, [sortedAuctions, stats?.teams, validDraftIds]);

  const recentWinningAuctions = sortedAuctions.slice(0, 12);

  const kpis = useMemo(() => {
    const uniqueDrafts = new Set((stats?.teams ?? []).filter(t => validDraftIds.has(t.draft_id)).map((team) => team.draft_id)).size;
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
  }, [playerSummary.length, sortedAuctions, stats?.teams, validDraftIds]);

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
        <div className="stats-filter-bar">
          <label className="stats-filter-label">
            Include only drafts of minimum size
            <input
              className="stats-filter-input"
              type="number"
              min={0}
              value={minAuctionsFilter}
              onChange={(e) => setMinAuctionsFilter(Math.max(0, Number(e.target.value)))}
            />
          </label>
        </div>
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
            <div className="kpi-label">Total Sales</div>
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
              <h2>Most Sold Pokemon</h2>
              <div className="panel-list">
                {topPokemon.map((entry) => (
                  <div className="stats-pokemon-row" key={entry.key}>
                    <div className="stats-pokemon-ident">
                      <img
                        src={`/baseforms/${entry.name}.png`}
                        alt={entry.name}
                        style={{ width: '40px', height: '40px', objectFit: 'contain' }}
                        onError={(ev) => {
                          (ev.currentTarget as HTMLImageElement).style.display = 'none';
                        }}
                      />
                      <div>
                        <div className="strong">{entry.name}</div>
                        {entry.form && entry.form !== 'base' && <div className="muted">{toLabel(entry.form)}</div>}
                      </div>
                    </div>
                    <div className="stats-pokemon-metrics">
                      <span>{entry.bidsWon} sales</span>
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
                        <div className="strong">{auction.name} {auction.form && auction.form !== 'base' ? toLabel(auction.form) : ''}</div>
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

        {activeTab === 'pokemon' && (
          <section className="stats-content-grid">
            <article className="stats-panel">
              <h2>Pokemon Auction Outcomes</h2>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th className="sortable" onClick={() => handleSort('name')}>
                        Pokemon {sortConfig.key === 'name' ? (sortConfig.direction === 'asc' ? '↑' : '↓') : ''}
                      </th>
                      <th className="sortable" onClick={() => handleSort('avgWinningBid')}>
                        Avg Winning Bid {sortConfig.key === 'avgWinningBid' ? (sortConfig.direction === 'asc' ? '↑' : '↓') : ''}
                      </th>
                      <th className="sortable" onClick={() => handleSort('minBid')}>
                        Lowest Cost {sortConfig.key === 'minBid' ? (sortConfig.direction === 'asc' ? '↑' : '↓') : ''}
                      </th>
                      <th className="sortable" onClick={() => handleSort('maxBid')}>
                        Highest Cost {sortConfig.key === 'maxBid' ? (sortConfig.direction === 'asc' ? '↑' : '↓') : ''}
                      </th>
                      <th className="sortable" onClick={() => handleSort('priceVariance')}>
                        Price Variance {sortConfig.key === 'priceVariance' ? (sortConfig.direction === 'asc' ? '↑' : '↓') : ''}
                      </th>
                      <th className="sortable" onClick={() => handleSort('bidsWon')}>
                        Total Sales {sortConfig.key === 'bidsWon' ? (sortConfig.direction === 'asc' ? '↑' : '↓') : ''}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {pokemonSummary.map((entry) => (
                      <tr key={entry.key}>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <img
                              src={`/MiniIcons/${formatPokemonName(entry.name)}.png`}
                              alt={entry.name}
                              style={{ width: 'auto', height: 'auto', maxWidth: '20px', maxHeight: '20px', objectFit: 'contain' }}
                              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                            />
                            <span>{entry.name} {entry.form && entry.form !== 'base' ? `(${toLabel(entry.form)})` : ''}</span>
                          </div>
                        </td>
                        <td>${entry.avgWinningBid.toLocaleString()}</td>
                        <td>${entry.minBid.toLocaleString()}</td>
                        <td>${entry.maxBid.toLocaleString()}</td>
                        <td>±${entry.priceVariance.toLocaleString()}</td>
                        <td>{entry.bidsWon}</td>
                      </tr>
                    ))}
                    {pokemonSummary.length === 0 && (
                      <tr>
                        <td colSpan={6} className="empty-cell">No pokemon stats available.</td>
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
                      <React.Fragment key={draft.draftId}>
                        <tr
                          className="draft-row-clickable"
                          onClick={() => setExpandedDraftId((prev) => (prev === draft.draftId ? null : draft.draftId))}
                        >
                          <td className="mono">{draft.draftId}</td>
                          <td>{draft.teamCount}</td>
                          <td>{draft.auctionCount}</td>
                          <td>${draft.avgWinningBid.toLocaleString()}</td>
                          <td>${draft.highestBid.toLocaleString()}</td>
                        </tr>
                        {expandedDraftId === draft.draftId && (
                          <tr className="draft-details-row">
                            <td colSpan={5}>
                              <div className="draft-details-grid">
                                {sortedAuctions
                                  .filter((a) => a.draft_id === draft.draftId)
                                  .sort((a, b) => (b.winning_bid ?? 0) - (a.winning_bid ?? 0))
                                  .map((auction) => {
                                    const winnerKey = auction.winning_user_id || auction.winning_guest_id || '';
                                    const winnerName = playersById.get(winnerKey)?.user_name || winnerKey || '-';
                                    return (
                                      <div className="draft-detail-card" key={auction.auction_id} title={`${auction.name} - $${auction.winning_bid}`}>
                                        <img
                                          src={`/baseforms/${auction.name}.png`}
                                          alt={auction.name}
                                          onError={(ev) => {
                                            (ev.currentTarget as HTMLImageElement).style.display = 'none';
                                          }}
                                        />
                                        <div className="pokemon-name">{auction.name}</div>
                                        <div className="pokemon-price">${(auction.winning_bid ?? 0).toLocaleString()}</div>
                                        <div className="pokemon-winner">{winnerName}</div>
                                      </div>
                                    );
                                  })}
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
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
        )}
      </main>
    </div>
  );
};

export default Stats;
