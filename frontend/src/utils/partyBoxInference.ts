import type { SaveBoxPokemon, SavePokemon } from './parseSaveFile';
import { getMonIdentity } from './pokemonIdentity';
import { isRentalSpeciesId } from './rentalPokemon';

type EvolutionMetadataEntry = {
  evolves_from_id?: string | number | null;
  form?: string;
  mega?: string;
};

/** Shape of the `pokemonById` map loaded from `/api/pokemon`. */
export type PokemonByIdLike =
  | Map<number, EvolutionMetadataEntry[] | undefined>
  | Record<string, EvolutionMetadataEntry[] | undefined>;

export interface EvolutionMaps {
  /** Evolved species -> pre-evolution species. */
  parents: Map<number, number>;
  /** Species with multiple children from the same parent (split evolutions). */
  splitPartners: Set<number>;
}

export interface PartyInferenceState {
  inferredBox: Map<string, SavePokemon>;
  departedSinceSave: Map<string, SavePokemon>;
  lastSeenParty: Map<string, SavePokemon>;
  lastPartyKeys: Set<string>;
  /**
   * Rental identities observed leaving the live party. A returned rental is
   * truly gone from the player's roster — it is not a box move — so these keys
   * must never be preserved in the inferred box, even by a stale `.sav`.
   */
  returnedRentals: Set<string>;
  evolution: EvolutionMaps;
}

const NINCADA = 290;
const NINJASK = 291;
const SHEDINJA = 292;

/**
 * Builds the species lineage used to tell an in-place evolution apart from a
 * party departure. Every evolution keeps the same PID, so without this a
 * pre-evolution would be inferred into the box the moment it evolved.
 *
 * The Nincada split is seeded locally because it is a ROM mechanic and must
 * work even before the async `/api/pokemon` metadata has arrived.
 */
export const buildEvolutionMaps = (pokemonById?: PokemonByIdLike): EvolutionMaps => {
  const parents = new Map<number, number>([
    [NINJASK, NINCADA],
    [SHEDINJA, NINCADA],
  ]);

  if (pokemonById) {
    const entries: Array<[unknown, EvolutionMetadataEntry[] | undefined]> =
      pokemonById instanceof Map
        ? Array.from(pokemonById.entries())
        : Object.entries(pokemonById);

    for (const [rawSpeciesId, mons] of entries) {
      const speciesId = Number(rawSpeciesId);
      if (!Number.isInteger(speciesId) || speciesId <= 0 || !Array.isArray(mons)) continue;

      for (const mon of mons) {
        if (!mon) continue;
        const form = String(mon.form ?? mon.mega ?? '').toLowerCase();
        if (form.startsWith('mega')) continue;
        if (mon.evolves_from_id === undefined || mon.evolves_from_id === null || mon.evolves_from_id === '') continue;

        const parentId = Number(mon.evolves_from_id);
        if (!Number.isInteger(parentId) || parentId <= 0 || parentId === speciesId) continue;
        parents.set(speciesId, parentId);
      }
    }
  }

  const childCounts = new Map<number, number>();
  parents.forEach((parentId) => {
    childCounts.set(parentId, (childCounts.get(parentId) ?? 0) + 1);
  });
  const splitPartners = new Set<number>();
  parents.forEach((parentId, speciesId) => {
    if ((childCounts.get(parentId) ?? 0) > 1) splitPartners.add(speciesId);
  });

  return { parents, splitPartners };
};

export const createPartyInferenceState = (pokemonById?: PokemonByIdLike): PartyInferenceState => ({
  inferredBox: new Map(),
  departedSinceSave: new Map(),
  lastSeenParty: new Map(),
  lastPartyKeys: new Set(),
  returnedRentals: new Set(),
  evolution: buildEvolutionMaps(pokemonById),
});

/** Refreshes lineage data once the async pokemon metadata finishes loading. */
export const setPartyInferenceEvolutionMetadata = (
  state: PartyInferenceState,
  pokemonById?: PokemonByIdLike
): void => {
  state.evolution = buildEvolutionMaps(pokemonById);
};

export const resetPartyInferenceState = (state: PartyInferenceState): void => {
  state.inferredBox.clear();
  state.departedSinceSave.clear();
  state.lastSeenParty.clear();
  state.lastPartyKeys.clear();
  state.returnedRentals.clear();
  // `evolution` is catalog metadata, not game state, so it survives a reset.
};

const samePersonality = (a: { personality: number }, b: { personality: number }): boolean =>
  (a.personality >>> 0) === (b.personality >>> 0);

/** True when `newSpeciesId` is the same mon evolving from `oldSpeciesId`. */
const isEvolutionOf = (oldSpeciesId: number, newSpeciesId: number, state: PartyInferenceState): boolean => {
  if (oldSpeciesId === newSpeciesId) return false;

  const { parents, splitPartners } = state.evolution;
  const seen = new Set<number>();
  let cursor = newSpeciesId;
  while (Number.isInteger(cursor) && cursor > 0 && !seen.has(cursor)) {
    if (cursor === oldSpeciesId) return true;
    seen.add(cursor);
    const parent = parents.get(cursor);
    if (parent === undefined || parent === cursor) break;
    cursor = parent;
  }

  // No explicit lineage link. In Emerald an in-party species change with the
  // same PID is an evolution, so suppress the old species. Split partners are
  // the exception: Shedinja can be withdrawn while Ninjask stays in the party,
  // and that is a real box departure rather than an evolution.
  if (splitPartners.has(oldSpeciesId) || splitPartners.has(newSpeciesId)) return false;
  return true;
};

