import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import Header from '../../shared/components/Header';
import { parseSaveFile, SaveData, getTrainerNameById } from '../../utils/parseSaveFile';
import { getIconName, createResolveMetadata, isActuallyNicknamed } from '../../utils/speciesUtils';
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
        FS?: {
          syncfs(populate: boolean, callback: (err: any) => void): void;
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
type OtherPlayerSaves = Record<string, { displayName: string; save: SaveData | null }>;

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

  const [autosaveHistory, setAutosaveHistory] = useState<{ id: string; ts: number }[]>([]);
  const [isAutosaveModalOpen, setIsAutosaveModalOpen] = useState(false);

  // Current logged-in user (to exclude self from sidebar)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [currentUsername, setCurrentUsername] = useState<string | null>(null);
  const [hasRefereeRole, setHasRefereeRole] = useState(false);

  // Other players in the draft (populated via WebSocket)
  const [otherSaves, setOtherSaves] = useState<OtherPlayerSaves>({});
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
  const controlBindingsIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastKnownBindingsRef = useRef<string | null>(null);
  const blockShortcutsRef = useRef<((e: KeyboardEvent) => void) | null>(null);
  const blockContextMenuRef = useRef<((e: MouseEvent) => void) | null>(null);
  const handleBeforeUnloadRef = useRef<((e: BeforeUnloadEvent) => void) | null>(null);
  const originalSetItemRef = useRef<((key: string, value: string) => void) | null>(null);

  // Stable ref so window callbacks always see the latest handler
  const onRawSaveBytesRef = useRef<((bytes: Uint8Array) => void) | null>(null);

  // Latest raw .sav bytes for the download button
  const latestSaveBytesRef = useRef<Uint8Array | null>(null);
  const [hasSaveBytes, setHasSaveBytes] = useState(false);

  // Once a player forfeits, ignore any further save bytes — the final save the
  // emulator triggers while shutting down must not overwrite the forfeit loss
  // that was just recorded on the backend.
  const forfeitedRef = useRef(false);

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
      if (u.user_id) setCurrentUserId(u.user_id);
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
            next[team.user_id] = {
              displayName: team.global_name?.trim() || team.username,
              save: prev[team.user_id]?.save ?? null,
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
      console.log(`[Icon Metadata] Loaded ${all.length} pokemon (${regular.length} regular, ${rental.length} rental)`);
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
      }

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string);
          if (msg.type === 'SaveUpdate') {
            const { user_id, save_data } = msg.data as { user_id: string; save_data: any };
            console.log('[EmulatorPage] SaveUpdate received for', user_id, save_data);
            setOtherSaves((prev) => ({
              ...prev,
              [user_id]: { displayName: prev[user_id]?.displayName ?? user_id, save: save_data },
            }));
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
          console.log('reconnecting ws');
          reconnectTimeoutRef.current = setTimeout(() => {
            reconnectCountRef.current += 1;
            wsConnect();
          }, delay);
        }
        else {
          console.log('failed to reconnect ws in 5 tries, aborting...');
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

  // Track which Personalities have hit 0 HP to keep them fainted in the box
  useEffect(() => {
    const newFainted: Record<string, Set<number>> = { ...faintedPids };
    let changed = false;

    const processSave = (uid: string, data: SaveData | null) => {
      if (!data?.party) return;
      if (!newFainted[uid]) newFainted[uid] = new Set();
      data.party.forEach(mon => {
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

  const isMonFainted = (uid: string, mon: any) => {
    if (mon.hp === 0) return true;
    const deadSet = faintedPids[uid];
    if (deadSet && deadSet.has(mon.personality)) return true;
    return false;
  };

  // ── Save bytes handler: parse + POST to backend ──────────────────────────
  onRawSaveBytesRef.current = (bytes: Uint8Array) => {
    // Ignore saves that arrive after a forfeit (e.g. the one the emulator
    // writes while exiting) so they can't overwrite the recorded loss.
    if (forfeitedRef.current) return;
    latestSaveBytesRef.current = bytes;
    setHasSaveBytes(true);
    let parsed: SaveData;
    try {
      parsed = parseSaveFile(bytes, pokemonMetadata, pokemonById);
    } catch {
      return;
    }
    setMySaveData(parsed);
    const now = new Date();
    setSaveLastSynced(now);
    console.log(`Synced save at ${now.toLocaleTimeString()}`);

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

    // Build the Hall of Fame team from the party saved at the museum (the first
    // time the game is beaten). A party is at most 6 Pokemon, so cap it there
    // defensively. The backend only keeps the first one it receives.
    const hallOfFameTeam = isWinner
      ? (parsed.party ?? []).slice(0, 6).map((mon: any) => {
          const speciesId = mon.species_id ?? mon.speciesId;
          const speciesData = resolveMetadata(speciesId, mon.nickname);
          const realName = (speciesId === 412 && mon.nickname?.toLowerCase() === 'egg') ? "Egg" : (speciesData?.name || `ID ${speciesId}`);
          return { name: realName, icon: getIconName(realName, speciesId) };
        })
      : undefined;

    if (draftId) {
      console.log('[EmulatorPage] Sending save data with trainer_card_wins:', parsed.trainer_card_wins);
      fetch(`/api/drafts/${draftId}/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(hallOfFameTeam ? { ...parsed, hall_of_fame_team: hallOfFameTeam } : parsed),
        credentials: 'include',
      }).catch(() => { });
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
    console.log('[ControlBindings] Initial localStorage key:', localStorageKey);

    // Load control bindings from backend
    const loadControlBindings = async () => {
      try {
        const bindings = await fetchControlBindings();
        console.log('[ControlBindings] Fetched from backend:', bindings);
        if (bindings && typeof bindings === 'object') {
          lastKnownBindingsRef.current = JSON.stringify(bindings);
          console.log('[ControlBindings] Stored bindings in ref, will apply after EmulatorJS initializes');
          return bindings;
        } else {
          console.log('[ControlBindings] No bindings found or invalid format');
          return null;
        }
      } catch (err) {
        console.error('[ControlBindings] Failed to load control bindings:', err);
        return null;
      }
    };

    // Load bindings and then initialize emulator
    loadControlBindings().then((bindings) => {
      console.log('[ControlBindings] Bindings loaded, initializing emulator');

      // Set control settings directly in EmulatorJS configuration
      // The correct property is EJS_defaultControls (mapped to config.defaultControllers)
      if (bindings) {
        console.log('[ControlBindings] Setting EJS_defaultControls:', bindings);
        (window as any).EJS_defaultControls = bindings;
      }

      // Poll localStorage for control binding changes and save to backend
      // The storage event only fires for changes from other tabs/windows, so we need polling
      // to detect changes made by EmulatorJS in the same tab
      controlBindingsIntervalRef.current = setInterval(() => {
        // Check ALL matching localStorage keys for changes
        const allKeys = Object.keys(localStorage).filter(k => k.startsWith('ejs-') && k.endsWith('-settings'));
        const matchingKeys = allKeys.filter(k => k.startsWith(`ejs-${gameId}-${core}-`));
        console.log('[ControlBindings] Checking matching keys:', matchingKeys);

        for (const key of matchingKeys) {
          const settingsStr = localStorage.getItem(key);
          if (settingsStr) {
            try {
              const settings = JSON.parse(settingsStr);
              const currentBindings = settings.controlSettings;
              const bindingsStr = currentBindings ? JSON.stringify(currentBindings) : null;
              console.log('[ControlBindings] Key:', key, 'Extracted controlSettings:', bindingsStr?.substring(0, 100), 'Last known:', lastKnownBindingsRef.current?.substring(0, 100));
              if (bindingsStr && bindingsStr !== lastKnownBindingsRef.current) {
                console.log('[ControlBindings] Detected change in', key, ', saving to backend:', currentBindings);
                saveControlBindings(currentBindings).then(() => {
                  console.log('[ControlBindings] Successfully saved to backend');
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
          setShowOverlay(prev => !prev);
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
      // Hook saveSaveFiles once the emulator is ready — fires on toolbar save
      // button, tab background/unload, and our 30-second auto-sync interval.
      window.EJS_ready = () => {
        console.log('[ControlBindings] EmulatorJS ready');

        window.EJS_emulator?.on('saveSaveFiles', (rawData) => {
          const bytes = rawData as Uint8Array | null | undefined;
          if (!bytes || !(bytes instanceof Uint8Array) || bytes.length === 0) return;
          onRawSaveBytesRef.current?.(bytes);

          // Sync Emscripten FS to IndexedDB
          try {
            window.EJS_emulator?.gameManager?.FS?.syncfs(false, (err: any) => {
              if (err) console.error('Error syncing IDBFS:', err);
              else console.log('Successfully synced IDBFS to browser IndexedDB.');
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
        console.log('[ControlBindings] Game started, applying saved bindings');

        // Apply saved bindings when the game starts
        if (lastKnownBindingsRef.current) {
          const bindings = JSON.parse(lastKnownBindingsRef.current);
          console.log('[ControlBindings] Applying bindings on game start:', bindings);

          // Try multiple approaches to set controls
          setTimeout(() => {
            const gameMgr = window.EJS_emulator?.gameManager;
            if (gameMgr) {
              console.log('[ControlBindings] Game manager available, exploring structure:', Object.keys(gameMgr));

              // Try to find and update the virtual gamepad controls
              if ((gameMgr as any).virtualGamepad) {
                console.log('[ControlBindings] Found virtualGamepad, setting controls');
                (gameMgr as any).virtualGamepad.controls = bindings;
              }

              // Try to update the controls object directly
              if ((gameMgr as any).controls) {
                console.log('[ControlBindings] Found controls object, updating');
                Object.assign((gameMgr as any).controls, bindings);
              }

              // Try to access the input system
              if ((gameMgr as any).input) {
                console.log('[ControlBindings] Found input system, exploring:', Object.keys((gameMgr as any).input));
                if ((gameMgr as any).input.controls) {
                  (gameMgr as any).input.controls = bindings;
                  console.log('[ControlBindings] Set input.controls');
                }
              }

              // Try to call any available control update method
              const possibleMethods = ['setControls', 'updateControls', 'loadControls', 'applyControls'];
              for (const method of possibleMethods) {
                if (typeof (gameMgr as any)[method] === 'function') {
                  console.log('[ControlBindings] Calling method:', method);
                  (gameMgr as any)[method](bindings);
                }
              }
            }
          }, 1000);
        }

        syncIntervalRef.current = setInterval(() => {
          window.EJS_emulator?.gameManager?.saveSaveFiles();
          setTimeout(() => {
            window.EJS_emulator?.gameManager?.saveSaveFiles();
          }, 200);
        }, 10_000);

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
              
              console.log('Autosaved emulator state successfully.');
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
      if (stateIntervalRef.current !== null) {
        clearInterval(stateIntervalRef.current);
        stateIntervalRef.current = null;
      }
      if (controlBindingsIntervalRef.current !== null) {
        clearInterval(controlBindingsIntervalRef.current);
        controlBindingsIntervalRef.current = null;
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
      return badgesB - badgesA;
    });
  // Display list capped at 9
  const sidebarEntries = allPlayerEntries.slice(0, 9);
  const hasSidebar = draftId !== undefined;

  // Once any player has earned at least 1 badge, the race has effectively
  // started and the "Ready to Race" button is no longer needed.
  const anyPlayerHasBadge =
    (mySaveData?.badge_count ?? 0) >= 1 ||
    allPlayerEntries.some(([, { save }]) => (save?.badge_count ?? 0) >= 1);

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
  const sortPokemon = (uid: string, mons: any[]) => {
    return [...mons].sort((a, b) => {
      const aFainted = isMonFainted(uid, a);
      const bFainted = isMonFainted(uid, b);
      if (aFainted !== bFainted) return aFainted ? 1 : -1;
      if (a._isParty !== b._isParty) return a._isParty ? -1 : 1;
      return 0;
    });
  };

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
          <div className={`emulator-layout${hasSidebar ? ' has-sidebar' : ''}`}>
            {/* ── Left column: emulator + own save panel ── */}
            <div className="emulator-col" style={{ flexGrow: 1 }}>
              <div id="game" />
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
                    {sidebarEntries.map(([uid, { displayName, save }]) => {
                      const isCurrentUser = uid === currentUserId;
                      const saveData = isCurrentUser ? mySaveData : save;
                      const displayDisplayName = isCurrentUser ? (currentUsername || 'You') : displayName;

                      // Detect wipe (InsideOfTruck) or win (LilycoveCity_LilycoveMuseum_1F)
                      const isWiped = saveData?.map_name === 'InsideOfTruck';
                      const isWinner = saveData?.map_name === 'LilycoveCity_LilycoveMuseum_1F';
                      const mostRecentLossName = saveData?.most_recent_loss_name;
                      const championName = getChampionName(saveData);

                      return (
                        <div key={uid} className="overlay-player-card">
                          <div className="overlay-player-header">
                            <span className="overlay-username">{displayDisplayName}</span>
                            {isWiped && mostRecentLossName && (
                              <span className="wipe-text">(Wiped to {mostRecentLossName})</span>
                            )}
                            {isWinner && championName && (
                              <span className="win-text">(Beat {championName}!)</span>
                            )}
                            <span className="overlay-badges">
                              {saveData ? `${saveData.badge_count} ${saveData.badge_count === 1 ? 'badge' : 'badges'}` : '— badges'}
                            </span>
                          </div>
                          {saveData ? (
                            <div className="overlay-mon-icons">
                              {sortPokemon(uid, [
                                ...(saveData.party ?? []).map((m: any) => ({ ...m, _isParty: true })),
                                ...(saveData.box ?? []).map((m: any) => ({ ...m, _isParty: false })),
                              ]).map((mon: any, i: number, arr: any[]) => {
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
                    {draftId && (
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
                    {draftId && draftData && (
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
                      />
                    )}
                    {draftId && draftData && !mySaveData && (
                      <NotebookWithdrawButton
                        pokemon={
                          draftData.teams.find((t: any) => t.user_id === currentUserId)
                            ?.auctions_won ?? []
                        }
                      />
                    )}
                    {!draftId && urlPokemon.length > 0 && !mySaveData && (
                      <NotebookWithdrawButton pokemon={urlPokemon} />
                    )}
                    {draftId && draftData && countdown === null && !raceStarted && !anyPlayerHasBadge && (
                      <button
                        className={`ready-race-button ${readyPlayers.has(currentUserId ?? '') ? 'ready' : ''}`}
                        onClick={handleToggleReady}
                      >
                        {readyPlayers.has(currentUserId ?? '') ? 'Ready!' : 'Ready to Race'}
                      </button>
                    )}

                    <button
                      className="panel-minimize-btn"
                      onClick={() => setIsPanelMinimized(!isPanelMinimized)}
                      title={isPanelMinimized ? "Expand" : "Minimize"}
                    >
                      {isPanelMinimized ? '＋' : '－'}
                    </button>
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
                          <div key={`combined-${i}`} className={`save-mon-card${fainted ? ' fainted' : ''}`}>
                            <div className="mon-name-row">
                              <span className="mon-name" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                {hasNickname ? (
                                  <>{mon.nickname} <span style={{ opacity: 0.6, fontSize: '0.9em' }}>({realName})</span></>
                                ) : realName}
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
                            </div>
                            {mon.nature && <div className="mon-nature">{mon.nature}{NATURE_EFFECTS[mon.nature]}</div>}
                            {mon.ivs && (
                              <IVRow ivs={mon.ivs} />
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
            {hasSidebar && (
              <aside className="emulator-sidebar">
                {sidebarEntries.map(([uid, { displayName, save }]) => {
                  const isCurrentUser = uid === currentUserId;
                  const saveData = isCurrentUser ? mySaveData : save;
                  const displayDisplayName = isCurrentUser ? (currentUsername || 'You') : displayName;

                  // Detect wipe (InsideOfTruck) or win (LilycoveCity_LilycoveMuseum_1F)
                  const isWiped = saveData?.map_name === 'InsideOfTruck';
                  const isWinner = saveData?.map_name === 'LilycoveCity_LilycoveMuseum_1F';
                  const mostRecentLossName = saveData?.most_recent_loss_name;
                  const championName = getChampionName(saveData);

                  return (
                    <div key={uid} className={`sidebar-player-card ${readyPlayers.has(uid) ? 'race-ready' : ''}`}>
                      <div className="sidebar-player-header">
                        <span className={`sidebar-username ${isWiped ? 'wiped' : ''} ${isWinner ? 'winner' : ''}`}>
                          {displayDisplayName}
                          {isWiped && mostRecentLossName && (
                            <span className="wipe-text"> (Wiped to {mostRecentLossName})</span>
                          )}
                          {isWinner && championName && (
                            <span className="win-text"> (Beat {championName}!)</span>
                          )}
                        </span>
                        <span className="sidebar-badges">
                          {saveData ? `${saveData.badge_count} ${saveData.badge_count === 1 ? 'badge' : 'badges'}` : '— badges'}
                        </span>
                      </div>
                      {saveData ? (
                        <div className="sidebar-mon-icons">
                          {sortPokemon(uid, [
                            ...(saveData.party ?? []).map((m: any) => ({ ...m, _isParty: true })),
                            ...(saveData.box ?? []).map((m: any) => ({ ...m, _isParty: false })),
                          ]).map((mon: any, i: number, arr: any[]) => {
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
                                title={`${hasNickname ? `${mon.nickname} (${realName})` : realName} (${abilityName}) - (${mon.nature || 'Unknown'} Nature${mon.nature ? NATURE_EFFECTS[mon.nature] : ''})${mon.ivs ? `\nIVs: ${mon.ivs.hp}/${mon.ivs.atk}/${mon.ivs.def}/${mon.ivs.spa}/${mon.ivs.spd}/${mon.ivs.spe}` : ''}`}
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
