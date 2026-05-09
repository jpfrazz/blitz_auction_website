import React, { useEffect, useMemo, useState } from 'react';
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

  const draftStats = useMemo(() => {
    const statsMap = new Map<string, { total: number; minBidCount: number; teamCount: number; maxBid: number }>();

    // Count teams (players) per draft
    (stats?.teams ?? []).forEach((t) => {
      const curr = statsMap.get(t.draft_id) || { total: 0, minBidCount: 0, teamCount: 0, maxBid: 0 };
      curr.teamCount += 1;
      statsMap.set(t.draft_id, curr);
    });

    (stats?.auctions ?? []).forEach((a) => {
      if (a.winning_bid !== null) {
        const curr = statsMap.get(a.draft_id) || { total: 0, minBidCount: 0, teamCount: 0, maxBid: 0 };
        curr.total += 1;
        if (a.winning_bid === 100) {
          curr.minBidCount += 1;
        }
        if (a.winning_bid > curr.maxBid) {
          curr.maxBid = a.winning_bid;
        }
        statsMap.set(a.draft_id, curr);
      }
    });
    return statsMap;
  }, [stats?.auctions, stats?.teams]);

  const validDraftIds = useMemo(() => {
    const valid = new Set<string>();
    draftStats.forEach((data, id) => {
      if (data.total >= 40 && data.minBidCount <= 3 && data.total === 8 * data.teamCount && data.maxBid <= 12000) {
        valid.add(id);
      }
    });
    return valid;
  }, [draftStats]);

  return (
    <div className="auction-player-search-tab">
      <PlayerSearchStatsTab
        stats={stats}
        loading={loading}
        error={error}
        validDraftIds={validDraftIds}
      />
    </div>
  );
};

export default PlayerSearchTab;
