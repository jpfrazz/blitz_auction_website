import React, { useState } from 'react';
import { StatsPageResponse } from '../../types';
import { PokemonPriceHistoryChartBody } from './PokemonPriceHistoryChart';
import PokemonPickHistoryChartBody from './PokemonPickHistoryChart';

interface PokemonHistoryChartProps {
  pokemonKey: string;
  pokemonName: string;
  stats: StatsPageResponse;
  cutoffDate?: string;
}

type HistoryTab = 'sales' | 'picks';

const PokemonHistoryChart: React.FC<PokemonHistoryChartProps> = ({ pokemonKey, pokemonName, stats, cutoffDate }) => {
  const [activeTab, setActiveTab] = useState<HistoryTab>('sales');

  return (
    <div
      className="pokemon-history-chart"
      style={{ width: '100%', background: 'rgba(0,0,0,0.1)', borderRadius: '8px', padding: '15px', boxSizing: 'border-box' }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            type="button"
            className={`tab-chip ${activeTab === 'sales' ? 'active' : ''}`}
            style={{ padding: '2px 10px', fontSize: '0.85rem', minWidth: 'auto', margin: 0 }}
            onClick={() => setActiveTab('sales')}
          >
            Sale History
          </button>
          <button
            type="button"
            className={`tab-chip ${activeTab === 'picks' ? 'active' : ''}`}
            style={{ padding: '2px 10px', fontSize: '0.85rem', minWidth: 'auto', margin: 0 }}
            onClick={() => setActiveTab('picks')}
          >
            Pick History
          </button>
        </div>
        <h4 style={{ margin: 0, fontSize: '1rem', color: '#888', fontWeight: 600 }}>
          {activeTab === 'sales' ? `Price History: ${pokemonName}` : `Pick History: ${pokemonName}`}
        </h4>
      </div>
      <div style={{ height: '235px', position: 'relative' }}>
        {activeTab === 'sales' ? (
          <PokemonPriceHistoryChartBody
            pokemonKey={pokemonKey}
            pokemonName={pokemonName}
            stats={stats}
            cutoffDate={cutoffDate}
          />
        ) : (
          <PokemonPickHistoryChartBody
            pokemonKey={pokemonKey}
            pokemonName={pokemonName}
            stats={stats}
            cutoffDate={cutoffDate}
          />
        )}
      </div>
    </div>
  );
};

export default PokemonHistoryChart;