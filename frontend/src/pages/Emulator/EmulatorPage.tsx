import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import Header from '../../shared/components/Header';
import { parseSaveFile, SaveData } from '../../utils/parseSaveFile';
import { fetchCurrentUser, fetchDraftById } from '../../shared/api/draftData';
import { fetchPokemonList } from '../../shared/api/pokemon';
import './EmulatorPage.scss';

const getIconName = (name: string) => {
  if (!name || name === '???') return 'egg';
  const n = name.toLowerCase();
  if (n.startsWith('egg')) return 'egg';
  return n.replace(/é/g, 'e').replace(/[^a-z0-9]/g, '');
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
      gameManager?: { saveSaveFiles(): void };
    } | undefined;
    EJS_buttons: { [key: string]: boolean };
    EJS_Buttons?: { [key: string]: any };
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

// Map of user_id → latest parsed save for other draft players
type OtherPlayerSaves = Record<string, { displayName: string; save: SaveData | null }>;

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

  // Current logged-in user (to exclude self from sidebar)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  // Other players in the draft (populated via WebSocket)
  const [otherSaves, setOtherSaves] = useState<OtherPlayerSaves>({});
  const [pokemonNameById, setPokemonNameById] = useState<Record<number, string>>({});

  // Persist fainted state via Personality ID (User ID -> Set of PIDs)
  const [faintedPids, setFaintedPids] = useState<Record<string, Set<number>>>({});

  const fileInputRef = useRef<HTMLInputElement>(null);
  const objectUrlRef = useRef<string | null>(null);
  const scriptRef = useRef<HTMLScriptElement | null>(null);
  const syncIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  // Stable ref so window callbacks always see the latest handler
  const onRawSaveBytesRef = useRef<((bytes: Uint8Array) => void) | null>(null);

  // ── Fetch current user to filter self from sidebar ───────────────────────
  useEffect(() => {
    fetchCurrentUser().then((u) => {
      if (u.user_id) setCurrentUserId(u.user_id);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!draftId) return;
    let cancelled = false;
    fetchDraftById(draftId)
      .then((draft) => {
        if (cancelled) return;
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

  // Load pokemon list to map species_id -> name for MiniIcons
  useEffect(() => {
    let cancelled = false;
    fetchPokemonList().then((list) => {
      if (cancelled) return;
      const map: Record<number, string> = {};
      for (const p of list) {
        const id = (p.pokedex_id ?? p.id) as number;
        if (id) map[id] = (p.name || '').toString().toLowerCase();
      }
      setPokemonNameById(map);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    if (!draftId) return;

    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${protocol}://${window.location.host}/api/ws/${draftId}`);
    wsRef.current = ws;

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
      } catch {
        // ignore parse errors
      }
    };

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [draftId]);

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
      parsed = parseSaveFile(bytes);
    } catch {
      return;
    }
    setMySaveData(parsed);
    setSaveLastSynced(new Date());

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

    // Remove any leftover script from a previous load
    if (scriptRef.current) {
      scriptRef.current.remove();
      scriptRef.current = null;
    }

    // Intercept keyboard shortcuts for saving/loading (keys 1, 2, 3) and pause (Space)
    const blockShortcuts = (e: KeyboardEvent) => {
      if (['1', '2', '3', ' ', 'Fn', 'Function'].includes(e.key)) {
        e.stopImmediatePropagation();
      }
    };
    document.addEventListener('keydown', blockShortcuts, true);

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
      });
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
      scriptRef.current?.remove();
      scriptRef.current = null;
      window.EJS_ready = undefined;
      window.EJS_onGameStart = undefined;
      if (syncIntervalRef.current !== null) {
        clearInterval(syncIntervalRef.current);
        syncIntervalRef.current = null;
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

  // EmulatorJS owns the WASM runtime globally — the cleanest way to
  // load a different ROM is a full page reload to reset all state.
  const handleChangeRom = () => window.location.reload();

  // ── Other-player sidebar ─────────────────────────────────────────────────
  // Filter out the current user and cap at 9
  const otherEntries = Object.entries(otherSaves)
    .filter(([uid]) => uid !== currentUserId)
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
      <main className="emulator-main">
        {!romUrl ? (
          <div className="emulator-picker">
            <h1 className="emulator-title">GBA Emulator</h1>
            <p className="emulator-subtitle">
              Select a ROM of Pokemon Emerald from your device. The browser will then apply the v9.0 patch for Blitz automatically.
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
            <div className="emulator-col">
              <div className="emulator-top-bar">
                <span className="emulator-rom-label">{romName}</span>
                <button className="emulator-change-btn" onClick={handleChangeRom}>
                  Load Different ROM
                </button>
              </div>
              <div id="game" />

              {mySaveData && (
                <div className="save-panel own-save-panel">
                  <div className="save-panel-header">
                    <span className="save-panel-trainer">{mySaveData.trainer_name}</span>
                    <span className="save-panel-badges">
                      {mySaveData.badge_count} {mySaveData.badge_count === 1 ? 'badge' : 'badges'}
                    </span>
                    <span className="save-panel-money">₽{mySaveData.money.toLocaleString()}</span>
                    {saveLastSynced && (
                      <span className="save-panel-synced">
                        synced {saveLastSynced.toLocaleTimeString()}
                      </span>
                    )}
                  </div>
                  <div className="save-party-grid">
                    {sortPokemon(currentUserId || 'me', [
                      ...(mySaveData.party ?? []).map((m: any) => ({ ...m, _isParty: true })),
                      ...(mySaveData.box ?? []).map((m: any) => ({ ...m, _isParty: false })),
                    ]).map((mon: any, i: number) => {
                      const speciesId = mon.species_id ?? mon.speciesId;
                      const name = pokemonNameById[speciesId] || mon.nickname || '???';
                      const iconName = getIconName(name);
                      const fainted = isMonFainted(currentUserId || 'me', mon);

                      return (
                        <div key={`combined-${i}`} className={`save-mon-card${fainted ? ' fainted' : ''}`}>
                          <div className="mon-name-row">
                            <span className="mon-name" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                              {mon.nickname}
                              <img
                                src={`/MiniIcons/${iconName}.png`}
                                alt=""
                                style={{ width: '24px', height: '24px', imageRendering: 'pixelated' }}
                                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                              />
                            </span>
                            {mon._isParty && <span className="mon-level">Lv. {mon.level}</span>}
                          </div>
                          {mon.nature && <div className="mon-nature">{mon.nature}{NATURE_EFFECTS[mon.nature]}</div>}
                          {mon.ivs && (
                            <div className="mon-ivs" style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', fontSize: '0.8rem', marginTop: '4px', opacity: 0.8 }}>
                              <span style={{ color: mon.ivs.hp > 24 ? '#4ade80' : mon.ivs.hp < 8 ? '#f87171' : 'inherit', fontWeight: mon.ivs.hp > 24 ? '600' : 'normal' }}>HP: {mon.ivs.hp}</span>
                              <span style={{ color: mon.ivs.atk > 24 ? '#4ade80' : mon.ivs.atk < 8 ? '#f87171' : 'inherit', fontWeight: mon.ivs.atk > 24 ? '600' : 'normal' }}>ATK: {mon.ivs.atk}</span>
                              <span style={{ color: mon.ivs.def > 24 ? '#4ade80' : mon.ivs.def < 8 ? '#f87171' : 'inherit', fontWeight: mon.ivs.def > 24 ? '600' : 'normal' }}>DEF: {mon.ivs.def}</span>
                              <span style={{ color: mon.ivs.spa > 24 ? '#4ade80' : mon.ivs.spa < 8 ? '#f87171' : 'inherit', fontWeight: mon.ivs.spa > 24 ? '600' : 'normal' }}>SPA: {mon.ivs.spa}</span>
                              <span style={{ color: mon.ivs.spd > 24 ? '#4ade80' : mon.ivs.spd < 8 ? '#f87171' : 'inherit', fontWeight: mon.ivs.spd > 24 ? '600' : 'normal' }}>SPD: {mon.ivs.spd}</span>
                              <span style={{ color: mon.ivs.spe > 24 ? '#4ade80' : mon.ivs.spe < 8 ? '#f87171' : 'inherit', fontWeight: mon.ivs.spe > 24 ? '600' : 'normal' }}>SPE: {mon.ivs.spe}</span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* ── Right sidebar: other players ── */}
            {hasSidebar && (
              <aside className="emulator-sidebar">
                {otherEntries.map(([uid, { displayName, save }]) => (
                  <div key={uid} className="sidebar-player-card">
                    <div className="sidebar-player-header">
                      <span className="sidebar-username">{displayName}</span>
                      <span className="sidebar-badges">
                        {save ? `${save.badge_count} ${save.badge_count === 1 ? 'badge' : 'badges'}` : '— badges'}
                      </span>
                    </div>
                    {save ? (
                      <div className="sidebar-mon-icons">
                        {sortPokemon(uid, [
                          ...(save.party ?? []).map((m: any) => ({ ...m, _isParty: true })),
                          ...(save.box ?? []).map((m: any) => ({ ...m, _isParty: false })),
                        ]).map((mon: any, i: number) => {
                          const speciesId = mon.species_id ?? mon.speciesId;
                          const name = pokemonNameById[speciesId] || mon.nickname || '???';
                          const iconName = getIconName(name);
                          const fainted = isMonFainted(uid, mon);
                          return (
                            <img
                              key={`icon-${i}`}
                              src={`/MiniIcons/${iconName}.png`}
                              alt={mon.nickname || iconName}
                              className={`sidebar-mini-icon ${fainted ? 'fainted' : ''}`}
                              style={fainted ? { filter: 'grayscale(100%)', opacity: 0.6 } : {}}
                              title={`${mon.nickname} (${mon.nature || 'Unknown'} Nature${mon.nature ? NATURE_EFFECTS[mon.nature] : ''})${mon.ivs ? `\nIVs: ${mon.ivs.hp}/${mon.ivs.atk}/${mon.ivs.def}/${mon.ivs.spa}/${mon.ivs.spd}/${mon.ivs.spe}` : ''}`}
                              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                            />
                          );
                        })}
                      </div>
                    ) : (
                      <p className="sidebar-no-save">Waiting for save…</p>
                    )}
                  </div>
                ))}
              </aside>
            )}
          </div>
        )}
      </main>
    </div>
  );
};

export default EmulatorPage;
