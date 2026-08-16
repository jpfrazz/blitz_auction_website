// Synthetic reproduction of the "garbage Pokemon appear in the box after
// saves" bug, using the site's REAL parsing/scoring functions imported from
// parseSaveFile.ts.
//
// Setup mirrors the reported session:
//   - the live gPlayerParty has STALE checksums (Blitz direct writes) so the
//     strict scan rejects it;
//   - the flash save-slot buffer holds a valid-checksum party at a HIGH heap
//     offset, so the strict scan pins the FLASH BUFFER as the "live" party;
//   - each save rotates the flash: the party section moves, and the pinned
//     offset briefly holds data that decodes (shape-only) to out-of-dex garbage
//     species before the emulator settles it.
// Then it replays the site's .sav-handler + poll logic cycle by cycle and
// prints exactly what enters the party display vs. the inferred box.

import {
  parseRamParty,
  getRamPartyCount,
  findRamPartyOffset,
  findRamPartyCopies,
  SavePokemon,
} from '../src/utils/parseSaveFile';

const SECTION_SIZE = 4096;
const RAM_POKEMON_SIZE = 116;
const RADIUS = 256 * 1024;

const SUBSTRUCTURE_ORDERS = [
  'GAEM', 'GAME', 'GEAM', 'GEMA', 'GMAE', 'GMEA',
  'AGEM', 'AGME', 'AEGM', 'AEMG', 'AMGE', 'AMEG',
  'EGAM', 'EGMA', 'EAGM', 'EAMG', 'EMGA', 'EMAG',
  'MGAE', 'MGEA', 'MAGE', 'MAEG', 'MEGA', 'MEAG',
];

function writeU32(b: Uint8Array, o: number, v: number) {
  b[o] = v & 0xff; b[o + 1] = (v >>> 8) & 0xff; b[o + 2] = (v >>> 16) & 0xff; b[o + 3] = (v >>> 24) & 0xff;
}
function writeU16(b: Uint8Array, o: number, v: number) {
  b[o] = v & 0xff; b[o + 1] = (v >>> 8) & 0xff;
}
function readU32(b: Uint8Array, o: number): number {
  return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
}

function makeMon(personality: number, otId: number, species: number, level: number, maxHp: number, staleChecksum = false): Uint8Array {
  const m = new Uint8Array(RAM_POKEMON_SIZE);
  writeU32(m, 0, personality);
  writeU32(m, 4, otId);
  const key = (personality ^ otId) >>> 0;
  const order = SUBSTRUCTURE_ORDERS[personality % 24];
  const growthIdx = order.indexOf('G');
  const miscIdx = order.indexOf('M');
  const attackIdx = order.indexOf('A');
  const sub = new Uint8Array(64);
  writeU32(sub, growthIdx * 16, species);
  writeU32(sub, miscIdx * 16 + 4, 0x1a1a1a1a);
  for (let mv = 0; mv < 4; mv++) {
    const xor = mv % 2 === 0 ? key & 0xffff : key >>> 16;
    writeU16(sub, attackIdx * 16 + mv * 2, (mv + 1) ^ xor);
  }
  for (let w = 0; w < 16; w++) writeU32(m, 32 + w * 4, readU32(sub, w * 4) ^ key);
  let sum = 0;
  for (let w = 0; w < 16; w++) {
    const word = readU32(sub, w * 4);
    sum += (word & 0xffff) + (word >>> 16);
  }
  writeU16(m, 28, ((staleChecksum ? sum + 1 : sum) & 0xffff));
  m[100] = level;
  writeU16(m, 102, maxHp);
  writeU16(m, 104, maxHp);
  return m;
}

function placeParty(heap: Uint8Array, off: number, mons: Uint8Array[]) {
  heap[off - 4] = mons.length;
  mons.forEach((m, i) => heap.set(m, off + i * RAM_POKEMON_SIZE));
}

const GARBAGE_SPECIES = [1612, 1823, 2021, 1740, 1704, 1888];
function placeShapePassingGarbage(heap: Uint8Array, off: number, seed: number) {
  const mons = GARBAGE_SPECIES.map((sp, i) =>
    makeMon(0x10000000 + seed * 16 + i, 0xdeadbeef, sp, (seed * 13 + i * 17) % 100 + 1, 100 + i * 50, true)
  );
  placeParty(heap, off, mons);
}
function placeShapeFailingGarbage(heap: Uint8Array, off: number, seed: number) {
  heap.fill(0, off - 4, off + RAM_POKEMON_SIZE); // personality 0 → shape fails
}

const state = {
  box: new Map<number, SavePokemon>(),
  departed: new Map<number, SavePokemon>(),
  lastSeen: new Map<number, SavePokemon>(),
  lastPartyPids: new Set<number>(),
};

// ── Verbatim from EmulatorPage.tsx ──────────────────────────────────────────
function applyPartyInference(party: SavePokemon[]) {
  const box = state.box;
  const departed = state.departed;
  const newPids = new Set<number>();
  for (const mon of party) {
    newPids.add(mon.personality);
    state.lastSeen.set(mon.personality, mon);
    box.delete(mon.personality);
    departed.delete(mon.personality);
  }
  for (const pid of Array.from(state.lastPartyPids)) {
    if (!newPids.has(pid) && !box.has(pid)) {
      const data = state.lastSeen.get(pid);
      if (data) {
        box.set(pid, data);
        departed.set(pid, data);
      }
    }
  }
  state.lastPartyPids = newPids;
}

