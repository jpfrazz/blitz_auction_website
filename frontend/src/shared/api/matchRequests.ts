import axios from 'axios';
import type {
  CreateMatchRequestResponse,
  MatchRequestsResponse,
} from '../../types';

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

export async function createMatchRequest(
  payload: CreateMatchRequestPayload,
): Promise<CreateMatchRequestResponse> {
  const response = await axios.post<CreateMatchRequestResponse>('/api/match-requests', payload);
  return response.data;
}
