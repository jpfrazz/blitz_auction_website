import axios from 'axios';
import type { MatchRequestsResponse } from '../../types';

export async function fetchMatchRequests(limit = 20): Promise<MatchRequestsResponse> {
  const response = await axios.get<MatchRequestsResponse>('/api/match-requests', {
    params: { limit },
  });
  return response.data;
}

export interface CreateMatchRequestPayload {
  mode: '1v1' | 'Booster' | 'Draft';
  requested_at: string;
}

export async function createMatchRequest(payload: CreateMatchRequestPayload): Promise<void> {
  await axios.post('/api/match-requests', payload);
}

export async function deleteMatchRequest(id: number): Promise<void> {
  await axios.delete(`/api/match-requests/${id}`);
}
