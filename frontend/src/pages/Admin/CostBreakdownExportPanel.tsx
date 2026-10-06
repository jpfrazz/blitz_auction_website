import React, { useEffect, useMemo, useState } from 'react';
import { fetchStatsPageData } from '../../shared/api/stats';
import { computeCostBreakdown, downloadCostBreakdownCsv } from '../../shared/utils/costBreakdown';
import { StatsPageResponse } from '../../types';

const CostBreakdownExportPanel: React.FC = () => {
  const [stats, setStats] = useState<StatsPageResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [cutoffDate, setCutoffDate] = useState<string>('');
  const [lookbackWindow, setLookbackWindow] = useState<number | ''>('');
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [includeLegacy, setIncludeLegacy] = useState<boolean>(true);
  const [includePicks, setIncludePicks] = useState<boolean>(true);

  useEffect(() => {
    setLoading(true);
    fetchStatsPageData()
      .then((data) => {
        setStats(data);
        setError(null);
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : 'Failed to load stats');
      })
      .finally(() => setLoading(false));
  }, []);

  const aggregates = useMemo(() => {
    if (!stats) return [];
    return computeCostBreakdown({
      auctions: stats.auctions,
      legacy: stats.legacy,
      cutoffDate: cutoffDate || undefined,
      lookbackWindow: lookbackWindow === '' ? undefined : Number(lookbackWindow),
      typeFilter: typeFilter || null,
      includeLegacy,
    });
  }, [stats, cutoffDate, lookbackWindow, typeFilter, includeLegacy]);

  const handleDownload = () => {
    let filename = 'cost-breakdown.csv';
    const parts: string[] = ['cost-breakdown'];
    if (cutoffDate) parts.push('cutoff-' + cutoffDate);
    if (lookbackWindow !== '') parts.push('lookback-' + lookbackWindow + 'd');
    if (parts.length > 1) filename = parts.join('-') + '.csv';
    downloadCostBreakdownCsv(aggregates, {
      includePicks,
      filename,
    });
  };

  if (loading) {
    return <div style={{ color: '#94a3b8' }}>Loading cost breakdown data...</div>;
  }

  if (error) {
    return <div style={{ color: '#f87171' }}>Error: {error}</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', background: '#172637', padding: '1rem', borderRadius: '8px', border: '1px solid #2b3e52' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
          <label style={{ fontSize: '0.8rem', color: '#94a3b8' }}>Cutoff Date (exclude auctions after this date)</label>
          <input
            type="date"
            value={cutoffDate}
            onChange={(e) => setCutoffDate(e.target.value)}
            style={{ background: '#0f172a', color: '#eef4fb', border: '1px solid #2b3e52', borderRadius: '6px', padding: '0.4rem 0.6rem' }}
          />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
          <label style={{ fontSize: '0.8rem', color: '#94a3b8' }}>Lookback Window (days)</label>
          <input
            type="number"
            min="0"
            value={lookbackWindow}
            onChange={(e) => setLookbackWindow(e.target.value === '' ? '' : Number(e.target.value))}
            style={{ background: '#0f172a', color: '#eef4fb', border: '1px solid #2b3e52', borderRadius: '6px', padding: '0.4rem 0.6rem', width: '120px' }}
          />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
          <label style={{ fontSize: '0.8rem', color: '#94a3b8' }}>Type Filter</label>
          <input
            type="text"
            placeholder="e.g. Fire, Water, Dragon"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            style={{ background: '#0f172a', color: '#eef4fb', border: '1px solid #2b3e52', borderRadius: '6px', padding: '0.4rem 0.6rem' }}
          />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginTop: 'auto' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.9rem', color: '#eef4fb' }}>
            <input type="checkbox" checked={includeLegacy} onChange={(e) => setIncludeLegacy(e.target.checked)} />
            Include Legacy Data
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.9rem', color: '#eef4fb' }}>
            <input type="checkbox" checked={includePicks} onChange={(e) => setIncludePicks(e.target.checked)} />
            Include 1v1 Picks
          </label>
        </div>
      </div>

      <div style={{ background: '#172637', padding: '1rem', borderRadius: '8px', border: '1px solid #2b3e52' }}>
        <div style={{ fontSize: '0.9rem', color: '#94a3b8', marginBottom: '0.8rem' }}>
          Total Pokemon in result: <span style={{ color: '#eef4fb', fontWeight: 'bold' }}>{aggregates.length}</span>
        </div>
        <button
          onClick={handleDownload}
          disabled={aggregates.length === 0}
          style={{
            background: aggregates.length === 0 ? '#1f2937' : '#224161',
            color: '#eef4fb',
            border: '1px solid ' + (aggregates.length === 0 ? '#374151' : '#3c6a94'),
            borderRadius: '8px',
            padding: '0.6rem 1.2rem',
            cursor: aggregates.length === 0 ? 'not-allowed' : 'pointer',
            fontWeight: 'bold',
          }}
          type="button"
        >
          Download CSV ({aggregates.length} rows)
        </button>
      </div>
    </div>
  );
};

export default CostBreakdownExportPanel;
