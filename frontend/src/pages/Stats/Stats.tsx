import React, { useEffect, useMemo, useState } from 'react';
import Header from '../../shared/components/Header';
import { fetchStatsPageData, fetchMatchHistoryByUserId } from '../../shared/api/stats';
import { StatsAuction, StatsPagePlayer, StatsPageResponse, StatsPageTeamRow, MatchHistoryTeam } from '../../types';
import './Stats.scss';

type StatsTab = 'pokemon' | 'drafts' | 'player-search';

interface PokemonAggregate {
  key: string;
  name: string;
  form: string;
  bidsWon: number;
  totalSpend: number;
  avgWinningBid: number;
  minBid: number;
  maxBid: number;
  priceVariance: number;
  rank: number;
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

interface PokemonSaleRow {
  key: string;
  name: string;
  form: string;
  bid: number;
}

const excludedPokemonNames = new Set([
  'Bombirdier',
  'Larvesta',
  'Hawlucha',
  'Falinks',
  'Absol',
  'Miltank',
  'Stonjourner',
  'Klawf',
  'Turtonator',
]);

function formatPokemonName(name: string): string {
  const cleaned = name.toLowerCase().replace(/'/g, '');
  if (cleaned === 'farfetchd galar' || cleaned === 'farfetchd-galar') {
    return 'farfetch\'d';
  }
  return cleaned;
}

function toLabel(value: string): string {
  return value
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

function parseLegacyCost(cost: string): number | null {
  const normalized = cost.trim().replace(/,/g, '');
  return /^\d+$/.test(normalized) ? Number(normalized) : null;
}

function getPriceColor(price: number): string {
  // 5000+ is red (Hue 0)
  // 1250 and below is purple (Hue 270)
  // Intervals of 250
  if (price >= 5000) return 'hsla(0, 85%, 45%, 0.35)';
  if (price <= 1250) return 'hsla(270, 85%, 45%, 0.35)';

  const maxPrice = 5000;
  const minPrice = 1250;
  const range = maxPrice - minPrice;
  const stepSize = 250;
  
  const stepIndex = Math.floor((maxPrice - price) / stepSize);
  const hue = (stepIndex / (range / stepSize)) * 270;
  return `hsla(${hue}, 85%, 45%, 0.35)`;
}

function calculateQuantile(sortedData: number[], q: number) {
  const pos = (sortedData.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sortedData[base + 1] !== undefined) {
    return sortedData[base] + rest * (sortedData[base + 1] - sortedData[base]);
  }
  return sortedData[base];
}

const Stats: React.FC = () => {
  const [stats, setStats] = useState<StatsPageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<StatsTab>('pokemon');
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
          legacyCount: data.legacy?.length ?? 0,
        });

        // Preload mini icons so the animation doesn't start until they are ready
        const uniqueNames = new Set<string>();
        data.auctions.forEach((a) => uniqueNames.add(a.name));
        data.legacy?.forEach((l: any) => uniqueNames.add(l.pokemon));

        await Promise.all(Array.from(uniqueNames).map((name) => {
          return new Promise<void>((resolve) => {
            const img = new Image();
            img.src = `/MiniIcons/${formatPokemonName(name)}.png`;
            img.onload = () => resolve();
            img.onerror = () => resolve();
          });
        }));

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
      .filter((player) => !player.is_guest)
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

  const draftAuctionCounts = useMemo(() => {
    const counts = new Map<string, number>();
    (stats?.auctions ?? []).forEach((a) => {
      if (a.winning_bid !== null) {
        counts.set(a.draft_id, (counts.get(a.draft_id) || 0) + 1);
      }
    });
    return counts;
  }, [stats?.auctions]);

  const validDraftIds = useMemo(() => {
    const valid = new Set<string>();
    draftAuctionCounts.forEach((count, id) => {
      if (count >= minAuctionsFilter) {
        valid.add(id);
      }
    });
    return valid;
  }, [draftAuctionCounts, minAuctionsFilter]);

  const hiddenDraftCount = useMemo(() => {
    let hidden = 0;
    draftAuctionCounts.forEach((count) => {
      if (count < minAuctionsFilter) {
        hidden += 1;
      }
    });
    return hidden;
  }, [draftAuctionCounts, minAuctionsFilter]);

  const sortedAuctions = useMemo(() => {
    const sorted = [...(stats?.auctions ?? [])]
      .filter((auction) => auction.winning_bid !== null && validDraftIds.has(auction.draft_id) && !excludedPokemonNames.has(auction.name))
      .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
    console.log('[Stats] Computed sortedAuctions:', sorted.length, 'auctions with winning bids');
    return sorted;
  }, [stats?.auctions, validDraftIds]);

  const aggregatedPokemon = useMemo<PokemonAggregate[]>(() => {
    const sales: PokemonSaleRow[] = [];

    sortedAuctions.forEach((auction) => {
      const bid = auction.winning_bid;
      if (bid === null) {
        return;
      }
      sales.push({
        key: `${auction.pokedex_id}:${auction.form || ''}`,
        name: auction.name,
        form: auction.form || '',
        bid,
      });
    });

    (stats?.legacy ?? []).forEach((legacyRow) => {
      const bid = parseLegacyCost(legacyRow.cost);
      if (bid === null) {
        return;
      }
      if (excludedPokemonNames.has(legacyRow.pokemon)) {
        return;
      }
      sales.push({
        key: `legacy:${legacyRow.pokemon}`,
        name: legacyRow.pokemon,
        form: '',
        bid,
      });
    });

    const grouped = new Map<string, {
      key: string;
      name: string;
      form: string;
      bids: number[];
    }>();

    sales.forEach((sale) => {
      const key = sale.key;
      let existing = grouped.get(key);
      if (!existing) {
        existing = {
          key,
          name: sale.name,
          form: sale.form,
          bids: []
        };
        grouped.set(key, existing);
      }
      existing.bids.push(sale.bid);
    });

    let results = Array.from(grouped.values())
      .map((entry) => {
        // Filter out sales of exactly 100
        let bids = entry.bids.filter(b => b !== 100);

        // If no bids remain after filtering, exclude this pokemon
        if (bids.length === 0) return null;
        
        if (bids.length > 1) {
          const sortedBids = [...bids].sort((a, b) => a - b);
          const q1 = calculateQuantile(sortedBids, 0.25);
          const q3 = calculateQuantile(sortedBids, 0.75);
          const iqr = q3 - q1;
          const lower = q1 - 1.5 * iqr;
          const upper = q3 + 2.0 * iqr;
          bids = sortedBids.filter((b) => b >= lower && b <= upper);
        }

        // If no bids remain after outlier removal, also exclude
        if (bids.length === 0) {
          return null;
        }

        const count = bids.length;
        const sum = bids.reduce((a, b) => a + b, 0);
        const avg = count > 0 ? Math.round(sum / count) : 0;
        const min = count > 0 ? Math.min(...bids) : 0;
        const max = count > 0 ? Math.max(...bids) : 0;
        
        // Calculate Standard Deviation for Price Variance
        let stdDev = 0;
        if (count > 0) {
          const sqDiffSum = bids.reduce((a, b) => a + Math.pow(b - avg, 2), 0);
          stdDev = Math.sqrt(sqDiffSum / count);
        }

        return {
          key: entry.key,
          name: entry.name,
          form: entry.form,
          bidsWon: count,
          totalSpend: sum,
          avgWinningBid: avg,
          minBid: min,
          maxBid: max,
          priceVariance: Math.round(stdDev),
          rank: 0, // Placeholder
        };
      }).filter((p): p is PokemonAggregate => p !== null);

    // Calculate rank based on avgWinningBid descending
    results.sort((a, b) => b.avgWinningBid - a.avgWinningBid);
    results.forEach((p, i) => p.rank = i + 1);
    return results;
  }, [sortedAuctions, stats?.legacy]);

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

  const kpis = useMemo(() => {
    const uniqueDrafts = new Set((stats?.teams ?? []).filter(t => validDraftIds.has(t.draft_id)).map((team) => team.draft_id)).size;
    const uniquePlayers = playerSummary.length;

    const allSales = [
      ...sortedAuctions
        .map((auction) => auction.winning_bid)
        .filter((bid): bid is number => bid !== null),
      ...(stats?.legacy ?? [])
        .map((legacyRow) => parseLegacyCost(legacyRow.cost))
        .filter((bid): bid is number => bid !== null),
    ];

    const totalMoneySpent = allSales.reduce((sum, bid) => sum + bid, 0);

    const result = {
      uniqueDrafts,
      uniquePlayers,
      totalWinningAuctions: allSales.length,
      totalMoneySpent,
    };

    console.log('[Stats] KPIs computed:', {
      uniqueDrafts,
      uniquePlayers,
      totalWinningAuctions: allSales.length,
      totalMoneySpent,
    });

    return result;
  }, [playerSummary.length, sortedAuctions, stats?.legacy, stats?.teams, validDraftIds]);

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
            Include only drafts of minimum size ({hiddenDraftCount} hidden)
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
          <article className="kpi-card stats-row-animate" style={{ animationDelay: '0ms' }}>
            <div className="kpi-label">Completed Drafts</div>
            <div className="kpi-value">{kpis.uniqueDrafts}</div>
          </article>
          <article className="kpi-card stats-row-animate" style={{ animationDelay: '50ms' }}>
            <div className="kpi-label">Tracked Players</div>
            <div className="kpi-value">{kpis.uniquePlayers}</div>
          </article>
          <article className="kpi-card stats-row-animate" style={{ animationDelay: '100ms' }}>
            <div className="kpi-label">Total Sales</div>
            <div className="kpi-value">{kpis.totalWinningAuctions}</div>
          </article>
          <article className="kpi-card stats-row-animate" style={{ animationDelay: '150ms' }}>
            <div className="kpi-label">Total Money Spent</div>
            <div className="kpi-value">${kpis.totalMoneySpent.toLocaleString()}</div>
          </article>
        </section>

        <section className="stats-tab-bar" aria-label="Stats tabs">
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

        {activeTab === 'pokemon' && (
          <section className="stats-content-grid">
            <article className="stats-panel">
              <h2>Cost Breakdown</h2>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th className="sortable" onClick={() => handleSort('rank')}>
                        Rank {sortConfig.key === 'rank' ? (sortConfig.direction === 'asc' ? '↑' : '↓') : ''}
                      </th>
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
                    {pokemonSummary.map((entry, index) => (
                      <tr key={entry.key} className="stats-row-animate" style={{ animationDelay: `${200 + index * 30}ms` }}>
                        <td style={{ backgroundColor: getPriceColor(entry.avgWinningBid) }}>{entry.rank}</td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                            <div style={{ width: '32px', display: 'flex', justifyContent: 'center', flexShrink: 0 }}>
                              <img
                                src={`/MiniIcons/${formatPokemonName(entry.name)}.png`}
                                alt={entry.name}
                                style={{ width: 'auto', height: 'auto', maxWidth: '32px', maxHeight: '32px', objectFit: 'contain' }}
                                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                              />
                            </div>
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
                        <td colSpan={7} className="empty-cell">No pokemon stats available.</td>
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
                      <th>Players</th>
                      <th>Pokemon Sold</th>
                      <th>Avg Winning Bid</th>
                      <th>Highest Bid</th>
                    </tr>
                  </thead>
                  <tbody>
                    {draftSummary.map((draft, index) => (
                      <React.Fragment key={draft.draftId}>
                        <tr
                          className="draft-row-clickable stats-row-animate"
                          style={{ animationDelay: `${200 + index * 30}ms` }}
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

                      {playerMatchHistory.map((team, index) => {
                        const auctions = team.pokemon_drafted || [];
                        const isRanked = team.pre_match_mmr !== null || team.placement !== null;
                        const result = !isRanked ? 'Unknown' : team.placement === 1 ? 'Win' : 'Loss';
                        const resultClass = result === 'Win' ? 'win' : result === 'Loss' ? 'loss' : 'unknown';

                        return (
                          <div 
                            className={`match-timeline-row ${resultClass} stats-row-animate`} 
                            key={team.team_id}
                            style={{ animationDelay: `${100 + index * 30}ms` }}
                          >
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
