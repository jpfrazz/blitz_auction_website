import type { SaveBoxPokemon, SavePokemon } from './parseSaveFile';

type IdentifiableMon = Pick<SavePokemon, 'personality' | 'species_id'> | Pick<SaveBoxPokemon, 'personality' | 'species_id'>;

/**
 * Stable identity for a Pokémon in website state.
 *
 * A personality/PID is not unique in Blitz: Gen III's Nincada split creates
 * Ninjask and Shedinja by copying the source struct, so both legitimately have
 * the same PID. Keying maps, sets, React keys, or drag-and-drop IDs by PID alone
 * makes those two mons collide and lets one silently erase the other.
 *
 * Species distinguishes the pair (and any other legitimate PID collisions),
 * while `>>> 0` keeps the value stable if a PID ever arrives as a signed int.
 */
export const getMonIdentity = (mon: IdentifiableMon): string =>
  `${mon.personality >>> 0}-${mon.species_id}`;
