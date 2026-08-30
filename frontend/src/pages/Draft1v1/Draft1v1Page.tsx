import React, { useEffect, useRef, useState, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Header from '../../shared/components/Header';
import { connectDraftWebSocket } from '../../shared/api/draftWebSocket';
import {
  fetchDraftById,
  fetchCurrentUser,
  joinDraft,
  startDraft,
  pauseDraft,
  unpauseDraft,
  readyUpDraft,
  oneVOnePick,
  oneVOneBan,
  claimEeveelution,
  unclaimEeveelution,
  updatePendingDraftSettings,
  oneVOneToggleTimer,
} from '../../shared/api/draftData';
import { Draft, Pokemon, Team, OneVOnePoolSlot } from '../../types';
import { fetchPokemonList } from '../../shared/api/pokemon';
import PlayerRow from '../Auction/components/PlayerRow';
import AuctionChatBox from '../Auction/components/AuctionChatBox';
import EeveelutionClaimModal from '../Auction/components/EeveelutionClaimModal';
import CurrentPokemonPanel from '../Auction/components/CurrentPokemonPanel';
import AllPokemonTab from '../Auction/components/PokemonTablePanel/AllPokemonTab';
import TeamPlannerTab from '../Auction/components/PokemonTablePanel/TeamPlannerTab';
import TierListTab from '../Auction/components/PokemonTablePanel/TierListTab';
import PlayerSearchTab from '../Auction/components/PokemonTablePanel/PlayerSearchTab';
import OneVOnePool from './components/OneVOnePool';
import OneVOneInfoPanel from './components/OneVOneInfoPanel';
import '../Auction/AuctionPage.scss';
import './Draft1v1Page.scss';

function useDraftId() {
  const location = useLocation();
  return location.search.replace(/^\?/, '');
}

function memberIds(t: Team): (string | null | undefined)[] {
  return [t.user_id, t.guest_id];
}

function teamMatchesId(t: Team, id: string | null): boolean {
  return !!id && memberIds(t).includes(id);
}

const TAB_ALL = 'all';
const TAB_TEAM = 'team';
const TAB_HISTORY = 'history';
const TAB_STATS = 'stats';
const TAB_PLAYER = 'player-search';
const TAB_HOVER = 'hover';

const Draft1v1Page: React.FC = () => {
  const draftId = useDraftId();
  const navigate = useNavigate();

  const [draft, setDraft] = useState<Draft | null>(null);
  const [allPokemon, setAllPokemon] = useState<Pokemon[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [isGuest, setIsGuest] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showJoinModal, setShowJoinModal] = useState(false);
  const [showGuestConfirmModal, setShowGuestConfirmModal] = useState(false);
  const [joinPassword, setJoinPassword] = useState('');
  const [joinError, setJoinError] = useState<string | null>(null);
  const [joiningDraft, setJoiningDraft] = useState(false);
  const [startingDraft, setStartingDraft] = useState(false);
  const [readyingUp, setReadyingUp] = useState(false);
  const [pausingDraft, setPausingDraft] = useState(false);
  const [showKickPlayerModal, setShowKickPlayerModal] = useState(false);
  const [selectedTeamIdsToRemove, setSelectedTeamIdsToRemove] = useState<string[]>([]);
  const [draftSettingsError, setDraftSettingsError] = useState<string | null>(null);
  const [showEeveelutionModal, setShowEeveelutionModal] = useState(false);
  const [showEeveePopUp, setShowEeveePopUp] = useState(false);
  const eeveePopUpShownRef = useRef(false);
  const [tab, setTab] = useState<string>(TAB_HOVER);
  const [minimizedPokemon, setMinimizedPokemon] = useState<Set<string>>(new Set());
  const [wsConnected, setWsConnected] = useState(true);
  const [hasRefereeRole, setHasRefereeRole] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<OneVOnePoolSlot | null>(null);
  const [hoveredSlot, setHoveredSlot] = useState<OneVOnePoolSlot | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!draftId) return;
    setLoading(true);
    fetchCurrentUser()
      .then((user) => {
        setCurrentUserId(user.user_id);
        setIsGuest(user.is_guest);
        setIsLoggedIn(!!user.user_id);
        setHasRefereeRole(
          (user.roles ?? []).some((r) => r.role_name === 'Referee' || r.role_name === 'Admin') ||
          user.username === 'franklynathan' || user.username === 'jage04' || user.username === 'Jason' || user.username === 'mfrazz'
        );
        return Promise.all([fetchDraftById(draftId), fetchPokemonList()] as [Promise<Draft>, Promise<Pokemon[]>]).then(([draftData, allPkmn]) => ({ user, draftData, allPkmn }));
      })
      .then(({ user, draftData, allPkmn }) => {
        if (draftData.draft_type !== '1v1') {
          navigate(`/Auction?${draftId}`, { replace: true });
          return;
        }
        setDraft(draftData);
        setAllPokemon(allPkmn);
        const alreadyOnTeam = draftData.teams.some((t) => teamMatchesId(t, user.user_id));
        if (draftData.draft_state === 'PENDING' && !alreadyOnTeam) {
          setShowJoinModal(true);
        }
      })
      .catch((e) => setError(e.response?.data || e.message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftId]);

  useEffect(() => {
    if (!draftId) return;
    const ws = connectDraftWebSocket(
      draftId,
      (updated) => setDraft(updated),
      () => {},
      setWsConnected
    );
    wsRef.current = ws;
    return () => ws.close();
  }, [draftId]);

  useEffect(() => {
    document.body.classList.add('auction-page-active');
    return () => document.body.classList.remove('auction-page-active');
  }, []);

  const oneVOne = draft?.one_v_one;
  const isPaused = !!oneVOne?.paused_time_remaining;

  // Show the Eeveelution ban popup once the phase flips to true.
  useEffect(() => {
    if (oneVOne?.eeveelution_phase && !eeveePopUpShownRef.current) {
      eeveePopUpShownRef.current = true;
      setShowEeveePopUp(true);
    }
  }, [oneVOne?.eeveelution_phase]);

  // Clear any selected pokemon when the turn or phase changes.
  useEffect(() => {
    setSelectedSlot(null);
  }, [oneVOne?.current_player, oneVOne?.current_action, oneVOne?.eeveelution_phase]);

  const isHost = !!draft && currentUserId === draft.host;

  const currentUserTeam = draft?.teams.find((t) => teamMatchesId(t, currentUserId));

  const requiredTeams = 2;
  const joinedTeams = draft?.teams.length ?? 0;
  const readyTeams = draft?.teams.filter((t) => t.ready === true).length ?? 0;
  const allTeamsReady = joinedTeams >= requiredTeams && readyTeams >= requiredTeams;

  const orderedTeams = useMemo<Team[]>(() => {
    if (!draft) return [];
    if (!oneVOne) return draft.teams;
    const p1 = draft.teams.find((t) => teamMatchesId(t, oneVOne.player1));
    const p2 = draft.teams.find((t) => teamMatchesId(t, oneVOne.player2));
    return [p1, p2].filter((t): t is Team => !!t);
  }, [draft, oneVOne]);

  const currentPlayerIsMe = useMemo(() => {
    if (!oneVOne?.current_player || !currentUserTeam) return false;
    if (oneVOne.current_player === 'P1') return teamMatchesId(currentUserTeam, oneVOne.player1);
    if (oneVOne.current_player === 'P2') return teamMatchesId(currentUserTeam, oneVOne.player2);
    return false;
  }, [oneVOne, currentUserTeam]);

  const currentPlayerLabel = useMemo(() => {
    if (!oneVOne?.current_player) return null;
    const team = oneVOne.current_player === 'P1' ? orderedTeams[0] : orderedTeams[1];
    return team?.global_name || team?.username || oneVOne.current_player;
  }, [oneVOne, orderedTeams]);

  const highlightTeamId = useMemo(() => {
    if (!oneVOne?.current_player) return null;
    const team = oneVOne.current_player === 'P1' ? orderedTeams[0] : orderedTeams[1];
    return team?.user_id ?? team?.guest_id ?? null;
  }, [oneVOne, orderedTeams]);

  const poolPokemon = useMemo<Pokemon[]>(() => {
    return oneVOne?.pool.map((slot) => slot.pokemon) ?? [];
  }, [oneVOne]);

  const slotLabels = useMemo<Map<string, string>>(() => {
    const map = new Map<string, string>();
    if (!oneVOne) return map;
    let pick = 0;
    let ban = 0;
    for (const h of oneVOne.history) {
      const key = `${h.pokemon.pokedex_id}-${h.pokemon.form ?? ''}`;
      if (h.action === 'Pick') {
        pick += 1;
        map.set(key, `P${pick}`);
      } else {
        ban += 1;
        map.set(key, `B${ban}`);
      }
    }
    if (oneVOne.eeveelution_phase) {
      for (const slot of oneVOne.eeveelutions) {
        if (typeof slot.status === 'object' && slot.status !== null && 'Banned' in slot.status) {
          ban += 1;
          map.set(`${slot.pokemon.pokedex_id}-${slot.pokemon.form ?? ''}`, `B${ban}`);
        }
      }
    }
    return map;
  }, [oneVOne]);

  const handleReadyUp = async () => {
    if (!draft) return;
    setReadyingUp(true);
    try {
      const updated = await readyUpDraft(draft.draft_id);
      setDraft(updated);
    } catch (e: any) {
      setError(e.response?.data || e.message);
    } finally {
      setReadyingUp(false);
    }
  };

  const handleStartDraft = async () => {
    if (!draft) return;
    setStartingDraft(true);
    try {
      const updated = await startDraft(draft.draft_id);
      setDraft(updated);
    } catch (e: any) {
      setError(e.response?.data || e.message);
    } finally {
      setStartingDraft(false);
    }
  };

  const handleTogglePause = async () => {
    if (!draft) return;
    setPausingDraft(true);
    try {
      if (isPaused) await unpauseDraft(draft.draft_id);
      else await pauseDraft(draft.draft_id);
    } catch (e: any) {
      setError(e.response?.data || e.message);
    } finally {
      setPausingDraft(false);
    }
  };

  const handleToggleTimer = async () => {
    if (!draft) return;
    try {
      await oneVOneToggleTimer(draft.draft_id);
    } catch (e: any) {
      setError(e.response?.data || e.message);
    }
  };

  const handleSaveKickPlayer = async () => {
    if (!draft) return;
    setDraftSettingsError(null);
    try {
      const updated = await updatePendingDraftSettings(
        draft.draft_id,
        draft.total_teams ?? 2,
        draft.total_auctions ?? 30,
        selectedTeamIdsToRemove
      );
      setDraft(updated);
      setShowKickPlayerModal(false);
      setSelectedTeamIdsToRemove([]);
    } catch (e: any) {
      setDraftSettingsError(e.response?.data || e.message);
    }
  };

  const attemptJoinDraft = async (password?: string) => {
    if (!draftId) return;
    setJoiningDraft(true);
    setJoinError(null);
    try {
      const updatedDraft = await joinDraft(draftId, password);
      setDraft(updatedDraft);
      setShowJoinModal(false);
      setShowGuestConfirmModal(false);
      setJoinPassword('');
    } catch (err: any) {
      setJoinError(err?.response?.data?.error || err?.response?.data || err?.message || 'Failed to join draft.');
    } finally {
      setJoiningDraft(false);
    }
  };

  const handleRacerClick = async () => {
    if (!isLoggedIn) {
      setShowGuestConfirmModal(true);
      setShowJoinModal(false);
    } else {
      await attemptJoinDraft(joinPassword);
    }
  };

  const handlePick = async (slot: OneVOnePoolSlot) => {
    try {
      await oneVOnePick(draftId, slot.pokemon.pokedex_id ?? slot.pokemon.id, slot.pokemon.form || null);
    } catch (e: any) {
      setError(e.response?.data || e.message);
    }
  };

  const handleBan = async (slot: OneVOnePoolSlot) => {
    try {
      await oneVOneBan(draftId, slot.pokemon.pokedex_id ?? slot.pokemon.id, slot.pokemon.form || null);
    } catch (e: any) {
      setError(e.response?.data || e.message);
    }
  };

  const handleConfirmAction = async () => {
    if (!selectedSlot) return;
    const slot = selectedSlot;
    setSelectedSlot(null);
    if (oneVOne?.current_action === 'Ban') await handleBan(slot);
    else await handlePick(slot);
  };

  const handleClaimEeveelution = async (pokedexId: number, form: string | null, targetUserId?: string | null) => {
    if (!draft) return;
    await claimEeveelution(draft.draft_id, pokedexId, form, targetUserId);
    const updated = await fetchDraftById(draft.draft_id);
    setDraft(updated);
  };

  const handleUnclaimEeveelution = async (pokedexId: number, form: string | null, targetUserId?: string | null) => {
    if (!draft) return;
    await unclaimEeveelution(draft.draft_id, pokedexId, form, targetUserId);
    const updated = await fetchDraftById(draft.draft_id);
    setDraft(updated);
  };

  const handleToggleMinimize = (name: string) => {
    setMinimizedPokemon((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
        <Header />
        <main className="auction-page-main" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          Loading 1v1 draft...
        </main>
      </div>
    );
  }

  if (!draftId) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
        <Header />
        <main className="auction-page-main" style={{ flex: 1 }}>No draft ID provided.</main>
      </div>
    );
  }

  if (!draft) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
        <Header />
        <main className="auction-page-main" style={{ flex: 1 }}>{error || 'No draft found.'}</main>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <Header />
      <main className="auction-main-layout">
        {error && <div style={{ color: 'red', padding: '8px' }}>{error}</div>}
        {!wsConnected && <div style={{ color: 'orange', padding: '8px' }}>Reconnecting...</div>}

        {/* Top: Player boxes */}
        <div className="auction-top-row-wrapper">
          <PlayerRow
            teams={orderedTeams}
            numPlayers={requiredTeams}
            wsConnected={wsConnected}
            currentUserId={currentUserId}
            auctionCompleted={draft.draft_state === 'COMPLETED'}
            hideMoney
            positionColors={!!oneVOne}
            highlightId={highlightTeamId}
            equalWidth
          />
        </div>

        {/* Main content grid */}
        <div className="auction-content-grid">
          {/* Left: 1v1 Pool Container + tabs */}
          <div className="auction-left-panel">
            <div className="one-v-one-pool-container">
              {oneVOne && (
                <OneVOnePool
                  pool={oneVOne.pool}
                  history={oneVOne.history}
                  slotLabels={slotLabels}
                  currentPlayer={oneVOne.current_player}
                  currentAction={oneVOne.current_action}
                  isActive={draft.draft_state === 'BIDDING' && currentPlayerIsMe && !isPaused}
                  selectedSlot={selectedSlot}
                  onSelect={setSelectedSlot}
                  onHover={setHoveredSlot}
                />
              )}
              {oneVOne?.eeveelution_phase && oneVOne.eeveelutions.length > 0 && (
                <div className="one-v-one-pool-container-sub">
                  <OneVOnePool
                    pool={oneVOne.eeveelutions}
                    history={oneVOne.history}
                    slotLabels={slotLabels}
                    currentPlayer={oneVOne.current_player}
                    currentAction={oneVOne.current_action}
                    isActive={draft.draft_state === 'BIDDING' && currentPlayerIsMe && !isPaused}
                    selectedSlot={selectedSlot}
                    onSelect={setSelectedSlot}
                    onHover={setHoveredSlot}
                  />
                </div>
              )}
            </div>

            <div className="pokemon-table-panel-outer">
              <div className="pokemon-table-tabs">
                <button className={tab === TAB_HOVER ? 'active' : ''} onClick={() => setTab(TAB_HOVER)}>Current Hover</button>
                <button className={tab === TAB_ALL ? 'active' : ''} onClick={() => setTab(TAB_ALL)}>All Pokémon</button>
                <button className={tab === TAB_TEAM ? 'active' : ''} onClick={() => setTab(TAB_TEAM)}>Team Planner</button>
                <button className={tab === TAB_HISTORY ? 'active' : ''} onClick={() => setTab(TAB_HISTORY)}>Draft History</button>
                <button className={tab === TAB_STATS ? 'active' : ''} onClick={() => setTab(TAB_STATS)}>Stats</button>
                <button className={tab === TAB_PLAYER ? 'active' : ''} onClick={() => setTab(TAB_PLAYER)}>Player Search</button>
              </div>
              <div className="auction-pokemon-table-box">
                <div className="pokemon-table-tab-content">
                  {tab === TAB_HOVER && (
                    <div className="one-v-one-hover-panel">
                      {(() => {
                        const p = hoveredSlot?.pokemon ?? selectedSlot?.pokemon;
                        if (!p) return <div className="one-v-one-info-prompt">Hover over a Pokémon to inspect it.</div>;
                        const fakeAuction = {
                          auction_id: 'preview',
                          auction_state: 'PENDING',
                          pokemon: p,
                          highest_bid: 0,
                          highest_bidder: null,
                        } as any;
                        return <CurrentPokemonPanel current_auction={fakeAuction} all_pokemon={allPokemon.length > 0 ? allPokemon : poolPokemon} />;
                      })()}
                    </div>
                  )}
                  {tab === TAB_ALL && <AllPokemonTab pokemon={poolPokemon} auctions={[]} allPokemon={allPokemon.length > 0 ? allPokemon : poolPokemon} />}
                  {tab === TAB_TEAM && (
                    <TeamPlannerTab
                      teams={draft.teams}
                      currentUserId={currentUserId}
                      allPokemon={allPokemon.length > 0 ? allPokemon : poolPokemon}
                      minimizedPokemon={minimizedPokemon}
                      onToggleMinimize={handleToggleMinimize}
                    />
                  )}
                  {tab === TAB_HISTORY && (
                    <div className="one-v-one-draft-history" style={{ paddingTop: '1rem' }}>
                      <ul>
                        {(oneVOne?.history ?? []).slice().reverse().map((entry, idx) => (
                          <li key={idx} className={`one-v-one-history-row ${entry.player === 'P1' ? 'row-p1' : 'row-p2'}`}>
                            <div style={{ display: 'flex', alignItems: 'center' }}>
                              <div style={{ width: '24px', display: 'flex', justifyContent: 'center', marginRight: '8px', flexShrink: 0 }}>
                                <img
                                  src={`/MiniIcons/${entry.pokemon.name.toLowerCase()}.png`}
                                  alt={entry.pokemon.name}
                                  className="draft-history-pokemon-icon"
                                />
                              </div>
                              <div>
                                <strong>{entry.pokemon.name}</strong>: {entry.player} {entry.action}
                              </div>
                            </div>
                          </li>
                        ))}
                        {(!oneVOne || oneVOne.history.length === 0) && <li>No picks or bans yet.</li>}
                      </ul>
                    </div>
                  )}
                  {tab === TAB_STATS && <TierListTab />}
                  {tab === TAB_PLAYER && <PlayerSearchTab />}
                </div>
              </div>
            </div>
          </div>

          {/* Right: info panel / completed UI */}
          <div className="auction-right-panel">
            {draft.draft_state === 'COMPLETED' ? (
              <div className="draft-completed-panel">
                <h3 className="draft-completed-title">Draft Completed!</h3>
                <div className="draft-completed-buttons">
                  {currentUserTeam ? (
                    <>
                      <button className="button" onClick={() => setShowEeveelutionModal(true)}>Claim Eeveelution</button>
                      <button className="button" onClick={() => window.open(`/Emulator/${draft.draft_id}`, '_blank')}>Play Emulator</button>
                    </>
                  ) : (
                    <button className="button" onClick={() => window.open(`/Spectate/${draft.draft_id}`, '_blank')}>Spectate Race</button>
                  )}
                  {hasRefereeRole && draft.ranked && (
                    <button className="button" onClick={() => setShowEeveelutionModal(true)}>Submit Results</button>
                  )}
                </div>
              </div>
            ) : (
              <>
                {draft.draft_state === 'PENDING' && (
                  <div className="draft-completed-panel">
                    <h3 className="draft-completed-title">
                      {currentUserTeam
                        ? (currentUserTeam.ready ? (allTeamsReady ? 'Ready to Start!' : 'Waiting for others...') : 'Ready Up!')
                        : 'Draft Pending...'}
                    </h3>
                    <div className="draft-completed-buttons">
                      {isHost && (
                        <>
                          <button className="button" onClick={() => setShowKickPlayerModal(true)}>Kick Player</button>
                          <button className="button" onClick={handleStartDraft} disabled={startingDraft || !allTeamsReady}>
                            {startingDraft ? 'Starting Draft...' : 'Start 1v1 Draft'}
                          </button>
                        </>
                      )}
                      {currentUserTeam && !currentUserTeam.ready && (
                        <button className="button" onClick={handleReadyUp} disabled={readyingUp}>
                          {readyingUp ? 'Readying Up...' : 'Ready Up'}
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {draft.draft_state !== 'PENDING' && oneVOne && (
                  <OneVOneInfoPanel
                    draft_id={draft.draft_id}
                    isPaused={isPaused}
                    pauseActionPending={pausingDraft}
                    onTogglePause={handleTogglePause}
                    currentPlayerLabel={currentPlayerLabel}
                    currentPlayer={oneVOne.current_player}
                    currentAction={oneVOne.current_action}
                    isMyTurn={currentPlayerIsMe}
                    turnExpiresAt={oneVOne.turn_expires_at}
                    currentServerTime={draft.current_server_time}
                    pausedTimeRemaining={oneVOne.paused_time_remaining}
                    canPause={!!currentUserTeam}
                    timerEnabled={!!oneVOne.timer_enabled}
                    onToggleTimer={handleToggleTimer}
                    canToggleTimer={!!currentUserTeam}
                    turnLength={60}
                    selectedPokemon={selectedSlot?.pokemon ?? null}
                    canConfirm={draft.draft_state === 'BIDDING' && currentPlayerIsMe && !isPaused && !!selectedSlot}
                    onConfirm={handleConfirmAction}
                  />
                )}
                <AuctionChatBox draftId={draft.draft_id} isGuest={isGuest} isLoggedIn={isLoggedIn} />
              </>
            )}
          </div>
        </div>

        {/* Join modal */}
        {showJoinModal && (
          <div className="auction-password-modal-overlay">
            <div className="auction-password-modal" onClick={(e) => e.stopPropagation()}>
              <h3 className="auction-password-modal-title">Join As...</h3>
              {draft.has_password && (
                <input
                  className="auction-password-modal-input"
                  type="password"
                  value={joinPassword}
                  onChange={(e) => {
                    setJoinPassword(e.target.value);
                    if (joinError) setJoinError(null);
                  }}
                  placeholder="Password"
                  autoFocus
                />
              )}
              {joinError && <div className="auction-password-modal-error">{joinError}</div>}
              <div className="auction-password-modal-actions">
                <button className="button" onClick={() => setShowJoinModal(false)} disabled={joiningDraft}>Spectator</button>
                <button className="button" onClick={() => void handleRacerClick()} disabled={joiningDraft}>
                  {joiningDraft ? 'Joining...' : 'Player'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Guest confirm modal */}
        {showGuestConfirmModal && (
          <div className="auction-password-modal-overlay">
            <div className="auction-password-modal" onClick={(e) => e.stopPropagation()}>
              <h3 className="auction-password-modal-title">Wait!</h3>
              <p className="auction-password-modal-text">
                It looks like you aren't logged in! Are you sure you want to draft as a guest? If you log in with Discord, this website will track your favorite picks and other stats!
              </p>
              {joinError && <div className="auction-password-modal-error">{joinError}</div>}
              <div className="auction-password-modal-actions">
                <button className="button" onClick={() => { setShowGuestConfirmModal(false); setShowJoinModal(true); }}>Back</button>
                <button className="button" onClick={() => { window.location.href = '/api/login'; }}>Log in via Discord</button>
                <button className="button" onClick={() => void attemptJoinDraft(joinPassword)} disabled={joiningDraft}>
                  {joiningDraft ? 'Joining...' : 'Continue as Guest'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Kick Player modal */}
        {showKickPlayerModal && (
          <div className="auction-password-modal-overlay">
            <div className="auction-password-modal" onClick={(e) => e.stopPropagation()}>
              <h3 className="auction-password-modal-title">Kick Player</h3>
              <div className="auction-settings-remove-teams">
                <div className="auction-settings-remove-teams-title">Remove Joined Teams</div>
                {draft.teams.filter((t) => t.user_id !== draft.host).length === 0 ? (
                  <div className="auction-settings-remove-teams-empty">No removable players joined.</div>
                ) : (
                  <div className="auction-settings-remove-teams-list">
                    {draft.teams
                      .filter((t) => t.user_id !== draft.host)
                      .map((t, idx) => (
                        <label key={t.user_id ?? t.guest_id ?? idx} className="auction-settings-remove-teams-item">
                          <input
                            type="checkbox"
                            checked={selectedTeamIdsToRemove.includes(t.user_id ?? '')}
                            onChange={() =>
                              setSelectedTeamIdsToRemove((prev) =>
                                prev.includes(t.user_id ?? '') ? prev.filter((id) => id !== t.user_id) : [...prev, t.user_id ?? '']
                              )
                            }
                            disabled={false}
                          />
                          <span>{t.global_name || t.username}</span>
                        </label>
                      ))}
                  </div>
                )}
              </div>
              {draftSettingsError && <div className="auction-password-modal-error">{draftSettingsError}</div>}
              <div className="auction-password-modal-actions">
                <button className="button" onClick={() => { setShowKickPlayerModal(false); setSelectedTeamIdsToRemove([]); }}>Cancel</button>
                <button className="button" onClick={() => void handleSaveKickPlayer()}>Save</button>
              </div>
            </div>
          </div>
        )}

        {/* Eeveelution claim modal */}
        {showEeveelutionModal && (
          <EeveelutionClaimModal
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
            teams={draft.teams}
            currentUserId={currentUserId}
            isReferee={hasRefereeRole}
            bannedPokedexIds={oneVOne?.banned_eeveelutions ?? []}
            onClaim={handleClaimEeveelution}
            onUnclaim={handleUnclaimEeveelution}
            onClose={() => setShowEeveelutionModal(false)}
          />
        )}

        {/* Eeveelution-ban popup */}
        {showEeveePopUp && (
          <div className="auction-password-modal-overlay">
            <div className="auction-password-modal eevee-bans-modal" onClick={(e) => e.stopPropagation()}>
              <h3 className="auction-password-modal-title">Eeveelution Bans</h3>
              <p className="auction-password-modal-text">
                In Blitz, Eeveelutions are first come, first serve, and once a player gets one, no other player can use that Eeveelution.{' '}
                <strong>Also, in 1v1 Draft, each player gets to ban one Eeveelution which neither player will be able to choose.</strong>
              </p>
              <div className="auction-password-modal-actions">
                <button className="button eevee-bans-got-it" onClick={() => setShowEeveePopUp(false)}>Got it!</button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default Draft1v1Page;
