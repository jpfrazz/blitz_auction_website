import type { SaveBoxPokemon, SaveData, SavePokemon } from './parseSaveFile';
import { getMonIdentity } from './pokemonIdentity';

/** Fainted keys grouped by user id. Keys are `personality-species`, or a raw
 *  personality for saves written before composite keys existed. */
export type FaintedMap = Record<string, Set<string>>;

export function cloneFaintedMap(map: FaintedMap): FaintedMap {
  return Object.fromEntries(
    Object.entries(map).map(([uid, keys]) => [uid, new Set(keys)])
  );
}

/** Key written when a mon is first seen fainted. Including the level lets the
 *  profile keep showing `lvl 15` after that mon is healed or moved to a box. */
export const getFaintedKey = (mon: SavePokemon | SaveBoxPokemon): string => {
  const base = `${mon.personality >>> 0}-${mon.species_id}`;
  return 'level' in mon && mon.level != null ? `${base}-${mon.level}` : base;
};

/** Whether `keys` contains this mon, ignoring the level captured at faint time
 *  (the mon may have been healed and gained levels since). */
export function hasFaintedKey(
  keys: Set<string> | undefined,
  mon: SavePokemon | SaveBoxPokemon
): boolean {
  if (!keys) return false;
  const identity = getMonIdentity(mon);
  if (keys.has(identity) || keys.has(String(mon.personality))) return true;
  const prefix = `${identity}-`;
  return Array.from(keys).some((key) => key.startsWith(prefix));
}

type ParsedFaintKey = { pid: number; species: number; level?: number };

function parseFaintedKey(key: string): ParsedFaintKey | null {
  // Stored saves from older clients can contain numeric PIDs in this array.
  // They are harmless as raw keys, but must not throw while we inspect them.
  if (typeof key !== 'string') return null;
  const [pidText, speciesText, levelText] = key.split('-');
  // A raw PID is the legacy format and already matches every species.
  if (speciesText === undefined) return null;
  const pid = Number(pidText);
  const species = Number(speciesText);
  if (!Number.isFinite(pid) || !Number.isFinite(species)) return null;
  const level = levelText === undefined ? undefined : Number(levelText);
  return {
    pid,
    species,
    level: level !== undefined && Number.isFinite(level) ? level : undefined,
  };
}

/**
 * Record every fainted party mon for `uid` and carry persisted composite keys
 * forward when a mon evolves.
 *
 * A fainted Skiddo is stored as `pid-678`; once it becomes Gogoat the live mon
 * is `pid-673`, so the old key no longer matches. As long as the PID has only
 * one species in the save, the stale key can be migrated safely. Split
 * evolutions share a PID (Ninjask/Shedinja), so those are left alone to keep
 * the two fainted states distinct.
 *
 * Mutates `map` in place and returns whether anything was added.
 */
export function recordFaintedFromSave(
  map: FaintedMap,
  uid: string,
  data: SaveData | null | undefined
): boolean {
  if (!data) return false;

  const keys = map[uid] ?? (map[uid] = new Set<string>());
  let changed = false;
  const add = (key: string) => {
    if (!keys.has(key)) {
      keys.add(key);
      changed = true;
    }
  };

  if (Array.isArray(data.fainted_keys) && data.fainted_keys.length > 0) {
    data.fainted_keys.forEach(add);
  } else if (Array.isArray(data.fainted_pids)) {
    data.fainted_pids.forEach((pid) => add(String(pid)));
  }

  const mons: Array<SavePokemon | SaveBoxPokemon> = [
    ...(data.party ?? []),
    ...(data.box ?? []),
  ];
  mons.forEach((mon) => {
    if ('hp' in mon && mon.hp === 0) add(getFaintedKey(mon));
  });

  const speciesByPid = new Map<number, Set<number>>();
  mons.forEach((mon) => {
    const pid = mon.personality >>> 0;
    if (!speciesByPid.has(pid)) speciesByPid.set(pid, new Set<number>());
    speciesByPid.get(pid)!.add(mon.species_id);
  });

  Array.from(keys).forEach((key) => {
    const parsed = parseFaintedKey(key);
    if (!parsed) return;
    const { pid, species: oldSpecies, level } = parsed;

    const present = speciesByPid.get(pid);
    if (!present || present.size !== 1 || present.has(oldSpecies)) return;

    const current = mons.find((mon) => (mon.personality >>> 0) === pid);
    if (!current) return;
    // Carry the level at which it fainted; old two-part keys had none.
    add(level === undefined ? getMonIdentity(current) : `${pid}-${current.species_id}-${level}`);
  });

  return changed;
}
