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

const PickHistoryTooltip = ({ active, payload, label }: any) => {
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
        <p style={{ margin: '0 0 6px', color: '#888', fontWeight: 600 }}>Point #{label}</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <p style={{ margin: 0, color: '#fff' }}>
            <span style={{ color: '#888' }}>Date:</span> {data.date}
          </p>
          <p style={{ margin: 0, color: '#fff' }}>
            <span style={{ color: '#888' }}>Pick/Ban #:</span> {data.pickNumber}
          </p>
          {data.player && (
            <p style={{ margin: 0, color: '#fff' }}>
              <span style={{ color: '#888' }}>Player:</span> {data.player}
            </p>
          )}
        </div>
      </div>
    );
  }
  return null;
};

interface PokemonHistoryChartProps {
  pokemonKey: string;
  pokemonName: string;
  stats: StatsPageResponse;
  cutoffDate?: string;
}

const PICK_HISTORY_Y_TICKS = [1, 5, 9, 13, 17, 21, 25, 29];

// Tracks the 1-29 pick/ban slot of a pokemon across every played 1v1 draft.
// Mirrors the Sale History chart formatting, including its tooltip layout.
const PokemonPickHistoryChartBody: React.FC<PokemonHistoryChartProps> = ({ pokemonKey, stats, cutoffDate }) => {
  const chartData = useMemo(() => {
    const cutoff = cutoffDate ? new Date(cutoffDate).getTime() : 0;

    // Map of players for easy name lookup
    const playersMap = new Map<string, string>();
    (stats.players ?? []).forEach(p => {
      if (!p.is_guest) {
        playersMap.set(p.user_id, p.user_name);
      }
    });

    // Only 1v1 drafts that were actually played (produced a save) count.
    const played1v1DraftIds = new Set<string>();
    (stats.teams ?? []).forEach(t => {
      if (t.has_save) played1v1DraftIds.add(t.draft_id);
    });

    const events = (stats.auctions ?? [])
      .filter(a => {
        if (a.draft_type !== '1v1') return false;
        if (!played1v1DraftIds.has(a.draft_id)) return false;
        if (resolveIdentity(a.name, a.form || '').key !== pokemonKey) return false;
        if (cutoff > 0) {
          const ts = a.created_at ? new Date(a.created_at).getTime() : 0;
          return ts >= cutoff;
        }
        return true;
      })
      .map(a => {
        let pickNumber: number | null = null;
        if (a.action === 'LEFTOVER') {
          // The four unused pool pokemon count as 29.
          pickNumber = 29;
        } else if ((a.action === 'PICK' || a.action === 'BAN') && a.draft_order >= 1 && a.draft_order <= 28) {
          // The main 1v1 phase is exactly 28 picks/bans. Eeveelution-phase
          // bans (draft_order >= 29) are skipped.
          pickNumber = a.draft_order;
        }

        const actorKey = a.winning_user_id || '';
        const actorName = actorKey ? playersMap.get(actorKey) || null : null;

        return {
          pickNumber,
          date: a.created_at ? new Date(a.created_at).getTime() : 0,
          formattedDate: a.created_at ? new Date(a.created_at).toLocaleDateString() : 'Unknown',
          draftId: a.draft_id,
          draftOrder: a.draft_order,
          player: actorName,
        };
      })
      .filter(e => e.pickNumber !== null)
      .sort((a, b) => (a.date - b.date) || (a.draftOrder - b.draftOrder));

    if (events.length === 0) return null;

    // Statistical outlier detection using IQR "fences", mirroring the Sale
    // History chart. Pick/ban numbers below Q1 - 1.5 x IQR (lower fence) or
    // above Q3 + 2.0 x IQR (upper fence) are treated as outliers.
    const picksForBounds = events.map(e => e.pickNumber as number);
    let lowerBound: number | null = null;
    let upperBound: number | null = null;

    if (picksForBounds.length > 1) {
      const sortedPicks = [...picksForBounds].sort((a, b) => a - b);
      const q1 = calculateQuantile(sortedPicks, 0.25);
      const q3 = calculateQuantile(sortedPicks, 0.75);
      const iqr = q3 - q1;

      lowerBound = q1 - 1.5 * iqr;
      upperBound = q3 + 2.0 * iqr;
    }

    const data = events.map((e, index) => {
      const pickNumber = e.pickNumber as number;
      return {
        pointNumber: index + 1,
        pickNumber,
        isOutlier: (lowerBound !== null && pickNumber < lowerBound) || (upperBound !== null && pickNumber > upperBound),
        date: e.formattedDate,
        draftId: e.draftId,
        player: e.player,
      };
    });

    const xAxisTicks = [];
    const tickInterval = data.length > 50 ? 10 : 5;
    for (let i = tickInterval; i <= data.length; i += tickInterval) {
      xAxisTicks.push(i);
    }
    if (xAxisTicks.length === 0 && data.length > 0) xAxisTicks.push(1);

    return { data, lowerBound, upperBound, xAxisTicks };
  }, [pokemonKey, stats]);

  if (!chartData || chartData.data.length === 0) return null;

  const { data, lowerBound, upperBound, xAxisTicks } = chartData;

  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 5, right: 40, left: 10, bottom: 25 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
        <XAxis
          dataKey="pointNumber"
          stroke="#666"
          tick={{ fontSize: 11 }}
          ticks={xAxisTicks}
          label={{ value: 'Point #', position: 'insideBottom', offset: -15, fill: '#666', fontSize: 11 }}
        />
        <YAxis
          type="number"
          domain={[1, 29]}
          ticks={PICK_HISTORY_Y_TICKS}
          stroke="#666"
          tick={{ fontSize: 11 }}
          label={{ value: 'Pick/Ban #', angle: -90, position: 'insideLeft', fill: '#666', fontSize: 11 }}
        />
        <Tooltip content={<PickHistoryTooltip />} />

        {(upperBound !== null && upperBound > 1 && upperBound < 29) && <ReferenceLine y={upperBound} stroke="#8B0000" strokeDasharray="5 5" label={{ value: 'Outlier Bound', position: 'right', fill: '#8B0000', fontSize: 10 }} />}
        {(lowerBound !== null && lowerBound > 1 && lowerBound < 29) && <ReferenceLine y={lowerBound} stroke="#8B0000" strokeDasharray="5 5" />}

        <Line
          type="monotone"
          dataKey="pickNumber"
          stroke="#7CB946"
          strokeWidth={0}
          dot={(props: any) => {
            const { cx, cy, payload } = props;
            const fill = payload.isOutlier ? '#8B0000' : '#7CB946';
            return (
              <circle key={`dot-${payload.pointNumber}`} cx={cx} cy={cy} r={4} fill={fill} stroke="none" />
            );
          }}
          activeDot={{ r: 6, fill: '#fff', stroke: '#7CB946' }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
};

export default PokemonPickHistoryChartBody;