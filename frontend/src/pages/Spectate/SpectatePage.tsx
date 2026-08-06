import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import Header from '../../shared/components/Header';
import Footer from '../../shared/components/Footer';
import { getIconName, createResolveMetadata, isActuallyNicknamed } from '../../utils/speciesUtils';
import { SaveData } from '../../utils/parseSaveFile';
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

const SpectatePage: React.FC = () => {
  const { draftId } = useParams<{ draftId?: string }>();
  const [draft, setDraft] = useState<any>(null);
  const [playerSaves, setPlayerSaves] = useState<Record<string, PlayerSave>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pokemonMetadata, setPokemonMetadata] = useState<Record<string, any>>({});
  const [pokemonById, setPokemonById] = useState<Map<number, any[]>>(new Map());

  // Persist fainted state via Personality ID (User ID -> Set of PIDs)
  const [faintedPids, setFaintedPids] = useState<Record<string, Set<number>>>({});

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
            next[team.user_id] = {
              displayName: team.global_name?.trim() || team.username,
              save: prev[team.user_id]?.save ?? null,
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
          if (msg.type === 'SaveUpdate') {
            const { user_id, save_data } = msg.data as { user_id: string; save_data: any };
            setPlayerSaves((prev) => ({
              ...prev,
              [user_id]: { displayName: prev[user_id]?.displayName ?? user_id, save: save_data },
            }));
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
      if (!data?.party) return;
      if (!newFainted[uid]) newFainted[uid] = new Set();
      data.party.forEach(mon => {
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
        return badgesB - badgesA;
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
              <h1 className="spectate-title">Spectate Race</h1>
              <p className="spectate-subtitle">{draft.draft_name}</p>
            </div>

            <div className="spectate-grid">
              {playerEntries.length === 0 && (
                <p className="spectate-empty">No players have joined this draft yet.</p>
              )}
              {playerEntries.map(([uid, { displayName, save }]) => {
                // Detect wipe (InsideOfTruck) or win (LilycoveCity_LilycoveMuseum_1F)
                const isWiped = save?.map_name === 'InsideOfTruck';
                const isWinner = save?.map_name === 'LilycoveCity_LilycoveMuseum_1F';
                const mostRecentLossName = save?.most_recent_loss_name;

                return (
                  <div key={uid} className="spectate-player-card">
                    <div className="spectate-player-header">
                      <span className={`spectate-username ${isWiped ? 'wiped' : ''} ${isWinner ? 'winner' : ''}`}>
                        {displayName}
                        {isWiped && mostRecentLossName && (
                          <span className="wipe-text"> (Wiped to {mostRecentLossName})</span>
                        )}
                        {isWinner && mostRecentLossName && (
                          <span className="win-text"> (Beat {mostRecentLossName})</span>
                        )}
                      </span>
                      <span className="spectate-badges">
                        {save ? `${save.badge_count} ${save.badge_count === 1 ? 'badge' : 'badges'}` : '— badges'}
                      </span>
                    </div>
                    {save ? (
                      <div className="spectate-mon-icons">
                        {sortPokemon(uid, [
                          ...(save.party ?? []).map((m: any) => ({ ...m, _isParty: true })),
                          ...(save.box ?? []).map((m: any) => ({ ...m, _isParty: false })),
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
                            <span key={`icon-${i}`} className={`mini-icon-wrapper spectate ${isFirstFainted ? 'first-fainted' : ''}`}>
                              <img
                                src={`/MiniIcons/${iconName}.png`}
                                alt={mon.nickname || realName}
                                className={`spectate-mini-icon ${fainted ? 'fainted' : ''}`}
                                style={fainted ? { filter: 'grayscale(100%)', opacity: 0.6 } : {}}
                                title={`${hasNickname ? `${mon.nickname} (${realName})` : realName} (${abilityName}) - (${mon.nature || 'Unknown'} Nature${mon.nature ? NATURE_EFFECTS[mon.nature] : ''})${mon.ivs ? `\nIVs: ${mon.ivs.hp}/${mon.ivs.atk}/${mon.ivs.def}/${mon.ivs.spa}/${mon.ivs.spd}/${mon.ivs.spe}` : ''}`}
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
