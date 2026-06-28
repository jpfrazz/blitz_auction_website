import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import Header from '../../shared/components/Header';
import { parseSaveFile, SaveData } from '../../utils/parseSaveFile';
import { fetchCurrentUser, fetchDraftById, claimEeveelution, unclaimEeveelution, fetchControlBindings, saveControlBindings } from '../../shared/api/draftData';
import { fetchPokemonList } from '../../shared/api/pokemon';
import EeveelutionClaimButton from './EeveelutionClaimButton';
import './EmulatorPage.scss';

const getIconName = (name: string, speciesId?: number) => {
  if (!name || name === '???') return 'egg';
  const n = name.toLowerCase();
  if (n.startsWith('egg')) return 'egg';
  
  // Special handling for specific Pokemon with non-standard names
  if (n.includes('plusle')) return 'plusle';
  if (n.includes('minun')) return 'minun';
  if (n.includes('deerling')) return 'deerling';
  if (n.includes('mime jr')) return 'mime jr';
  if (n.includes('mime.')) return 'mime jr';
  
  // Fallback: handle by species ID if name lookup failed
  if (n.startsWith('id') && speciesId) {
    if (speciesId === 312) return 'minun';
    if (speciesId === 311) return 'plusle';
    if (speciesId === 1094 || speciesId === 1095 || speciesId === 1096 || speciesId === 1097) return 'deerling';
    if (speciesId === 439) return 'mime jr';
  }
  
  return n.replace(/é/g, 'e').replace(/[^a-z0-9- .]/g, '');
};

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
      gameManager?: {
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

// Map of user_id → latest parsed save for other draft players
type OtherPlayerSaves = Record<string, { displayName: string; save: SaveData | null }>;

interface ToastNotification {
  id: number;
  text: string;
}

const EmulatorPage: React.FC = () => {
  const { draftId } = useParams<{ draftId?: string }>();

  const [romUrl, setRomUrl] = useState<string | null>(null);
  const [romName, setRomName] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isPatching, setIsPatching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Own parsed save data shown below the emulator
  const [mySaveData, setMySaveData] = useState<SaveData | null>(null);
  const [saveLastSynced, setSaveLastSynced] = useState<Date | null>(null);
  const [isPanelMinimized, setIsPanelMinimized] = useState(false);

  const [hasAutosave, setHasAutosave] = useState(false);
  const [autosaveTime, setAutosaveTime] = useState<string | null>(null);

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

  // Persist fainted state via Personality ID (User ID -> Set of PIDs)
  const [faintedPids, setFaintedPids] = useState<Record<string, Set<number>>>({});

  // Toast notifications for state load events from other players
  const [notifications, setNotifications] = useState<ToastNotification[]>([]);
  const toastIdRef = useRef(0);

  // Tab key overlay for race standings
  const [showOverlay, setShowOverlay] = useState(false);

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

  // Stable ref so window callbacks always see the latest handler
  const onRawSaveBytesRef = useRef<((bytes: Uint8Array) => void) | null>(null);

  // Stable ref for the notification fetch so EJS_ready closure always gets the current draftId
  const postStateLoadRef = useRef<(() => void) | null>(null);
  postStateLoadRef.current = () => {
    if (draftId) {
      fetch(`/api/drafts/${draftId}/state-load-notification`, {
        method: 'POST',
        credentials: 'include',
      }).catch(() => {});
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
    }).catch(() => {});
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
      .catch(() => {});
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

  // Map Blitz mod species IDs to database species IDs
  const mapSpeciesId = (id: number): number => {
    // Deerling forms: Blitz uses 1094-1097, database uses 585
    if (id >= 1094 && id <= 1097) return 585;
    // Plusle and Minun: Blitz uses 311/312, database uses 311 for combined
    if (id === 312) return 311;
    return id;
  };

  const resolveMetadata = (speciesId: number, nickname: string | undefined) => {
    // Map Blitz species ID to database species ID
    const dbSpeciesId = mapSpeciesId(speciesId);

    // Special handling for Plusle/Minun since they're combined in database
    if (speciesId === 311 || speciesId === 312) {
      const combinedEntry = pokemonById.get(311)?.[0];
      if (combinedEntry) {
        const isMinun = speciesId === 312;
        return {
          ...combinedEntry,
          name: isMinun ? 'Minun' : 'Plusle',
          pokedex_id: speciesId,
          // Override abilities: Plusle always has Plus, Minun always has Minus
          ability1: isMinun ? 'Minus' : 'Plus',
          ability2: isMinun ? 'Plus' : 'Minus',
        };
      }
    }

    // Special handling for Farfetch'd - map to Galar variant (ID 83)
    if (speciesId === 83) {
      const farfetchdCandidates = pokemonById.get(83);
      if (farfetchdCandidates) {
        const galarVariant = farfetchdCandidates.find(p => p.form === 'Galar');
        if (galarVariant) return galarVariant;
      }
    }

    // 1. Try direct ID lookup. This is the most reliable method.
    const candidates = pokemonById.get(dbSpeciesId);
    let data: any = null;

    if (candidates) {
      const singleCandidate = candidates.length === 1 ? candidates[0] : null;
      const isNameMismatch = singleCandidate && nickname && !singleCandidate.name.toLowerCase().startsWith(nickname.toLowerCase());

      // If the ID lookup fails or is ambiguous, immediately try to find a form-based match
      // using the nickname. This is crucial for Pokémon like Deerling.
      if ((!singleCandidate || isNameMismatch) && nickname) {
        const formMatch = Object.values(pokemonMetadata).find(p => 
          p.name.toLowerCase().startsWith(nickname.toLowerCase()) && Number(p.pokedex_id) === dbSpeciesId
        );
        if (formMatch) return formMatch;
      }
      else if (candidates.length > 1 || isNameMismatch) {
        // If multiple candidates or a name mismatch, use the nickname to find the correct form.
        if (nickname) {
          data = candidates.find(p => p.name.toLowerCase().startsWith(nickname.toLowerCase()));
        }
        // If still no match, we can't be sure, so we don't assign data yet.
      } else if (singleCandidate) {
        data = singleCandidate;
      }
    }
    
    if (!data && nickname) {
      let searchName = nickname.toLowerCase();
      // Special handling for Deerling/Sawsbuck - strip form suffixes to match base form in DB
      if (searchName.startsWith('deerling')) {
        searchName = 'deerling';
      } else if (searchName.startsWith('sawsbuck')) {
        searchName = 'sawsbuck';
      }
      // Handle Mime Jr. period issue - database has "Mime Jr" without period
      else if (searchName === 'mime jr.' || searchName === 'mime jr') {
        searchName = 'mime jr';
      }
      // Handle Farfetch'd - database has apostrophe, save file might not
      else if (searchName === 'farfetchd' || searchName === 'farfetch\'d') {
        searchName = 'farfetch\'d';
      }
      // Handle Farfetch'd Galar - database has "Farfetch'd,Galar"
      else if (searchName === 'farfetch\'d galar' || searchName === 'farfetchd galar') {
        searchName = 'farfetch\'d,galar';
      }
      data = pokemonMetadata[searchName];
      
      // Try normalized lookup for accented names
      if (!data) {
        const normalized = searchName.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        data = pokemonMetadata[normalized];
      }

      // Handle forms (e.g. "Deerling" matching "Deerling-Spring") or truncated names
      if (!data) {
        data = Object.values(pokemonMetadata).find(p => 
          p.name.toLowerCase().startsWith(searchName)
        );
      }
    }

    // 4. Handle Mega Evolution redirection to treat them as base forms
    if (data && data.name.toLowerCase().includes('mega')) {
      const baseName = data.name.toLowerCase()
        .replace(/\s*\(mega .*\)/, '') // Handles "(Mega ...)"
        .replace(/^mega\s*/, '') // Handles "Mega ..."
        .trim();
      if (pokemonMetadata[baseName]) return pokemonMetadata[baseName];
    }

    return data;
  };

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
                const { user_id, save_data } = msg.data as { user_id: string; save_data: SaveData };
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
                console.warn('failed to reconnect ws in 5 tries, aborting...');
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

    if (draftId) {
      fetch(`/api/drafts/${draftId}/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed),
        credentials: 'include',
      }).catch(() => {});
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
        const patchedData = applyBpsPatch(new Uint8Array(romBuffer), new Uint8Array(patchBuffer));
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
      setError('Failed to apply Blitz patch. Please ensure you are using a clean Emerald ROM.');
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

    // Load control bindings from backend before initializing emulator
    const loadControlBindings = async () => {
      try {
        const bindings = await fetchControlBindings();
        if (bindings && typeof bindings === 'object') {
          console.log('Loaded control bindings from backend:', bindings);
          // Store in localStorage for EmulatorJS to pick up
          localStorage.setItem('ejs_controlSettings', JSON.stringify(bindings));
        }
      } catch (err) {
        console.error('Failed to load control bindings:', err);
      }
    };

    loadControlBindings();

    // Listen for control binding changes and save to backend
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'ejs_controlSettings' && e.newValue) {
        try {
          const bindings = JSON.parse(e.newValue);
          console.log('Saving control bindings to backend:', bindings);
          saveControlBindings(bindings).catch(err => {
            console.error('Failed to save control bindings:', err);
          });
        } catch (err) {
          console.error('Failed to parse control bindings:', err);
        }
      }
    };

    window.addEventListener('storage', handleStorageChange);

    // Remove any leftover script from a previous load
    if (scriptRef.current) {
      scriptRef.current.remove();
      scriptRef.current = null;
    }

    // Intercept keyboard shortcuts (1,2,3) and prevent arrow keys from scrolling the page.
    // When users map game controls to arrow keys, the browser scrolls the page by default.
    const blockShortcuts = (e: KeyboardEvent) => {
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
    document.addEventListener('keydown', blockShortcuts, true);

    // Add beforeunload confirmation to prevent accidental tab closure
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = ''; // Chrome requires returnValue to be set
    };
    window.addEventListener('beforeunload', handleBeforeUnload);

    // Disable the right-click context menu entirely for the emulator
    const blockContextMenu = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('#game') || target.closest('.ejs_context_menu')) {
        // Prevent the browser's native context menu but allow the emulator's
        // custom contextmenu event handlers to receive the event.
        e.preventDefault();
      }
    };
    document.addEventListener('contextmenu', blockContextMenu, true);

    const core = getExtension(romName ?? '') === 'gba' ? 'mgba' : 'gambatte';

    window.EJS_player = '#game';
    window.EJS_core = core;
    window.EJS_gameUrl = romUrl;
    window.EJS_pathtodata = '/emulatorjs/';
    window.EJS_startOnLoaded = true;
    window.EJS_stopOnUnfocused = false;
    window.EJS_pauseOnBlur = false;
    window.EJS_language = 'en-US';
    window.EJS_gameName = draftId || 'game';
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

    // Hook saveSaveFiles once the emulator is ready — fires on toolbar save
    // button, tab background/unload, and our 30-second auto-sync interval.
    window.EJS_ready = () => {
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
            const key = `state_${draftId || 'standalone'}`;
            const timeKey = `state_time_${draftId || 'standalone'}`;
            void setStoredSave(key, stateData);
            const now = new Date();
            localStorage.setItem(timeKey, now.toISOString());
            setHasAutosave(true);
            setAutosaveTime(now.toLocaleTimeString());
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

    return () => {
      document.removeEventListener('keydown', blockShortcuts, true);
      document.removeEventListener('contextmenu', blockContextMenu, true);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener('storage', handleStorageChange);
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

  const handleLoadAutosave = () => {
    const key = `state_${draftId || 'standalone'}`;
    getStoredSave(key).then((bytes) => {
      if (bytes && bytes.length > 0) {
        try {
          window.EJS_emulator?.gameManager?.loadState(bytes);
          window.EJS_emulator?.displayMessage('Loaded autosave state!');
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

  useEffect(() => {
    if (!romUrl) {
      setHasAutosave(false);
      setAutosaveTime(null);
      return;
    }
    const timeKey = `state_time_${draftId || 'standalone'}`;
    const storedTime = localStorage.getItem(timeKey);
    if (storedTime) {
      const key = `state_${draftId || 'standalone'}`;
      getStoredSave(key).then((bytes) => {
        if (bytes && bytes.length > 0) {
          setHasAutosave(true);
          try {
            const date = new Date(storedTime);
            setAutosaveTime(date.toLocaleTimeString());
          } catch {
            setAutosaveTime(storedTime);
          }
        }
      }).catch(() => {});
    }
  }, [romUrl, draftId]);

  // ── Other-player sidebar ─────────────────────────────────────────────────
  // Include current user and cap at 9
  const sidebarEntries = Object.entries(otherSaves)
    .sort(([, a], [, b]) => {
      const badgesA = a.save?.badge_count ?? 0;
      const badgesB = b.save?.badge_count ?? 0;
      return badgesB - badgesA;
    })
    .slice(0, 9);
  const hasSidebar = draftId !== undefined;

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
        {!romUrl ? (
          <div className="emulator-picker">
            <h1 className="emulator-title">GBA Emulator</h1>
            <p className="emulator-subtitle">
              Select a ROM of Pokemon Emerald from your device. The browser will then apply the v9.1 patch for Blitz automatically.
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
              {/* Tab key overlay for race standings */}
              {showOverlay && hasSidebar && (
                <div className="race-standings-overlay">
                  <div className="overlay-header">
                    <span className="overlay-title">Race Standings (Tab)</span>
                  </div>
                  <div className="overlay-content">
                    {sidebarEntries.map(([uid, { displayName, save }]) => {
                      const isCurrentUser = uid === currentUserId;
                      const saveData = isCurrentUser ? mySaveData : save;
                      const displayDisplayName = isCurrentUser ? (currentUsername || 'You') : displayName;

                      return (
                        <div key={uid} className="overlay-player-card">
                          <div className="overlay-player-header">
                            <span className="overlay-username">{displayDisplayName}</span>
                            <span className="overlay-badges">
                              {saveData ? `${saveData.badge_count} ${saveData.badge_count === 1 ? 'badge' : 'badges'}` : '— badges'}
                            </span>
                          </div>
                          {saveData ? (
                            <div className="overlay-mon-icons">
                              {sortPokemon(uid, [
                                ...(saveData.party ?? []).map((m: any) => ({ ...m, _isParty: true })),
                                ...(saveData.box ?? []).map((m: any) => ({ ...m, _isParty: false })),
                              ]).map((mon: any, i: number) => {
                                const speciesId = mon.species_id ?? mon.speciesId;
                                const speciesData = resolveMetadata(speciesId, mon.nickname);
                                const realName = (speciesId === 412 && mon.nickname?.toLowerCase() === 'egg') ? "Egg" : (speciesData?.name || `ID ${speciesId}`);
                                const iconName = getIconName(realName, speciesId);
                                const fainted = isMonFainted(uid, mon);

                                return (
                                  <img
                                    key={`overlay-icon-${i}`}
                                    src={`/MiniIcons/${iconName}.png`}
                                    alt={mon.nickname || realName}
                                    className={`overlay-mini-icon ${fainted ? 'fainted' : ''}`}
                                    style={fainted ? { filter: 'grayscale(100%)', opacity: 0.6 } : {}}
                                    title={`${realName}`}
                                    onError={(e) => { (e.target as HTMLImageElement).src = '/MiniIcons/question.png'; }}
                                  />
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
                  {hasAutosave && (
                    <button
                      className="autosave-btn"
                      onClick={handleLoadAutosave}
                    >
                      Load Autosave {autosaveTime ? `(${autosaveTime.replace(/\s*[aApP][mM]\s*$/, '')})` : ''}
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
                      const isTruncatedMatch = realName.toLowerCase().startsWith(mon.nickname.toLowerCase()) && mon.nickname.length >= 10;
                      const hasNickname = mon.nickname && mon.nickname.toLowerCase() !== realName.toLowerCase() && !isTruncatedMatch;

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
                            <div className="mon-ivs">
                              <span className="iv-item"><span className="iv-label">HP </span><span className="iv-value" data-good={mon.ivs.hp > 24} data-bad={mon.ivs.hp < 7}>{mon.ivs.hp}</span></span>
                              <span className="iv-item"><span className="iv-label">ATK </span><span className="iv-value" data-good={mon.ivs.atk > 24} data-bad={mon.ivs.atk < 7}>{mon.ivs.atk}</span></span>
                              <span className="iv-item"><span className="iv-label">DEF </span><span className="iv-value" data-good={mon.ivs.def > 24} data-bad={mon.ivs.def < 7}>{mon.ivs.def}</span></span>
                              <span className="iv-item"><span className="iv-label">SPA </span><span className="iv-value" data-good={mon.ivs.spa > 24} data-bad={mon.ivs.spa < 7}>{mon.ivs.spa}</span></span>
                              <span className="iv-item"><span className="iv-label">SPD </span><span className="iv-value" data-good={mon.ivs.spd > 24} data-bad={mon.ivs.spd < 7}>{mon.ivs.spd}</span></span>
                              <span className="iv-item"><span className="iv-label">SPE </span><span className="iv-value" data-good={mon.ivs.spe > 24} data-bad={mon.ivs.spe < 7}>{mon.ivs.spe}</span></span>
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
            {hasSidebar && (
              <aside className="emulator-sidebar">
                {sidebarEntries.map(([uid, { displayName, save }]) => {
                  const isCurrentUser = uid === currentUserId;
                  const saveData = isCurrentUser ? mySaveData : save;
                  const displayDisplayName = isCurrentUser ? (currentUsername || 'You') : displayName;

                  return (
                    <div key={uid} className="sidebar-player-card">
                      <div className="sidebar-player-header">
                        <span className="sidebar-username">{displayDisplayName}</span>
                        <span className="sidebar-badges">
                          {saveData ? `${saveData.badge_count} ${saveData.badge_count === 1 ? 'badge' : 'badges'}` : '— badges'}
                        </span>
                      </div>
                      {saveData ? (
                        <div className="sidebar-mon-icons">
                          {sortPokemon(uid, [
                            ...(saveData.party ?? []).map((m: any) => ({ ...m, _isParty: true })),
                            ...(saveData.box ?? []).map((m: any) => ({ ...m, _isParty: false })),
                          ]).map((mon: any, i: number) => {
                            const speciesId = mon.species_id ?? mon.speciesId;
                            const speciesData = resolveMetadata(speciesId, mon.nickname);
                            const realName = (speciesId === 412 && mon.nickname?.toLowerCase() === 'egg') ? "Egg" : (speciesData?.name || `ID ${speciesId}`);
                            const iconName = getIconName(realName, speciesId);
                            const abilityName = speciesData?.abilities?.[mon.ability_num] || 'Unknown';
                            const fainted = isMonFainted(uid, mon);
                            const isTruncatedMatch = realName.toLowerCase().startsWith(mon.nickname.toLowerCase()) && mon.nickname.length >= 10;
                            const hasNickname = mon.nickname && mon.nickname.toLowerCase() !== realName.toLowerCase() && !isTruncatedMatch;

                            return (
                              <img
                                key={`icon-${i}`}
                                src={`/MiniIcons/${iconName}.png`}
                                alt={mon.nickname || realName}
                                className={`sidebar-mini-icon ${fainted ? 'fainted' : ''}`}
                                style={fainted ? { filter: 'grayscale(100%)', opacity: 0.6 } : {}}
                                title={`${hasNickname ? `${mon.nickname} (${realName})` : realName} (${abilityName}) - (${mon.nature || 'Unknown'} Nature${mon.nature ? NATURE_EFFECTS[mon.nature] : ''})${mon.ivs ? `\nIVs: ${mon.ivs.hp}/${mon.ivs.atk}/${mon.ivs.def}/${mon.ivs.spa}/${mon.ivs.spd}/${mon.ivs.spe}` : ''}`}
                                onError={(e) => { (e.target as HTMLImageElement).src = '/MiniIcons/question.png'; }}
                              />
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
