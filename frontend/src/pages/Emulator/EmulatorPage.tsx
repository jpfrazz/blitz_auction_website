import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import Header from '../../shared/components/Header';
import { parseSaveFile, SaveData, SavePokemon, SaveBoxPokemon, getTrainerNameById, parseRamParty, getRamPartyCount, ramPartyScore, findRamPartyOffset, findRamPartyCopies, hashRamParty, formatMapName, findLiveMapEwramBase, readLiveMapFrame, LIVE_WARP_EWRAM_BASE_OFFSET, RAM_PARTY_BYTES, SECTION_SIZE, SLOT_SIZE, NUM_SECTIONS, FOOTER_OFFSET, SIGNATURE } from '../../utils/parseSaveFile';
import { MAP_NAMES } from '../Auction/mapNames';
import { getIconName, createResolveMetadata, isActuallyNicknamed } from '../../utils/speciesUtils';
import { SPECIES_BY_ID } from '../../utils/speciesIdMap';
import { MOVES, MOVE_TYPE_COLORS } from '../../utils/movesData';
import { fetchCurrentUser, fetchDraftById, claimEeveelution, unclaimEeveelution, fetchControlBindings, saveControlBindings, forfeitDraft } from '../../shared/api/draftData';
import { fetchPokemonList } from '../../shared/api/pokemon';
import EeveelutionClaimButton from './EeveelutionClaimButton';
import NotebookWithdrawButton from './NotebookWithdrawButton';
import './EmulatorPage.scss';

(function () {
  if (typeof window === 'undefined') return;

  // 1. VISIBILITY MASK
  Object.defineProperty(document, 'hidden', { get: () => false, configurable: true });
  Object.defineProperty(document, 'visibilityState', { get: () => 'visible', configurable: true });

  // 2. UNIFIED BACKGROUND WORKER CLOCK
  const workerCode = `
        let timer = null;
        self.onmessage = function(e) {
            if (e.data === 'start') {
                if (timer) clearInterval(timer);
                timer = setInterval(() => { self.postMessage('tick'); }, 16.666666666666668);
            }
        };
    `;
  const blob = new Blob([workerCode], { type: 'application/javascript' });
  const worker = new Worker(URL.createObjectURL(blob));

  let fakeRAFId = 0;
  const pendingCallbacks = new Map<number, FrameRequestCallback>();
  let lastTime = performance.now();

  // The worker thread handles 100% of the game loops, completely bypassing browser throttling
  worker.onmessage = function () {
    const callbacksToRun = Array.from(pendingCallbacks.entries());
    pendingCallbacks.clear();

    callbacksToRun.forEach(([id, callback]) => {
      lastTime += 16.666666666666668;
      callback(lastTime);
    });
  };

  worker.postMessage('start');

  // 3. OVERRIDE TIMING GLOBAL (Always use the worker engine)
  window.requestAnimationFrame = function (callback: FrameRequestCallback): number {
    const id = ++fakeRAFId;
    pendingCallbacks.set(id, callback);
    return id;
  };

  window.cancelAnimationFrame = function (id: number): void {
    pendingCallbacks.delete(id);
  };

  // 4. AUDIO CONTEXT PROTECTOR
  const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
  if (AudioContextClass) {
    AudioContextClass.prototype.suspend = function (): Promise<void> {
      return Promise.resolve();
    };
    const originalCreateGain = AudioContextClass.prototype.createGain;
    AudioContextClass.prototype.createGain = function () {
      if (this.state === 'suspended') {
        try { (this as any).resume(); } catch (e) { }
      }
      return originalCreateGain.apply(this, arguments as any);
    };
  }
})();

const NATURE_EFFECTS: Record<string, string> = {
  "Hardy": "",
  "Lonely": " (+Atk -Def)",
  "Brave": " (+Atk -Spe)",
  "Adamant": " (+Atk -SpAtk)",
  "Naughty": " (+Atk -SpDef)",
  "Bold": " (+Def -Atk)",
  "Docile": "",
  "Relaxed": " (+Def -Spe)",
  "Impish": " (+Def -SpAtk)",
  "Lax": " (+Def -SpDef)",
  "Timid": " (+Spe -Atk)",
  "Hasty": " (+Spe -Def)",
  "Serious": "",
  "Jolly": " (+Spe -SpAtk)",
  "Naive": " (+Spe -SpDef)",
  "Modest": " (+SpAtk -Atk)",
  "Mild": " (+SpAtk -Def)",
  "Quiet": " (+SpAtk -Spe)",
  "Rash": " (+SpAtk -SpDef)",
  "Calm": " (+SpDef -Atk)",
  "Gentle": " (+SpDef -Def)",
  "Sassy": " (+SpDef -Spe)",
  "Careful": " (+SpDef -SpAtk)",
  "Quirky": "",
  "Bashful": ""
};

declare global {
  interface Window {
    EJS_player: string;
    EJS_core: string;
    EJS_gameUrl: string;
    EJS_pathtodata: string;
    EJS_startOnLoaded: boolean;
    EJS_stopOnUnfocused: boolean;
    EJS_pauseOnBlur: boolean;
    EJS_language: string;
    EJS_ready: (() => void) | undefined;
    EJS_onGameStart: (() => void) | undefined;
    EJS_emulator: {
      on(event: string, callback: (data?: unknown) => void): void;
      callEvent(event: string, data?: unknown): void;
      gameManager?: {
        simulateInput(player: number, index: number, value: number): void;
        saveSaveFiles(): void;
        getState(): Uint8Array;
        loadState(state: Uint8Array): void;
        quickLoad(slot?: number): void;
        getSaveFilePath(): string;
        FS?: {
          syncfs(populate: boolean, callback: (err: any) => void): void;
        };
        // Emscripten module. `HEAPU8` is a live view of the WASM heap the
        // libretro core runs in, which is where the GBA's EWRAM (and the live
        // party) lives.
        Module?: {
          HEAPU8: Uint8Array;
          [key: string]: unknown;
        };
      };
      displayMessage(message: string, time?: number): void;
    } | undefined;
    EJS_buttons: { [key: string]: boolean };
    EJS_Buttons?: { [key: string]: any };
    EJS_gameName: string;
    EJS_hideSettings: string[];
  }
}

const ACCEPTED_EXTENSIONS = ['gba'];
const BLITZ_PATCH_URL = '/emeraldblitz.bps';

/**
 * Implements the BPS (Beat Patch System) patching algorithm.
 * Based on the spec: https://www.romhacking.net/documents/746/
 */
function applyBpsPatch(source: Uint8Array, patch: Uint8Array): Uint8Array {
  if (patch[0] !== 0x42 || patch[1] !== 0x50 || patch[2] !== 0x53 || patch[3] !== 0x31) {
    throw new Error('Invalid BPS patch header');
  }

  let offset = 4;
  const readVLI = () => {
    let value = 0, shift = 1;
    while (true) {
      const byte = patch[offset++];
      value += (byte & 0x7f) * shift;
      if (byte & 0x80) break;
      shift <<= 7;
      value += shift;
    }
    return value;
  };

  readVLI(); // Source size (unused for application)
  const targetSize = readVLI();
  const metadataSize = readVLI();
  offset += metadataSize;

  const target = new Uint8Array(targetSize);
  let sourceRelativeOffset = 0;
  let targetRelativeOffset = 0;
  let outputOffset = 0;

  while (offset < patch.length - 12) {
    const data = readVLI();
    const command = data & 3;
    const length = (data >> 2) + 1;

    if (command === 0) { // SourceRead
      for (let i = 0; i < length; i++) {
        target[outputOffset] = source[outputOffset];
        outputOffset++;
      }
    } else if (command === 1) { // TargetRead
      for (let i = 0; i < length; i++) target[outputOffset++] = patch[offset++];
    } else if (command === 2) { // SourceCopy
      const data = readVLI();
      sourceRelativeOffset += (data & 1 ? -(data >> 1) : (data >> 1));
      for (let i = 0; i < length; i++) target[outputOffset++] = source[sourceRelativeOffset++];
    } else if (command === 3) { // TargetCopy
      const data = readVLI();
      targetRelativeOffset += (data & 1 ? -(data >> 1) : (data >> 1));
      for (let i = 0; i < length; i++) target[outputOffset++] = target[targetRelativeOffset++];
    }
  }
  return target;
}

// CRC32 lookup table, used to verify the uploaded ROM matches the source ROM
// the Blitz patch was built against.
const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  const table = CRC32_TABLE;
  for (let i = 0; i < data.length; i++) {
    crc = table[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const IVRow: React.FC<{ ivs: { hp: number; atk: number; def: number; spa: number; spd: number; spe: number } }> = ({ ivs }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [gapPx, setGapPx] = useState(12);

  const updateGap = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const parentWidth = el.clientWidth;
    const items = Array.from(el.children) as HTMLElement[];
    if (items.length < 2) return;

    const contentWidth = items.reduce((sum, item) => sum + item.getBoundingClientRect().width, 0);
    const maxGap = 0.8 * parseFloat(getComputedStyle(document.documentElement).fontSize);
    const minGap = 0.15 * parseFloat(getComputedStyle(document.documentElement).fontSize);
    const requiredGap = (parentWidth - contentWidth) / (items.length - 1);
    const newGap = Math.max(minGap, Math.min(maxGap, requiredGap));
    setGapPx(newGap);
  }, []);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    updateGap();
    if (typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver(() => updateGap());
    observer.observe(el);
    if (el.parentElement) observer.observe(el.parentElement);
    return () => observer.disconnect();
  }, [updateGap]);

  return (
    <div className="mon-ivs" ref={ref} style={{ gap: `${gapPx}px` }}>
      <span className="iv-item"><span className="iv-label">HP </span><span className="iv-value" data-good={ivs.hp > 24} data-bad={ivs.hp < 7}>{ivs.hp}</span></span>
      <span className="iv-item"><span className="iv-label">ATK </span><span className="iv-value" data-good={ivs.atk > 24} data-bad={ivs.atk < 7}>{ivs.atk}</span></span>
      <span className="iv-item"><span className="iv-label">DEF </span><span className="iv-value" data-good={ivs.def > 24} data-bad={ivs.def < 7}>{ivs.def}</span></span>
      <span className="iv-item"><span className="iv-label">SPA </span><span className="iv-value" data-good={ivs.spa > 24} data-bad={ivs.spa < 7}>{ivs.spa}</span></span>
      <span className="iv-item"><span className="iv-label">SPD </span><span className="iv-value" data-good={ivs.spd > 24} data-bad={ivs.spd < 7}>{ivs.spd}</span></span>
      <span className="iv-item"><span className="iv-label">SPE </span><span className="iv-value" data-good={ivs.spe > 24} data-bad={ivs.spe < 7}>{ivs.spe}</span></span>
    </div>
  );
};

function readBpsVli(patch: Uint8Array, offset: number): { value: number; nextOffset: number } {
  let value = 0;
  let shift = 1;
  while (true) {
    const byte = patch[offset++];
    value += (byte & 0x7f) * shift;
    if (byte & 0x80) break;
    shift <<= 7;
    value += shift;
  }
  return { value, nextOffset: offset };
}

/**
 * Refuses to proceed unless `rom` is a clean (vanilla, unmodified) copy of the
 * exact Pokémon Emerald ROM the Blitz patch expects. Running the BPS patch on a
 * different or already-patched ROM silently produces corrupted game data, so we
 * verify the ROM before patching instead of letting a bad result get played.
 */
function validateEmeraldRom(rom: Uint8Array, patch: Uint8Array): void {
  if (patch.length < 16 || patch[0] !== 0x42 || patch[1] !== 0x50 || patch[2] !== 0x53 || patch[3] !== 0x31) {
    throw new Error('Failed to load the Blitz patch.');
  }

  const sourceSize = readBpsVli(patch, 4).value;
  if (rom.length !== sourceSize) {
    throw new Error(`That file is the wrong size for Pokémon Emerald. Please use an unpatched ROM.`);
  }

  // GBA header game code (offset 0xAC) — "BPEE" identifies Pokémon Emerald.
  const gameCode = String.fromCharCode(rom[0xAC], rom[0xAD], rom[0xAE], rom[0xAF]);
  if (gameCode !== 'BPEE') {
    throw new Error('That file does not appear to be Pokémon Emerald. Please select a clean, unmodified Emerald ROM.');
  }

  // The final 12 bytes of a BPS patch are the source CRC32, target CRC32, and
  // patch CRC32. The source CRC32 is the checksum of the vanilla ROM the patch
  // was created from, so a match proves the upload is that exact clean ROM.
  const sourceCrc = (patch[patch.length - 12]
    | patch[patch.length - 11] << 8
    | patch[patch.length - 10] << 16
    | patch[patch.length - 9] << 24) >>> 0;
  const romCrc = crc32(rom);
  if (romCrc !== sourceCrc) {
    throw new Error('That Pokémon Emerald ROM has already been modified (patched or hacked). Please use a clean, unmodified vanilla Emerald ROM.');
  }
}

function getExtension(filename: string): string {
  return filename.split('.').pop()?.toLowerCase() ?? '';
}

const DB_NAME = 'BlitzEmulatorSaves';
const DB_VERSION = 1;
const STORE_NAME = 'saves';

function openSavesDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getStoredSave(key: string): Promise<Uint8Array | null> {
  try {
    const db = await openSavesDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(key);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.error('Failed to get stored save:', err);
    return null;
  }
}

async function setStoredSave(key: string, data: Uint8Array): Promise<void> {
  try {
    const db = await openSavesDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.put(data, key);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.error('Failed to store save:', err);
  }
}

async function deleteStoredSave(key: string): Promise<void> {
  try {
    const db = await openSavesDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(key);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.error('Failed to delete stored save:', err);
  }
}

// Map of user_id → latest parsed save for other draft players
type OtherPlayerSaves = Record<string, { displayName: string; save: SaveData | null; mapName?: string; inBattle?: boolean }>;

// Returns "Wally" or "Steven" when the player has a champion win on their
// trainer card (Wally = 656, Steven = 804), otherwise null. Used to display
// "(Beat Wally!)" / "(Beat Steven!)" once the save reaches the museum.
function getChampionName(saveData: SaveData | null | undefined): string | null {
  const wins = saveData?.trainer_card_wins;
  if (!wins || wins.length === 0) return null;
  const championWins = wins.filter(w => !w.is_loss && (w.trainer_id === 656 || w.trainer_id === 804));
  if (championWins.length === 0) return null;
  return championWins[championWins.length - 1].trainer_id === 804 ? 'Steven' : 'Wally';
}

// In-game seconds elapsed when a player obtained their Nth badge, derived from
// the gym leader win on their trainer card with version === N. Used to break
// badge-count ties: the player who earned badge N at the earliest in-game time
// is ordered first. Returns Infinity when the info isn't available so unknown
// players sort below everyone they're tied with.
function badgeReachSeconds(save: SaveData | null | undefined, badgeCount: number): number {
  const wins = save?.trainer_card_wins;
  if (badgeCount <= 0 || !wins || wins.length === 0) return Infinity;
  const gym = wins.find(w => w.version === badgeCount);
  if (!gym) return Infinity;
  return gym.hours * 3600 + gym.minutes * 60 + gym.seconds;
}

// ── Memoized player cards ──────────────────────────────────────────────────
// One card per racer in the right sidebar and the Tab-key standings overlay.
// Extracted behind React.memo so a location/battle ping for a single player
// (or our own save flushes) only re-renders that player's card instead of
// re-sorting every box in the sidebar on every message. All helper props are
// referentially stable (useCallback/useMemo in the parent), so the default
// shallow prop compare skips cards whose data didn't change.
interface PlayerCardProps {
  uid: string;
  displayName: string;
  saveData: SaveData | null;
  mapName: string | undefined;
  inBattle: boolean;
  sortPokemon: (uid: string, mons: any[]) => any[];
  isMonFainted: (uid: string, mon: any) => boolean;
  isPlayerDisconnected: (uid: string, saveData: SaveData | null) => boolean;
  resolveMetadata: (speciesId: number, nickname?: string) => any;
}

const cardEntries = (saveData: SaveData | null): any[] => [
  ...(saveData?.party ?? []).map((m: any) => ({ ...m, _isParty: true })),
  ...(saveData?.box ?? []).map((m: any) => ({ ...m, _isParty: false })),
];

