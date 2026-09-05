import React, { useEffect, useMemo, useState } from 'react';
import PokemonPriceHistoryChart from '../PokemonPriceHistoryChart';
import { fetchPokemonList } from '../../../shared/api/pokemon';
import { Pokemon, StatsPageResponse } from '../../../types';
import { TbSettings, TbRefresh } from 'react-icons/tb';
import '../Stats.scss';
import './PokemonStatsTab.scss';

type SortKey = 'rank' | 'name' | 'avgWinningBid' | 'minBid' | 'maxBid' | 'priceVariance' | 'bidsWon' | 'recentMovement' | 'priceMovement';

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
  recentMovement: number;
  priceMovement: number;
  types: string[];
}

interface PokemonSaleRow {
  key: string;
  name: string;
  form: string;
  bid: number;
  types: string[];
}

interface PokemonStatsTabProps {
  stats: StatsPageResponse | null;
  loading?: boolean;
  error?: string | null;
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

const formOverrides: Record<string, { form: string; key: string }> = {
  'Wooper': { form: 'Paldea', key: 'Wooper-Paldea' },
  'Vulpix': { form: 'Alola', key: 'Vulpix-Alola' },
  'Voltorb': { form: 'Hisui', key: 'Voltorb-Hisui' },
  "Farfetch'd": { form: 'Galar', key: "Farfetch'd-Galar" },
  'Sandshrew': { form: 'Alola', key: 'Sandshrew-Alola' },
  'Meowth': { form: 'Galar', key: 'Meowth-Galar' },
  'Slowpoke': { form: 'Galar', key: 'Slowpoke-Galar' },
  'Zigzagoon': { form: 'Galar', key: 'Zigzagoon-Galar' },
};

const resolveIdentity = (name: string, form: string) => {
  let currentName = name;
  let currentForm = form;

  // Handle names that include the form, e.g., "Farfetch'd-Galar"
  const knownForms = ['Alola', 'Galar', 'Hisui', 'Paldea'];
  for (const f of knownForms) {
    if (currentName.endsWith(`-${f}`)) {
      currentName = currentName.slice(0, -(f.length + 1));
      currentForm = f;
      break;
    }
  }

  if ((!currentForm || currentForm === 'base') && formOverrides[currentName]) {
    return { name: currentName, ...formOverrides[currentName] };
  }
  const effectiveForm = currentForm && currentForm !== 'base' ? currentForm : '';
  const key = `${currentName}${effectiveForm ? '-' + effectiveForm : ''}`;
  return { name: currentName, form: effectiveForm, key };
};

const POKEMON_TYPES = [
  'Normal', 'Fire', 'Water', 'Grass', 'Electric', 'Ice', 'Fighting', 'Poison', 'Ground',
  'Flying', 'Psychic', 'Bug', 'Rock', 'Ghost', 'Dragon', 'Dark', 'Steel', 'Fairy'
];

function formatPokemonName(name: string): string {
  const lower = name.toLowerCase();
  if (lower.startsWith("farfetch'd")) {
    return "farfetch'd";
  }
  return lower.replace(/'/g, '');
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
}) => {
  const [pokemonList, setPokemonList] = useState<Pokemon[]>([]);
  const [pokemonSearch, setPokemonSearch] = useState('');
  const [lookbackWindow, setLookbackWindow] = useState<string>('10');
  const [cutoffDate, setCutoffDate] = useState<string>('');
  const [selectedType, setSelectedType] = useState<string>('');
  const [sortConfig, setSortConfig] = useState<{ key: SortKey; direction: 'asc' | 'desc' }>({
    key: 'avgWinningBid',
    direction: 'desc',
  });
  const [showSettings, setShowSettings] = useState(false);
  const [expandedPokemon, setExpandedPokemon] = useState<string | null>(null);

  useEffect(() => {
    fetchPokemonList().then(setPokemonList).catch(console.error);
  }, []);

  const handleSort = (key: SortKey) => {
    setSortConfig((current) => ({
      key,
      direction: current.key === key && current.direction === 'desc' ? 'asc' : 'desc',
    }));
  };

  const draftStats = useMemo(() => {
    const statsMap = new Map<string, { total: number; minBidCount: number; teamCount: number; maxBid: number; latestTimestamp: number }>();

    // Count teams (players) per draft
    (stats?.teams ?? []).forEach((t) => {
      const curr = statsMap.get(t.draft_id) || { total: 0, minBidCount: 0, teamCount: 0, maxBid: 0, latestTimestamp: 0 };
      curr.teamCount += 1;
      statsMap.set(t.draft_id, curr);
    });

    (stats?.auctions ?? []).forEach((a) => {
      if (a.winning_bid !== null) {
        const curr = statsMap.get(a.draft_id) || { total: 0, minBidCount: 0, teamCount: 0, maxBid: 0, latestTimestamp: 0 };
        curr.total += 1;
        if (a.winning_bid === 100) {
          curr.minBidCount += 1;
        }
        if (a.winning_bid > curr.maxBid) {
          curr.maxBid = a.winning_bid;
        }
        const ts = a.created_at ? new Date(a.created_at).getTime() : 0;
        if (ts > curr.latestTimestamp) curr.latestTimestamp = ts;
        statsMap.set(a.draft_id, curr);
      }
    });
    return statsMap;
  }, [stats?.auctions, stats?.teams]);

  const validDraftIds = useMemo(() => {
    const valid = new Set<string>();
    // Threshold: Exclude drafts where:
    // 1. More than 3 Pokemon sold for the minimum $100.
    // 2. The total number of Pokemon sold is not 8 * players.
    // 3. Fewer than 40 Pokemon were sold.
    // 4. No single Pokemon sold for more than $12,000.
    draftStats.forEach((data, id) => {
      if (data.total >= 40 && data.minBidCount <= 3 && data.total === 8 * data.teamCount && data.maxBid <= 12000) {
        valid.add(id);
      }
    });
    return valid;
  }, [draftStats]);

  const sortedAuctions = useMemo(() => {
    const cutoff = cutoffDate ? new Date(cutoffDate).getTime() : 0;

    return [...(stats?.auctions ?? [])]
      .filter((auction) => {
        const isCompetitive = auction.winning_bid !== null && validDraftIds.has(auction.draft_id) && !excludedPokemonNames.has(auction.name);
        if (!isCompetitive) return false;
        if (cutoff > 0) {
          const ts = auction.created_at ? new Date(auction.created_at).getTime() : 0;
          return ts >= cutoff;
        }
        return true;
      })
      .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  }, [stats?.auctions, validDraftIds, cutoffDate]);

  const unifiedTimeline = useMemo(() => {
    const cutoff = cutoffDate ? new Date(cutoffDate).getTime() : 0;

    const modern = Array.from(validDraftIds).map(id => ({
      id,
      timestamp: draftStats.get(id)?.latestTimestamp || 0,
      type: 'modern' as const
    })).filter(d => d.timestamp >= cutoff);

    const uniqueLegacyDates = Array.from(new Set((stats?.legacy ?? [])
      .map(l => l.date)
      .filter((d): d is string => Boolean(d))));

    const legacy = uniqueLegacyDates.map(d => ({
      id: d,
      timestamp: new Date(d).getTime(),
      type: 'legacy' as const
    })).filter(d => d.timestamp >= cutoff);

    return [...modern, ...legacy].sort((a, b) => b.timestamp - a.timestamp);
  }, [validDraftIds, draftStats, stats?.legacy, cutoffDate]);

  const recentDraftInfo = useMemo(() => {
    let depth = parseInt(lookbackWindow) || 0;

    if (depth >= unifiedTimeline.length && unifiedTimeline.length > 1) {
      depth = unifiedTimeline.length - 1;
    }

    const sliced = unifiedTimeline.slice(0, depth);
    return {
      modern: new Set(sliced.filter(s => s.type === 'modern').map(s => s.id)),
      legacy: new Set(sliced.filter(s => s.type === 'legacy').map(s => s.id))
    };
  }, [unifiedTimeline, lookbackWindow]);

  const typeLookup = useMemo(() => {
    const map = new Map<string, string[]>();
    if (pokemonList.length === 0) return map;

    // Group children by their parent identity for fast tree traversal
    const childrenMap = new Map<string, Pokemon[]>();
    pokemonList.forEach(p => {
      if (p.evolves_from_id) {
        const parentKey = `${p.evolves_from_id}-${p.evolves_from_form ?? ''}`;
        if (!childrenMap.has(parentKey)) childrenMap.set(parentKey, []);
        childrenMap.get(parentKey)!.push(p);
      }
    });

    const getEvolutionTypes = (pkmn: Pokemon, visited = new Set<string>()): string[] => {
      const pkmnIdKey = `${pkmn.pokedex_id ?? pkmn.id}-${pkmn.form ?? ''}`;
      if (visited.has(pkmnIdKey)) return [];
      visited.add(pkmnIdKey);

      const types = new Set<string>();
      if (pkmn.type1) types.add(pkmn.type1);
      if (pkmn.type2) types.add(pkmn.type2);

      const children = childrenMap.get(pkmnIdKey) || [];
      children.forEach(child => {
        // Exclude mega forms from evolution type calculations
        if ((child.form ?? '').toLowerCase() !== 'mega') {
          getEvolutionTypes(child, visited).forEach(t => types.add(t));
        }
      });

      return Array.from(types);
    };

    pokemonList.forEach(p => {
      const resolved = resolveIdentity(p.name, p.form || '');
      // Only process entries that are canonical for their key (handling formOverrides)
      const isCanonical = resolved.form === (p.form || '') || 
                          (resolved.form === '' && (p.form === 'base' || !p.form));
      
      if (isCanonical) {
        map.set(resolved.key, getEvolutionTypes(p));
      }
    });

    return map;
  }, [pokemonList]);

  const aggregatedPokemon = useMemo<PokemonAggregate[]>(() => {
    const sales: PokemonSaleRow[] = [];

    sortedAuctions.forEach((auction) => {
      const bid = auction.winning_bid;
      if (bid === null) {
        return;
      }
      const { key, name, form } = resolveIdentity(auction.name, auction.form || '');
      const types = typeLookup.get(key) || [];

      sales.push({
        key,
        name,
        form,
        bid,
        types,
      });
    });

    (stats?.legacy ?? []).forEach((legacyRow) => {
      if (cutoffDate && legacyRow.date && new Date(legacyRow.date).getTime() < new Date(cutoffDate).getTime()) return;
      const bid = parseLegacyCost(legacyRow.cost);
      if (bid === null) {
        return;
      }
      if (excludedPokemonNames.has(legacyRow.pokemon)) {
        return;
      }

      const { name, form, key } = resolveIdentity(legacyRow.pokemon, '');
      const types = typeLookup.get(key) || [];

      sales.push({
        key,
        name,
        form,
        bid,
        types,
      });
    });

    const grouped = new Map<string, {
      key: string;
      name: string;
      form: string;
      bids: number[];
      types: string[];
    }>();

    sales.forEach((sale) => {
      let existing = grouped.get(sale.key);
      if (!existing) {
        existing = {
          key: sale.key,
          name: sale.name,
          form: sale.form,
          bids: [],
          types: sale.types,
        };
        grouped.set(sale.key, existing);
      }
      existing.bids.push(sale.bid);
    });

    // Calculate Historic Ranks
    const historicGrouped = new Map<string, number[]>();

    (stats?.legacy ?? []).forEach((legacyRow) => {
      if (cutoffDate && legacyRow.date && new Date(legacyRow.date).getTime() < new Date(cutoffDate).getTime()) return;
      const bid = parseLegacyCost(legacyRow.cost);
      if (bid === null || excludedPokemonNames.has(legacyRow.pokemon) || (legacyRow.date && recentDraftInfo.legacy.has(legacyRow.date))) return;
      const { key } = resolveIdentity(legacyRow.pokemon, '');
      if (!historicGrouped.has(key)) historicGrouped.set(key, []);
      historicGrouped.get(key)!.push(bid);
    });

    sortedAuctions.forEach((auction) => {
      if (!recentDraftInfo.modern.has(auction.draft_id) && auction.winning_bid !== null) {
        const { key } = resolveIdentity(auction.name, auction.form || '');
        if (!historicGrouped.has(key)) historicGrouped.set(key, []);
        historicGrouped.get(key)!.push(auction.winning_bid);
      }
    });

    let historicStats = Array.from(historicGrouped.entries()).map(([key, bids]) => {
      let filteredBids = bids.filter(b => b !== 100);
      if (filteredBids.length === 0) return null;

      if (filteredBids.length > 1) {
        const sortedBids = [...filteredBids].sort((a, b) => a - b);
        const q1 = calculateQuantile(sortedBids, 0.25);
        const q3 = calculateQuantile(sortedBids, 0.75);
        const iqr = q3 - q1;
        const lower = q1 - 1.5 * iqr;
        const upper = q3 + 2.0 * iqr;
        filteredBids = sortedBids.filter((b) => b >= lower && b <= upper);
      }

      if (filteredBids.length === 0) return null;

      const sum = filteredBids.reduce((a, b) => a + b, 0);
      const avg = Math.round(sum / filteredBids.length);

      return { key, avg };
    }).filter((s): s is { key: string; avg: number } => s !== null && s.avg > 100);

    historicStats.sort((a, b) => b.avg - a.avg);
    
    const historicRankMap = new Map<string, number>();
    historicStats.forEach((s, index) => {
      historicRankMap.set(s.key, index + 1);
    });

    // Calculate Overall Stats
    let results = Array.from(grouped.values()).map((entry) => {
      let bids = entry.bids.filter((b) => b !== 100);

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
        recentMovement: 0,
        priceMovement: 0,
        types: entry.types,
      };
    });

    results = results.filter((p) => p.avgWinningBid > 100);
    results.sort((a, b) => b.avgWinningBid - a.avgWinningBid);
    
    let comparativeRankCounter = 1;
    results.forEach((p, i) => {
      p.rank = i + 1;

      const prevRank = historicRankMap.get(p.key);
      if (prevRank) {
        p.recentMovement = prevRank - comparativeRankCounter;
        comparativeRankCounter++;
      } else {
        p.recentMovement = 0;
      }

      const histData = historicStats.find(s => s.key === p.key);
      p.priceMovement = histData ? p.avgWinningBid - histData.avg : 0;
    });
    return results;
  }, [sortedAuctions, stats?.legacy, recentDraftInfo, typeLookup]);

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