const evolvedInto = (
  previous: SavePokemon,
  currentParty: SavePokemon[],
  state: PartyInferenceState
): boolean =>
  currentParty.some(mon =>
    samePersonality(previous, mon) && isEvolutionOf(previous.species_id, mon.species_id, state)
  );

/**
 * Tracks party ↔ box movements from live party reads.
 *
 * Keys are `personality-species`, not raw PIDs, because Ninjask and Shedinja
 * share a PID. With PID-only keys, a stale live read containing Ninjask but not
 * Shedinja "covers" Shedinja's PID and the box reconciliation deletes it.
 * Same-PID species changes are evolutions, however, so the old species is not
 * inferred into the box.
 */
export const applyPartyInference = (state: PartyInferenceState, party: SavePokemon[]): void => {
  const newKeys = new Set<string>();

  for (const mon of party) {
    const key = getMonIdentity(mon);
    newKeys.add(key);
    state.lastSeenParty.set(key, mon);
    state.inferredBox.delete(key);
    state.departedSinceSave.delete(key);
    // A rental seen in the live party is still owned — clear any stale
    // "returned" marker (e.g. the same identity was rented again).
    state.returnedRentals.delete(key);
  }

  for (const key of Array.from(state.lastPartyKeys)) {
    if (newKeys.has(key) || state.inferredBox.has(key)) continue;
    const data = state.lastSeenParty.get(key);
    if (!data) continue;

    if (isRentalSpeciesId(data.species_id)) {
      // Returned rentals leave the roster entirely. Never preserve them as a
      // ghost box entry the way we do for ordinary missing Pokémon.
      state.inferredBox.delete(key);
      state.departedSinceSave.delete(key);
      state.lastSeenParty.delete(key);
      state.returnedRentals.add(key);
      continue;
    }

    if (evolvedInto(data, party, state)) {
      // The pre-evolution ceased to exist; it did not move to the box.
      state.inferredBox.delete(key);
      state.departedSinceSave.delete(key);
      state.lastSeenParty.delete(key);
      continue;
    }

    state.inferredBox.set(key, data);
    state.departedSinceSave.set(key, data);
  }

  state.lastPartyKeys = newKeys;
};

/**
 * Rebuilds the inferred box from an authoritative `.sav` snapshot, reconciled
 * against the most recent live party read. Identity is composite so a live
 * Ninjask can never mask a Shedinja (or vice versa) that shares its PID, and
 * lineage data keeps a stale save's pre-evolution out of the box after evolution.
 *
 * Rentals are exempt from the "missing mon" preservation: once a rental has
 * been seen leaving the live party it is treated as returned, so a stale save
 * cannot put it back in the box.
 */
export const reconcileBoxFromSave = (
  state: PartyInferenceState,
  saveBox: SaveBoxPokemon[],
  saveParty: SavePokemon[],
  liveParty: SavePokemon[] | null
): void => {
  const saveBoxKeys = new Set(saveBox.map(getMonIdentity));
  const savePartyKeys = new Set(saveParty.map(getMonIdentity));
  const liveKeys = liveParty ? new Set(liveParty.map(getMonIdentity)) : savePartyKeys;

  // A live read is authoritative: a rental present there is still owned.
  if (liveParty) {
    for (const key of Array.from(liveKeys)) state.returnedRentals.delete(key);
  }

  // Anything the snapshot accounts for — or that has since evolved — is no
  // longer an unconfirmed departure. Returned rentals are never unconfirmed
  // departures: they left the roster for good.
  for (const [key, data] of Array.from(state.departedSinceSave)) {
    if (isRentalSpeciesId(data.species_id)) {
      state.departedSinceSave.delete(key);
      if (!liveKeys.has(key)) {
        state.lastSeenParty.delete(key);
        state.returnedRentals.add(key);
      }
      continue;
    }
    if (
      saveBoxKeys.has(key) ||
      savePartyKeys.has(key) ||
      (liveParty && evolvedInto(data, liveParty, state))
    ) {
      state.departedSinceSave.delete(key);
    }
  }

  const rebuilt = new Map<string, SavePokemon>();
  for (const mon of saveBox) {
    const key = getMonIdentity(mon);
    if (state.returnedRentals.has(key)) continue;
    rebuilt.set(key, mon as unknown as SavePokemon);
  }
  for (const [key, data] of Array.from(state.departedSinceSave)) rebuilt.set(key, data);

  // Mons the snapshot still listed in the party that have since left it.
  // A same-PID evolution is not a departure: the new species is already in the
  // live party, while the old species no longer exists anywhere.
  for (const mon of saveParty) {
    const key = getMonIdentity(mon);
    if (liveKeys.has(key)) continue;
    if (liveParty && evolvedInto(mon, liveParty, state)) continue;
    if (isRentalSpeciesId(mon.species_id)) {
      // The save predates a rental return — do not resurrect it as a box mon.
      state.returnedRentals.add(key);
      state.lastSeenParty.delete(key);
      continue;
    }
    rebuilt.set(key, mon);
  }

  // Whatever is in the party right now is not in the box.
  for (const key of Array.from(liveKeys)) rebuilt.delete(key);

  state.inferredBox = rebuilt;
  state.lastPartyKeys = liveKeys;
};