const OverlayPlayerCard = React.memo(function OverlayPlayerCard({
  uid,
  displayName,
  saveData,
  mapName,
  inBattle,
  sortPokemon,
  isMonFainted,
  isPlayerDisconnected,
  resolveMetadata,
}: PlayerCardProps) {
  // Detect wipe (InsideOfTruck) or win (champion trainer-card win)
  const isWiped = saveData?.map_name === 'InsideOfTruck';
  const mostRecentLossName = saveData?.most_recent_loss_name;
  const championName = getChampionName(saveData);
  const showDisconnected =
    isPlayerDisconnected(uid, saveData) && !isWiped && !championName;
  const currentMap = mapName ?? saveData?.map_name;

  return (
    <div className="overlay-player-card">
      <div className="overlay-player-header">
        <span className={`overlay-username ${showDisconnected ? 'disconnected' : ''}`}>{displayName}</span>
        {isWiped && mostRecentLossName && (
          <span className="wipe-text">(Wiped to {mostRecentLossName})</span>
        )}
        {championName && (
          <span className="win-text">(Beat {championName}!)</span>
        )}
        {showDisconnected && (
          <span className="disconnect-text">(Disconnected)</span>
        )}
        <span className="overlay-badges">
          {saveData ? `${saveData.badge_count} ${saveData.badge_count === 1 ? 'badge' : 'badges'}` : '— badges'}
        </span>
      </div>
      {currentMap && (
        <div className="sidebar-map" title={`${currentMap} (map)`}>
          {formatMapName(currentMap)}
          {inBattle && <span className="in-battle-suffix"> (In battle)</span>}
        </div>
      )}
      {saveData ? (
        <div className="overlay-mon-icons">
          {sortPokemon(uid, cardEntries(saveData)).map((mon: any, i: number, arr: any[]) => {
            const speciesId = mon.species_id ?? mon.speciesId;
            const speciesData = resolveMetadata(speciesId, mon.nickname);
            const realName = (speciesId === 412 && mon.nickname?.toLowerCase() === 'egg') ? "Egg" : (speciesData?.name || `ID ${speciesId}`);
            const iconName = getIconName(realName, speciesId);
            const fainted = isMonFainted(uid, mon);
            const prevFainted = i > 0 ? isMonFainted(uid, arr[i - 1]) : false;
            const isFirstFainted = fainted && !prevFainted;

            return (
              <span key={`overlay-icon-${i}`} className={`mini-icon-wrapper overlay ${isFirstFainted ? 'first-fainted' : ''}`}>
                <img
                  src={`/MiniIcons/${iconName}.png`}
                  alt={mon.nickname || realName}
                  className={`overlay-mini-icon ${fainted ? 'fainted' : ''}`}
                  style={fainted ? { filter: 'grayscale(100%)', opacity: 0.6 } : {}}
                  title={`${realName}`}
                  onError={(e) => { (e.target as HTMLImageElement).src = '/MiniIcons/question.png'; }}
                />
              </span>
            );
          })}
        </div>
      ) : (
        <p className="overlay-no-save">Waiting for save…</p>
      )}
    </div>
  );
});

const SidebarPlayerCard = React.memo(function SidebarPlayerCard({
  uid,
  displayName,
  saveData,
  mapName,
  inBattle,
  isReady,
  sortPokemon,
  isMonFainted,
  isPlayerDisconnected,
  resolveMetadata,
}: PlayerCardProps & { isReady: boolean }) {
  // Detect wipe (InsideOfTruck) or win (champion trainer-card win)
  const isWiped = saveData?.map_name === 'InsideOfTruck';
  const mostRecentLossName = saveData?.most_recent_loss_name;
  const championName = getChampionName(saveData);
  const showDisconnected =
    isPlayerDisconnected(uid, saveData) && !isWiped && !championName;
  const currentMap = mapName ?? saveData?.map_name;

  return (
    <div className={`sidebar-player-card ${isReady ? 'race-ready' : ''}`}>
      <div className="sidebar-player-header">
        <span className={`sidebar-username ${showDisconnected ? 'disconnected' : ''} ${isWiped ? 'wiped' : ''} ${championName ? 'winner' : ''}`}>
          {displayName}
          {isWiped && mostRecentLossName && (
            <span className="wipe-text"> (Wiped to {mostRecentLossName})</span>
          )}
          {championName && (
            <span className="win-text"> (Beat {championName}!)</span>
          )}
          {showDisconnected && (
            <span className="disconnect-text"> (Disconnected)</span>
          )}
        </span>
        <span className="sidebar-badges">
          {saveData ? `${saveData.badge_count} ${saveData.badge_count === 1 ? 'badge' : 'badges'}` : '— badges'}
        </span>
      </div>
      {currentMap && (
        <div className="sidebar-map" title={`${currentMap} (map)`}>
          {formatMapName(currentMap)}
          {inBattle && <span className="in-battle-suffix"> (In battle)</span>}
        </div>
      )}
      {saveData ? (
        <div className="sidebar-mon-icons">
          {sortPokemon(uid, cardEntries(saveData)).map((mon: any, i: number, arr: any[]) => {
            const speciesId = mon.species_id ?? mon.speciesId;
            const speciesData = resolveMetadata(speciesId, mon.nickname);
            const realName = (speciesId === 412 && mon.nickname?.toLowerCase() === 'egg') ? "Egg" : (speciesData?.name || `ID ${speciesId}`);
            const iconName = getIconName(realName, speciesId);
            const abilityName = speciesData?.abilities?.[mon.ability_num] || 'Unknown';
            const fainted = isMonFainted(uid, mon);
            const prevFainted = i > 0 ? isMonFainted(uid, arr[i - 1]) : false;
            const isFirstFainted = fainted && !prevFainted;
            const hasNickname = isActuallyNicknamed(mon.nickname, speciesId, realName);

            return (
              <span key={`icon-${i}`} className={`mini-icon-wrapper sidebar ${isFirstFainted ? 'first-fainted' : ''}`}>
                <img
                  src={`/MiniIcons/${iconName}.png`}
                  alt={mon.nickname || realName}
                  className={`sidebar-mini-icon ${fainted ? 'fainted' : ''}`}
                  style={fainted ? { filter: 'grayscale(100%)', opacity: 0.6 } : {}}
                  title={`${hasNickname ? `${mon.nickname} (${realName})` : realName} (${abilityName}) - ${mon.nature || 'Unknown'} Nature${mon.nature ? NATURE_EFFECTS[mon.nature] : ''}${mon.ivs ? `\nIVs: ${mon.ivs.hp}/${mon.ivs.atk}/${mon.ivs.def}/${mon.ivs.spa}/${mon.ivs.spd}/${mon.ivs.spe}` : ''}${mon.moves && mon.moves.some((id: number) => id > 0) ? `\nMoves: ${mon.moves.filter((id: number) => id > 0).map((id: number) => MOVES[id]?.name).filter(Boolean).join(', ')}` : ''}`}
                  onError={(e) => { (e.target as HTMLImageElement).src = '/MiniIcons/question.png'; }}
                />
              </span>
            );
          })}
        </div>
      ) : (
        <p className="sidebar-no-save">Waiting for save…</p>
      )}
    </div>
  );
});

// Boss trainers a player can forfeit to. Ids match TRAINER_ID_TO_NAME in
// parseSaveFile.ts so the recorded loss shows the same name everywhere.
const FORFEIT_TRAINERS: { id: number; name: string }[] = [
  { id: 265, name: 'Roxanne' },
  { id: 855, name: 'Viola' },
  { id: 266, name: 'Brawly' },
  { id: 267, name: 'Wattson' },
  { id: 268, name: 'Flannery' },
  { id: 269, name: 'Norman' },
  { id: 270, name: 'Winona' },
  { id: 271, name: 'Tate & Liza' },
  { id: 272, name: 'Juan & Wallace' },
  { id: 601, name: 'Maxie' },
  { id: 34, name: 'Archie' },
  { id: 261, name: 'Sidney' },
  { id: 262, name: 'Phoebe' },
  { id: 263, name: 'Glacia' },
  { id: 264, name: 'Drake' },
  { id: 806, name: 'Tucker' },
  { id: 807, name: 'Spenser' },
  { id: 810, name: 'Lucy' },
  { id: 811, name: 'Brandon' },
  { id: 656, name: 'Wally' },
  { id: 804, name: 'Steven' },
];

interface ToastNotification {
  id: number;
  text: string;
}

// A live read of the WRONG region (the player's own party/box data read at a
// shifted stride) decodes slots whose nickname field lands on the trainer's OT
// name — so every garbage mon ends up "nicknamed" the player's name exactly
// (e.g. the trainer "PHONY." shows as a "phony." nickname on every garbage
// slot). Real mons keep their species name or a custom nickname, so a nickname
// that matches the trainer name marks the slot as a garbage read regardless of
// how plausible the decoded species id looks (a garbage species like 1160 is
// still Kartana in the metadata, but it's not a real catch). Comparison strips
// case and non-alphanumerics so "PHONY", "Phony", and "phony." all normalize to
// the same key.
const isTrainerNameNickname = (nickname: string | undefined, trainerName: string | undefined): boolean => {
  if (!nickname || !trainerName) return false;
  const clean = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const n = clean(nickname);
  const t = clean(trainerName);
  return n.length > 0 && n === t;
};

// Boss trainers' Pokémon all have 31/31/31/31/31/31 IVs, which is impossible
// for a player to obtain. During battles the live party read can accidentally
// pick up gEnemyParty, so this catches that case.
const isBossIvs = (ivs: { hp: number; atk: number; def: number; spa: number; spd: number; spe: number }): boolean => {
  return ivs.hp === 31 && ivs.atk === 31 && ivs.def === 31 && ivs.spa === 31 && ivs.spd === 31 && ivs.spe === 31;
};

const normalizeName = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');

// A live read that pinned the wrong region can decode a slot whose plaintext
// nickname is a *different* species' name than the species_id it decrypts to.
//  That is physically impossible for a real Pokémon:
//   • an un-nicknamed mon's nickname is always its own species name (or a
//     truncated prefix of it), and
//   • a genuinely nicknamed mon never carries another species' exact name.
// So if a slot's nickname is ANY valid species name other than its own, the
// slot came from a misaligned/garbage read and must not be shown.
const isForeignSpeciesNickname = (mon: SavePokemon): boolean => {
  const nick = mon.nickname;
  if (!nick) return false;
  if (mon.species_id === 412 && nick.toLowerCase() === 'egg') return false;
  const n = normalizeName(nick);
  if (!n) return false;
  const ownInfo = SPECIES_BY_ID[mon.species_id];
  const ownName = ownInfo ? normalizeName(ownInfo.name) : '';
  // It's this mon's own (possibly truncated) species name -> fine.
  if (ownName && (ownName === n || ownName.startsWith(n))) return false;
  // Does the nickname name some *other* species in the ROM map?
  for (const id in SPECIES_BY_ID) {
    if (Number(id) === mon.species_id) continue;
    const cand = normalizeName(SPECIES_BY_ID[id].name);
    if (cand === n || cand.startsWith(n)) return true;
  }
  return false;
};

// Drops slots that decoded from a garbage live read (see isTrainerNameNickname),
// that belong to a boss trainer (all-31 IVs, see isBossIvs), or whose plaintext
// nickname is another species' name (see isForeignSpeciesNickname).
// Returns null when the ENTIRE read is garbage so the caller can fall back to
// the .sav party instead of clobbering the display with nonsense.
const filterLiveParty = (party: SavePokemon[], trainerName: string | undefined): SavePokemon[] | null => {
  const clean = party.filter((m) => {
    if (isTrainerNameNickname(m.nickname, trainerName)) return false;
    if (isBossIvs(m.ivs)) return false;
    if (isForeignSpeciesNickname(m)) return false;
    return true;
  });
  return clean.length > 0 ? clean : null;
};

