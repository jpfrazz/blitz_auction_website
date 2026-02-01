// Stub for creating a draft (to be replaced with real API call)
export async function createDraft(data: any): Promise<string> {
  // Simulate network delay
  await new Promise(res => setTimeout(res, 300));
  // Return a fake auction id that looks like a Postgres bigserial (19 digits, 64-bit integer)
  // Range: 1 to 9223372036854775807
  const min = 1_000_000_000_000_000_000;
  const max = 9_223_372_036_854_775_807;
  const id = BigInt(Math.floor(Math.random() * Number(max - min))) + BigInt(min);
  return id.toString();
}
