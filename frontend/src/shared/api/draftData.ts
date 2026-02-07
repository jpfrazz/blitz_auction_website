import axios from 'axios';
import { Draft } from "../../types";

// Fetch current user info
export async function fetchCurrentUser(): Promise<{user_id: string, username: string}> {
  const response = await axios.get('/api/me');
  // Response can be {GuestUser: {...}} or {DiscordUser: {...}}
  const data = response.data;
  if (data.GuestUser) {
    return {
      user_id: data.GuestUser.user_id,
      username: data.GuestUser.user_name,
    };
  } else if (data.DiscordUser) {
    return {
      user_id: data.DiscordUser.user_id,
      username: data.DiscordUser.user_name,
    };
  }
  throw new Error('Unknown user type');
}

// Fetch a draft by id from the backend
export async function fetchDraftById(draft_id: string): Promise<Draft> {
  const response = await axios.get(`/api/drafts/${draft_id}`);
  return response.data;
}

// Start a draft
export async function startDraft(draft_id: string): Promise<Draft> {
  await axios.post(`/api/drafts/${draft_id}/start`);
  const response = await axios.get(`/api/drafts/${draft_id}`);
  return response.data;
}

// Join a draft
export async function joinDraft(draft_id: string): Promise<Draft> {
  await axios.post(`/api/drafts/${draft_id}/join`);
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