function reconcileBoxFromSave(saveBox: SavePokemon[], saveParty: SavePokemon[], liveParty: SavePokemon[] | null) {
  const saveBoxPids = new Set(saveBox.map((m) => m.personality));
  const savePartyPids = new Set(saveParty.map((m) => m.personality));
  const livePids = liveParty ? new Set(liveParty.map((m) => m.personality)) : savePartyPids;
  for (const pid of Array.from(state.departed.keys())) {
    if (saveBoxPids.has(pid) || savePartyPids.has(pid)) state.departed.delete(pid);
  }
  const rebuilt = new Map<number, SavePokemon>();
  for (const m of saveBox) rebuilt.set(m.personality, m);
  for (const [pid, data] of Array.from(state.departed)) rebuilt.set(pid, data);
  for (const m of saveParty) {
    if (!livePids.has(m.personality)) rebuilt.set(m.personality, m);
  }
  for (const pid of Array.from(livePids)) rebuilt.delete(pid);
  state.box = rebuilt;
  state.lastPartyPids = livePids;
}
// ─────────────────────────────────────────────────────────────────────────────

const heap = new Uint8Array(16 * 1024 * 1024);
const ewramPartyOff = 0x20000;
const flashStart = 0x800000;
const partyOff = (i: number) => flashStart + i * SECTION_SIZE + 0x238;

const otId = 0x12345678;
const realPids = [0x11111111, 0x22222222, 0x33333333, 0x44444444, 0x55555555, 0x66666666];
const realMons = realPids.map((p, i) => makeMon(p, otId, [6, 3, 9, 65, 130, 149][i], 50 + i * 5, 160 + i * 20, false));
const parsedParty = (off: number) => parseRamParty(heap, off, false); // what parseSaveFile yields for the .sav

// EWRAM party with stale checksums → invisible to strict scan, found by identity.
placeParty(heap, ewramPartyOff, realMons.map((m) => {
  const c = new Uint8Array(m); c[28] = (c[28] + 1) & 0xff; return c;
}));
// Flash party (valid checksums) at section index 0 → strict scan pins it.
placeParty(heap, partyOff(0), realMons);

console.log('=== sanity ===');
console.log('EWRAM strict:', getRamPartyCount(heap, ewramPartyOff, true), '| EWRAM shape:', getRamPartyCount(heap, ewramPartyOff, false));
console.log('flash strict:', getRamPartyCount(heap, partyOff(0), true));

const pinned = findRamPartyOffset(heap);
console.log('\n=== first save: strict scan pins ===');
console.log('pinned =', pinned, '| is flash buffer?', pinned === partyOff(0));

let liveOff = pinned;
let sectionIdx = 0;
applyPartyInference(parsedParty(partyOff(0)));
console.log('after first save: party', parsedParty(partyOff(0)).map((m) => m.species_id), '| box size', state.box.size);

console.log('\n══════════ replaying saves ══════════\n');
for (let save = 2; save <= 5; save++) {
  const garbageSeed = save * 1000 + sectionIdx;

  // ── rotation: party section moves up; the pinned offset now briefly shows
  //    garbage that passes the shape-only read ──
  sectionIdx += 1;
  const newRealOff = partyOff(sectionIdx);
  placeShapePassingGarbage(heap, liveOff, garbageSeed); // old pinned offset → shape-passing garbage
  placeParty(heap, newRealOff, realMons);               // relocated real party (valid checksums)

  console.log(`--- save #${save}: rotation -> party at ${newRealOff} ---`);
  console.log('  old pinned offset strict:', getRamPartyCount(heap, liveOff, true), 'shape:', getRamPartyCount(heap, liveOff, false));
  console.log('  new party offset   strict:', getRamPartyCount(heap, newRealOff, true));

  // ── .sav handler: reads liveOff (pinned), reconcile seeds lastPartyPids ──
  const savLive = getRamPartyCount(heap, liveOff, false) !== null ? parseRamParty(heap, liveOff, false) : null;
  console.log('  [.sav] live read at', liveOff, '-> species', savLive?.map((m) => m.species_id) ?? 'null');
  reconcileBoxFromSave([], parsedParty(newRealOff), savLive);

  // ── poll #1: fast path reads the same garbage (seeds lastSeenParty) ──
  const g1 = getRamPartyCount(heap, liveOff, false);
  if (g1 !== null) {
    const p = parseRamParty(heap, liveOff, false);
    console.log('  [poll#1] fast path read garbage species', p.map((m) => m.species_id));
    applyPartyInference(p);
  }

  // ── flash settles: the pinned offset now fails shape ──
  placeShapeFailingGarbage(heap, liveOff, garbageSeed + 1);

  // ── poll #2: fast path fails -> local strict rescan re-pins to the real
  //    relocated party; inference boxes the previous garbage ──
  const g2 = getRamPartyCount(heap, liveOff, false);
  if (g2 !== null) {
    console.log('  [poll#2] still reads garbage (shape passes)');
    applyPartyInference(parseRamParty(heap, liveOff, false));
  } else {
    const local = findRamPartyOffset(heap, Math.max(4, liveOff - RADIUS), liveOff + RADIUS);
    if (local !== null) {
      console.log('  [poll#2] fast path FAILED shape -> re-pin to', local);
      liveOff = local;
      applyPartyInference(parsedParty(local));
    } else {
      console.log('  [poll#2] fast path FAILED shape, rescan found nothing');
    }
  }

  console.log('  [result] displayed party species:', parsedParty(liveOff).map((m) => m.species_id));
  console.log('  [result] box species:', [...state.box.values()].map((m) => m.species_id), '| size', state.box.size);
}

console.log('\n══════════ summary ══════════');
const boxSpecies = [...state.box.values()].map((m) => m.species_id);
console.log('final box species:', boxSpecies);
console.log('out-of-dex garbage in box:', boxSpecies.filter((s) => s > 1573));
console.log('box size:', state.box.size);
console.log('identity scan copies of real party:', findRamPartyCopies(heap, realPids));
