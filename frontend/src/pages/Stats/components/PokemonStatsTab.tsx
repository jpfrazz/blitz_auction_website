import React, { useMemo, useState } from 'react';
import { StatsPageResponse } from '../../../types';
import '../Stats.scss';
import './PokemonStatsTab.scss';

type SortKey = 'rank' | 'name' | 'avgWinningBid' | 'minBid' | 'maxBid' | 'priceVariance' | 'bidsWon';

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

interface PokemonSaleRow {
  key: string;
  name: string;
  form: string;
  bid: number;
}

interface PokemonStatsTabProps {
  stats: StatsPageResponse | null;
  loading?: boolean;
  error?: string | null;
  minAuctionsFilter?: number;
  onMinAuctionsFilterChange?: (value: number) => void;
  showDraftSizeFilter?: boolean;
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

const PokemonStatsTab: React.FC<PokemonStatsTabProps> = ({
  stats,
  loading = false,
  error = null,
  minAuctionsFilter,
  onMinAuctionsFilterChange,
  showDraftSizeFilter = true,
}) => {
  const [internalMinAuctionsFilter, setInternalMinAuctionsFilter] = useState<number>(40);
  const [pokemonSearch, setPokemonSearch] = useState('');
  const [sortConfig, setSortConfig] = useState<{ key: SortKey; direction: 'asc' | 'desc' }>({
    key: 'avgWinningBid',
    direction: 'desc',
  });

  const resolvedMinAuctionsFilter = minAuctionsFilter ?? internalMinAuctionsFilter;

  const setResolvedMinAuctionsFilter = (nextValue: number) => {
    if (onMinAuctionsFilterChange) {
      onMinAuctionsFilterChange(nextValue);
      return;
    }
    setInternalMinAuctionsFilter(nextValue);
  };

  const handleSort = (key: SortKey) => {
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
      if (count >= resolvedMinAuctionsFilter) {
        valid.add(id);
      }
    });
    return valid;
  }, [draftAuctionCounts, resolvedMinAuctionsFilter]);

  const hiddenDraftCount = useMemo(() => {
    let hidden = 0;
    draftAuctionCounts.forEach((count) => {
      if (count < resolvedMinAuctionsFilter) {
        hidden += 1;
      }
    });
    return hidden;
  }, [draftAuctionCounts, resolvedMinAuctionsFilter]);

  const sortedAuctions = useMemo(() => {
    return [...(stats?.auctions ?? [])]
      .filter((auction) => auction.winning_bid !== null && validDraftIds.has(auction.draft_id) && !excludedPokemonNames.has(auction.name))
      .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  }, [stats?.auctions, validDraftIds]);

  const aggregatedPokemon = useMemo<PokemonAggregate[]>(() => {
    const sales: PokemonSaleRow[] = [];

    sortedAuctions.forEach((auction) => {
      const bid = auction.winning_bid;
      if (bid === null) {
        return;
      }
      sales.push({
        key: `${auction.name}${auction.form && auction.form !== 'base' ? '-' + auction.form : ''}`,
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
        key: legacyRow.pokemon,
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
      let existing = grouped.get(sale.key);
      if (!existing) {
        existing = {
          key: sale.key,
          name: sale.name,
          form: sale.form,
          bids: [],
        };
        grouped.set(sale.key, existing);
      }
      existing.bids.push(sale.bid);
    });

    let results = Array.from(grouped.values()).map((entry) => {
      let bids = entry.bids;

      if (bids.length > 1) {
        const sortedBids = [...bids].sort((a, b) => a - b);
        const q1 = calculateQuantile(sortedBids, 0.25);
        const q3 = calculateQuantile(sortedBids, 0.75);
        const iqr = q3 - q1;
        const lower = q1 - 1.5 * iqr;
        const upper = q3 + 2.0 * iqr;
        bids = sortedBids.filter((b) => b >= lower && b <= upper);
      }

      const count = bids.length;
      const sum = bids.reduce((a, b) => a + b, 0);
      const avg = count > 0 ? Math.round(sum / count) : 0;
      const min = count > 0 ? Math.min(...bids) : 0;
      const max = count > 0 ? Math.max(...bids) : 0;

      const priceVariance = max - min;

      return {
        key: entry.key,
        name: entry.name,
        form: entry.form,
        bidsWon: count,
        totalSpend: sum,
        avgWinningBid: avg,
        minBid: min,
        maxBid: max,
        priceVariance,
        rank: 0,
      };
    });

    results = results.filter((p) => p.avgWinningBid > 100);
    results.sort((a, b) => b.avgWinningBid - a.avgWinningBid);
    results.forEach((p, i) => {
      p.rank = i + 1;
    });
    return results;
  }, [sortedAuctions, stats?.legacy]);

  const pokemonSummary = useMemo<PokemonAggregate[]>(() => {
    return [...aggregatedPokemon].sort((a, b) => {
      const { key, direction } = sortConfig;
      if (a[key] < b[key]) return direction === 'asc' ? -1 : 1;
      if (a[key] > b[key]) return direction === 'asc' ? 1 : -1;
      return 0;
    });
  }, [aggregatedPokemon, sortConfig]);

  const filteredPokemonSummary = useMemo(() => {
    const query = pokemonSearch.trim().toLowerCase();
    if (!query) {
      return pokemonSummary;
    }

    return pokemonSummary.filter((entry) => entry.name.toLowerCase().includes(query));
  }, [pokemonSummary, pokemonSearch]);

  if (loading) {
    return <section className="pokemon-stats-tab stats-content-grid">Loading stats...</section>;
  }

  if (error) {
    return (
      <section className="pokemon-stats-tab stats-content-grid">
        <div className="match-history-error">{error}</div>
      </section>
    );
  }

  return (
    <section className="pokemon-stats-tab">
      <div className="pokemon-stats-controls">
        {showDraftSizeFilter && (
          <div className="stats-filter-bar">
            <label className="stats-filter-label">
              Include only drafts of minimum size ({hiddenDraftCount} hidden)
              <input
                className="stats-filter-input"
                type="number"
                min={0}
                value={resolvedMinAuctionsFilter}
                onChange={(e) => setResolvedMinAuctionsFilter(Math.max(0, Number(e.target.value)))}
              />
            </label>
          </div>
        )}

        <div className="pokemon-search-bar">
          <input
            className="pokemon-search-input"
            type="text"
            placeholder="Search Pokemon name..."
            value={pokemonSearch}
            onChange={(e) => setPokemonSearch(e.target.value)}
          />
        </div>
      </div>

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
                {filteredPokemonSummary.map((entry, index) => (
                  <tr key={entry.key} className="stats-row-animate" style={{ animationDelay: `${200 + index * 30}ms` }}>
                    <td style={{ backgroundColor: getPriceColor(entry.avgWinningBid) }}>{entry.rank}</td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <div style={{ width: '32px', display: 'flex', justifyContent: 'center', flexShrink: 0 }}>
                          <img
                            src={`/MiniIcons/${formatPokemonName(entry.name)}.png`}
                            alt={entry.name}
                            style={{ width: 'auto', height: 'auto', maxWidth: '32px', maxHeight: '32px', objectFit: 'contain' }}
                            onError={(e) => {
                              (e.target as HTMLImageElement).style.display = 'none';
                            }}
                          />
                        </div>
                        <span>{entry.name} {entry.form && entry.form !== 'base' ? `(${toLabel(entry.form)})` : ''}</span>
                      </div>
                    </td>
                    <td>${entry.avgWinningBid.toLocaleString()}</td>
                    <td>${entry.minBid.toLocaleString()}</td>
                    <td>${entry.maxBid.toLocaleString()}</td>
                    <td>{entry.priceVariance.toLocaleString()}</td>
                    <td>{entry.bidsWon}</td>
                  </tr>
                ))}
                {filteredPokemonSummary.length === 0 && (
                  <tr>
                    <td colSpan={7} className="empty-cell">No pokemon stats available.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </article>
      </section>
    </section>
  );
};

export default PokemonStatsTab;