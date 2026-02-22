import axios from 'axios';
import { ChatMessage, Draft, DraftLobby } from "../../types";

// Fetch current user info
export async function fetchCurrentUser(): Promise<{user_id: string, username: string, avatar?: string, is_guest: boolean}> {
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
      user_id: data.DiscordUser.id,
      username: data.DiscordUser.username,
      avatar: data.DiscordUser.avatar,
      is_guest: false,
    };
  }
  throw new Error('Unknown user type');
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
  if (trimmedPassword) {
    await axios.post(`/api/drafts/${draft_id}/join`, {
      password: trimmedPassword,
    });
  } else {
    await axios.post(`/api/drafts/${draft_id}/join`);
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