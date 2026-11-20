import type { SaveBoxPokemon, SaveData, SavePokemon } from './parseSaveFile';
import { cloneFaintedMap, hasFaintedKey, recordFaintedFromSave, type FaintedMap } from './faintedTracking';

const ivs = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };

const partyMon = (personality: number, species_id: number, hp: number, level = 15): SavePokemon => ({
  personality,
  nickname: '',
  level,
  hp,
  max_hp: 50,
  species_id,
  nature: 'Hardy',
  ability_num: 0,
  ivs,
  moves: [],
  total_turns: null,
  ko_count: null,
});

const boxMon = (personality: number, species_id: number): SaveBoxPokemon => ({
  personality,
  nickname: '',
  species_id,
  ability_num: 0,
  nature: 'Hardy',
  ivs,
  moves: [],
  total_turns: null,
  ko_count: null,
});

const save = (
  party: SavePokemon[],
  box: SaveBoxPokemon[],
  fainted_keys: string[] = [],
  fainted_pids: number[] = []
): SaveData => ({
  trainer_name: 'Test',
  money: 0,
  badge_count: 0,
  map_name: '',
  party,
  box,
  trainer_card_wins: [],
  most_recent_loss: null,
  most_recent_loss_name: null,
  player_faint_counter: null,
  fainted_keys,
  fainted_pids,
});

describe('recordFaintedFromSave', () => {
  it('records a fainted party mon by composite identity', () => {
    const map: FaintedMap = {};
    expect(recordFaintedFromSave(map, 'u1', save([partyMon(123, 678, 0)], []))).toBe(true);
    expect(Array.from(map.u1)).toEqual(['123-678-15']);
  });

  it('migrates a stale key when the mon evolved', () => {
    const map: FaintedMap = {};
    // Skiddo (678) fainted, but the save now holds the evolved Gogoat (673).
    const data = save([partyMon(123, 673, 40)], [], ['123-678']);
    expect(recordFaintedFromSave(map, 'u1', data)).toBe(true);
    expect(Array.from(map.u1).sort()).toEqual(['123-673', '123-678']);
  });

  it('keeps the faint level when migrating an evolved key', () => {
    const map: FaintedMap = {};
    const data = save([partyMon(123, 673, 40)], [], ['123-678-15']);
    expect(recordFaintedFromSave(map, 'u1', data)).toBe(true);
    expect(Array.from(map.u1).sort()).toEqual(['123-673-15', '123-678-15']);
  });

  it('does not migrate a key when split evolutions share the PID', () => {
    const map: FaintedMap = {};
    const data = save([partyMon(123, 291, 1), partyMon(123, 292, 1)], [], ['123-290']);
    expect(recordFaintedFromSave(map, 'u1', data)).toBe(true);
    // Only the persisted Nincada key is kept; neither split product inherits it.
    expect(Array.from(map.u1)).toEqual(['123-290']);
  });

  it('keeps legacy raw PID keys unchanged', () => {
    const map: FaintedMap = {};
    const data = save([partyMon(123, 673, 40)], [], [], [123]);
    expect(recordFaintedFromSave(map, 'u1', data)).toBe(true);
    expect(Array.from(map.u1)).toEqual(['123']);
  });

  it('still matches a healed mon that gained levels after fainting', () => {
    const keys = new Set(['123-678-15']);
    expect(hasFaintedKey(keys, partyMon(123, 678, 40, 27))).toBe(true);
  });

  it('cloneFaintedMap returns independent sets', () => {
    const map = { u1: new Set(['123-678']) };
    const copy = cloneFaintedMap(map);
    copy.u1.add('123-673');
    expect(Array.from(map.u1)).toEqual(['123-678']);
  });
});
