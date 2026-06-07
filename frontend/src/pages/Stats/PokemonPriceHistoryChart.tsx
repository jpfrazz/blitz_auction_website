import React, { useMemo } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import { StatsPageResponse } from '../../types';

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

function calculateQuantile(sortedData: number[], q: number) {
  const pos = (sortedData.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sortedData[base + 1] !== undefined) {
    return sortedData[base] + rest * (sortedData[base + 1] - sortedData[base]);
  }
  return sortedData[base];
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    return (
      <div style={{ 
        backgroundColor: '#1a1a1a', 
        border: '1px solid #333', 
        padding: '10px', 
        fontSize: '12px', 
        borderRadius: '4px',
        boxShadow: '0 4px 12px rgba(0,0,0,0.5)'
      }}>
        <p style={{ margin: '0 0 6px', color: '#888', fontWeight: 600 }}>Sale #{label}</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <p style={{ margin: 0, color: '#fff' }}>
            <span style={{ color: '#888' }}>Price:</span> ${data.cost.toLocaleString()}
          </p>
          {data.winner !== 'Guest' && (
            <p style={{ margin: 0, color: '#fff' }}>
              <span style={{ color: '#888' }}>Winner:</span> {data.winner}
            </p>
          )}
        </div>
      </div>
    );
  }
  return null;
};

interface PokemonPriceHistoryChartProps {
  pokemonKey: string;
  pokemonName: string;
  stats: StatsPageResponse;
}

