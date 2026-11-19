import type { SaveBoxPokemon, SavePokemon } from './parseSaveFile';
import { getMonIdentity } from './pokemonIdentity';
import {
  applyPartyInference,
  createPartyInferenceState,
  reconcileBoxFromSave,
  setPartyInferenceEvolutionMetadata,
} from './partyBoxInference';

const NINJASK_PID = 378320750;
const CATERPIE_PID = 123456789;

const NAMES: Record<number, string> = {
  10: 'Caterpie',
  11: 'Metapod',
  12: 'Butterfree',
  222: 'Corsola',
  290: 'Nincada',
  291: 'Ninjask',
  292: 'Shedinja',
};

const mon = (species_id: number, hp = 20, personality = NINJASK_PID): SavePokemon => ({
  personality,
  nickname: NAMES[species_id] ?? `Species ${species_id}`,
  level: 20,
  hp,
  max_hp: hp,
  species_id,
  nature: 'Hardy',
  ability_num: 0,
  ivs: { hp: 15, atk: 15, def: 15, spa: 15, spd: 15, spe: 15 },
  moves: [104, 71, 28, 154],
});

const corsola = mon(222, 46, 2192851550);
const nincada = mon(290, 20, NINJASK_PID);
const ninjask = mon(291, 57);
const shedinja = mon(292, 1);
const caterpie = mon(10, 45, CATERPIE_PID);
const metapod = mon(11, 50, CATERPIE_PID);
const butterflyfree = mon(12, 60, CATERPIE_PID);

describe('same-PID Ninjask/Shedinja identity', () => {
  test('getMonIdentity distinguishes split-evolution partners', () => {
    expect(getMonIdentity(ninjask)).toBe(`${NINJASK_PID}-291`);
    expect(getMonIdentity(shedinja)).toBe(`${NINJASK_PID}-292`);
    expect(getMonIdentity(ninjask)).not.toBe(getMonIdentity(shedinja));
  });

  test('a live party containing both keeps both in the party and out of the box', () => {
    const state = createPartyInferenceState();
    const saveParty = [ninjask, corsola, shedinja];

    reconcileBoxFromSave(state, [], saveParty, saveParty);

    expect(Array.from(state.lastPartyKeys).sort()).toEqual([
      getMonIdentity(corsola),
      getMonIdentity(ninjask),
      getMonIdentity(shedinja),
    ].sort());
    expect(state.inferredBox.size).toBe(0);
  });

  test('a stale live read missing Shedinja cannot erase it', () => {
    const state = createPartyInferenceState();
    const saveParty = [ninjask, corsola, shedinja];
    const staleLiveParty = [ninjask, corsola];

    reconcileBoxFromSave(state, [], saveParty, staleLiveParty);

    // Shedinja is no longer in the live read, so it is preserved in the box
    // instead of being swallowed by Ninjask's identical PID.
    expect(Array.from(state.inferredBox.values()).map(m => m.species_id)).toEqual([292]);
    expect(state.inferredBox.has(getMonIdentity(shedinja))).toBe(true);
  });

  test('a boxed Shedinja is not deleted by a live Ninjask with the same PID', () => {
    const state = createPartyInferenceState();
    const boxed: SaveBoxPokemon = shedinja as unknown as SaveBoxPokemon;

    reconcileBoxFromSave(state, [boxed], [ninjask, corsola], [ninjask, corsola]);

    expect(Array.from(state.inferredBox.values()).map(m => m.species_id)).toEqual([292]);
  });

  test('applyPartyInference tracks Shedinja leaving independently of Ninjask', () => {
    const state = createPartyInferenceState();

    applyPartyInference(state, [ninjask, corsola, shedinja]);
    applyPartyInference(state, [ninjask, corsola]);

    expect(Array.from(state.inferredBox.values()).map(m => m.species_id)).toEqual([292]);
    expect(state.inferredBox.has(getMonIdentity(shedinja))).toBe(true);
    expect(state.lastPartyKeys.has(getMonIdentity(ninjask))).toBe(true);
    expect(state.lastPartyKeys.has(getMonIdentity(shedinja))).toBe(false);
  });
});

describe('evolution-aware inference', () => {
  test('Nincada evolving into Ninjask + Shedinja does not leave Nincada in the box', () => {
    const state = createPartyInferenceState();

    applyPartyInference(state, [nincada, corsola]);
    applyPartyInference(state, [ninjask, shedinja, corsola]);

    expect(state.inferredBox.size).toBe(0);
    expect(state.lastPartyKeys.has(getMonIdentity(nincada))).toBe(false);
    expect(state.lastPartyKeys.has(getMonIdentity(ninjask))).toBe(true);
    expect(state.lastPartyKeys.has(getMonIdentity(shedinja))).toBe(true);
  });

  test('a stale save listing Nincada does not re-add it after the split evolution', () => {
    const state = createPartyInferenceState();

    reconcileBoxFromSave(state, [], [nincada, corsola], [ninjask, shedinja, corsola]);

    expect(state.inferredBox.size).toBe(0);
  });

  test('a normal same-PID evolution does not leave the pre-evolution in the box', () => {
    const state = createPartyInferenceState();

    applyPartyInference(state, [caterpie, corsola]);
    applyPartyInference(state, [metapod, corsola]);

    expect(state.inferredBox.size).toBe(0);
    expect(state.lastPartyKeys.has(getMonIdentity(metapod))).toBe(true);
  });

  test('a stale save listing a pre-evolution is reconciled away after evolution', () => {
    const state = createPartyInferenceState();

    reconcileBoxFromSave(state, [], [caterpie, corsola], [metapod, corsola]);

    expect(state.inferredBox.size).toBe(0);
  });

  test('multi-stage lineage from pokemon metadata recognizes distant evolutions', () => {
    const state = createPartyInferenceState();
    setPartyInferenceEvolutionMetadata(state, new Map<number, any[]>([
      [10, [{ evolves_from_id: null }]],
      [11, [{ evolves_from_id: '10' }]],
      [12, [{ evolves_from_id: 11 }]],
    ]));

    applyPartyInference(state, [caterpie]);
    applyPartyInference(state, [butterflyfree]);

    expect(state.inferredBox.size).toBe(0);
  });

  test('an evolved-looking mon with a different PID is still treated as a box departure', () => {
    const state = createPartyInferenceState();
    const unrelatedMetapod = mon(11, 50, CATERPIE_PID + 1);

    applyPartyInference(state, [caterpie, corsola]);
    applyPartyInference(state, [unrelatedMetapod, corsola]);

    expect(Array.from(state.inferredBox.values()).map(m => m.species_id)).toEqual([10]);
  });
});
