import axios from 'axios';
import type { BlitzUpdate } from '../../types';

export async function fetchBlitzUpdates(limit = 30): Promise<BlitzUpdate[]> {
  const response = await axios.get('/api/updates', { params: { limit } });
  return response.data;
}

export interface AchievementSnapshotReport {
  user_id: string;
  user_name?: string;
  achievements: Array<{
    id: string;
    name: string;
    icon: string;
    earned: boolean;
  }>;
}

/** Establishes/updates the player's earned-achievement baseline. */
export async function reportAchievementSnapshot(
  report: AchievementSnapshotReport,
): Promise<void> {
  await axios.post('/api/updates/achievements', report);
}

export interface RankingSnapshotReport {
  rankings: Array<{
    key: string;
    name: string;
    rank: number;
    avg_price: number;
  }>;
}

/** Reports the current all-time cost ranking for change detection. */
export async function reportRankingSnapshot(
  report: RankingSnapshotReport,
): Promise<void> {
  await axios.post('/api/updates/rankings', report);
}