const EmulatorPage: React.FC = () => {
  const { draftId } = useParams<{ draftId?: string }>();
  const [searchParams] = useSearchParams();

  const urlPokemon = useMemo(() => {
    const names = searchParams.getAll('pokemon');
    if (names.length === 0) return [];

    // Handle Plusle and Minun: in-game they're separate entries but selecting
    // Plusle gives both. Website has "plusle and minun" as one entry, or
    // individual "plusle"/"minun". If both are present, keep only Plusle.
    const hasPlusle = names.includes('plusle');
    const hasMinun = names.includes('minun');
    const hasCombined = names.includes('plusle and minun');

    const deduped = names.filter(n => {
      if (n === 'minun' && (hasPlusle || hasCombined)) return false;
      if (n === 'plusle' && hasCombined) return false;
      return true;
    });

    return deduped.map(name => ({ name }));
  }, [searchParams]);

  const [romUrl, setRomUrl] = useState<string | null>(null);
  const [romName, setRomName] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isPatching, setIsPatching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Own parsed save data shown below the emulator
  const [mySaveData, setMySaveData] = useState<SaveData | null>(null);
  const [saveLastSynced, setSaveLastSynced] = useState<Date | null>(null);
  const [isPanelMinimized, setIsPanelMinimized] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  // Emulator resize: drag the bottom / right / corner edges. Null means "use
  // the CSS default" (75% width, calc height) so nothing changes until the
  // player drags a handle.
  const [emulatorHeightPx, setEmulatorHeightPx] = useState<number | null>(null);
  const [emulatorWidthPx, setEmulatorWidthPx] = useState<number | null>(null);
  const [isResizing, setIsResizing] = useState(false);

  // Progress (0..1) of the initial full-heap scan that locates the live party
  // in the WASM heap. Mirrors liveScanStateRef so the first scan's lag spike is
  // explained by a small load bar bottom-right instead of looking like a
  // freeze. null = not scanning / hidden.
  const [scanProgress, setScanProgress] = useState<number | null>(null);

  // Whether THIS player is mid-battle, read live from the game's EWRAM buffer
  // (byte +0x05 of gLiveWarpStatus, mirrored from gMain.inBattle every frame).
  // Drives the "(In battle)" suffix on the player's own location card.
  const [myInBattle, setMyInBattle] = useState(false);

  const [autosaveHistory, setAutosaveHistory] = useState<{ id: string; ts: number }[]>([]);
  const [isAutosaveModalOpen, setIsAutosaveModalOpen] = useState(false);

  // Current logged-in user (to exclude self from sidebar)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [currentUsername, setCurrentUsername] = useState<string | null>(null);
  const [hasRefereeRole, setHasRefereeRole] = useState(false);

  // Other players in the draft (populated via WebSocket)
  const [otherSaves, setOtherSaves] = useState<OtherPlayerSaves>({});

  // Which players currently have a live emulator WebSocket open (populated via
  // the server's presence snapshot + PlayerConnected/PlayerDisconnected events).
  const [connectedUsers, setConnectedUsers] = useState<Set<string>>(new Set());
  // Users we've ever seen connected this session, so a player who joins the
  // lobby and then closes their tab (before ever saving) still shows as gone.
  const [everConnectedUsers, setEverConnectedUsers] = useState<Set<string>>(new Set());
  // Set once the server's presence snapshot has been received so players don't
  // flash as disconnected for the instant before we know who's online.
  const [presenceLoaded, setPresenceLoaded] = useState(false);

  const [pokemonMetadata, setPokemonMetadata] = useState<Record<string, any>>({});
  const [pokemonById, setPokemonById] = useState<Map<number, any[]>>(new Map());

  // Draft data for eeveelution claiming
  const [draftData, setDraftData] = useState<any>(null);

  // Ready to Race state
  const [readyPlayers, setReadyPlayers] = useState<Set<string>>(new Set());
  const [countdown, setCountdown] = useState<number | null>(null);
  const [raceStarted, setRaceStarted] = useState(false);

  // Persist fainted state via Personality ID (User ID -> Set of PIDs)
  const [faintedPids, setFaintedPids] = useState<Record<string, Set<number>>>({});
  // Pokémon the player has marked (checked) so they remember to buy items for
  // them. Keyed by personality ID, same as faintedPids.
  const [markedPids, setMarkedPids] = useState<Set<number>>(new Set());

  // Toast notifications for state load events from other players
  const [notifications, setNotifications] = useState<ToastNotification[]>([]);
  const toastIdRef = useRef(0);

  // Tab key overlay for race standings
  const [showOverlay, setShowOverlay] = useState(false);

  // Forfeit flow: confirm modal -> trainer dropdown -> stop emulator
  const [isForfeitConfirmOpen, setIsForfeitConfirmOpen] = useState(false);
  const [isForfeitTrainerOpen, setIsForfeitTrainerOpen] = useState(false);
  const [forfeitTrainerId, setForfeitTrainerId] = useState<number | null>(null);
  const [isForfeiting, setIsForfeiting] = useState(false);
  const [forfeitedTrainer, setForfeitedTrainer] = useState<string | null>(null);

  const addNotification = useCallback((text: string) => {
    const id = ++toastIdRef.current;
    setNotifications(prev => [...prev, { id, text }]);
    setTimeout(() => {
      setNotifications(prev => prev.filter(n => n.id !== id));
    }, 4000);
  }, []);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const objectUrlRef = useRef<string | null>(null);
  const scriptRef = useRef<HTMLScriptElement | null>(null);
  const syncIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stateIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectCountRef = useRef(0);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Latest currentUserId so the WebSocket onopen handler (a closure created
  // before the user fetch resolves) can still register presence correctly.
  const currentUserIdRef = useRef<string | null>(null);
  const controlBindingsIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastKnownBindingsRef = useRef<string | null>(null);
  const blockShortcutsRef = useRef<((e: KeyboardEvent) => void) | null>(null);
  const isWithdrawingRef = useRef(false);
  const blockContextMenuRef = useRef<((e: MouseEvent) => void) | null>(null);
  const handleBeforeUnloadRef = useRef<((e: BeforeUnloadEvent) => void) | null>(null);
  const originalSetItemRef = useRef<((key: string, value: string) => void) | null>(null);

  // ── Emulator resize drag ─────────────────────────────────────────────────
  const gameStageRef = useRef<HTMLDivElement>(null);
  const layoutRef = useRef<HTMLDivElement>(null);
  const resizeDragRef = useRef<{
    mode: 'bottom' | 'right' | 'corner';
    startX: number;
    startY: number;
    startHeight: number;
    startWidth: number;
    maxHeight: number;
    maxWidth: number;
  } | null>(null);

  // Stable ref so window callbacks always see the latest handler
  const onRawSaveBytesRef = useRef<((bytes: Uint8Array) => void) | null>(null);

  // Latest raw .sav bytes for the download button
  const latestSaveBytesRef = useRef<Uint8Array | null>(null);
  const [hasSaveBytes, setHasSaveBytes] = useState(false);

  // Once a player forfeits, ignore any further save bytes — the final save the
  // emulator triggers while shutting down must not overwrite the forfeit loss
  // that was just recorded on the backend.
  const forfeitedRef = useRef(false);

  // ── Live party reads from the WASM heap ──────────────────────────────────
  // The libretro mGBA core keeps the GBA's EWRAM (and with it the live party)
  // in the WASM heap, reachable via gameManager.Module.HEAPU8. We scan once to
  // find the party offset (it stays fixed for a session since EWRAM is a
  // stable core allocation), then poll the RAM_PARTY_BYTES (696-byte) region
  // and merge changes into mySaveData so the site updates live instead of
  // waiting for .sav flushes.
  const liveSyncIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const livePartyOffsetRef = useRef<number | null>(null);
  const livePartyHashRef = useRef<string>('');
  // Scan progress so a full-heap search can be spread across poll ticks. `best`
  // tracks the strongest candidate (highest count) seen so far; a lone checksum
  // false positive at a low offset must not shadow the real party, so we adopt
  // the best of the whole heap instead of the first match. A full pass is only
  // restarted once per `LIVE_SCAN_MIN_INTERVAL_MS`, and that backoff is the
  // cost saver before a party exists (brand-new file, still in the bedroom):
  // while a party is absent every pass finds nothing, so running the scan more
  // often just starves the emulator's main thread with no benefit. When a party
  // actually exists the very first pass finds it, so a long backoff never
  // delays a real detection.
  const liveScanStateRef = useRef({
    running: false,
    next: 0,
    lastAttempt: 0,
    best: null as { off: number; score: number } | null,
  });
  // Mirror of mySaveData so the live poll can read the latest base save
  // (trainer/money/badges/box from the .sav parse) without a stale closure.
  const mySaveDataRef = useRef<SaveData | null>(null);
  // Live current-map: the WASM-heap offset where the GBA EWRAM region begins,
  // discovered once by scanning for the decomp's live warp buffer (see the map
  // read in livePollRef), plus the chunked-scan state. `lastPostedMapRef` is
  // the last map identifier committed, so the /location ping only fires on an
  // actual map transition. `lastPostedBattleRef` mirrors the in-battle flag the
  // same way so entering/exiting a battle also pings without spamming.
  const ewramBaseRef = useRef<number | null>(null);
  const ewramScanStartRef = useRef(0);
  const ewramScanDoneRef = useRef(false);
  const ewramScanRetryAtRef = useRef(0);
  const lastPostedMapRef = useRef<string | null>(null);
  const lastPostedBattleRef = useRef(false);
  const LIVE_MAP_SCAN_CHUNK = 2 * 1024 * 1024;
  const LIVE_MAP_SCAN_RETRY_MS = 10000;
  // Inferred PC box. Blitz only writes the flash on manual saves, so the .sav
  // box goes stale the moment the player moves mons around in storage. Since a
  // mon that leaves the live party must have gone to the box, we carry
  // departures forward at their most recent seen stats and let each new .sav
  // box snapshot (ground truth) erase mons that are genuinely gone (released,
  // traded, rented). `departedSinceSave` tracks departures that happened after
  // the last .sav snapshot was written so a stale snapshot can't resurrect or
  // erase them.
  const inferredBoxRef = useRef<Map<number, SavePokemon>>(new Map());
  const departedSinceSaveRef = useRef<Map<number, SavePokemon>>(new Map());
  const lastSeenPartyRef = useRef<Map<number, SavePokemon>>(new Map());
  const lastPartyPidsRef = useRef<Set<number>>(new Set());
  const LIVE_POLL_MS = 750;
  const LIVE_SCAN_BUDGET_MS = 120;
  // A full pass is only restarted once per LIVE_SCAN_MIN_INTERVAL_MS — the
  // backoff is the cost saver while no party exists (brand-new file, still in
  // the bedroom): every pass over the whole heap eats up to the budget per
  // tick, so running it constantly starved the emulator's main thread. When a
  // party actually exists the very first pass finds it, so a long backoff
  // never delays a real detection.
  const LIVE_SCAN_MIN_INTERVAL_MS = 10000;
  // The party lives in EWRAM, a small buffer that in EmulatorJS/mGBA sits in
  // the low megabytes of the (up to 128MB) WASM heap, so there's no need to
  // scan the whole heap. Capping the region makes each pass take a couple of
  // seconds instead of minutes.
  const LIVE_SCAN_MAX_BYTES = 32 * 1024 * 1024;
  // When the known party offset fails to validate, we search this many bytes
  // on each side of it in a single tick (~256KB @ 4-byte stride ≈ 5ms). The
  // party never moves far, so this relocates it without a full heap scan.
  const LIVE_PARTY_LOCAL_SCAN_RADIUS = 256 * 1024;
  // Consecutive fast-path misses before a persisted (not yet validated) offset
  // is given up and a fresh scan starts. An offset validated THIS session is
  // never dropped on misses: EWRAM addresses are fixed per session, so the
  // party reappears there after a reset or battle.
  const LIVE_PARTY_MISS_LIMIT = 10;
  const LIVE_PARTY_OFFSETS_KEY = 'blitz_live_party_offsets';
  // Filesystem watcher: poll .sav mtime/size to detect manual saves instantly.
  const savWatcherRef = useRef<{ intervalId: ReturnType<typeof setInterval> | null; lastStat: { mtime: number; size: number } | null; retryIntervalId: ReturnType<typeof setInterval> | null; haveSeenSave: boolean }>({ intervalId: null, lastStat: null, retryIntervalId: null, haveSeenSave: false });
  // Consecutive fast-path misses at the current offset (transient battle
  // states recover within a tick or two, so a miss is never fatal).
  const livePartyMissesRef = useRef(0);
  // True once this session's RAM scan has validated an offset. A persisted
  // offset from a previous session could belong to a different ROM build, so
  // it is only trusted after it validates; once validated it is never dropped.
  const livePartySessionValidatedRef = useRef(false);
  // Identity of the currently loaded ROM (name:size), used to persist and
  // restore the party offset so reloads skip the heap scan.
  const livePartyRomKeyRef = useRef<string | null>(null);
  // Every location in RAM that holds a copy of the party's mon identities
  // (gPlayerParty plus save-slot buffers). The checksum-gated scan finds the
  // party only when its checksums happen to be current, so it can pin a static
  // copy while the live gPlayerParty (stale checksums) sits elsewhere — that
  // made swaps "not update". We find ALL copies by plaintext personality
  // signature and watch which one actually changes to identify the live one.
  const livePartyCandidatesRef = useRef<number[]>([]);
  const livePartyCandHashesRef = useRef<string[]>([]);
  // Once a candidate has been observed to change (proving it is gPlayerParty),
  // only that offset is polled; the others are no longer watched, so a battle
  // populating gEnemyParty mid-session can never be mistaken for the player's.
  const livePartyProvenLiveRef = useRef(false);
  // Pending identity-signature scan (personalities to match, next offset).
  const livePartySigScanRef = useRef<{ ids: number[]; next: number }>({ ids: [], next: 0 });
  const LIVE_SIG_SCAN_CHUNK = 512 * 1024;

  // Stable ref for the notification fetch so EJS_ready closure always gets the current draftId
  const postStateLoadRef = useRef<(() => void) | null>(null);
  postStateLoadRef.current = () => {
    if (draftId) {
      fetch(`/api/drafts/${draftId}/state-load-notification`, {
        method: 'POST',
        credentials: 'include',
      }).catch(() => { });
    }
  };

  // ── Fetch current user to filter self from sidebar ───────────────────────
  useEffect(() => {
    fetchCurrentUser().then((u) => {
      if (u.user_id) {
        currentUserIdRef.current = u.user_id;
        setCurrentUserId(u.user_id);
      }
      setCurrentUsername(u.username);
      setHasRefereeRole(
        (u.roles ?? []).some((role) => role.role_name === 'Referee' || role.role_name === 'Admin') ||
        u.username === 'franklynathan' || u.username === 'jage04' || u.username === 'Jason' || u.username === 'mfrazz'
      );
    }).catch(() => { });
  }, []);

  useEffect(() => {
    if (!draftId) return;
    let cancelled = false;
    fetchDraftById(draftId)
      .then((draft) => {
        if (cancelled) return;
        setDraftData(draft);
        setOtherSaves((prev) => {
          const next = { ...prev };
          for (const team of draft.teams) {
            const teamKey = team.user_id ?? team.guest_id ?? '';
            next[teamKey] = {
              // Preserve existing entry state (e.g. live mapName/inBattle)
              // across hydration.
              ...next[teamKey],
              displayName: team.global_name?.trim() || team.username || '',
              // Prefer the latest save the backend persisted so a player who has
              // stopped broadcasting live saves still shows up after a reload.
              save: team.save_data ?? prev[teamKey]?.save ?? null,
            };
          }
          return next;
        });
      })
      .catch(() => { });
    return () => {
      cancelled = true;
    };
  }, [draftId]);

  // Load pokemon list to map species_id -> name for MiniIcons.
  // Fetch both regular and rental pokemon since the emulator shows ALL Pokemon.
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetchPokemonList(),
      fetch('/api/pokemon/rental').then(r => r.ok ? r.json() : []).catch(() => []),
    ]).then(([regular, rental]) => {
      if (cancelled) return;
      const all = [...regular, ...rental];
      const map: Record<string, any> = {};
      const idMap = new Map<number, any[]>();
      for (const p of all) {
        const entry = {
          ...p,
          abilities: [p.ability1, p.ability2 || p.ability1, p.hidden_ability || p.ability1]
        };
        const name = p.name?.toLowerCase();
        if (name) map[name] = entry;

        const id = p.id || p.pokedex_id;
        if (id) {
          const numId = Number(id);
          const existing = idMap.get(numId) || [];
          existing.push(entry);
          idMap.set(numId, existing);
        }
      }
      setPokemonMetadata(map);
      setPokemonById(idMap);
    }).catch((err) => {
      console.error('[Icon Metadata] Failed to load pokemon list:', err);
    });
    return () => { cancelled = true; };
  }, []);

  const resolveMetadata = useMemo(
    () => createResolveMetadata(pokemonById, pokemonMetadata),
    [pokemonById, pokemonMetadata]
  );

  useEffect(() => {
    if (!draftId) return;

    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const wsUrl = `${protocol}://${window.location.host}/api/ws/${draftId}`;
    const maxReconnectAttempts = 5;
    const baseReconnectInterval = 1000;

    const wsConnect = () => {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        reconnectCountRef.current = 0;
        // Tell the server this socket is a live player so the lobby knows we're
        // here. Re-sent on every reconnect so a drop-and-rejoin registers again.
        const uid = currentUserIdRef.current;
        if (uid) {
          ws.send(JSON.stringify({ type: 'PresenceRegister', data: { user_id: uid } }));
        }
      }

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string);
          if (msg.type === 'PresenceSnapshot') {
            const ids = (msg.data?.user_ids ?? []) as string[];
            setConnectedUsers(new Set(ids));
            setEverConnectedUsers((prev) => new Set([...Array.from(prev), ...ids]));
            setPresenceLoaded(true);
          }
          if (msg.type === 'PlayerConnected') {
            const { user_id } = msg.data as { user_id: string };
            setConnectedUsers((prev) => new Set(prev).add(user_id));
            setEverConnectedUsers((prev) => new Set(prev).add(user_id));
            setPresenceLoaded(true);
          }
          if (msg.type === 'PlayerDisconnected') {
            const { user_id } = msg.data as { user_id: string };
            setConnectedUsers((prev) => {
              const next = new Set(prev);
              next.delete(user_id);
              return next;
            });
            setPresenceLoaded(true);
          }
          if (msg.type === 'SaveUpdate') {
            const { user_id, save_data } = msg.data as { user_id: string; save_data: any };
            setOtherSaves((prev) => ({
              ...prev,
              [user_id]: {
                ...prev[user_id],
                displayName: prev[user_id]?.displayName ?? user_id,
                save: save_data,
              },
            }));
          }
          // Lightweight live location ping from another player's heap read.
          // Bail on our own echo (the server broadcasts to every subscriber,
          // poster included) and on messages that don't change anything, so a
          // redundant ping doesn't re-render the sidebar player cards.
          if (msg.type === 'LocationUpdate') {
            const { user_id, map_name, in_battle } = msg.data as { user_id: string; map_name: string; in_battle?: boolean };
            if (user_id === currentUserId) return;
            const nextInBattle = !!in_battle;
            setOtherSaves((prev) => {
              const prevEntry = prev[user_id];
              if (prevEntry && prevEntry.mapName === map_name && !!prevEntry.inBattle === nextInBattle) {
                return prev;
              }
              return {
                ...prev,
                [user_id]: {
                  displayName: prevEntry?.displayName ?? user_id,
                  save: prevEntry?.save ?? null,
                  mapName: map_name,
                  inBattle: nextInBattle,
                },
              };
            });
          }
          // DraftUpdate gives us the username list for the sidebar
          if (msg.type === 'DraftUpdate') {
            const teams = (msg.data?.teams ?? []) as Array<{
              user_id: string;
              username: string;
              global_name?: string | null;
              save_data?: SaveData | null;
            }>;
            setOtherSaves((prev) => {
              const next = { ...prev };
              for (const t of teams) {
                next[t.user_id] = {
                  // Preserve existing entry state across DraftUpdate.
                  ...next[t.user_id],
                  displayName: t.global_name?.trim() || t.username,
                  save: t.save_data ?? next[t.user_id]?.save ?? null,
                };
              }
              return next;
            });
          }
          // State load notification from another player
          if (msg.type === 'StateLoadNotification') {
            const { display_name } = msg.data as { display_name: string };
            addNotification(`${display_name} loaded a previous state!`);
          }
          // Wipe notification
          if (msg.type === 'WipeNotification') {
            const { username, trainer } = msg.data as { username: string; trainer: string };
            addNotification(`${username} wiped to ${trainer}!`);
          }
          // Win notification
          if (msg.type === 'WinNotification') {
            const { username, trainer } = msg.data as { username: string; trainer: string };
            addNotification(`${username} beat ${trainer}!`);
          }
          // Eeveelution claim notification
          if (msg.type === 'EeveelutionClaimed') {
            const { user_name, eeveelution_name, user_id, pokedex_id, form } = msg.data as { user_name: string; eeveelution_name: string; user_id: string; pokedex_id: number; form: string | null };
            addNotification(`${user_name} claimed ${eeveelution_name}!`);

            // Update draft data locally to reflect the claim instantly
            setDraftData((prev: any) => {
              if (!prev) return prev;
              const updatedTeams = prev.teams.map((team: any) => {
                if (team.user_id === user_id) {
                  const existingAuctions = team.auctions_won || [];
                  // Check if already claimed to avoid duplicates
                  const alreadyClaimed = existingAuctions.some((p: any) => p.pokedex_id === pokedex_id && p.form === form);
                  if (alreadyClaimed) return team;

                  return {
                    ...team,
                    auctions_won: [...existingAuctions, { pokedex_id, form, name: eeveelution_name }]
                  };
                }
                return team;
              });
              return { ...prev, teams: updatedTeams };
            });
          }
          // Eeveelution unclaim notification
          if (msg.type === 'EeveelutionUnclaimed') {
            const { user_name, eeveelution_name, user_id, pokedex_id, form } = msg.data as { user_name: string; eeveelution_name: string; user_id: string; pokedex_id: number; form: string | null };
            addNotification(`${user_name} unclaimed ${eeveelution_name}!`);

            // Update draft data locally to reflect the unclaim instantly
            setDraftData((prev: any) => {
              if (!prev) return prev;
              const updatedTeams = prev.teams.map((team: any) => {
                if (team.user_id === user_id) {
                  const existingAuctions = team.auctions_won || [];
                  return {
                    ...team,
                    auctions_won: existingAuctions.filter((p: any) => !(p.pokedex_id === pokedex_id && p.form === form))
                  };
                }
                return team;
              });
              return { ...prev, teams: updatedTeams };
            });
          }
          // Ready to Race
          if (msg.type === 'ReadyToRace') {
            const { user_id } = msg.data as { user_id: string };
            setReadyPlayers(prev => {
              const next = new Set(prev);
              next.add(user_id);
              return next;
            });
          }
          if (msg.type === 'ReadyToRaceCancelled') {
            const { user_id } = msg.data as { user_id: string };
            setReadyPlayers(prev => {
              const next = new Set(prev);
              next.delete(user_id);
              return next;
            });
          }
        } catch {
          // ignore parse errors
        }
      };

      // reconnect if ws is disconnected unintentionally
      ws.onclose = (event) => {
        if (event.wasClean) return;

        if (reconnectCountRef.current < maxReconnectAttempts) {
          const delay = baseReconnectInterval * Math.pow(2, reconnectCountRef.current);
          reconnectTimeoutRef.current = setTimeout(() => {
            reconnectCountRef.current += 1;
            wsConnect();
          }, delay);
        }
        else {
        }
      }
    };

    wsConnect();


    return () => {
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      if (wsRef.current) {
        wsRef.current.close(1000, 'closing socket');
        wsRef.current = null;
      }
    };
  }, [draftId, addNotification]);

  // If the WebSocket opened before fetchCurrentUser resolved, register presence
  // as soon as we learn our user_id.
  useEffect(() => {
    if (!currentUserId) return;
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'PresenceRegister', data: { user_id: currentUserId } }));
    }
  }, [currentUserId]);

  // Track which Personalities have hit 0 HP to keep them fainted in the box
  useEffect(() => {
    const newFainted: Record<string, Set<number>> = { ...faintedPids };
    let changed = false;

    const processSave = (uid: string, data: SaveData | null) => {
      if (!data) return;
      if (!newFainted[uid]) newFainted[uid] = new Set();
      // Restore fainted personalities persisted by the backend (survives reload)
      if (Array.isArray(data.fainted_pids)) {
        data.fainted_pids.forEach(pid => {
          if (!newFainted[uid].has(pid)) {
            newFainted[uid].add(pid);
            changed = true;
          }
        });
      }
      data.party?.forEach(mon => {
        if (mon.hp === 0 && !newFainted[uid].has(mon.personality)) {
          newFainted[uid].add(mon.personality);
          changed = true;
        }
      });
    };

    if (currentUserId) processSave(currentUserId, mySaveData);
    Object.entries(otherSaves).forEach(([uid, entry]) => processSave(uid, entry.save));

    if (changed) setFaintedPids(newFainted);
  }, [mySaveData, otherSaves, currentUserId]);

  // Keep the live poll in sync with the latest parsed save.
  useEffect(() => {
    mySaveDataRef.current = mySaveData;
  }, [mySaveData]);

  const isMonFainted = useCallback((uid: string, mon: any) => {
    if (mon.hp === 0) return true;
    const deadSet = faintedPids[uid];
    if (deadSet && deadSet.has(mon.personality)) return true;
    return false;
  }, [faintedPids]);

  const toggleMarked = useCallback((pid: number) => {
    setMarkedPids(prev => {
      const next = new Set(prev);
      if (next.has(pid)) next.delete(pid);
      else next.add(pid);
      return next;
    });
  }, []);

  // ── Save bytes handler: parse + POST to backend ──────────────────────────
  // Shared POST helper used by both the .sav flush path and the live heap path.
  const postSaveToBackend = (parsed: SaveData, extra?: Record<string, unknown>) => {
    if (!draftId) return;
    const body: Record<string, unknown> = {
      ...parsed,
      // Persist which Pokemon have been seen fainted so a reload doesn't
      // forget boxed fainted Pokemon and reset their grayed-out look.
      fainted_pids: currentUserId ? Array.from(faintedPids[currentUserId] ?? []) : [],
      ...extra,
    };
    fetch(`/api/drafts/${draftId}/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      credentials: 'include',
    }).catch(() => { });
  };

  // Stable ref so the poll interval always calls the freshest handler.
  const livePollRef = useRef<(() => void) | null>(null);

  // ── Locate the flash save image inside the WASM heap ──────────────────────
  // The .sav bytes mGBA exposes are exactly the emulated flash contents, so the
  // flash save-slot buffer in HEAPU8 is a copy of `latestSaveBytes`. That buffer
  // is the ROTATING save image (sections move on every manual save), so it must
  // never be treated as the live party — a shape-only read of a rotated-in
  // section decodes garbage mons that poison the box inference. Every
  // live-party decision (scan, identity candidates, hot-detection, fast path)
  // therefore excludes this region. The flash image base is a fixed allocation,
  // so this runs at most once per session.
  const saveBufferRegionRef = useRef<{ start: number; end: number } | null>(null);
  const locateSaveBufferRegion = (heap: Uint8Array) => {
    const save = latestSaveBytesRef.current;
    if (!save || save.length < SLOT_SIZE) return;
    if (saveBufferRegionRef.current) return;
    const saveView = new DataView(save.buffer, save.byteOffset, save.byteLength);
    const heapView = new DataView(heap.buffer, heap.byteOffset, heap.byteLength);
    const slotOffsets = [0, SLOT_SIZE, 0x1000, 0x2000, 0x3000, 0x4000];
    // Fast prefilter: the save-section footer signature is a 32-bit constant
    // that appears nowhere in random RAM, so any heap hit is a real footer.
    let hit = -1;
    if (heap.byteOffset % 4 === 0 && heap.byteLength % 4 === 0) {
      const u32 = new Uint32Array(heap.buffer, heap.byteOffset, heap.byteLength >>> 2);
      for (let i = 0; i < u32.length; i++) {
        if (u32[i] === SIGNATURE) { hit = i * 4; break; }
      }
    } else {
      for (let h = 0; h + 4 <= heap.length; h += 4) {
        if ((heap[h] | (heap[h + 1] << 8) | (heap[h + 2] << 16) | (heap[h + 3] << 24)) === SIGNATURE) { hit = h; break; }
      }
    }
    if (hit < 0) return;
    // Reconstruct the image base from the footer at `hit`, verifying every
    // known footer of the save image lines up in the heap before trusting it.
    for (const o of slotOffsets) {
      for (let j = 0; j < NUM_SECTIONS; j++) {
        const f = o + j * SECTION_SIZE + FOOTER_OFFSET;
        if (f + 8 > save.length) continue;
        const start = hit - f;
        if (start < 0 || start + save.length > heap.length) continue;
        let ok = true;
        for (const o2 of slotOffsets) {
          for (let j2 = 0; j2 < NUM_SECTIONS; j2++) {
            const f2 = o2 + j2 * SECTION_SIZE + FOOTER_OFFSET;
            if (f2 + 8 > save.length) continue;
            const sid = save[f2] | (save[f2 + 1] << 8);
            const ssig = saveView.getUint32(f2 + 2, true);
            const hid = heap[start + f2] | (heap[start + f2 + 1] << 8);
            const hsig = heapView.getUint32(start + f2 + 2, true);
            if (hid !== sid || hsig !== ssig) { ok = false; break; }
          }
          if (!ok) break;
        }
        if (ok) {
          const region = { start, end: start + save.length };
          saveBufferRegionRef.current = region;
          return;
        }
      }
    }
  };
  const isInSaveBuffer = (off: number | null): boolean => {
    const r = saveBufferRegionRef.current;
    if (off === null || !r) return false;
    return off >= r.start && off < r.end;
  };

  // Tracks party ↔ box movements from live party reads. Withdrawals (a mon
  // arriving in the live party) leave the box; departures (a mon that was in
  // the party but no longer is) enter it at their most recent seen stats.
  const applyPartyInference = (party: SavePokemon[]) => {
    const box = inferredBoxRef.current;
    const departed = departedSinceSaveRef.current;
    const newPids = new Set<number>();
    for (const mon of party) {
      newPids.add(mon.personality);
      lastSeenPartyRef.current.set(mon.personality, mon);
      box.delete(mon.personality);
      departed.delete(mon.personality);
    }
    for (const pid of Array.from(lastPartyPidsRef.current)) {
      if (!newPids.has(pid) && !box.has(pid)) {
        const data = lastSeenPartyRef.current.get(pid);
        if (data) {
          box.set(pid, data);
          departed.set(pid, data);
        }
      }
    }
    lastPartyPidsRef.current = newPids;
  };

  // Rebuilds the box whenever a .sav is parsed. The .sav box snapshot is the
  // authoritative possession list at save time: mons it no longer contains are
  // erased — except departures that happened after it was written, which the
  // live party proves were still possessed. Mons the snapshot still had in the
  // party but that have since left it are boxed (they had to go somewhere).
  const reconcileBoxFromSave = (
    saveBox: SaveBoxPokemon[],
    saveParty: SavePokemon[],
    liveParty: SavePokemon[] | null
  ) => {
    const saveBoxPids = new Set(saveBox.map((m) => m.personality));
    const savePartyPids = new Set(saveParty.map((m) => m.personality));
    const livePids = liveParty ? new Set(liveParty.map((m) => m.personality)) : savePartyPids;

    // Anything the snapshot accounts for is no longer an unconfirmed departure.
    for (const pid of Array.from(departedSinceSaveRef.current.keys())) {
      if (saveBoxPids.has(pid) || savePartyPids.has(pid)) departedSinceSaveRef.current.delete(pid);
    }

    const rebuilt = new Map<number, SavePokemon>();
    for (const m of saveBox) rebuilt.set(m.personality, m as unknown as SavePokemon);
    for (const [pid, data] of Array.from(departedSinceSaveRef.current)) rebuilt.set(pid, data);
    // Mons the snapshot still listed in the party that have since left it.
    for (const m of saveParty) {
      if (!livePids.has(m.personality)) rebuilt.set(m.personality, m);
    }
    // Whatever is in the party right now is not in the box.
    for (const pid of Array.from(livePids)) rebuilt.delete(pid);

    inferredBoxRef.current = rebuilt;
    lastPartyPidsRef.current = livePids;
  };

  // Reads the live party out of the emulator's WASM heap and merges it into
  // mySaveData whenever it changes. Falls back to scanning the heap (spread
  // across poll ticks) until a valid party is located, e.g. right after the
  // game boots or after a hard reset.
  livePollRef.current = () => {
    if (forfeitedRef.current) return;
    // No .sav parsed yet → there is nothing to merge into, so skip the heap
    // scan entirely. Before the player makes the initial in-game save there is
    // also no party in RAM, so scanning would burn main-thread time and starve
    // the emulator for zero benefit (this was the stutter at new-game boot).
    if (!mySaveDataRef.current) return;
    const gm = window.EJS_emulator?.gameManager;
    const heap = gm?.Module?.HEAPU8;
    if (!heap || heap.length < RAM_PARTY_BYTES + 3) return;

    // Live current-map read. The Blitz decomp writes gLiveWarpStatus to a FIXED
    // GBA EWRAM address (the last 16 bytes of EWRAM, 0x0203F000) on every map
    // transition, so the player's location can be polled at a known address
    // instead of scanning the heap for a party-anchored save block. The EWRAM
    // region sits at a session-stable offset in the WASM heap; we locate it once
    // (chunked, budgeted per tick) and every later poll is a single 16-byte
    // read. The magic + advancing sequence only appear after the first in-game
    // warp, so before that lastPostedMapRef stays null and the .sav's map_name
    // is authoritative. This is independent of party detection, so it can never
    // drift to a stale party/save copy the way an anchor-based read could.
    let rawName: string | null = null;
    let inBattle = false;
    {
      const ewramBase = ewramBaseRef.current;
      if (ewramBase !== null) {
        const frame = readLiveMapFrame(heap, ewramBase);
        if (frame !== null) {
          // Byte +0x05 of gLiveWarpStatus mirrors gMain.inBattle every frame,
          // so this flips within one poll of entering/exiting any battle.
          inBattle = frame.inBattle;
          const nm = MAP_NAMES[frame.mapGroup]?.[frame.mapNum];
          if (typeof nm === 'string') rawName = nm;
        }
      } else if (ewramScanDoneRef.current) {
        // A finished pass with no buffer yet (pre-first-warp, or the buffer was
        // cleared). Retry on a long backoff instead of scanning every tick.
        if (Date.now() >= ewramScanRetryAtRef.current) {
          ewramScanDoneRef.current = false;
          ewramScanStartRef.current = 0;
        }
      } else {
        const start = ewramScanStartRef.current;
        const endLimit = Math.min(heap.length - LIVE_WARP_EWRAM_BASE_OFFSET, LIVE_SCAN_MAX_BYTES);
        const next = Math.min(start + LIVE_MAP_SCAN_CHUNK, endLimit);
        const base = findLiveMapEwramBase(
          heap,
          start,
          next,
          // Accept only a real LiveWarp buffer: valid map. The scan walks the
          // heap from low addresses and can otherwise latch a false positive
          // (random bytes that coincidentally carry the magic + a nonzero
          // sequence + a valid-looking map) before reaching the real struct.
          (g, n) => typeof MAP_NAMES[g]?.[n] === 'string'
        );
        if (base !== null) {
          ewramBaseRef.current = base;
          ewramScanDoneRef.current = true;
          ewramScanRetryAtRef.current = 0;
        } else if (next >= endLimit) {
          ewramScanDoneRef.current = true;
          ewramScanRetryAtRef.current = Date.now() + LIVE_MAP_SCAN_RETRY_MS;
        } else {
          ewramScanStartRef.current = next;
        }
      }
    }
    if (inBattle !== myInBattle) {
      setMyInBattle(inBattle);
    }
    if (rawName !== null) {
      const base = mySaveDataRef.current;
      if (base && base.map_name !== rawName) {
        mySaveDataRef.current = { ...base, map_name: rawName };
        setMySaveData(mySaveDataRef.current);
      }
      if (lastPostedMapRef.current !== rawName || lastPostedBattleRef.current !== inBattle) {
        lastPostedMapRef.current = rawName;
        lastPostedBattleRef.current = inBattle;
        if (draftId) {
          fetch(`/api/drafts/${draftId}/location`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ map_name: rawName, in_battle: inBattle }),
            credentials: 'include',
          }).catch(() => { });
        }
      }
    }

    // Applies a freshly read live party on top of the latest parsed save,
    // keeping trainer/money/badges and the inferred box intact.
    const applyLiveParty = (party: SavePokemon[]) => {
      const base = mySaveDataRef.current;
      if (!base) return; // wait for the first .sav parse to arrive
      // A read from the wrong region decodes slots "nicknamed" with the
      // trainer's OT name — drop them, and skip the merge entirely if the
      // whole read was garbage so the last good save stays on screen.
      const clean = filterLiveParty(party, base.trainer_name);
      if (!clean) return;
      applyPartyInference(clean);
      const merged: SaveData = { ...base, party: clean, box: Array.from(inferredBoxRef.current.values()) };
      mySaveDataRef.current = merged;
      setMySaveData(merged);
      postSaveToBackend(merged);
    };

    // Identity-signature scan: locate every copy of the party (the pinned one
    // may be a stale save-slot buffer while gPlayerParty, checksums too old to
    // be found by the checksum scan, sits elsewhere). Runs in small chunks.
    if (!livePartyProvenLiveRef.current && livePartySigScanRef.current.ids.length > 0) {
      const ss = livePartySigScanRef.current;
      const endLimit = Math.min(heap.length - RAM_PARTY_BYTES, LIVE_SCAN_MAX_BYTES);
      const deadline = performance.now() + 20;
      while (ss.next <= endLimit && performance.now() < deadline) {
        const copies = findRamPartyCopies(heap, ss.ids, ss.next, ss.next + LIVE_SIG_SCAN_CHUNK, saveBufferRegionRef.current);
        for (const c of copies) {
          if (!livePartyCandidatesRef.current.includes(c)) livePartyCandidatesRef.current.push(c);
        }
        ss.next += LIVE_SIG_SCAN_CHUNK;
      }
      if (ss.next > endLimit) {
        ss.ids = [];
        ss.next = 0;
        // The flash save-slot buffer is the rotating save image, never live
        // RAM — drop any copies that landed inside it so they can't be pinned.
        // Done in place (not by filtering reads) so the candidates array and
        // its per-copy hash array stay index-aligned.
        for (let i = livePartyCandidatesRef.current.length - 1; i >= 0; i--) {
          if (isInSaveBuffer(livePartyCandidatesRef.current[i])) {
            livePartyCandidatesRef.current.splice(i, 1);
            livePartyCandHashesRef.current.splice(i, 1);
          }
        }
        livePartyCandidatesRef.current.sort((a, b) => a - b);
        livePartyCandHashesRef.current = livePartyCandidatesRef.current.map(() => '');
        // A single copy leaves nothing to disambiguate — pin it directly.
        if (livePartyCandidatesRef.current.length === 1) {
          const c = livePartyCandidatesRef.current[0];
          if (c >= 4 && c + RAM_PARTY_BYTES <= heap.length && getRamPartyCount(heap, c, false) !== null) {
            livePartyOffsetRef.current = c;
            livePartyHashRef.current = hashRamParty(heap, c);
            livePartyMissesRef.current = 0;
            livePartySessionValidatedRef.current = true;
            livePartyProvenLiveRef.current = true;
            livePartySigScanRef.current = { ids: [], next: 0 };
            applyLiveParty(parseRamParty(heap, c, false));
            return;
          }
        }
      }
    }

    // Hot-detection: while the live region is unproven, watch every copy. The
    // first one whose bytes change is gPlayerParty (gameplay writes to it, the
    // buffers don't) — unless it merely converged to another copy (a manual
    // save copying the live party into the slot buffer), in which case the
    // other copy is the source of truth. Multiple simultaneous changes are left
    // for the fast path and resolve on the next interaction. Copies living in
    // the flash save-slot buffer are the ROTATING save image, not live RAM —
    // they must never be pinned or watched, or a mid-battle save rotation reads
    // garbage shapes as the party. Re-splice in place: the region can be
    // located after the candidates list was finalized, and this keeps the
    // per-copy hash array aligned.
    for (let i = livePartyCandidatesRef.current.length - 1; i >= 0; i--) {
      if (isInSaveBuffer(livePartyCandidatesRef.current[i])) {
        livePartyCandidatesRef.current.splice(i, 1);
        livePartyCandHashesRef.current.splice(i, 1);
      }
    }
    const cands = livePartyCandidatesRef.current;
    if (!livePartyProvenLiveRef.current && cands.length >= 2) {
      const prev = livePartyCandHashesRef.current;
      const cur: string[] = [];
      const hot: number[] = [];
      for (let i = 0; i < cands.length; i++) {
        const c = cands[i];
        if (c >= 4 && c + RAM_PARTY_BYTES <= heap.length && getRamPartyCount(heap, c, false) !== null) {
          cur.push(hashRamParty(heap, c));
          if (prev[i] && prev[i] !== cur[i]) hot.push(i);
        } else {
          cur.push(prev[i] ?? '');
        }
      }
      livePartyCandHashesRef.current = cur;
      if (hot.length === 1) {
        const i = hot[0];
        const converged = cands.findIndex((_, j) => j !== i && cur[j] === cur[i]);
        const target = cands[converged >= 0 ? converged : i];
        livePartyOffsetRef.current = target;
        livePartyHashRef.current = hashRamParty(heap, target);
        livePartyMissesRef.current = 0;
        livePartySessionValidatedRef.current = true;
        livePartyProvenLiveRef.current = true;
        livePartySigScanRef.current = { ids: [], next: 0 };
        applyLiveParty(parseRamParty(heap, target, false));
        return;
      }
    }

    // Fast path: we already know where the party lives in the heap. EWRAM
    // addresses are fixed for the whole session, so a failed validation is
    // almost always transient (a mid-battle slot update, the party being
    // absent in the bedroom, or a temporarily wrong/stale offset) and the
    // party reappears at (or within a hair of) the same offset. When the known
    // offset fails we run a cheap neighborhood rescan instead of throwing the
    // offset away — that used to trigger a full-heap rescan on every battle
    // (stutter + dead updates).
    const off = livePartyOffsetRef.current;
    if (off !== null) {
      // Until the offset has been proven real this session (a checksum-valid
      // find), validate strictly — a random wrong offset can pass the loose
      // shape check by luck (~6%), and we must not pin garbage. Once proven,
      // relax to shape-only: Blitz's race/notebook/claim systems write party
      // mons directly and don't always keep each mon's checksum current in
      // RAM, so requiring it there would silently drop a good party right
      // after it was found.
      const strict = !livePartySessionValidatedRef.current;
      if (
        off >= 4 &&
        off + RAM_PARTY_BYTES <= heap.length &&
        !isInSaveBuffer(off) &&
        getRamPartyCount(heap, off, strict) !== null
      ) {
        livePartyMissesRef.current = 0;
        if (strict) livePartySessionValidatedRef.current = true;
        const hash = hashRamParty(heap, off);
        if (hash !== livePartyHashRef.current) {
          livePartyHashRef.current = hash;
          applyLiveParty(parseRamParty(heap, off, strict));
        }
        return;
      }
      // The known offset is not valid right now. Search a tight window around
      // it in a single tick (a few hundred KB at 4-byte stride is ~5ms) — the
      // party never wanders far, so this recovers from relocated data, stale
      // offsets, and battle churn without a full heap scan.
      const local = findRamPartyOffset(
        heap,
        Math.max(4, off - LIVE_PARTY_LOCAL_SCAN_RADIUS),
        off + LIVE_PARTY_LOCAL_SCAN_RADIUS,
        saveBufferRegionRef.current
      );
      if (local !== null) {
        livePartyMissesRef.current = 0;
        livePartySessionValidatedRef.current = true;
        livePartyOffsetRef.current = local;
        livePartyHashRef.current = hashRamParty(heap, local);
        if (!livePartyProvenLiveRef.current) {
          const localParty = parseRamParty(heap, local, false);
          if ((localParty.length ?? 0) >= 2) {
            livePartySigScanRef.current = { ids: localParty.map((m) => m.personality), next: 0 };
          }
        }
        applyLiveParty(parseRamParty(heap, local, false));
        return;
      }
      livePartyMissesRef.current += 1;
      // A persisted offset from a previous session that never validates THIS
      // session (different ROM build → different EWRAM layout) must give way to
      // a fresh scan. An offset validated this session is kept forever.
      if (!livePartySessionValidatedRef.current && livePartyMissesRef.current >= LIVE_PARTY_MISS_LIMIT) {
        livePartyOffsetRef.current = null;
        livePartyHashRef.current = '';
        livePartyMissesRef.current = 0;
        livePartySessionValidatedRef.current = false;
        livePartyCandidatesRef.current = [];
        livePartyCandHashesRef.current = [];
        livePartyProvenLiveRef.current = false;
        livePartySigScanRef.current = { ids: [], next: 0 };
        const st2 = liveScanStateRef.current;
        st2.best = null;
        st2.next = 0;
        st2.lastAttempt = 0;
      }
      return;
    }

    // Locate the party in the heap, in bounded chunks so the scan can't freeze
    // the tab. Only the first LIVE_SCAN_MAX_BYTES are searched (EWRAM sits in
    // the low megabytes) and a fresh pass is only started every
    // LIVE_SCAN_MIN_INTERVAL_MS.
    const st = liveScanStateRef.current;
    const now = Date.now();
    if (st.running) return;
    if (st.next === 0 && now - st.lastAttempt < LIVE_SCAN_MIN_INTERVAL_MS) return;
    st.running = true;
    const deadline = performance.now() + LIVE_SCAN_BUDGET_MS;
    const endLimit = Math.min(heap.length - RAM_PARTY_BYTES, LIVE_SCAN_MAX_BYTES);
    // The first full-heap scan is the moment the tab visibly stutters (each
    // tick spends up to the whole budget chewing 4-byte strides), so surface a
    // load bar bottom-right until the party is located instead of letting that
    // spike look like a freeze. Only the initial scan reaches this block — once
    // an offset is found the poll uses the fast path and never rescans.
    setScanProgress(st.next === 0 ? 0 : Math.min(1, st.next / endLimit));
    while (st.next <= endLimit && performance.now() < deadline) {
      // Skip the flash save-slot buffer wholesale — it is a rotating copy of
      // the save image, not live RAM, and its shapes can outscore the real
      // party's on a stale read.
      if (isInSaveBuffer(st.next)) { st.next += 4; continue; }
      const r = ramPartyScore(heap, st.next);
      if (r && (!st.best || r.score > st.best.score || (r.score === st.best.score && st.next < st.best.off))) {
        // Ties prefer the lower address so the player's party (declared before
        // gEnemyParty in EWRAM) wins over the enemy's during a battle.
        st.best = { off: st.next, score: r.score };
      }
      st.next += 4;
    }
    if (st.next > endLimit) {
      const found = st.best?.off ?? null;
      st.best = null;
      st.next = 0;
      st.lastAttempt = now;
      if (found !== null && getRamPartyCount(heap, found, false) !== null) {
        const party = parseRamParty(heap, found, false);
        livePartyOffsetRef.current = found;
        livePartyHashRef.current = hashRamParty(heap, found);
        livePartyMissesRef.current = 0;
        livePartySessionValidatedRef.current = true;
        // Remember the offset for this ROM so reloads can probe it directly
        // and skip the scan. Only stable multi-slot parties are persisted; a
        // lone count-1 slot could be a checksum false positive.
        if (livePartyRomKeyRef.current && (party.length ?? 0) >= 2) {
          try {
            const map = JSON.parse(localStorage.getItem(LIVE_PARTY_OFFSETS_KEY) ?? '{}');
            map[livePartyRomKeyRef.current] = found;
            localStorage.setItem(LIVE_PARTY_OFFSETS_KEY, JSON.stringify(map));
          } catch { /* ignore storage errors */ }
        }
        st.running = false;
        setScanProgress(null);
        // Locate all copies of this party so the live one (which may sit
        // outside the checksum-valid region) can be identified by change.
        if (!livePartyProvenLiveRef.current && (party.length ?? 0) >= 2) {
          livePartySigScanRef.current = { ids: party.map((m) => m.personality), next: 0 };
        }
        applyLiveParty(party);
        return;
      }
      // scanned the search region without a trustworthy party — retry later
      // No party yet (brand-new file / not saved) — hide the bar until the
      // next backoff-gated pass.
      setScanProgress(null);
    }
    st.running = false;
  };
  onRawSaveBytesRef.current = (bytes: Uint8Array) => {
    // Ignore saves that arrive after a forfeit (e.g. the one the emulator
    // writes while exiting) so they can't overwrite the recorded loss.
    if (forfeitedRef.current) return;
    latestSaveBytesRef.current = bytes;
    setHasSaveBytes(true);
    let parsed: SaveData;
    try {
      parsed = parseSaveFile(bytes, pokemonMetadata, pokemonById);
    } catch (e) {
      console.error('[onRawSaveBytesRef] Parse error:', e);
      return;
    }
    // The flash save lags live RAM: the game only writes the flash on manual
    // saves (there's no autosave in Blitz), while the party in EWRAM updates
    // the instant the player catches/trades/swaps. If we have a valid live
    // party region, keep it instead of letting a stale flash party from the
    // 10-second auto-sync revert the display. The box likewise only persists
    // when the player opens the PC, so we reconcile the .sav box against live
    // party movements instead of trusting it blindly.
    const liveOff = livePartyOffsetRef.current;
    const liveHeap = window.EJS_emulator?.gameManager?.Module?.HEAPU8;
    // Locate the flash save-slot buffer FIRST so the read below (and any
    // subsequent scan) knows to exclude the rotating save image from live-RAM
    // decisions.
    if (liveHeap) locateSaveBufferRegion(liveHeap);
    let liveParty: SavePokemon[] | null = null;
    // Shape-tolerant read: the live gPlayerParty's stored checksums go stale
    // under Blitz's direct writes, so requiring them here would drop the live
    // party and let the stale flash party revert the display every 10s.
    if (liveOff !== null && liveHeap && liveOff >= 4 && liveOff + RAM_PARTY_BYTES <= liveHeap.length && !isInSaveBuffer(liveOff) && getRamPartyCount(liveHeap, liveOff, false) !== null) {
      liveParty = parseRamParty(liveHeap, liveOff, false);
    }
    // A live read from the wrong region decodes slots "nicknamed" with the
    // trainer's OT name. Drop those slots; if the whole read was garbage,
    // keep the .sav party (which is a properly aligned save image).
    const livePartyClean = liveParty ? filterLiveParty(liveParty, parsed.trainer_name) : null;
    // Tag whether the pinned offset is the rotating flash save-slot buffer
    // (the .sav image) vs. real EWRAM. The .sav carries the party's plaintext
    // personalities at save time — use them to locate every copy in RAM (the
    // live gPlayerParty included) when the live region is not yet proven.
    // Self-heals once the player saves.
    const savParty = parsed.party ?? [];
    if (!livePartyProvenLiveRef.current && (savParty.length ?? 0) >= 2 && !livePartySigScanRef.current.ids.length) {
      livePartySigScanRef.current = { ids: savParty.map((m) => m.personality), next: 0 };
    }
    reconcileBoxFromSave(parsed.box ?? [], parsed.party ?? [], livePartyClean);
    const syncedSave: SaveData = {
      ...parsed,
      money: parsed.money,
      // Prefer the live-settled map while one exists: the flash .sav can lag the
      // live location by up to 10s, so it drives `map_name`. The buffer read is
      // magic-validated, so a miss simply yields no update and the .sav's map
      // shows through and recovers the display.
      ...(lastPostedMapRef.current ? { map_name: lastPostedMapRef.current } : {}),
      ...(livePartyClean ? { party: livePartyClean } : {}),
      box: Array.from(inferredBoxRef.current.values()),
    };
    setMySaveData(syncedSave);
    const now = new Date();
    setSaveLastSynced(now);

    // Check for wipe (InsideOfTruck) and send notification
    const isWiped = parsed.map_name === 'InsideOfTruck';
    const wasWiped = mySaveData?.map_name === 'InsideOfTruck';
    if (isWiped && !wasWiped && parsed.most_recent_loss_name && currentUsername) {
      // Send wipe notification via WebSocket
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: 'WipeNotification',
          data: {
            username: currentUsername,
            trainer: parsed.most_recent_loss_name,
          }
        }));
      }
    }

    // Check for win (LilycoveCity_LilycoveMuseum_1F) and send notification
    const isWinner = parsed.map_name === 'LilycoveCity_LilycoveMuseum_1F';
    const wasWinner = mySaveData?.map_name === 'LilycoveCity_LilycoveMuseum_1F';
    if (isWinner && !wasWinner && parsed.most_recent_loss_name && currentUsername) {
      // Send win notification via WebSocket
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: 'WinNotification',
          data: {
            username: currentUsername,
            trainer: parsed.most_recent_loss_name,
          }
        }));
      }
    }

    // Build the Hall of Fame team from the party on the first save that
    // carries a "Beat Steven" (804) / "Beat Wally" (656) trainer-card win,
    // i.e. the save right after the player actually beats the game. The win
    // save can arrive before the warp to the museum or after the player has
    // left it, and the Lilycove Museum is reachable before beating the game,
    // so the map is not a reliable signal. A party is at most 6 Pokemon, so
    // cap it defensively. The backend only keeps the first one.
    const beatChampion = (parsed.trainer_card_wins ?? []).some(w =>
      !w.is_loss && (w.trainer_id === 656 || w.trainer_id === 804)
    );
    const hallOfFameTeam = beatChampion
      ? (syncedSave.party ?? []).slice(0, 6).map((mon: any) => {
        const speciesId = mon.species_id ?? mon.speciesId;
        const speciesData = resolveMetadata(speciesId, mon.nickname);
        const realName = (speciesId === 412 && mon.nickname?.toLowerCase() === 'egg') ? "Egg" : (speciesData?.name || `ID ${speciesId}`);
        return { name: realName, icon: getIconName(realName, speciesId) };
      })
      : undefined;

    if (draftId) {
      postSaveToBackend(syncedSave, hallOfFameTeam ? { hall_of_fame_team: hallOfFameTeam } : undefined);
    }
  };

  // ── ROM picker ──────────────────────────────────────────────────────────
  const loadRom = useCallback(async (file: File) => {
    const ext = getExtension(file.name);
    if (!ACCEPTED_EXTENSIONS.includes(ext)) {
      setError('Unsupported file type. Please select a .gba ROM.');
      return;
    }
    setError(null);
    setIsPatching(true);

    try {
      let finalBlob: Blob = file;

      // Automatically apply Blitz patch if it's a GBA file (Emerald)
      if (ext === 'gba') {
        const [patchRes, romBuffer] = await Promise.all([
          fetch(BLITZ_PATCH_URL),
          file.arrayBuffer()
        ]);

        if (!patchRes.ok) throw new Error('Failed to fetch Blitz patch');

        const patchBuffer = await patchRes.arrayBuffer();
        const romBytes = new Uint8Array(romBuffer);
        const patchBytes = new Uint8Array(patchBuffer);

        // Verify the ROM is the exact clean Emerald the patch expects before
        // applying anything, so a wrong or already-patched ROM can never get
        // corrupted and played.
        validateEmeraldRom(romBytes, patchBytes);

        const patchedData = applyBpsPatch(romBytes, patchBytes);
        finalBlob = new Blob([patchedData as any], { type: 'application/octet-stream' });
      }

      // Revoke any previous object URL to avoid memory leaks
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
      }

      // A new (possibly different) ROM may have a different EWRAM layout, so
      // drop any live-party state from the previous ROM. Remember this ROM's
      // identity (name + size + head hash) so a previously found party offset
      // can be probed directly on the next reload instead of re-scanning.
      livePartyOffsetRef.current = null;
      livePartyHashRef.current = '';
      livePartyMissesRef.current = 0;
      livePartySessionValidatedRef.current = false;
      livePartyCandidatesRef.current = [];
      livePartyCandHashesRef.current = [];
      livePartyProvenLiveRef.current = false;
      livePartySigScanRef.current = { ids: [], next: 0 };
      try {
        const head = new Uint8Array(await finalBlob.slice(0, 262144).arrayBuffer());
        let h = 0x811c9dc5;
        for (let i = 0; i < head.length; i++) {
          h ^= head[i];
          h = Math.imul(h, 0x01000193);
        }
        livePartyRomKeyRef.current = `${file.name}:${finalBlob.size}:${(h >>> 0).toString(16)}`;
      } catch {
        livePartyRomKeyRef.current = `${file.name}:${finalBlob.size}`;
      }

      const url = URL.createObjectURL(finalBlob);
      objectUrlRef.current = url;
      setRomName(file.name);
      setRomUrl(url);
    } catch (err) {
      console.error('Patching error:', err);
      setError(err instanceof Error && err.message
        ? err.message
        : 'Failed to apply Blitz patch. Please ensure you are using a clean Emerald ROM.');
    } finally {
      setIsPatching(false);
    }
  }, []);

  // Drag & drop / file input handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };
  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const f = e.dataTransfer?.files?.[0];
    if (f) loadRom(f);
  };
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) loadRom(f);
    // reset input so same file can be selected again
    if (e.currentTarget) e.currentTarget.value = '';
  };

  // ── EmulatorJS bootstrap ────────────────────────────────────────────────────
  // Bootstrap EmulatorJS once we have a ROM URL
  useEffect(() => {
    if (!romUrl) return;

    const core = getExtension(romName ?? '') === 'gba' ? 'gba' : 'gambatte';
    const gameId = 1; // EmulatorJS uses this internally
    const gameName = draftId || 'game';

    // EmulatorJS generates localStorage keys dynamically with UUIDs
    // We need to find the key that matches our core and gameId pattern
    const getLocalStorageKey = () => {
      const allKeys = Object.keys(localStorage).filter(k => k.startsWith('ejs-') && k.endsWith('-settings'));
      // Look for keys that match our core and gameId pattern (ejs-{gameId}-{core}-*-settings)
      const matchingKeys = allKeys.filter(k => k.startsWith(`ejs-${gameId}-${core}-`));
      if (matchingKeys.length > 0) {
        // Return the most recently created key (the one with the UUID pattern)
        // or the standard key if it exists
        const standardKey = `ejs-${gameId}-${core}-${gameName}-settings`;
        if (matchingKeys.includes(standardKey)) return standardKey;
        // Otherwise return the first matching key (EmulatorJS will use the most recent)
        return matchingKeys[0];
      }
      // If no matching key exists, use the standard pattern
      return `ejs-${gameId}-${core}-${gameName}-settings`;
    };

    let localStorageKey = getLocalStorageKey();

    // Load control bindings from backend
    const loadControlBindings = async () => {
      try {
        const bindings = await fetchControlBindings();
        if (bindings && typeof bindings === 'object') {
          lastKnownBindingsRef.current = JSON.stringify(bindings);
          return bindings;
        } else {
          return null;
        }
      } catch (err) {
        console.error('[ControlBindings] Failed to load control bindings:', err);
        return null;
      }
    };

    // Load bindings and then initialize emulator
    loadControlBindings().then((bindings) => {

      // Set control settings directly in EmulatorJS configuration
      // The correct property is EJS_defaultControls (mapped to config.defaultControllers)
      if (bindings) {
        (window as any).EJS_defaultControls = bindings;
      }

      // Poll localStorage for control binding changes and save to backend
      // The storage event only fires for changes from other tabs/windows, so we need polling
      // to detect changes made by EmulatorJS in the same tab
      controlBindingsIntervalRef.current = setInterval(() => {
        // Check ALL matching localStorage keys for changes
        const allKeys = Object.keys(localStorage).filter(k => k.startsWith('ejs-') && k.endsWith('-settings'));
        const matchingKeys = allKeys.filter(k => k.startsWith(`ejs-${gameId}-${core}-`));

        for (const key of matchingKeys) {
          const settingsStr = localStorage.getItem(key);
          if (settingsStr) {
            try {
              const settings = JSON.parse(settingsStr);
              const currentBindings = settings.controlSettings;
              const bindingsStr = currentBindings ? JSON.stringify(currentBindings) : null;
              if (bindingsStr && bindingsStr !== lastKnownBindingsRef.current) {
                saveControlBindings(currentBindings).then(() => {
                }).catch(err => {
                  console.error('[ControlBindings] Failed to save control bindings:', err);
                });
                lastKnownBindingsRef.current = bindingsStr;
                // Update all matching keys with the new bindings
                matchingKeys.forEach(k => {
                  const updatedSettings = { ...settings, controlSettings: currentBindings };
                  localStorage.setItem(k, JSON.stringify(updatedSettings));
                });
                break; // Only save once per polling interval
              }
            } catch (err) {
              console.error('[ControlBindings] Failed to parse settings from', key, ':', err);
            }
          }
        }
      }, 20000); // Check every 20 seconds

      // Remove any leftover script from a previous load
      if (scriptRef.current) {
        scriptRef.current.remove();
        scriptRef.current = null;
      }

      // Intercept keyboard shortcuts (1,2,3) and prevent arrow keys from scrolling the page.
      // When users map game controls to arrow keys, the browser scrolls the page by default.
      blockShortcutsRef.current = (e: KeyboardEvent) => {
        // Block all keyboard input while auto-withdraw is running so that
        // stray key presses don't interfere with the automated sequence.
        if (isWithdrawingRef.current) {
          e.stopImmediatePropagation();
          e.preventDefault();
          return;
        }
        if (['1', '2', '3', 'Fn', 'Function'].includes(e.key)) {
          e.stopImmediatePropagation();
        }
        // Prevent arrow key scrolling when the emulator has focus.
        // The emulator's own keydown handler still receives the event
        // via normal propagation — we just stop the browser's default scroll.
        if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
          e.preventDefault();
        }
        // Toggle overlay on Tab key
        if (e.key === 'Tab') {
          e.preventDefault();
          // setShowOverlay(prev => !prev);
        }
      };
      document.addEventListener('keydown', blockShortcutsRef.current, true);

      // Add beforeunload confirmation to prevent accidental tab closure
      handleBeforeUnloadRef.current = (e: BeforeUnloadEvent) => {
        e.preventDefault();
        e.returnValue = ''; // Chrome requires returnValue to be set
      };
      window.addEventListener('beforeunload', handleBeforeUnloadRef.current);

      // Disable the right-click context menu entirely for the emulator
      blockContextMenuRef.current = (e: MouseEvent) => {
        const target = e.target as HTMLElement;
        if (target.closest('#game') || target.closest('.ejs_context_menu')) {
          // Prevent the browser's native context menu but allow the emulator's
          // custom contextmenu event handlers to receive the event.
          e.preventDefault();
        }
      };
      document.addEventListener('contextmenu', blockContextMenuRef.current, true);

      window.EJS_player = '#game';
      window.EJS_core = core; // Use 'gba' not 'mgba' to match EmulatorJS localStorage keys
      window.EJS_gameUrl = romUrl;
      window.EJS_pathtodata = '/emulatorjs/';
      window.EJS_startOnLoaded = true;
      window.EJS_stopOnUnfocused = false;
      window.EJS_pauseOnBlur = false;
      window.EJS_language = 'en-US';
      window.EJS_gameName = gameName;
      // Emulator loader expects `window.EJS_Buttons` (capital B).
      // Keep `EJS_buttons` for backward compatibility.
      window.EJS_Buttons = window.EJS_buttons = {
        playPause: false,
        restart: false,
        saveState: false,
        loadState: false,
        quickSave: false,
        quickLoad: false,
        saveSavFiles: false,
        loadSavFiles: false,
        screenshot: true, // re-enable screenshot in the emulator context menu
        gamepad: true,      // Keep custom controls visible
        settings: false,     // Hide the gear icon
        contextMenu: false,  // Hide the hamburger menu
        cheat: false,
        cacheManager: false,
        netplay: false,
        volume: false,
        fullscreen: false,
        exitEmulation: false,
        diskButton: false,
      };

      window.EJS_hideSettings = [
        'fastForward',
        'slowMotion',
        'rewindEnabled',
        'save-state-slot',
        'save-state-location',
        'save-save-interval',
      ];

      // Set callbacks BEFORE loading the emulator script
      // Hook saveSaveFiles once the emulator is ready — this is the true "the
      // saved game changed" signal: it fires when the player saves in-game or
      // uses the toolbar save button, carrying the actual .sav bytes. We dedupe
      // bursts of identical bytes (the mGBA "double-tap" / repeated flushes
      // emit the same data twice) so we parse + broadcast only real changes.
      window.EJS_ready = () => {

        let lastSavHash: string | null = null;
        window.EJS_emulator?.on('saveSaveFiles', (rawData) => {
          const bytes = rawData as Uint8Array | null | undefined;
          if (!bytes || !(bytes instanceof Uint8Array) || bytes.length === 0) return;
          // Cheap content hash: skip identical re-emits of the same save.
          let h = 0x811c9dc5;
          for (let i = 0; i < bytes.length; i++) {
            h ^= bytes[i];
            h = Math.imul(h, 0x01000193);
          }
          const hash = (h >>> 0).toString(16);
          if (hash === lastSavHash) return;
          lastSavHash = hash;
          onRawSaveBytesRef.current?.(bytes);

          // Sync Emscripten FS to IndexedDB so the browser-stored save survives
          // a reload even when no manual save is made.
          try {
            window.EJS_emulator?.gameManager?.FS?.syncfs(false, (err: any) => {
              if (err) console.error('Error syncing IDBFS:', err);
            });
          } catch (e) {
            console.error('Failed to run syncfs:', e);
          }
        });

        // Whenever a state is loaded via quickLoad (keyboard shortcut '2'),
        // notify other players in the race.
        const gameMgr = window.EJS_emulator?.gameManager;
        if (gameMgr && typeof gameMgr.quickLoad === 'function') {
          const origQuickLoad = gameMgr.quickLoad.bind(gameMgr);
          gameMgr.quickLoad = (slot?: number) => {
            origQuickLoad(slot);
            postStateLoadRef.current?.();
          };
        }
      };

      // Start the 30-second auto-sync once the game is actually running.
      // Calling saveSaveFiles() before the game starts can throw, so we wait
      // for the "start" event before scheduling the interval.
      // We use a "double-tap" save to fix mgba core buffer lag.
      window.EJS_onGameStart = () => {

        // Apply saved bindings when the game starts
        if (lastKnownBindingsRef.current) {
          const bindings = JSON.parse(lastKnownBindingsRef.current);

          // Try multiple approaches to set controls
          setTimeout(() => {
            const gameMgr = window.EJS_emulator?.gameManager;
            if (gameMgr) {

              // Try to find and update the virtual gamepad controls
              if ((gameMgr as any).virtualGamepad) {
                (gameMgr as any).virtualGamepad.controls = bindings;
              }

              // Try to update the controls object directly
              if ((gameMgr as any).controls) {
                Object.assign((gameMgr as any).controls, bindings);
              }

              // Try to access the input system
              if ((gameMgr as any).input) {
                if ((gameMgr as any).input.controls) {
                  (gameMgr as any).input.controls = bindings;
                }
              }

              // Try to call any available control update method
              const possibleMethods = ['setControls', 'updateControls', 'loadControls', 'applyControls'];
              for (const method of possibleMethods) {
                if (typeof (gameMgr as any)[method] === 'function') {
                  (gameMgr as any)[method](bindings);
                }
              }
            }
          }, 1000);
        }

        // Filesystem watcher: polls the Emscripten FS for the flash-backed .sav/.srm
        // every 3s and parses ONLY when the bytes actually change.
        //
        // The save file path is provided by the libretro core via
        // gameManager.getSaveFilePath()
        let savPath: string | null = null;
        let savLastHash: string | null = null;
        let savLastBytes: Uint8Array | null = null;
        const hashBytes = (bytes: Uint8Array): string => {
          let h = 0x811c9dc5;
          for (let i = 0; i < bytes.length; i++) {
            h ^= bytes[i];
            h = Math.imul(h, 0x01000193);
          }
          return (h >>> 0).toString(16);
        };
        const hashSample = (bytes: Uint8Array): string => {
          // Hash only a small window (head + tail) so the common no-change tick
          // skips the full 128KB hash. FNV-1a over the sample bytes.
          const head = 1024;
          const tail = 1024;
          let h = 0x811c9dc5;
          const len = bytes.length;
          const end = Math.max(0, len - tail);
          const step = Math.max(1, Math.floor(end / 32) || 1);
          for (let i = 0; i < end; i += step) {
            h ^= bytes[i];
            h = Math.imul(h, 0x01000193);
          }
          for (let i = 0; i < head && i < len; i++) {
            h ^= bytes[i];
            h = Math.imul(h, 0x01000193);
          }
          if (tail > 0) {
            for (let i = end; i < len; i++) {
              h ^= bytes[i];
              h = Math.imul(h, 0x01000193);
            }
          }
          return (h >>> 0).toString(16);
        };
        const parseSavFile = () => {
          const FS = window.EJS_emulator?.gameManager?.FS ?? (window as any).Module?.FS;
          if (!FS || !savPath) return;
          try {
            // Re-read the file on every tick (cheap-ish) so we never go stale,
            // but only do the full hash + parse when the sampled region moved.
            const bytes = FS.readFile(savPath, { encoding: 'binary' });
            if (!bytes || bytes.length === 0) return;
            const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
            // A non-empty save file exists — mark it so the SRAM flush can back
            // off from its pre-first-save cadence.
            if (!savWatcherRef.current.haveSeenSave) {
              savWatcherRef.current.haveSeenSave = true;
            }
            // If we already have a copy and its head/tail window is identical,
            // the saved game almost certainly didn't change — skip the full
            // hash entirely (mtime is unreliable for mGBA flash writes, so we
            // can't stat-and-bail; the sample is our cheap content check).
            if (savLastBytes && hashSample(arr) === hashSample(savLastBytes)) return;
            const h = hashBytes(arr);
            // Content-hash only: mtime is unreliable for mGBA flash writes.
            if (h === savLastHash) return;
            savLastHash = h;
            savLastBytes = arr;
            onRawSaveBytesRef.current?.(arr);
          } catch { }
        };
        const startWatcher = () => {
          const FS = window.EJS_emulator?.gameManager?.FS ?? (window as any).Module?.FS;
          if (!FS) return false;
          // First, ask the core for the exact save file path
          try {
            const corePath = window.EJS_emulator?.gameManager?.getSaveFilePath?.();
            if (corePath) {
              try {
                const stat = FS.stat(corePath);
                if (stat && stat.size > 0) { savPath = corePath; return true; }
              } catch { }
              // Try to list parent directory to understand structure
              const parts = corePath.split('/');
              parts.pop();
              const parentDir = parts.join('/') || '/';
              try {
                const entries = FS.readdir(parentDir);
              } catch { }
            }
          } catch { }
          // Fallback: try to infer from gameName (draftId)
          const gameName = draftId || 'game';
          const fallbackPaths = [
            `/data/saves/${gameName}.srm`,
            `/data/saves/${gameName}.sav`,
            `/data/saves/pokemon_emerald.srm`,
            `/data/saves/pokemon_emerald.sav`,
            `/data/saves/mGBA/${gameName}.srm`,
            `/data/saves/mGBA/${gameName}.sav`,
          ];
          for (const p of fallbackPaths) {
            try {
              const stat = FS.stat(p);
              if (stat && stat.size > 0) { savPath = p; return true; }
            } catch { }
          }
          // List /data/saves to see what's actually there
          try {
            const entries = FS.readdir('/data/saves');
          } catch { }
          return false;
        };
        if (startWatcher()) {
          savWatcherRef.current.intervalId = setInterval(parseSavFile, 3000);
          parseSavFile();
        } else {
          // Retry finding the path every 10s until it appears (e.g., first save creates it)
          const retryInterval = setInterval(() => {
            if (startWatcher()) {
              clearInterval(retryInterval);
              savWatcherRef.current.retryIntervalId = null;
              savWatcherRef.current.intervalId = setInterval(parseSavFile, 3000);
              parseSavFile();
            }
          }, 10000);
          // Clean up retry on unmount
          savWatcherRef.current.retryIntervalId = retryInterval;
        }

        // If a party offset was found for this exact ROM in a previous session,
        // probe it directly instead of scanning the heap — the EWRAM layout is
        // deterministic per ROM, so the offset carries over across reloads. It
        // is only trusted once it validates this session (see poll fast path).
        if (livePartyRomKeyRef.current) {
          try {
            const map = JSON.parse(localStorage.getItem(LIVE_PARTY_OFFSETS_KEY) ?? '{}');
            const savedOff = map[livePartyRomKeyRef.current];
            if (typeof savedOff === 'number' && savedOff > 0) {
              livePartyOffsetRef.current = savedOff;
              livePartyHashRef.current = '';
              livePartyMissesRef.current = 0;
              livePartySessionValidatedRef.current = false;
              livePartyCandidatesRef.current = [];
              livePartyCandHashesRef.current = [];
              livePartyProvenLiveRef.current = false;
              livePartySigScanRef.current = { ids: [], next: 0 };
            }
          } catch { /* ignore storage errors */ }
        }

        // Live party reads: merge changes straight from the WASM heap so the
        // site updates without waiting for the 10-second .sav flush.
        if (liveSyncIntervalRef.current !== null) {
          clearInterval(liveSyncIntervalRef.current);
        }
        liveSyncIntervalRef.current = setInterval(() => {
          livePollRef.current?.();
        }, LIVE_POLL_MS);

        // Periodically flush SRAM to filesystem so in-game saves become visible.
        // In-game save writes to SRAM but doesn't auto-flush; this triggers the
        // saveSaveFiles event and creates the .srm file for the watcher. saveSaveFiles
        // is a mutator on the emulator thread (it serializes the SRAM buffer), so it
        // backs off once a save file exists: flush every 5s BEFORE the first save so
        // the .srm gets created sooner, then settle to every 10s afterwards (the 3s
        // watcher already surfaces in-game saves the moment the core writes them).
        let sramFlushTimer: ReturnType<typeof setInterval> | null = null;
        const sramFlush = () => {
          try { window.EJS_emulator?.gameManager?.saveSaveFiles?.(); } catch { }
          const hasSave = !!savWatcherRef.current.haveSeenSave;
          clearInterval(sramFlushTimer as ReturnType<typeof setInterval>);
          sramFlushTimer = setInterval(sramFlush, hasSave ? 10000 : 5000);
          (window as any).__sramFlushInterval = sramFlushTimer;
        };
        sramFlushTimer = setInterval(sramFlush, 5000);
        // Store for cleanup
        (window as any).__sramFlushInterval = sramFlushTimer;
        livePollRef.current?.();

        // Autosave state every 60 seconds
        stateIntervalRef.current = setInterval(() => {
          try {
            const stateData = window.EJS_emulator?.gameManager?.getState();
            if (stateData && stateData.length > 0) {
              const metaKey = `autosaves_meta_${draftId || 'standalone'}`;
              const storedMeta = localStorage.getItem(metaKey);
              let history: any[] = [];
              if (storedMeta) {
                try {
                  history = JSON.parse(storedMeta);
                } catch { }
              }

              const newId = Date.now().toString();
              const key = `state_${draftId || 'standalone'}_${newId}`;

              void setStoredSave(key, stateData);
              const now = new Date();
              const newEntry = { id: newId, ts: now.getTime() };

              history.push(newEntry);
              // Keep only the most recent 60 autosaves
              while (history.length > 60) {
                const oldest = history.shift();
                if (oldest) {
                  void deleteStoredSave(`state_${draftId || 'standalone'}_${oldest.id}`);
                }
              }

              localStorage.setItem(metaKey, JSON.stringify(history));
              // Normalize before updating state
              const norm = history.map((e: any) => {
                const id = String(e.id ?? '');
                let ts = typeof e.ts === 'number' ? e.ts : NaN;
                if (!Number.isFinite(ts)) {
                  const n = Number(id);
                  if (Number.isFinite(n) && n > 1_000_000_000_000) ts = n;
                  else ts = Date.now();
                }
                return { id, ts };
              });
              setAutosaveHistory(norm);
            }
          } catch (e) {
            console.warn('Failed to capture autosave state:', e);
          }
        }, 60_000);
      };

      // Wipe the core cache before each load so stale decompressed entries
      // from earlier failed attempts never cause "EJS_Runtime is not defined".
      const deleteDb = (name: string) =>
        new Promise<void>((res) => {
          const req = indexedDB.deleteDatabase(name);
          req.onsuccess = () => res();
          req.onerror = () => res();
          req.onblocked = () => res();
        });

      deleteDb('EmulatorJS-core').then(() => {
        const script = document.createElement('script');
        script.src = '/emulatorjs/loader.js';
        document.body.appendChild(script);
        scriptRef.current = script;
      });
    });

    return () => {
      if (blockShortcutsRef.current) {
        document.removeEventListener('keydown', blockShortcutsRef.current, true);
      }
      if (blockContextMenuRef.current) {
        document.removeEventListener('contextmenu', blockContextMenuRef.current, true);
      }
      if (handleBeforeUnloadRef.current) {
        window.removeEventListener('beforeunload', handleBeforeUnloadRef.current);
      }
      scriptRef.current?.remove();
      scriptRef.current = null;
      window.EJS_ready = undefined;
      window.EJS_onGameStart = undefined;
      if (syncIntervalRef.current !== null) {
        clearInterval(syncIntervalRef.current);
        syncIntervalRef.current = null;
      }
      if (savWatcherRef.current.intervalId !== null) {
        clearInterval(savWatcherRef.current.intervalId);
        savWatcherRef.current.intervalId = null;
      }
      if (savWatcherRef.current.retryIntervalId !== null) {
        clearInterval(savWatcherRef.current.retryIntervalId);
        savWatcherRef.current.retryIntervalId = null;
      }
      if (liveSyncIntervalRef.current !== null) {
        clearInterval(liveSyncIntervalRef.current);
        liveSyncIntervalRef.current = null;
      }
      if (stateIntervalRef.current !== null) {
        clearInterval(stateIntervalRef.current);
        stateIntervalRef.current = null;
      }
      if (controlBindingsIntervalRef.current !== null) {
        clearInterval(controlBindingsIntervalRef.current);
        controlBindingsIntervalRef.current = null;
      }
      // Cleanup SRAM flush interval
      const sramFlushInterval = (window as any).__sramFlushInterval;
      if (sramFlushInterval) {
        clearInterval(sramFlushInterval);
        (window as any).__sramFlushInterval = null;
      }
      // Restore original localStorage.setItem
      if (originalSetItemRef.current) {
        localStorage.setItem = originalSetItemRef.current;
      }
    };
  }, [romUrl, romName]);

  // Revoke the object URL when the component unmounts
  useEffect(() => {
    return () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
      }
    };
  }, []);

  const handleDownloadSave = () => {
    const bytes = latestSaveBytesRef.current;
    if (!bytes || bytes.length === 0) return;
    const blob = new Blob([bytes.slice().buffer as ArrayBuffer], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'pokemon_emerald.sav';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // ── Forfeit ──────────────────────────────────────────────────────────────
  const openForfeitConfirm = () => {
    if (!draftId) return;
    setIsForfeitConfirmOpen(true);
  };

  const confirmForfeit = () => {
    setIsForfeitConfirmOpen(false);
    setForfeitTrainerId(null);
    setIsForfeitTrainerOpen(true);
  };

  const handleForfeitSubmit = async () => {
    if (!draftId || forfeitTrainerId === null) return;
    const trainer = FORFEIT_TRAINERS.find((t) => t.id === forfeitTrainerId);
    if (!trainer) return;

    setIsForfeiting(true);
    try {
      // Record the loss. No real in-game time exists for a forfeit, so use a
      // fixed placeholder (5:00:00) instead of a fake ranking time.
      await forfeitDraft(draftId, trainer.id, 5, 0, 0);

      // Notify other players in the race that the run was forfeited
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN && currentUsername) {
        wsRef.current.send(JSON.stringify({
          type: 'WipeNotification',
          data: { username: currentUsername, trainer: trainer.name },
        }));
      }

      setForfeitedTrainer(trainer.name);
      setIsForfeitTrainerOpen(false);

      // Stop the emulator so the run can't continue. callEvent('exit') shuts
      // down the core; the final save it triggers is ignored via forfeitedRef.
      forfeitedRef.current = true;
      try {
        window.EJS_emulator?.callEvent('exit');
      } catch (e) {
        console.error('Failed to stop emulator after forfeit:', e);
      }
      // Unmount the emulator DOM entirely and show the forfeit screen
      setRomUrl(null);
    } catch (e) {
      console.error('Failed to forfeit run:', e);
      window.EJS_emulator?.displayMessage('Forfeit failed. Please try again.');
    } finally {
      setIsForfeiting(false);
    }
  };

  const handleLoadAutosave = (id: string) => {
    const key = `state_${draftId || 'standalone'}_${id}`;
    getStoredSave(key).then((bytes) => {
      if (bytes && bytes.length > 0) {
        try {
          window.EJS_emulator?.gameManager?.loadState(bytes);
          window.EJS_emulator?.displayMessage('Loaded autosave state!');
          setIsAutosaveModalOpen(false);
          // Notify other players in the race that we loaded a previous state
          postStateLoadRef.current?.();
        } catch (e) {
          console.error('Failed to load autosave state:', e);
          window.EJS_emulator?.displayMessage('Failed to load autosave');
        }
      }
    }).catch(() => {
      window.EJS_emulator?.displayMessage('Failed to read autosave');
    });
  };

  const handleClaimEeveelution = async (pokedexId: number, form: string | null, targetUserId?: string | null) => {
    if (!draftId) return;
    try {
      await claimEeveelution(draftId, pokedexId, form, targetUserId);
      // Refresh draft data
      const updated = await fetchDraftById(draftId);
      setDraftData(updated);
    } catch (error) {
      console.error('Error claiming eeveelution:', error);
      throw error;
    }
  };

  const handleUnclaimEeveelution = async (pokedexId: number, form: string | null, targetUserId?: string | null) => {
    if (!draftId) return;
    try {
      await unclaimEeveelution(draftId, pokedexId, form, targetUserId);
      const updated = await fetchDraftById(draftId);
      setDraftData(updated);
    } catch (error) {
      console.error('Error unclaiming eeveelution:', error);
      throw error;
    }
  };

  // ── Ready to Race ──────────────────────────────────────────────────────────
  const handleToggleReady = useCallback(() => {
    if (!currentUserId || !currentUsername) return;
    const isReady = readyPlayers.has(currentUserId);
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    if (isReady) {
      ws.send(JSON.stringify({ type: 'ReadyToRaceCancelled', data: { user_id: currentUserId } }));
      setReadyPlayers(prev => {
        const next = new Set(prev);
        next.delete(currentUserId);
        return next;
      });
    } else {
      ws.send(JSON.stringify({ type: 'ReadyToRace', data: { user_id: currentUserId, user_name: currentUsername } }));
      setReadyPlayers(prev => {
        const next = new Set(prev);
        next.add(currentUserId);
        return next;
      });
    }
  }, [currentUserId, currentUsername, readyPlayers]);

  // Countdown timer
  useEffect(() => {
    if (countdown === null || countdown <= 0) return;
    const timer = setTimeout(() => {
      if (countdown <= 1) {
        setCountdown(0);
      } else {
        setCountdown(countdown - 1);
      }
    }, 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  // Clear "Go!" after 1 second
  useEffect(() => {
    if (countdown !== 0) return;
    const timer = setTimeout(() => {
      setCountdown(null);
      setReadyPlayers(new Set());
    }, 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  useEffect(() => {
    if (!romUrl) {
      setAutosaveHistory([]);
      return;
    }
    const metaKey = `autosaves_meta_${draftId || 'standalone'}`;
    const storedMeta = localStorage.getItem(metaKey);
    if (storedMeta) {
      try {
        const parsed = JSON.parse(storedMeta);
        if (Array.isArray(parsed)) {
          // Normalize entries: prefer `ts`, fall back to numeric `id` where possible
          const norm = parsed.map((e: any) => {
            const id = String(e.id ?? '');
            let ts = typeof e.ts === 'number' ? e.ts : NaN;
            if (!Number.isFinite(ts)) {
              // Try to derive timestamp from numeric id (legacy ids were Date.now().toString())
              const n = Number(id);
              if (Number.isFinite(n) && n > 1_000_000_000_000) ts = n;
              else ts = Date.now();
            }
            return { id, ts };
          });
          // Only keep the most recent 120 entries when loading
          setAutosaveHistory(norm.slice(-120));
        }
      } catch (e) {
        console.error('Failed to parse autosave history', e);
      }
    }
  }, [romUrl, draftId]);

  // ── Other-player sidebar ─────────────────────────────────────────────────
  // Full sorted list for readiness check (no cap)
  const allPlayerEntries = Object.entries(otherSaves)
    .sort(([, a], [, b]) => {
      const badgesA = a.save?.badge_count ?? 0;
      const badgesB = b.save?.badge_count ?? 0;
      if (badgesA !== badgesB) return badgesB - badgesA;
      // Tiebreaker: the player who obtained the current badge count at the
      // earliest in-game time (from their trainer card gym win) goes on top.
      // Players without a recorded time sort below everyone they're tied with.
      return badgeReachSeconds(a.save, badgesA) - badgeReachSeconds(b.save, badgesB);
    });
  // Show every player in the sidebar (the sidebar scrolls if they don't fit)
  const sidebarEntries = allPlayerEntries;
  const hasSidebar = draftId !== undefined;

  // Once any player has earned at least 1 badge, the race has effectively
  // started and the "Ready to Race" button is no longer needed.
  const anyPlayerHasBadge =
    (mySaveData?.badge_count ?? 0) >= 1 ||
    allPlayerEntries.some(([, { save }]) => (save?.badge_count ?? 0) >= 1);

  // Once the race has started (any player has a badge), clear every "ready"
  // state so nobody stays highlighted green in the sidebar for the whole run.
  useEffect(() => {
    if (anyPlayerHasBadge && readyPlayers.size > 0) {
      setReadyPlayers(new Set());
    }
  }, [anyPlayerHasBadge, readyPlayers]);

  // Start countdown when all players are ready
  useEffect(() => {
    if (countdown !== null) return;
    if (allPlayerEntries.length === 0) return;
    const allReady = allPlayerEntries.every(([uid]) => readyPlayers.has(uid));
    if (allReady && allPlayerEntries.length > 1) {
      setCountdown(10);
      setRaceStarted(true);
    }
  }, [readyPlayers, allPlayerEntries, countdown]);

  // Sorting helper: Active -> Boxed -> Fainted (at end)
  const sortPokemon = useCallback((uid: string, mons: any[]) => {
    return [...mons].sort((a, b) => {
      const aFainted = isMonFainted(uid, a);
      const bFainted = isMonFainted(uid, b);
      if (aFainted !== bFainted) return aFainted ? 1 : -1;
      if (a._isParty !== b._isParty) return a._isParty ? -1 : 1;
      return 0;
    });
  }, [isMonFainted]);

  // True when a player had joined the race (has a save or we've seen them
  // connected) but no longer has a live emulator WebSocket — i.e. they closed
  // their tab or left. Never applies to our own entry, and only once we know
  // who's online so nothing flashes before the presence snapshot arrives.
  const isPlayerDisconnected = useCallback(
    (uid: string, saveData: SaveData | null) =>
      presenceLoaded &&
      uid !== currentUserId &&
      !connectedUsers.has(uid) &&
      (saveData !== null || everConnectedUsers.has(uid)),
    [presenceLoaded, currentUserId, connectedUsers, everConnectedUsers]
  );

  // ── Emulator resize handlers ─────────────────────────────────────────────
  // The handles sit on the emulator's bottom / right edges (the boundaries
  // against the save panel below and the sidebar to the right), the standard
  // approach for a resizable 3-pane layout. Drag updates #game's height and
  // the left column's width; the save panel / sidebar flex to fill the rest.
  const startResize = (e: React.MouseEvent<HTMLDivElement>, mode: 'bottom' | 'right' | 'corner') => {
    e.preventDefault();
    e.stopPropagation();
    const layoutEl = layoutRef.current;
    const stageEl = gameStageRef.current;
    if (!layoutEl || !stageEl) return;
    const layoutRect = layoutEl.getBoundingClientRect();
    const stageRect = stageEl.getBoundingClientRect();
    resizeDragRef.current = {
      mode,
      startX: e.clientX,
      startY: e.clientY,
      startHeight: stageRect.height,
      startWidth: stageRect.width,
      maxHeight: layoutRect.height - 100,
      maxWidth: layoutRect.width - 280,
    };
    setIsResizing(true);
    document.body.style.cursor =
      mode === 'bottom' ? 'ns-resize' : mode === 'right' ? 'ew-resize' : 'nwse-resize';
    document.body.style.userSelect = 'none';
  };

  const onResizeMove = useCallback((e: MouseEvent) => {
    const drag = resizeDragRef.current;
    if (!drag) return;
    const deltaX = e.clientX - drag.startX;
    const deltaY = e.clientY - drag.startY;
    if (drag.mode === 'bottom' || drag.mode === 'corner') {
      setEmulatorHeightPx(Math.min(drag.maxHeight, Math.max(360, drag.startHeight + deltaY)));
    }
    if (drag.mode === 'right' || drag.mode === 'corner') {
      setEmulatorWidthPx(Math.min(drag.maxWidth, Math.max(320, drag.startWidth + deltaX)));
    }
  }, []);

  const onResizeEnd = useCallback(() => {
    resizeDragRef.current = null;
    setIsResizing(false);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }, []);

  useEffect(() => {
    if (!isResizing) return;
    const onBlur = () => onResizeEnd();
    window.addEventListener('mousemove', onResizeMove);
    window.addEventListener('mouseup', onResizeEnd);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('mousemove', onResizeMove);
      window.removeEventListener('mouseup', onResizeEnd);
      window.removeEventListener('blur', onBlur);
    };
  }, [isResizing, onResizeMove, onResizeEnd]);

  return (
    <div className="emulator-page">
      <Header />
      {/* ── Toast notifications overlay ── */}
      {notifications.length > 0 && (
        <div className="emulator-notifications">
          {notifications.map((n) => (
            <div key={n.id} className="emulator-notification">
              {n.text}
            </div>
          ))}
        </div>
      )}
      <main className="emulator-main">
        {forfeitedTrainer ? (
          <div className="emulator-forfeited">
            <h1 className="emulator-forfeited-title">Run Forfeited</h1>
            <p className="emulator-forfeited-text">
              You forfeited to <strong>{forfeitedTrainer}</strong>. Better luck next race!
            </p>
          </div>
        ) : !romUrl ? (
          <div className="emulator-picker">
            <h1 className="emulator-title">GBA Emulator</h1>
            <p className="emulator-subtitle">
              Select a ROM of Pokemon Emerald from your device. The browser will then apply the Blitz patch automatically.
              Your ROM is never uploaded — it stays entirely on your machine.
            </p>

            <div
              className={`emulator-dropzone${isDragging ? ' dragging' : ''}${isPatching ? ' patching' : ''}`}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onClick={() => !isPatching && fileInputRef.current?.click()}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && !isPatching && fileInputRef.current?.click()}
              aria-label="Select a ROM file"
            >
              {isPatching ? (
                <div className="patching-loader">
                  <p className="dropzone-label">Applying Blitz Patch...</p>
                  <p className="dropzone-hint">This usually takes a second.</p>
                </div>
              ) : (
                <>
                  <svg className="dropzone-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                    <rect x="2" y="6" width="20" height="14" rx="2" />
                    <path d="M8 13h2v2H8v-2zm4-2h2v4h-2v-4zm4 2h2v2h-2v-2z" strokeWidth="0" fill="currentColor" />
                    <circle cx="6" cy="13" r="1" fill="currentColor" strokeWidth="0" />
                    <path d="M12 2v4M10 4l2-2 2 2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <p className="dropzone-label">Drop ROM here, or click to browse</p>
                  <p className="dropzone-hint">.gba</p>
                </>
              )}
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept=".gba"
              style={{ display: 'none' }}
              onChange={handleFileChange}
            />

            {error && <p className="emulator-error">{error}</p>}

            <p className="emulator-disclaimer">
              Only play ROMs you legally own. This site does not host or distribute ROM files.
            </p>
          </div>
        ) : (
          <div
            ref={layoutRef}
            className={`emulator-layout${hasSidebar ? ' has-sidebar' : ''}${hasSidebar && isSidebarCollapsed ? ' sidebar-collapsed' : ''}`}
          >
            {/* ── Left column: emulator + own save panel ── */}
            <div
              className="emulator-col"
              style={{
                flexGrow: 1,
                ...(emulatorWidthPx !== null && hasSidebar && !isSidebarCollapsed
                  ? { flex: `0 0 ${emulatorWidthPx}px`, maxWidth: `${emulatorWidthPx}px`, width: `${emulatorWidthPx}px` }
                  : {}),
              }}
            >
              <div className="emulator-stage" ref={gameStageRef}>
                <div
                  id="game"
                  style={{
                    ...(emulatorHeightPx !== null && !isPanelMinimized ? { height: `${emulatorHeightPx}px` } : {}),
                    ...(isResizing ? { transition: 'none' } : {}),
                  }}
                />
                {!isPanelMinimized && (
                  <>
                    <div className="resize-handle bottom" onMouseDown={(e) => startResize(e, 'bottom')} />
                    {hasSidebar && !isSidebarCollapsed && (
                      <>
                        <div className="resize-handle right" onMouseDown={(e) => startResize(e, 'right')} />
                        <div className="resize-handle corner" onMouseDown={(e) => startResize(e, 'corner')} />
                      </>
                    )}
                  </>
                )}
              </div>
              {scanProgress !== null && (
                <div className="scan-load-bar">
                  <div className="scan-load-bar-track">
                    <div className="scan-load-bar-fill" style={{ width: `${Math.round(scanProgress * 100)}%` }} />
                  </div>
                  <span className="scan-load-bar-label">
                    {scanProgress < 1 ? 'Scanning game memory…' : 'Scanning…'}
                  </span>
                </div>
              )}
              {countdown !== null && (
                <div className="countdown-overlay">
                  <span className="countdown-text">
                    {countdown > 0 ? countdown : 'Go!'}
                  </span>
                </div>
              )}
              {/* Autosave Manager Modal */}
              {isAutosaveModalOpen && (
                <div className="autosave-modal-overlay" onClick={() => setIsAutosaveModalOpen(false)}>
                  <div className="autosave-modal-content" onClick={e => e.stopPropagation()}>
                    <div className="autosave-modal-header">
                      <h3>Autosave Manager</h3>
                      <button className="close-btn" onClick={() => setIsAutosaveModalOpen(false)}>×</button>
                    </div>
                    <div className="autosave-list">
                      {(() => {
                        const rev = [...autosaveHistory].slice().reverse();
                        return rev.map((entry, idx) => {
                          const minutes = idx + 1;
                          const label = `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
                          return (
                            <div key={entry.id} className="autosave-list-item" onClick={() => handleLoadAutosave(entry.id)}>
                              {label}
                            </div>
                          );
                        });
                      })()}
                    </div>
                  </div>
                </div>
              )}
              {/* Forfeit confirmation modal */}
              {isForfeitConfirmOpen && (
                <div className="forfeit-modal-overlay" onClick={() => setIsForfeitConfirmOpen(false)}>
                  <div className="forfeit-modal-content" onClick={e => e.stopPropagation()}>
                    <h3 className="forfeit-modal-title">Are you sure you'd like to forfeit your run?</h3>
                    <p className="forfeit-modal-text">
                      This records a loss and stops the emulator. This cannot be undone.
                    </p>
                    <div className="forfeit-modal-actions">
                      <button className="forfeit-modal-btn danger" onClick={confirmForfeit}>Yes</button>
                      <button className="forfeit-modal-btn" onClick={() => setIsForfeitConfirmOpen(false)}>No</button>
                    </div>
                  </div>
                </div>
              )}
              {/* Forfeit trainer selection modal */}
              {isForfeitTrainerOpen && (
                <div className="forfeit-modal-overlay" onClick={() => !isForfeiting && setIsForfeitTrainerOpen(false)}>
                  <div className="forfeit-modal-content" onClick={e => e.stopPropagation()}>
                    <h3 className="forfeit-modal-title">Who did you wipe to?</h3>
                    <p className="forfeit-modal-text">
                      Select the trainer you're forfeiting to.
                    </p>
                    <select
                      className="forfeit-trainer-select"
                      value={forfeitTrainerId ?? ''}
                      onChange={(e) => setForfeitTrainerId(Number(e.target.value))}
                      disabled={isForfeiting}
                    >
                      <option value="" disabled>Select a trainer…</option>
                      {FORFEIT_TRAINERS.map((t) => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </select>
                    <div className="forfeit-modal-actions">
                      <button
                        className="forfeit-modal-btn danger"
                        onClick={handleForfeitSubmit}
                        disabled={isForfeiting || forfeitTrainerId === null}
                      >
                        {isForfeiting ? 'Forfeiting…' : 'Forfeit'}
                      </button>
                      <button
                        className="forfeit-modal-btn"
                        onClick={() => setIsForfeitTrainerOpen(false)}
                        disabled={isForfeiting}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                </div>
              )}
              {/* Tab key overlay for race standings */}
              {showOverlay && hasSidebar && (
                <div className="race-standings-overlay">
                  <div className="overlay-header">
                    <span className="overlay-title">Race Standings (Tab)</span>
                  </div>
                  <div className="overlay-content">
                    {/* Boss battle history for current user */}
                    {mySaveData?.trainer_card_wins && mySaveData.trainer_card_wins.length > 0 && (
                      <div className="overlay-boss-battles">
                        <div className="overlay-section-title">Boss Battle History</div>
                        <div className="overlay-battle-list">
                          {mySaveData.trainer_card_wins.map((win, i) => (
                            <div key={i} className={`overlay-battle-item ${win.is_loss ? 'loss' : 'win'}`}>
                              <span className="overlay-battle-trainer">{getTrainerNameById(win.trainer_id, win.version)}</span>
                              <span className="overlay-battle-time">{win.hours}h {win.minutes}m {win.seconds}s</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {/* Race standings */}
                    {sidebarEntries.map(([uid, { displayName, save, mapName, inBattle }]) => {
                      const isCurrentUser = uid === currentUserId;
                      return (
                        <OverlayPlayerCard
                          key={uid}
                          uid={uid}
                          displayName={isCurrentUser ? (currentUsername || 'You') : displayName}
                          saveData={isCurrentUser ? mySaveData : save}
                          mapName={isCurrentUser ? undefined : mapName}
                          inBattle={isCurrentUser ? myInBattle : !!inBattle}
                          sortPokemon={sortPokemon}
                          isMonFainted={isMonFainted}
                          isPlayerDisconnected={isPlayerDisconnected}
                          resolveMetadata={resolveMetadata}
                        />
                      );
                    })}
                  </div>
                </div>
              )}

              <div className={`save-panel-container ${isPanelMinimized ? 'minimized' : ''}`}>
                <div className="save-panel own-save-panel">
                  <div className="save-panel-header">
                    {mySaveData ? (
                      <>
                        <span className="save-panel-trainer">{mySaveData.trainer_name}</span>
                        <span className="save-panel-badges">
                          {mySaveData.badge_count} {mySaveData.badge_count === 1 ? 'badge' : 'badges'}
                        </span>
                        <span className="save-panel-money">₽{mySaveData.money.toLocaleString()}</span>
                      </>
                    ) : (
                      <span className="save-panel-trainer" style={{ opacity: 0.5 }}>Save the game to display game data</span>
                    )}
                    {draftId && mySaveData && (
                      <button
                        className="forfeit-btn"
                        onClick={openForfeitConfirm}
                        title="Forfeit your run and record a loss"
                      >
                        Forfeit
                      </button>
                    )}
                    {mySaveData && (
                      <button
                        className="autosave-btn"
                        onClick={handleDownloadSave}
                        title="Download .sav file"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: 'middle', marginRight: 4 }}>
                          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                          <polyline points="7 10 12 15 17 10" />
                          <line x1="12" y1="15" x2="12" y2="3" />
                        </svg>
                        .sav
                      </button>
                    )}
                    {autosaveHistory.length > 0 && (
                      <button
                        className="autosave-btn"
                        onClick={() => setIsAutosaveModalOpen(true)}
                      >
                        Load Autosave
                      </button>
                    )}
                    {draftId && draftData && mySaveData && (
                      <EeveelutionClaimButton
                        eeveelutions={[
                          { pokedex_id: 134, name: 'Vaporeon', form: null },
                          { pokedex_id: 135, name: 'Jolteon', form: null },
                          { pokedex_id: 136, name: 'Flareon', form: null },
                          { pokedex_id: 196, name: 'Espeon', form: null },
                          { pokedex_id: 197, name: 'Umbreon', form: null },
                          { pokedex_id: 470, name: 'Leafeon', form: null },
                          { pokedex_id: 471, name: 'Glaceon', form: null },
                          { pokedex_id: 700, name: 'Sylveon', form: null },
                        ]}
                        teams={draftData.teams}
                        currentUserId={currentUserId}
                        currentUsername={currentUsername}
                        onClaim={handleClaimEeveelution}
                        onUnclaim={handleUnclaimEeveelution}
                        bannedPokedexIds={draftData.one_v_one?.banned_eeveelutions ?? []}
                      />
                    )}
                    {draftId && draftData && !mySaveData && (
                      <NotebookWithdrawButton
                        pokemon={
                          draftData.teams.find((t: any) => t.user_id === currentUserId)
                            ?.auctions_won ?? []
                        }
                        onWithdrawingChange={(val) => { isWithdrawingRef.current = val; }}
                      />
                    )}
                    {!draftId && urlPokemon.length > 0 && !mySaveData && (
                      <NotebookWithdrawButton
                        pokemon={urlPokemon}
                        onWithdrawingChange={(val) => { isWithdrawingRef.current = val; }}
                      />
                    )}
                    {draftId && draftData && countdown === null && !raceStarted && !anyPlayerHasBadge && (
                      <button
                        className={`ready-race-button ${readyPlayers.has(currentUserId ?? '') ? 'ready' : ''}`}
                        onClick={handleToggleReady}
                      >
                        {readyPlayers.has(currentUserId ?? '') ? 'Ready!' : 'Ready to Race'}
                      </button>
                    )}

                    <div className="panel-toggle-group">
                      <button
                        className="autosave-btn"
                        onClick={() => setIsPanelMinimized(!isPanelMinimized)}
                        title={isPanelMinimized ? "Expand" : "Minimize"}
                      >
                        {isPanelMinimized ? '▲' : '▼'}
                      </button>
                      {hasSidebar && (
                        <button
                          className="autosave-btn"
                          onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
                          title={isSidebarCollapsed ? "Show sidebar" : "Hide sidebar"}
                        >
                          {isSidebarCollapsed ? '◀' : '▶'}
                        </button>
                      )}
                    </div>
                  </div>
                  {!isPanelMinimized && mySaveData && (
                    <div className="save-party-grid">
                      {sortPokemon(currentUserId || 'me', [
                        ...(mySaveData.party ?? []).map((m: any) => ({ ...m, _isParty: true })),
                        ...(mySaveData.box ?? []).map((m: any) => ({ ...m, _isParty: false })),
                      ]).map((mon: any, i: number) => {
                        const speciesId = mon.species_id ?? mon.speciesId;
                        const speciesData = resolveMetadata(speciesId, mon.nickname);
                        const realName = (speciesId === 412 && mon.nickname?.toLowerCase() === 'egg') ? "Egg" : (speciesData?.name || `ID ${speciesId}`);
                        const iconName = getIconName(realName, speciesId);
                        const abilityName = speciesData?.abilities?.[mon.ability_num] || 'Unknown';
                        const fainted = isMonFainted(currentUserId || 'me', mon);
                        const hasNickname = isActuallyNicknamed(mon.nickname, speciesId, realName);

                        return (
                          <div key={`combined-${i}`} className={`save-mon-card${fainted ? ' fainted' : ''}${markedPids.has(mon.personality) ? ' marked' : ''}`}>
                            <div className="mon-name-row">
                              <span className="mon-name" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <a
                                  className="mon-name-link"
                                  href={`https://emeraldblitz.com/pokemon/${realName}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  title="Open on emeraldblitz.com"
                                >
                                  {hasNickname ? (
                                    <>{mon.nickname} <span style={{ opacity: 0.6, fontSize: '0.9em' }}>({realName})</span></>
                                  ) : realName}
                                </a>
                                <img
                                  src={`/MiniIcons/${iconName}.png`}
                                  alt=""
                                  style={{ width: '24px', height: '24px', imageRendering: 'pixelated' }}
                                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                                />
                                <span className="mon-ability" style={{ fontSize: '0.9rem', opacity: 0.7, fontWeight: 'normal', marginLeft: '4px' }}>
                                  {abilityName}
                                </span>
                              </span>
                              <label
                                className="mon-mark"
                                title="Mark this Pokémon so you remember to buy items for it"
                              >
                                <input
                                  type="checkbox"
                                  checked={markedPids.has(mon.personality)}
                                  onChange={() => toggleMarked(mon.personality)}
                                />
                              </label>
                            </div>
                            {mon.nature && <div className="mon-nature">{mon.nature}{NATURE_EFFECTS[mon.nature]}</div>}
                            {mon.ivs && (
                              <IVRow ivs={mon.ivs} />
                            )}
                            {mon.moves && mon.moves.some((id: number) => id > 0) && (
                              <div className="mon-moves">
                                {mon.moves.map((moveId: number, idx: number) => {
                                  const move = MOVES[moveId];
                                  if (!move) return null;
                                  const color = MOVE_TYPE_COLORS[move.type] || '#9ca3af';
                                  return (
                                    <span key={idx} className="mon-move" style={{ backgroundColor: `${color}2e`, color }}>
                                      {move.name}
                                    </span>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>


            {/* ── Right sidebar: other players ── */}
            {hasSidebar && !isSidebarCollapsed && (
              <aside
                className="emulator-sidebar"
                style={emulatorWidthPx !== null ? { flex: '1 1 0', maxWidth: 'none' } : undefined}
              >
                {sidebarEntries.map(([uid, { displayName, save, mapName, inBattle }]) => {
                  const isCurrentUser = uid === currentUserId;
                  return (
                    <SidebarPlayerCard
                      key={uid}
                      uid={uid}
                      displayName={isCurrentUser ? (currentUsername || 'You') : displayName}
                      saveData={isCurrentUser ? mySaveData : save}
                      mapName={isCurrentUser ? undefined : mapName}
                      inBattle={isCurrentUser ? myInBattle : !!inBattle}
                      isReady={readyPlayers.has(uid)}
                      sortPokemon={sortPokemon}
                      isMonFainted={isMonFainted}
                      isPlayerDisconnected={isPlayerDisconnected}
                      resolveMetadata={resolveMetadata}
                    />
                  );
                })}
              </aside>
            )}
          </div>
        )}
      </main>
    </div>
  );
};

export default EmulatorPage;