const PokemonPriceHistoryChart: React.FC<PokemonPriceHistoryChartProps> = ({ pokemonKey, pokemonName, stats }) => {
  const chartData = useMemo(() => {
    // Determine valid (competitive) draft IDs
    const draftStatsMap = new Map<string, { total: number; minBidCount: number; teamCount: number; maxBid: number }>();

    (stats.teams ?? []).forEach((t) => {
      const curr = draftStatsMap.get(t.draft_id) || { total: 0, minBidCount: 0, teamCount: 0, maxBid: 0 };
      curr.teamCount += 1;
      draftStatsMap.set(t.draft_id, curr);
    });

    (stats.auctions ?? []).forEach((a) => {
      if (a.winning_bid !== null) {
        const curr = draftStatsMap.get(a.draft_id) || { total: 0, minBidCount: 0, teamCount: 0, maxBid: 0 };
        curr.total += 1;
        if (a.winning_bid === 100) {
          curr.minBidCount += 1;
        }
        if (a.winning_bid > curr.maxBid) {
          curr.maxBid = a.winning_bid;
        }
        draftStatsMap.set(a.draft_id, curr);
      }
    });

    const validDraftIds = new Set<string>();
    draftStatsMap.forEach((data, id) => {
      if (data.total >= 40 && data.minBidCount <= 3 && data.total === 8 * data.teamCount && data.maxBid <= 12000) {
        validDraftIds.add(id);
      }
    });

    // Map of players for easy name lookup
    const playersMap = new Map<string, string>();
    (stats.players ?? []).forEach(p => {
      if (!p.is_guest) {
        playersMap.set(p.user_id, p.user_name);
      }
    });

    // 1. Gather all sales including auctions and legacy data
    const auctionSales = stats.auctions
      .filter(a => a.winning_bid !== null && validDraftIds.has(a.draft_id) && !excludedPokemonNames.has(a.name) && resolveIdentity(a.name, a.form || '').key === pokemonKey)
      .map(a => {
        const winnerName = a.winning_user_id ? playersMap.get(a.winning_user_id) : null;
        return {
          cost: a.winning_bid as number,
          date: a.created_at ? new Date(a.created_at).getTime() : 0,
          formattedDate: a.created_at ? new Date(a.created_at).toLocaleDateString() : 'Unknown',
          draftId: a.draft_id,
          winner: winnerName || 'Guest'
        };
      });

    const legacySales = (stats.legacy || [])
      .filter(l => !excludedPokemonNames.has(l.pokemon) && resolveIdentity(l.pokemon, '').key === pokemonKey)
      .map(l => {
        const costStr = String(l.cost).replace(/[^0-9]/g, '');
        const cost = parseInt(costStr, 10);
        return {
          cost: isNaN(cost) ? 0 : cost,
          date: l.date ? new Date(l.date).getTime() : 0,
          formattedDate: l.date ? new Date(l.date).toLocaleDateString() : 'Legacy Draft',
          draftId: 'Legacy',
          winner: 'Guest'
        };
      });

    // Combine and sort chronologically
    const allSales = [...legacySales, ...auctionSales].sort((a, b) => a.date - b.date);

    if (allSales.length === 0) return null;

    // 2. Statistical Outlier Detection (align with PokemonStatsTab logic)
    // Ignore $100 bids for the bound calculation
    const filteredForBounds = allSales.map(s => s.cost).filter(c => c !== 100);
    let lowerBound: number | null = null;
    let upperBound: number | null = null;

    if (filteredForBounds.length > 1) {
      const sortedCosts = [...filteredForBounds].sort((a, b) => a - b);
      const q1 = calculateQuantile(sortedCosts, 0.25);
      const q3 = calculateQuantile(sortedCosts, 0.75);
      const iqr = q3 - q1;
      
      lowerBound = q1 - 1.5 * iqr;
      upperBound = q3 + 2.0 * iqr;
    }

    const data = allSales.map((s, index) => ({
      saleNumber: index + 1,
      cost: s.cost,
      isOutlier: s.cost === 100 || (lowerBound !== null && s.cost < lowerBound) || (upperBound !== null && s.cost > upperBound),
      date: s.formattedDate,
      draftId: s.draftId,
      winner: s.winner
    }));

    const xAxisTicks = [];
    for (let i = 5; i <= data.length; i += 5) {
      xAxisTicks.push(i);
    }
    if (xAxisTicks.length === 0 && data.length > 0) xAxisTicks.push(1);

    return { data, lowerBound, upperBound, xAxisTicks };
  }, [pokemonKey, stats]);

  if (!chartData || chartData.data.length === 0) return null;

  const { data, lowerBound, upperBound, xAxisTicks } = chartData;

  return (
    <div className="pokemon-price-history-chart" style={{ width: '100%', height: '280px', marginTop: '10px', background: 'rgba(0,0,0,0.1)', borderRadius: '8px', padding: '15px', boxSizing: 'border-box' }}>
      <h4 style={{ margin: '0 0 15px', fontSize: '1rem', color: '#888', textAlign: 'center', fontWeight: 600 }}>
        Price History: {pokemonName}
      </h4>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 5, right: 40, left: 10, bottom: 25 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
          <XAxis 
            dataKey="saleNumber" 
            stroke="#666" 
            tick={{ fontSize: 11 }}
            ticks={xAxisTicks}
            label={{ value: 'Sale #', position: 'insideBottom', offset: -15, fill: '#666', fontSize: 11 }}
          />
          <YAxis 
            stroke="#666" 
            tick={{ fontSize: 11 }}
            label={{ value: 'Price ($)', angle: -90, position: 'insideLeft', fill: '#666', fontSize: 11 }}
          />
          <Tooltip content={<CustomTooltip />} />
          
          {upperBound !== null && <ReferenceLine y={upperBound} stroke="#8B0000" strokeDasharray="5 5" label={{ value: 'Outlier Bound', position: 'right', fill: '#8B0000', fontSize: 10 }} />}
          {lowerBound !== null && <ReferenceLine y={lowerBound} stroke="#8B0000" strokeDasharray="5 5" />}

          <Line 
            type="monotone" 
            dataKey="cost" 
            stroke="#36A2EB" 
            strokeWidth={0}
            dot={(props: any) => {
              const { cx, cy, payload } = props;
              const fill = payload.isOutlier ? '#8B0000' : '#36A2EB'; // Dark red for outliers
              return (
                <circle key={`dot-${payload.saleNumber}`} cx={cx} cy={cy} r={4} fill={fill} stroke="none" />
              );
            }}
            activeDot={{ r: 6, fill: '#fff', stroke: '#36A2EB' }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};

export default PokemonPriceHistoryChart;