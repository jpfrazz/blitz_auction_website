import axios from 'axios';
import { ChatMessage, Draft, DraftLobby } from "../../types";

interface JoinDraftResponse {
  joined: boolean;
  error?: string;
}

interface EeveelutionClaimResponse {
  success: boolean;
  error?: string;
}

// Fetch current user info
export async function fetchCurrentUser(): Promise<{user_id: string | null, username: string | null, avatar?: string, is_guest: boolean}> {
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
      is_guest: false,
    };
  } else {
    return {
      user_id: null,
      username: null,
      is_guest: false,
    }
  }
}

// Fetch a draft by id from the backend
export async function fetchDraftById(draft_id: string): Promise<Draft> {
  const response = await axios.get(`/api/drafts/${draft_id}`);
  return response.data;
}

// Fetch all open drafts for lobby viewer
export async function fetchOpenDrafts(): Promise<DraftLobby[]> {
  const response = await axios.get('/api/drafts');
  return response.data;
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

// Join a draft
export async function joinDraft(draft_id: string, password?: string): Promise<Draft> {
  const trimmedPassword = password?.trim();
  let joinResponse;

  if (trimmedPassword) {
    joinResponse = await axios.post<JoinDraftResponse>(`/api/drafts/${draft_id}/join`, {
      password: trimmedPassword,
    });
  } else {
    joinResponse = await axios.post<JoinDraftResponse>(`/api/drafts/${draft_id}/join`);
  }

  if (!joinResponse.data.joined) {
    throw new Error(joinResponse.data.error || 'Failed to join draft.');
  }

  // Fetch and return the updated draft after joining
  const response = await axios.get(`/api/drafts/${draft_id}`);
  return response.data;
}

// Place a bid on the current auction
export async function placeBid(draft_id: string, auction_id: string, value: number): Promise<{accepted: boolean, error?: string}> {
  const response = await axios.post(`/api/drafts/${draft_id}/bid`, {
    auction_id,
    value
  });
  return response.data;
}
// Claim an eeveelution after draft completes
export async function claimEeveelution(draft_id: string, pokedex_id: number, form: string | null): Promise<any> {
  const response = await axios.post(`/api/drafts/${draft_id}/claim-eeveelution`, {
    pokedex_id,
    form
  });
  const data = response.data as EeveelutionClaimResponse;
  if (typeof data?.success === 'boolean' && !data.success) {
    throw new Error(data.error || 'Failed to claim Eeveelution');
  }
  return data;
}

export async function unclaimEeveelution(draft_id: string, pokedex_id: number, form: string | null): Promise<any> {
  const response = await axios.post(`/api/drafts/${draft_id}/unclaim-eeveelution`, {
    pokedex_id,
    form
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
  const response = await axios.post(`/api/drafts/${draft_id}/chats`, { message });
  return response.data;
}

// Change guest name
export async function changeGuestName(newName: string): Promise<string> {
  // Only send the part after 'guest:'
  const trimmed = newName.trim();
  if (!trimmed) throw new Error('Name cannot be empty');
  const response = await axios.post('/api/guests/change-name', { new_name: `guest:${trimmed}` });
  return response.data;
}