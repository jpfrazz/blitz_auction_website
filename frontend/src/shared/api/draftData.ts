import axios, {AxiosError} from 'axios';
import {
  Auction,
  ChatMessage,
  Draft,
  DraftLobby,
  MatchHistoryTeam,
  Pokemon,
  StatsPageResponse,
  UserRole,
} from "../../types";

interface JoinDraftResponse {
  joined: boolean;
  error?: string;
}

interface EeveelutionClaimResponse {
  success: boolean;
  error?: string;
}

// Fetch current user info
export async function fetchCurrentUser(): Promise<{user_id: string | null, username: string | null, avatar?: string, is_guest: boolean, roles?: UserRole[]}> {
  const response = await axios.get('/api/me');
  // Response can be {GuestUser: {...}} or {DiscordUser: {...}}
  const data = response.data;
  if (data.GuestUser) {
    return {
      user_id: data.GuestUser.user_id,
      username: data.GuestUser.user_name,
      is_guest: true,
    };
  } else if (data.DiscordUser) {
    return {
      user_id: data.DiscordUser.user_id ?? data.DiscordUser.id,
      username: data.DiscordUser.user_name ?? data.DiscordUser.username,
      avatar: data.DiscordUser.avatar,
      roles: data.DiscordUser.roles ?? [],
      is_guest: false,
    };
  } else {
    return {
      user_id: null,
      username: null,
      is_guest: false,
      roles: [],
    }
  }
}

// Fetch a draft by id from the backend
export async function fetchDraftById(draft_id: string): Promise<Draft> {
  const response = await axios.get(`/api/drafts/${draft_id}`);
  return response.data;
}

export async function fetchDraftPokemon(draft_id: string): Promise<Pokemon[]> {
  const response = await axios.get(`/api/drafts/${draft_id}/pokemon`);
  return response.data;
}

export async function fetchDraftCurrentAuction(draft_id: string): Promise<Auction> {
  const response = await axios.get(`/api/drafts/${draft_id}/current_auction`);
  return response.data;
}

// Fetch all open drafts for lobby viewer
export async function fetchOpenDrafts(): Promise<DraftLobby[]> {
  const response = await axios.get('/api/drafts');
  return response.data;
}

// Hide a draft from the lobby viewer without deleting it from the database
export async function deleteDraft(draft_id: string): Promise<void> {
  await axios.delete(`/api/drafts/${draft_id}`);
}

// Start a draft
export async function startDraft(draft_id: string): Promise<Draft> {
  await axios.post(`/api/drafts/${draft_id}/start`);
  const response = await axios.get(`/api/drafts/${draft_id}`);
  return response.data;
}

export async function readyUpDraft(draft_id: string): Promise<Draft> {
  await axios.post(`/api/drafts/${draft_id}/ready`, { ready: true });
  const response = await axios.get(`/api/drafts/${draft_id}`);
  return response.data;
}

export async function pauseDraft(draft_id: string): Promise<void> {
  await axios.post(`/api/drafts/${draft_id}/pause`);
}

export async function unpauseDraft(draft_id: string): Promise<void> {
  await axios.post(`/api/drafts/${draft_id}/unpause`);
}

export async function submitRaceResults(
  draft_id: string,
  placements: Record<string, number>,
): Promise<void> {
  await axios.post(`/api/drafts/${draft_id}/submit-results`, placements);
}

export async function updatePendingDraftSettings(
  draft_id: string,
  num_teams: number,
  num_auctions: number,
  remove_team_ids: string[] = [],
): Promise<Draft> {
  const response = await axios.post(`/api/drafts/${draft_id}/pending-settings`, {
    num_teams,
    num_auctions,
    remove_team_ids,
  });

  return response.data;
}

// Join a draft
export async function joinDraft(draft_id: string, password?: string): Promise<Draft> {
  const trimmedPassword = password?.trim();
  let joinResponse;
  try {
    joinResponse = await axios.post(`/api/drafts/${draft_id}/join`, {
      password: trimmedPassword,
    });
  } catch (error) {
    if (axios.isAxiosError(error) && error.response) {
      throw new Error(error.response.data);
    } else {
      throw error;
    }
  }
   // Fetch and return the updated draft after joining
  const response = await axios.get(`/api/drafts/${draft_id}`);
  return response.data;
}

// Place a bid on the current auction
export async function placeBid(draft_id: string, auction_id: string, value: number): Promise<any> {
  const response = await axios.post(`/api/drafts/${draft_id}/bid`, {
    auction_id,
    value
  });
  return response;
}
// Claim an eeveelution after draft completes
export async function claimEeveelution(draft_id: string, pokedex_id: number, form: string | null, target_user_id?: string | null): Promise<any> {
  const response = await axios.post(`/api/drafts/${draft_id}/claim-eeveelution`, {
    pokedex_id,
    form,
    target_user_id
  });
  const data = response.data as EeveelutionClaimResponse;
  if (typeof data?.success === 'boolean' && !data.success) {
    throw new Error(data.error || 'Failed to claim Eeveelution');
  }
  return data;
}

export async function unclaimEeveelution(draft_id: string, pokedex_id: number, form: string | null, target_user_id?: string | null): Promise<any> {
  const response = await axios.post(`/api/drafts/${draft_id}/unclaim-eeveelution`, {
    pokedex_id,
    form,
    target_user_id
  });
  const data = response.data as EeveelutionClaimResponse;
  if (typeof data?.success === 'boolean' && !data.success) {
    throw new Error(data.error || 'Failed to unclaim Eeveelution');
  }
  return response.data;
}

// Fetch chat messages for a draft
export async function fetchDraftChats(draft_id: string): Promise<ChatMessage[]> {
  const response = await axios.get(`/api/drafts/${draft_id}/chats`);
  return response.data;
}

// Create a new chat message for a draft
export async function createDraftChat(draft_id: string, message: string): Promise<ChatMessage> {
  try {
    const response = await axios.post(`/api/drafts/${draft_id}/chats`, { message });
    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error) && error.response) {
      throw new Error(error.response.data);
    } else {
      throw error;
    }
  }
}

// Change guest name
export async function changeGuestName(newName: string): Promise<string> {
  // Only send the part after 'guest:'
  const trimmed = newName.trim();
  if (!trimmed) throw new Error('Name cannot be empty');
  const response = await axios.post('/api/guests/change-name', { new_name: `guest:${trimmed}` });
  return response.data;
}
