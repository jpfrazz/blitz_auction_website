import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import Header from '../../shared/components/Header';
import Footer from '../../shared/components/Footer';
import { getIconName, createResolveMetadata, isActuallyNicknamed } from '../../utils/speciesUtils';
import { MOVES } from '../../utils/movesData';
import { SaveData, formatMapName } from '../../utils/parseSaveFile';
import { fetchDraftById } from '../../shared/api/draftData';
import { fetchPokemonList, fetchRentalPokemonList } from '../../shared/api/pokemon';
import './SpectatePage.scss';

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

type PlayerSave = { displayName: string; save: SaveData | null };

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

const SpectatePage: React.FC = () => {
  const { draftId } = useParams<{ draftId?: string }>();
  const [draft, setDraft] = useState<any>(null);
  const [playerSaves, setPlayerSaves] = useState<Record<string, PlayerSave>>({});
  // Live current-map names received via LocationUpdate broadcasts, keyed by
  // user id. Kept separate from the save so a player who closes their tab (and
  // whose last SaveUpdate we still hold) doesn't pin a frozen location.
  const [liveMaps, setLiveMaps] = useState<Record<string, string>>({});
  // Mirror of LocationUpdate's in_battle flag, keyed by user id, so spectators
  // can append "(In battle)" to a player's location.
  const [liveBattles, setLiveBattles] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pokemonMetadata, setPokemonMetadata] = useState<Record<string, any>>({});
  const [pokemonById, setPokemonById] = useState<Map<number, any[]>>(new Map());

  // Persist fainted state via Personality ID (User ID -> Set of PIDs)
  const [faintedPids, setFaintedPids] = useState<Record<string, Set<number>>>({});

  // Which players currently have a live emulator WebSocket open, plus anyone
  // we've ever seen connected, so a player who closes their tab shows up as
  // disconnected even if they never sent a save.
  const [connectedUsers, setConnectedUsers] = useState<Set<string>>(new Set());
  const [everConnectedUsers, setEverConnectedUsers] = useState<Set<string>>(new Set());
  // Set once the server's presence snapshot has been received so players don't
  // flash as disconnected for the instant before we know who's online.
  const [presenceLoaded, setPresenceLoaded] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectCountRef = useRef(0);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!draftId) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);

    fetchDraftById(draftId)
      .then((draft) => {
        if (cancelled) return;
        setDraft(draft);
        setPlayerSaves((prev) => {
          const next = { ...prev };
          for (const team of draft.teams) {
            const teamKey = team.user_id ?? team.guest_id ?? '';
            next[teamKey] = {
              // Preserve existing entry state across hydration.
              ...next[teamKey],
              displayName: team.global_name?.trim() || team.username || '',
              // Prefer the latest save the backend persisted for this team so a
              // finished player's data still shows after a page reload.
              save: team.save_data ?? prev[teamKey]?.save ?? null,
            };
          }
          return next;
        });
      })
      .catch(() => {
        if (cancelled) return;
        setLoadError('Could not load this draft. It may not exist.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [draftId]);

  // Load pokemon list to map species_id -> name for MiniIcons.
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetchPokemonList(),
      fetchRentalPokemonList(),
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
    }).catch(() => { });
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
            setPlayerSaves((prev) => ({
              ...prev,
              [user_id]: { displayName: prev[user_id]?.displayName ?? user_id, save: save_data },
            }));
          }
          // Lightweight live location ping from an emulator's heap read.
          if (msg.type === 'LocationUpdate') {
            const { user_id, map_name, in_battle } = msg.data as { user_id: string; map_name: string; in_battle?: boolean };
            setLiveMaps((prev) => ({ ...prev, [user_id]: map_name }));
            setLiveBattles((prev) => ({ ...prev, [user_id]: !!in_battle }));
          }
          if (msg.type === 'DraftUpdate') {
            const teams = (msg.data?.teams ?? []) as Array<{
              user_id: string;
              username: string;
              global_name?: string | null;
              save_data?: SaveData | null;
            }>;
            setPlayerSaves((prev) => {
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
        } catch {
          // ignore parse errors
        }
      };

      ws.onclose = (event) => {
        if (event.wasClean) return;

        if (reconnectCountRef.current < maxReconnectAttempts) {
          const delay = baseReconnectInterval * Math.pow(2, reconnectCountRef.current);
          reconnectTimeoutRef.current = setTimeout(() => {
            reconnectCountRef.current += 1;
            wsConnect();
          }, delay);
        }
      };
    };

    wsConnect();

    return () => {
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      if (wsRef.current) {
        wsRef.current.close(1000, 'closing socket');
        wsRef.current = null;
      }
    };
  }, [draftId]);

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

    Object.entries(playerSaves).forEach(([uid, entry]) => processSave(uid, entry.save));

    if (changed) setFaintedPids(newFainted);
  }, [playerSaves]);

  const isMonFainted = (uid: string, mon: any) => {
    if (mon.hp === 0) return true;
    const deadSet = faintedPids[uid];
    if (deadSet && deadSet.has(mon.personality)) return true;
    return false;
  };

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

  const playerEntries = useMemo(() => {
    return Object.entries(playerSaves)
      .sort(([, a], [, b]) => {
        const badgesA = a.save?.badge_count ?? 0;
        const badgesB = b.save?.badge_count ?? 0;
        if (badgesA !== badgesB) return badgesB - badgesA;
        // Tiebreaker: the player who obtained the current badge count at the
        // earliest in-game time (from their trainer card gym win) goes on top.
        // Players without a recorded time sort below everyone they're tied with.
        return badgeReachSeconds(a.save, badgesA) - badgeReachSeconds(b.save, badgesB);
      });
  }, [playerSaves]);

  return (
    <div className="spectate-page">
      <Header />
      <main className="spectate-main">
        {loading && <div className="spectate-status">Loading race...</div>}

        {!loading && loadError && (
          <div className="spectate-status">
            <p>{loadError}</p>
            <Link to="/LobbyViewer" className="button">Back to Lobby Viewer</Link>
          </div>
        )}

        {!loading && !loadError && draft && (
          <>
            <div className="spectate-header">
              <h1 className="spectate-title">Spectating</h1>
              <p className="spectate-subtitle">{draft.draft_name}</p>
            </div>

            <div className="spectate-grid">
              {playerEntries.length === 0 && (
                <p className="spectate-empty">No players have joined this draft yet.</p>
              )}
              {playerEntries.map(([uid, { displayName, save }]) => {
                // Live map from LocationUpdate beats the last flushed save's map.
                const currentMap = liveMaps[uid] ?? save?.map_name;
                // Detect wipe (InsideOfTruck) or win (champion trainer-card win)
                const isWiped = save?.map_name === 'InsideOfTruck';
                const mostRecentLossName = save?.most_recent_loss_name;
                const championName = getChampionName(save);
                // A player has "left the lobby" when they had joined the race
                // (saved a file, or we've seen them connect) but their emulator
                // WebSocket is no longer live. Only evaluated once the presence
                // snapshot arrives so nobody flashes at page load.
                const isDisconnected =
                  presenceLoaded &&
                  !connectedUsers.has(uid) &&
                  (save !== null || everConnectedUsers.has(uid));
                const showDisconnected = isDisconnected && !isWiped && !championName;

                return (
                  <div key={uid} className="spectate-player-card">
                    <div className="spectate-player-header">
                      <span className={`spectate-username ${showDisconnected ? 'disconnected' : ''} ${isWiped ? 'wiped' : ''} ${championName ? 'winner' : ''}`}>
                        <a
                          href={`/Stats?tab=player-search&userId=${encodeURIComponent(uid)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {displayName}
                        </a>
                      </span>
                      {isWiped && mostRecentLossName && (
                        <span className="wipe-text">(Wiped to {mostRecentLossName})</span>
                      )}
                      {championName && (
                        <span className="win-text">(Beat {championName}!)</span>
                      )}
                      {showDisconnected && (
                        <span className="disconnect-text">(Disconnected)</span>
                      )}
                      <span className="spectate-badges">
                        {save ? `${save.badge_count} ${save.badge_count === 1 ? 'badge' : 'badges'}` : '— badges'}
                      </span>
                    </div>
                    {currentMap && (
                      <div className="spectate-map" title={`${currentMap} (map)`}>
                        {formatMapName(currentMap)}
                        {liveBattles[uid] && <span className="in-battle-suffix"> (In battle)</span>}
                      </div>
                    )}
                    {save ? (
                      <div className="spectate-mon-icons">
                        {sortPokemon(uid, [
                          ...(save.party ?? []).map((m: any) => ({ ...m, _isParty: true })),
                          ...(save.box ?? []).map((m: any) => ({ ...m, _isParty: false })),
                        ]).map((mon: any, i: number) => {
                          const speciesId = mon.species_id ?? mon.speciesId;
                          const speciesData = resolveMetadata(speciesId, mon.nickname);
                          const realName = (speciesId === 412 && mon.nickname?.toLowerCase() === 'egg') ? "Egg" : (speciesData?.name || `ID ${speciesId}`);
                          const iconName = getIconName(realName, speciesId);
                          const abilityName = speciesData?.abilities?.[mon.ability_num] || 'Unknown';
                          const fainted = isMonFainted(uid, mon);
                          const hasNickname = isActuallyNicknamed(mon.nickname, speciesId, realName);

                          return (
                            <span key={`icon-${i}`} className="mini-icon-wrapper spectate">
                              <img
                                src={`/MiniIcons/${iconName}.png`}
                                alt={mon.nickname || realName}
                                className={`spectate-mini-icon ${fainted ? 'fainted' : ''}`}
                                style={fainted ? { filter: 'grayscale(100%)', opacity: 0.6 } : {}}
                                title={`${hasNickname ? `${mon.nickname} (${realName})` : realName} (${abilityName}) - ${mon.nature || 'Unknown'} Nature${mon.nature ? NATURE_EFFECTS[mon.nature] : ''}${mon.ivs ? `\nIVs: ${mon.ivs.hp}/${mon.ivs.atk}/${mon.ivs.def}/${mon.ivs.spa}/${mon.ivs.spd}/${mon.ivs.spe}` : ''}${mon.moves && mon.moves.some((id: number) => id > 0) ? `\nMoves: ${mon.moves.filter((id: number) => id > 0).map((id: number) => MOVES[id]?.name).filter(Boolean).join(', ')}` : ''}`}
                                onError={(e) => { (e.target as HTMLImageElement).src = '/MiniIcons/question.png'; }}
                              />
                            </span>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="spectate-no-save">Waiting for save…</p>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </main>
      <Footer />
    </div>
  );
};

export default SpectatePage;
