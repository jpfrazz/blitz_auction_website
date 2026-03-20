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