// Types for create draft request
export interface ExcludedPokemon {
  pokedex_id: number;
  form: string | null;
}

export interface CreateDraftRequest {
  num_teams: number;
  starting_money: number;
  draft_name: string;
  ranked: boolean;
  password?: string | null;
  excluded_pokemon: ExcludedPokemon[];
  num_auctions: number;
  auction_length: number | {
    secs: number;
    nanos: number;
  };
  draft_type?: string;
}

// Create a draft via POST /drafts (proxied to backend)
export async function createDraft(data: CreateDraftRequest): Promise<string> {
  // Backend expects u32 (seconds), ensure we send a number
  const payload = {
    ...data,
    auction_length: typeof data.auction_length === 'object'
      ? data.auction_length.secs
      : data.auction_length
  };

  const response = await fetch(`/api/drafts`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include', // Include auth cookies
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error('Failed to create draft. Server response:', errorBody);
    throw new Error(`Failed to create draft: ${response.statusText}. Details: ${errorBody}`);
  }

  console.log("Draft created successfully");

  // Backend returns just the draft_id as a string, not JSON
  const draft_id = await response.text();
  return draft_id;
}