    return pokemonSummary.filter((entry) => {
      const searchTerms = query.split(/[,|]/).map(term => term.trim()).filter(term => term.length > 0);
      const matchesSearch = !query || searchTerms.some(term => 
        entry.name.toLowerCase().includes(term) || 
        entry.key.toLowerCase().includes(term)
      );
      const matchesType = !selectedType || entry.types.some(t => t.toLowerCase() === selectedType.toLowerCase());
      return matchesSearch && matchesType;
    });
  }, [pokemonSummary, pokemonSearch, selectedType]);

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
      <section className="stats-content-grid">
        <article className="stats-panel">
          <div className="stats-panel-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h2 style={{ margin: 0 }}>Cost Breakdown</h2>
            <div className="pokemon-search-bar" style={{ display: 'flex', alignItems: 'center' }}>
              <div className={`stats-analysis-settings ${showSettings ? 'visible' : ''}`}>
                <button
                  type="button"
                  className="stats-reset-button"
                  onClick={() => {
                    setCutoffDate('');
                    setLookbackWindow('10');
                    setSelectedType('');
                  }}
                  title="Reset analysis settings to default"
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#888',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    fontSize: '1.1rem',
                    padding: '4px',
                    flexShrink: 0,
                    transition: 'color 0.2s ease'
                  }}
                >
                  <TbRefresh />
                </button>
                <div className="stats-setting-item" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '0.85rem', color: '#888', whiteSpace: 'nowrap' }}>Cutoff Date</span>
                  <span 
                    title="Exclude all sales that occurred before this date"
                    style={{ 
                      cursor: 'help', 
                      color: '#888', 
                      fontSize: '0.7rem',
                      border: '1px solid #444',
                      borderRadius: '50%',
                      width: '14px',
                      height: '14px',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      marginLeft: '0px'
                    }}
                  >
                    i
                  </span>
                  <input
                    className="stats-filter-input"
                    type="date"
                    style={{ width: '130px' }}
                    value={cutoffDate}
                    onChange={(e) => setCutoffDate(e.target.value)}
                  />
                </div>
                <div className="stats-setting-item" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '0.85rem', color: '#888', whiteSpace: 'nowrap' }}>Lookback Window</span>
                  <span 
                    title="The number of recent drafts to use as the comparison baseline for calculating rank and price movement"
                    style={{ 
                      cursor: 'help', 
                      color: '#888', 
                      fontSize: '0.7rem',
                      border: '1px solid #444',
                      borderRadius: '50%',
                      width: '14px',
                      height: '14px',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      marginLeft: '0px'
                    }}
                  >
                    i
                  </span>
                  <input
                    className="stats-filter-input"
                    type="text"
                    inputMode="numeric"
                    style={{ width: '42px', textAlign: 'center' }}
                    value={lookbackWindow}
                    onChange={(e) => {
                      setLookbackWindow(e.target.value.replace(/\D/g, '').slice(0, 3));
                    }}
                  />
                </div>
                <div className="stats-setting-item" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '0.85rem', color: '#888', whiteSpace: 'nowrap' }}>Type</span>
                  <span 
                    title="Show only Pokemon of the selected type"
                    style={{ 
                      cursor: 'help', 
                      color: '#888', 
                      fontSize: '0.7rem',
                      border: '1px solid #444',
                      borderRadius: '50%',
                      width: '14px',
                      height: '14px',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      marginLeft: '0px'
                    }}
                  >
                    i
                  </span>
                  <select
                    className="stats-filter-input"
                    style={{ width: '86px' }}
                    value={selectedType}
                    onChange={(e) => setSelectedType(e.target.value)}
                  >
                    <option value="">All Types</option>
                    {POKEMON_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {type}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="settings-divider" style={{ width: '1px', height: '24px', backgroundColor: '#333', margin: '0 4px', flexShrink: 0 }} />
              </div>
              <button
                type="button"
                className={`stats-settings-toggle ${showSettings ? 'active' : ''}`}
                onClick={() => setShowSettings(!showSettings)}
                title="Analysis Settings"
                style={{
                  background: 'none',
                  border: 'none',
                  color: showSettings ? '#4caf50' : '#888',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  fontSize: '1.2rem',
                  padding: '4px',
                  transition: 'color 0.2s ease, transform 0.3s ease',
                  transform: showSettings ? 'rotate(90deg)' : 'rotate(0deg)'
                }}
              >
                <TbSettings size={16} />
              </button>
              <input
                className="pokemon-search-input"
                type="text"
                placeholder="Search Pokemon name..."
                value={pokemonSearch}
                onChange={(e) => setPokemonSearch(e.target.value)}
                style={{ marginLeft: '12px' }}
              />
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th className="sortable" onClick={() => handleSort('rank')}>
                    Rank {sortConfig.key === 'rank' ? (sortConfig.direction === 'asc' ? '↑' : '↓') : ''}
                  </th>
                  <th className="sortable" onClick={() => handleSort('recentMovement')}>
                    {sortConfig.key === 'recentMovement' ? (sortConfig.direction === 'asc' ? '↑' : '↓') : ''}
                  </th>
                  <th className="sortable" onClick={() => handleSort('name')}>
                    Pokemon {sortConfig.key === 'name' ? (sortConfig.direction === 'asc' ? '↑' : '↓') : ''}
                  </th>
                  <th className="sortable" onClick={() => handleSort('avgWinningBid')}>
                    Avg Price {sortConfig.key === 'avgWinningBid' ? (sortConfig.direction === 'asc' ? '↑' : '↓') : ''}
                  </th>
                  <th className="sortable" onClick={() => handleSort('priceMovement')}>
                    Price +/- {sortConfig.key === 'priceMovement' ? (sortConfig.direction === 'asc' ? '↑' : '↓') : ''}
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
                  <React.Fragment key={entry.key}>
                    <tr 
                      className={`stats-row-animate ${expandedPokemon === entry.key ? 'expanded' : ''}`} 
                      style={{ animationDelay: `${200 + index * 30}ms`, cursor: 'pointer' }}
                      onClick={() => setExpandedPokemon(expandedPokemon === entry.key ? null : entry.key)}
                    >
                    <td style={{ backgroundColor: getPriceColor(entry.avgWinningBid) }}>{entry.rank}</td>
                    <td style={{
                      backgroundColor: entry.recentMovement > 0 ? 'rgba(0, 255, 0, 0.15)' : entry.recentMovement < 0 ? 'rgba(255, 0, 0, 0.15)' : undefined,
                      fontWeight: entry.recentMovement !== 0 ? 'bold' : 'normal',
                      color: entry.recentMovement > 0 ? '#4caf50' : entry.recentMovement < 0 ? '#f44336' : 'inherit'
                    }}>
                      {entry.recentMovement > 0
                        ? `↑ ${entry.recentMovement}`
                        : entry.recentMovement < 0
                          ? `↓ ${Math.abs(entry.recentMovement)}`
                          : '-'}
                    </td>
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
                    <td style={{
                      backgroundColor: entry.priceMovement > 0 ? 'rgba(0, 255, 0, 0.15)' : entry.priceMovement < 0 ? 'rgba(255, 0, 0, 0.15)' : undefined,
                      fontWeight: entry.priceMovement !== 0 ? 'bold' : 'normal',
                      color: entry.priceMovement > 0 ? '#4caf50' : entry.priceMovement < 0 ? '#f44336' : 'inherit'
                    }}>
                      {entry.priceMovement > 0
                        ? `↑ $${entry.priceMovement.toLocaleString()}`
                        : entry.priceMovement < 0
                          ? `↓ $${Math.abs(entry.priceMovement).toLocaleString()}`
                          : '-'}
                    </td>
                    <td>${entry.minBid.toLocaleString()}</td>
                    <td>${entry.maxBid.toLocaleString()}</td>
                    <td>{entry.priceVariance.toLocaleString()}</td>
                    <td>{entry.bidsWon}</td>
                  </tr>
                    {expandedPokemon === entry.key && (
                      <tr className="price-history-dropdown-row">
                        <td colSpan={9}>
                          <div className="price-history-container">
                            <PokemonPriceHistoryChart 
                              pokemonKey={entry.key} 
                              pokemonName={`${entry.name}${entry.form && entry.form !== 'base' ? ` (${toLabel(entry.form)})` : ''}`}
                              stats={stats!} 
                              cutoffDate={cutoffDate}
                            />
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
                {filteredPokemonSummary.length === 0 && (
                  <tr>
                    <td colSpan={9} className="empty-cell">No pokemon stats available.</td>
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