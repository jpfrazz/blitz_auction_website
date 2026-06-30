import axios, {AxiosError} from 'axios';
import {
  MatchHistoryTeam,
  StatsPageResponse,
} from "../../types";

export async function fetchMatchHistoryByUserId(userId: string): Promise<MatchHistoryTeam[]> {
  const response = await axios.get(`/api/match-history/${userId}`);
  return response.data;
}

export async function fetchStatsPageData(): Promise<StatsPageResponse> {
  const response = await axios.get('/api/stats');
  return response.data;
}

export interface BossBattleHistoryEntry {
  trainer_id: number;
  version: number | null;
  hours: number;
  minutes: number;
  seconds: number;
  is_loss: boolean;
}

export async function fetchBossBattleHistory(draftId: string, userId?: string): Promise<BossBattleHistoryEntry[]> {
  const params = userId ? `?user_id=${userId}` : '';
  const response = await axios.get(`/api/drafts/${draftId}/boss-battle-history${params}`);
  return response.data;
}