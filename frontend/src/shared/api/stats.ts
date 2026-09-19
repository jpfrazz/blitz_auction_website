import axios, {AxiosError} from 'axios';
import {
  AdminHallOfFameEligibleEntry,
  DraftRaceResults,
  MatchHistoryTeam,
  RaceResultTeamUpdate,
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

export async function fetchHallOfFameEligible(): Promise<AdminHallOfFameEligibleEntry[]> {
  const response = await axios.get('/api/hall-of-fame-teams');
  return response.data;
}

export async function fetchDraftRaceResults(draftId: string): Promise<DraftRaceResults> {
  const response = await axios.get(`/api/drafts/${draftId}/race-results`);
  return response.data;
}

export async function updateDraftRaceResults(
  draftId: string,
  teams: RaceResultTeamUpdate[],
): Promise<void> {
  await axios.post(`/api/drafts/${draftId}/race-results`, { teams });
}

export interface BossBattleHistoryEntry {
  trainer_id: number;
  version: number | null;
  hours: number;
  minutes: number;
  seconds: number;
  is_loss: boolean;
}

export interface BossBattleSubmissionBattle {
  trainer_id: number;
  version: number | null;
  hours: number;
  minutes: number;
  seconds: number;
  is_loss: boolean;
}

export interface BossBattleSubmission {
  team_id: number;
  draft_id: string;
  battles: BossBattleSubmissionBattle[];
  note?: string | null;
  created_at: string;
}

export async function fetchBossBattleHistory(draftId: string, userId?: string): Promise<BossBattleHistoryEntry[]> {
  const params = userId ? `?user_id=${userId}` : '';
  const response = await axios.get(`/api/drafts/${draftId}/boss-battle-history${params}`);
  return response.data;
}

export async function fetchMyBossBattleSubmissions(): Promise<BossBattleSubmission[]> {
  const response = await axios.get('/api/boss-battle-submissions');
  return response.data;
}

export async function submitBossBattleSubmission(
  teamId: number,
  battles: BossBattleSubmissionBattle[],
  note?: string | null,
): Promise<BossBattleSubmission> {
  const response = await axios.post('/api/boss-battle-submissions', { team_id: teamId, battles, note });
  return response.data;
}

export async function withdrawBossBattleSubmission(teamId: number): Promise<void> {
  await axios.post(`/api/boss-battle-submissions/${teamId}/withdraw`);
}