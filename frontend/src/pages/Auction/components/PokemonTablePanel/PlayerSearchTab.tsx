import React, { useEffect, useState } from 'react';
import { fetchStatsPageData } from '../../../../shared/api/stats';
import { StatsPageResponse } from '../../../../types';
import PlayerSearchStatsTab from '../../../Stats/components/PlayerSearchStatsTab';
import './PlayerSearchTab.scss';

const PlayerSearchTab = () => {
  const [stats, setStats] = useState<StatsPageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await fetchStatsPageData();
        setStats(data);
      } catch (e: any) {
        console.error('[PlayerSearchTab] Error fetching stats data:', e);
        setError('Failed to load stats data.');
      } finally {
        setLoading(false);
      }
    };

    load();
  }, []);

  return (
    <div className="auction-player-search-tab">
      <PlayerSearchStatsTab
        stats={stats}
        loading={loading}
        error={error}
      />
    </div>
  );
};

export default PlayerSearchTab;
