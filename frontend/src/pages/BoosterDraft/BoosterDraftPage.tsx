import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Header from '../../shared/components/Header';
import { connectDraftWebSocket } from '../../shared/api/draftWebSocket';
import {
  becomeDraftSpectator,
  boosterSubmit,
  fetchCurrentUser,
  fetchDraftById,
  joinDraft,
  readyUpDraft,
  startDraft,
  updatePendingDraftSettings,
} from '../../shared/api/draftData';
import { fetchPokemonList } from '../../shared/api/pokemon';
import {
  BoosterAction,
  BoosterPoolSlot,
  ChatMessage,
  Draft,
  Pokemon,
  Team,
} from '../../types';
import PlayerRow from '../Auction/components/PlayerRow';
import AuctionChatBox from '../Auction/components/AuctionChatBox';
import CurrentPokemonPanel from '../Auction/components/CurrentPokemonPanel';
import AllPokemonTab from '../Auction/components/PokemonTablePanel/AllPokemonTab';
import TeamPlannerTab from '../Auction/components/PokemonTablePanel/TeamPlannerTab';
import TierListTab from '../Auction/components/PokemonTablePanel/TierListTab';
import PlayerSearchTab from '../Auction/components/PokemonTablePanel/PlayerSearchTab';
import BoosterPackGrid from './components/BoosterPackGrid';
import BoosterPackOrderTab from './components/BoosterPackOrderTab';
import BoosterMyTeamTab from './components/BoosterMyTeamTab';
import BoosterInfoPanel from './components/BoosterInfoPanel';
import { orderPacksForViewer } from './boosterPackOrder';
import { slotKey } from '../Draft1v1/components/OneVOnePool';
import '../Auction/AuctionPage.scss';
import '../Draft1v1/Draft1v1Page.scss';
import './BoosterDraftPage.scss';

function useDraftId() {
  return useLocation().search.replace(/^\?/, '');
}

function teamMatchesId(team: Team, id: string | null | undefined): boolean {
  return !!id && (team.user_id === id || team.guest_id === id);
}

const TAB_ALL = 'all';
const TAB_TEAM = 'team';
const TAB_HISTORY = 'history';
const TAB_STATS = 'stats';
const TAB_PLAYER = 'player-search';
const TAB_PACK_ORDER = 'pack-order';
const TAB_MY_TEAM = 'my-team';
const TAB_HOVER = 'hover';

/** Keep a viewer's own pending picks visible if a generic WS update arrives. */
function mergeViewerPending(updated: Draft, previous: Draft | null, viewerId: string | null): Draft {
  if (!viewerId || !updated.booster || !previous?.booster) return updated;
  if (updated.booster.round !== previous.booster.round) return updated;
  const nextBooster = {
    ...updated.booster,
    packs: updated.booster.packs.map((pack, packIndex) => ({
      ...pack,
      slots: pack.slots.map((slot, slotIndex) => {
        if (slot.status !== 'Available') return slot;
        const oldSlot = previous.booster!.packs[packIndex]?.slots[slotIndex];
        if (!oldSlot) return slot;
        const oldStatus = oldSlot.status;
        const isMine =
          typeof oldStatus === 'object' && oldStatus !== null &&
          (('Picked' in oldStatus && oldStatus.Picked === viewerId) ||
            ('Banned' in oldStatus && oldStatus.Banned === viewerId));
        return isMine ? { ...slot, status: oldSlot.status } : slot;
      }),
    })),
  };
  return { ...updated, booster: nextBooster };
}

const BoosterDraftPage: React.FC = () => {
  const draftId = useDraftId();
  const navigate = useNavigate();

  const [draft, setDraft] = useState<Draft | null>(null);
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
  const [becomingSpectator, setBecomingSpectator] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [showKickPlayerModal, setShowKickPlayerModal] = useState(false);
  const [selectedTeamIdsToRemove, setSelectedTeamIdsToRemove] = useState<string[]>([]);
  const [draftSettingsError, setDraftSettingsError] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<BoosterPoolSlot | null>(null);
  const [hoveredSlot, setHoveredSlot] = useState<BoosterPoolSlot | null>(null);
  const [markedSlots, setMarkedSlots] = useState<Set<string>>(() => new Set());
  const [tileSize, setTileSize] = useState(() => {
    const stored = Number(localStorage.getItem('eb-booster-tile-size'));
    return stored >= 52 && stored <= 114 ? stored : 72;
  });
  const [wsConnected, setWsConnected] = useState(true);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [allPokemon, setAllPokemon] = useState<Pokemon[]>([]);
  const [tab, setTab] = useState<string>(TAB_MY_TEAM);
  const [minimizedPokemon, setMinimizedPokemon] = useState<Set<string>>(new Set());

  useEffect(() => {
    document.body.classList.add('auction-page-active');
    return () => document.body.classList.remove('auction-page-active');
  }, []);

  useEffect(() => {
    if (!draftId) return;
    setLoading(true);
    fetchCurrentUser()
      .then((user) => {
        setCurrentUserId(user.user_id);
        setIsGuest(user.is_guest);
        setIsLoggedIn(!!user.user_id);
        return Promise.all([
          fetchDraftById(draftId),
          fetchPokemonList(),
        ] as [Promise<Draft>, Promise<Pokemon[]>]).then(([draftData, pokemon]) => ({ user, draftData, pokemon }));
      })
      .then(({ user, draftData, pokemon }) => {
        if (draftData.draft_type !== 'booster') {
          navigate(
            draftData.draft_type === '1v1'
              ? `/Draft1v1?${draftId}`
              : `/Auction?${draftId}`,
            { replace: true },
          );
          return;
        }
        setDraft(draftData);
        setAllPokemon(pokemon);
        const alreadyOnTeam = draftData.teams.some((team) => teamMatchesId(team, user.user_id));
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
      (updated) => setDraft((previous) => mergeViewerPending(updated, previous, currentUserId)),
      () => {},
      setWsConnected,
      (newChat) =>
        setChatMessages((previous) =>
          previous.some((message) => message.chat_id === newChat.chat_id)
            ? previous
            : [...previous, newChat],
        ),
    );
    return () => ws.close();
  }, [draftId, currentUserId]);

  const booster = draft?.booster ?? null;
  const isHost = !!draft && currentUserId === draft.host;
  const currentUserTeam = draft?.teams.find((team) => teamMatchesId(team, currentUserId));
  const myPack = booster?.packs.find((pack) => pack.holder_id === currentUserId) ?? null;
  const mySubmission = booster?.submissions.find((submission) => submission.user_id === currentUserId);
  const myAction: BoosterAction | null = !myPack
    ? null
    : !mySubmission?.has_picked
      ? 'Pick'
      : booster?.bans_enabled && !mySubmission.has_banned
        ? 'Ban'
        : null;
  const canAct = draft?.draft_state === 'BIDDING' && !!myPack && !!myAction && !submitting;

  const orderedTeams = useMemo<Team[]>(() => {
    if (!draft) return [];
    if (!booster) return draft.teams;
    return booster.player_ids
      .map((id) => draft.teams.find((team) => teamMatchesId(team, id)))
      .filter((team): team is Team => !!team);
  }, [draft, booster]);
  const orderedPacks = useMemo(
    () => booster ? orderPacksForViewer(booster.packs, booster.player_ids, currentUserId) : [],
    [booster, currentUserId],
  );
  const poolPokemon = useMemo<Pokemon[]>(
    () => booster?.packs.flatMap((pack) => pack.slots.map((slot) => slot.pokemon)) ?? [],
    [booster],
  );

  useEffect(() => {
    setSelectedSlot(null);
    setHoveredSlot(null);
  }, [booster?.round, myAction]);

  useEffect(() => {
    if (!booster || markedSlots.size === 0) return;
    const resolved = new Set(
      booster.packs
        .flatMap((pack) => pack.slots)
        .filter((slot) => slot.status !== 'Available')
        .map(slotKey),
    );
    setMarkedSlots((previous) => {
      const remaining = Array.from(previous).filter((key) => !resolved.has(key));
      return remaining.length === previous.size ? previous : new Set(remaining);
    });
  }, [booster, markedSlots.size]);

  const handleToggleMark = useCallback((slot: BoosterPoolSlot) => {
    const key = slotKey(slot);
    setMarkedSlots((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const handleToggleMinimize = (name: string) => {
    setMinimizedPokemon((previous) => {
      const next = new Set(previous);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const handleReadyUp = async () => {
    if (!draft) return;
    setReadyingUp(true);
    try {
      setDraft(await readyUpDraft(draft.draft_id));
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
      setDraft(await startDraft(draft.draft_id));
    } catch (e: any) {
      setError(e.response?.data || e.message);
    } finally {
      setStartingDraft(false);
    }
  };

  const handleBecomeSpectator = async () => {
    if (!draft) return;
    setBecomingSpectator(true);
    try {
      setDraft(await becomeDraftSpectator(draft.draft_id));
    } catch (e: any) {
      setError(e.response?.data || e.message);
    } finally {
      setBecomingSpectator(false);
    }
  };

  const handleSaveKickPlayer = async () => {
    if (!draft) return;
    setDraftSettingsError(null);
    try {
      setDraft(await updatePendingDraftSettings(
        draft.draft_id,
        draft.total_teams,
        draft.total_auctions,
        selectedTeamIdsToRemove,
      ));
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
      if (!isLoggedIn) {
        const user = await fetchCurrentUser();
        if (user.user_id) {
          setCurrentUserId(user.user_id);
          setIsGuest(user.is_guest);
          setIsLoggedIn(true);
        }
      }
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
    if (!isLoggedIn || isGuest) {
      setShowGuestConfirmModal(true);
      setShowJoinModal(false);
    } else {
      await attemptJoinDraft(joinPassword);
    }
  };

  const handleConfirm = async () => {
    if (!selectedSlot || !myAction || !draftId) return;
    const slot = selectedSlot;
    setSubmitting(true);
    setSelectedSlot(null);
    try {
      await boosterSubmit(
        draftId,
        myAction,
        slot.pokemon.pokedex_id ?? slot.pokemon.id,
        slot.pokemon.form || null,
      );
      setDraft(await fetchDraftById(draftId));
    } catch (e: any) {
      setError(e.response?.data || e.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="auction-page-shell" style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
        <Header />
        <main className="auction-page-main" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          Loading booster draft...
        </main>
      </div>
    );
  }

  if (!draftId || !draft) {
    return (
      <div className="auction-page-shell" style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
        <Header />
        <main className="auction-page-main" style={{ flex: 1 }}>{error || 'No draft found.'}</main>
      </div>
    );
  }

  const requiredTeams = draft.total_teams;
  const joinedTeams = draft.teams.length;
  const readyTeams = draft.teams.filter((team) => team.ready).length;
  const allTeamsReady = joinedTeams >= requiredTeams && readyTeams >= requiredTeams;
  // The confirm panel must only submit an explicitly selected slot. Hover is
  // reserved for the Current Hover tab so an accidental hover cannot submit a
  // different Pokémon than the one shown on the button.
  const selectedPokemon = selectedSlot?.pokemon ?? null;

  return (
    <div className="auction-page-shell" style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <Header />
      <main className="auction-main-layout booster-page">
        {error && <div style={{ color: 'red', padding: '8px' }}>{error}</div>}
        {!wsConnected && <div style={{ color: 'orange', padding: '8px' }}>Reconnecting…</div>}

        <div className="auction-top-row-wrapper">
          <PlayerRow
            teams={orderedTeams}
            numPlayers={requiredTeams}
            wsConnected={wsConnected}
            currentUserId={currentUserId}
            auctionCompleted={draft.draft_state === 'COMPLETED'}
            hideMoney
            positionColors={!!booster}
            positionIds={booster?.player_ids}
            equalWidth
          />
        </div>

        <div className="auction-content-grid">
          <div className="auction-left-panel booster-left-panel">
            {booster ? (
              <>
                <div className="booster-packs-grid">
                  {orderedPacks.map((pack) => (
                    <BoosterPackGrid
                      key={pack.pack_index}
                      pack={pack}
                      history={booster.history}
                      playerIds={booster.player_ids}
                      isMyPack={pack.holder_id === currentUserId}
                      canAct={canAct && pack.holder_id === currentUserId}
                      action={myAction}
                      selectedSlot={selectedSlot}
                      onSelect={setSelectedSlot}
                      onHover={setHoveredSlot}
                      markedSlots={markedSlots}
                      onToggleMark={handleToggleMark}
                      tileSize={tileSize}
                    />
                  ))}
                </div>
              </>
            ) : (
              <div className="booster-empty-state">Packs will appear here once the draft starts</div>
            )}

            <div className="pokemon-table-panel-outer">
              <div className="pokemon-table-tabs">
                <button className={tab === TAB_MY_TEAM ? 'active' : ''} onClick={() => setTab(TAB_MY_TEAM)}>My Team</button>
                <button className={tab === TAB_HOVER ? 'active' : ''} onClick={() => setTab(TAB_HOVER)}>Current Hover</button>
                <button className={tab === TAB_ALL ? 'active' : ''} onClick={() => setTab(TAB_ALL)}>All Pokémon</button>
                <button className={tab === TAB_TEAM ? 'active' : ''} onClick={() => setTab(TAB_TEAM)}>Team Planner</button>
                <button className={tab === TAB_HISTORY ? 'active' : ''} onClick={() => setTab(TAB_HISTORY)}>Draft History</button>
                <button className={tab === TAB_STATS ? 'active' : ''} onClick={() => setTab(TAB_STATS)}>Stats</button>
                <button className={tab === TAB_PLAYER ? 'active' : ''} onClick={() => setTab(TAB_PLAYER)}>Player Search</button>
                <button className={tab === TAB_PACK_ORDER ? 'active' : ''} onClick={() => setTab(TAB_PACK_ORDER)}>Pack Order</button>
                {booster && (
                  <label className="one-v-one-tile-size booster-tile-size-control">
                    <span>Tile size</span>
                    <input
                      type="range"
                      min="52"
                      max="114"
                      step="2"
                      value={tileSize}
                      onChange={(event) => {
                        const size = Number(event.target.value);
                        setTileSize(size);
                        localStorage.setItem('eb-booster-tile-size', String(size));
                      }}
                      aria-label="Booster tile size"
                    />
                  </label>
                )}
              </div>
              <div className="auction-pokemon-table-box">
                <div className="pokemon-table-tab-content">
                  {tab === TAB_MY_TEAM && (
                    <BoosterMyTeamTab
                      history={booster?.history ?? []}
                      packs={booster?.packs ?? []}
                      playerIds={booster?.player_ids ?? []}
                      currentUserId={currentUserId}
                      teamSize={booster?.team_size ?? 0}
                    />
                  )}
                  {tab === TAB_HOVER && (
                    <div className="one-v-one-hover-panel">
                      {(() => {
                        const p = hoveredSlot?.pokemon ?? selectedSlot?.pokemon;
                        if (!p) return <div className="one-v-one-info-prompt">Hover over a Pokémon to learn about it.</div>;
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
                  {tab === TAB_ALL && (
                    <AllPokemonTab pokemon={poolPokemon} auctions={[]} allPokemon={allPokemon.length > 0 ? allPokemon : poolPokemon} />
                  )}
                  {tab === TAB_TEAM && (
                    <TeamPlannerTab
                      teams={orderedTeams}
                      currentUserId={currentUserId}
                      allPokemon={allPokemon.length > 0 ? allPokemon : poolPokemon}
                      minimizedPokemon={minimizedPokemon}
                      onToggleMinimize={handleToggleMinimize}
                    />
                  )}
                  {tab === TAB_HISTORY && (
                    <div className="one-v-one-draft-history booster-draft-history" style={{ paddingTop: '1rem' }}>
                      <ul>
                        {(booster?.history ?? []).slice().reverse().map((entry, index) => {
                          const playerNumber = entry.player_id ? booster!.player_ids.indexOf(entry.player_id) + 1 : 0;
                          const owner = entry.player_id
                            ? orderedTeams.find((team) => teamMatchesId(team, entry.player_id))?.global_name
                              || orderedTeams.find((team) => teamMatchesId(team, entry.player_id))?.username
                              || `Player ${playerNumber}`
                            : null;
                          return (
                            <li key={`${entry.round}-${entry.pack_index}-${index}`} className={`one-v-one-history-row row-player-${playerNumber}`}>
                              <div style={{ display: 'flex', alignItems: 'center' }}>
                                <div style={{ width: '24px', display: 'flex', justifyContent: 'center', marginRight: '8px', flexShrink: 0 }}>
                                  <img
                                    src={`/MiniIcons/${entry.pokemon.name.toLowerCase()}.png`}
                                    alt={entry.pokemon.name}
                                    className="draft-history-pokemon-icon"
                                    onError={(event) => { event.currentTarget.style.visibility = 'hidden'; }}
                                  />
                                </div>
                                <div>
                                  <strong>{entry.pokemon.name}</strong>
                                  {entry.action === 'Leftover'
                                    ? ': Leftover'
                                    : `: ${owner} ${entry.action}`}
                                  {` (pack ${entry.pack_index + 1}, pass ${entry.round})`}
                                </div>
                              </div>
                            </li>
                          );
                        })}
                        {(!booster || booster.history.length === 0) && <li>No picks or bans yet.</li>}
                      </ul>
                    </div>
                  )}
                  {tab === TAB_STATS && <TierListTab />}
                  {tab === TAB_PLAYER && <PlayerSearchTab />}
                  {tab === TAB_PACK_ORDER && booster && (
                    <BoosterPackOrderTab playerIds={booster.player_ids} teamSize={booster.team_size} />
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="auction-right-panel">
            {draft.draft_state === 'COMPLETED' ? (
              <div className="draft-completed-panel">
                <h3 className="draft-completed-title">Draft Completed!</h3>
                <div className="draft-completed-buttons">
                  {currentUserTeam ? (
                    <button className="button" onClick={() => window.open(`/Emulator/${draft.draft_id}`, '_blank')}>
                      Play Emulator
                    </button>
                  ) : (
                    <button className="button" onClick={() => window.open(`/Spectate/${draft.draft_id}`, '_blank')}>
                      Spectate Race
                    </button>
                  )}
                </div>
              </div>
            ) : draft.draft_state === 'PENDING' ? (
              <div className="draft-completed-panel">
                <h3 className="draft-completed-title">
                  {currentUserTeam
                    ? currentUserTeam.ready
                      ? allTeamsReady ? 'Ready to Start!' : 'Waiting for others…'
                      : 'Ready Up!'
                    : 'Draft Pending...'}
                </h3>
                <div className="draft-completed-buttons">
                  {isHost && (
                    <>
                      <button className="button" onClick={handleStartDraft} disabled={startingDraft || !allTeamsReady}>
                        {startingDraft ? 'Starting Draft...' : 'Start Booster Draft'}
                      </button>
                      <button className="button" onClick={() => setShowKickPlayerModal(true)}>Kick Player</button>
                    </>
                  )}
                  {currentUserTeam && !currentUserTeam.ready && (
                    <button className="button ready-up-button" onClick={handleReadyUp} disabled={readyingUp}>
                      {readyingUp ? 'Readying Up...' : 'Ready Up'}
                    </button>
                  )}
                  {currentUserTeam && !currentUserTeam.ready && !isHost && (
                    <button className="button become-spectator-button" onClick={handleBecomeSpectator} disabled={becomingSpectator}>
                      {becomingSpectator ? 'Becoming Spectator...' : 'Become Spectator'}
                    </button>
                  )}
                </div>
              </div>
            ) : booster ? (
              <BoosterInfoPanel
                booster={booster}
                currentUserId={currentUserId}
                hasPack={!!myPack}
                selectedPokemon={selectedPokemon}
                canConfirm={canAct && !!selectedSlot}
                onConfirm={handleConfirm}
              />
            ) : null}

            <AuctionChatBox
              draftId={draft.draft_id}
              isGuest={isGuest}
              isLoggedIn={isLoggedIn}
              messages={chatMessages}
              onMessagesChange={setChatMessages}
              wsConnected={wsConnected}
            />
          </div>
        </div>

        {showJoinModal && (
          <div className="auction-password-modal-overlay">
            <div className="auction-password-modal" onClick={(event) => event.stopPropagation()}>
              <h3 className="auction-password-modal-title">Join As...</h3>
              {draft.has_password && (
                <input
                  className="auction-password-modal-input"
                  type="password"
                  value={joinPassword}
                  onChange={(event) => {
                    setJoinPassword(event.target.value);
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

        {showGuestConfirmModal && (
          <div className="auction-password-modal-overlay">
            <div className="auction-password-modal guest-confirm-modal" onClick={(event) => event.stopPropagation()}>
              <h3 className="auction-password-modal-title">Wait!</h3>
              <p className="auction-password-modal-text">
                It looks like you aren't logged in! Are you sure you want to draft as a guest? If you log in with Discord, this website will track your favorite picks and other stats!
              </p>
              {joinError && <div className="auction-password-modal-error">{joinError}</div>}
              <div className="auction-password-modal-actions">
                <button className="button" onClick={() => { setShowGuestConfirmModal(false); setShowJoinModal(true); }}>Back</button>
                <button className="button" onClick={() => { window.location.href = '/api/login'; }}>Log in via Discord</button>
                <button className="button" onClick={() => void attemptJoinDraft(joinPassword)} disabled={joiningDraft}>
                  Continue as Guest
                </button>
              </div>
            </div>
          </div>
        )}

        {showKickPlayerModal && (
          <div className="auction-password-modal-overlay">
            <div className="auction-password-modal" onClick={(event) => event.stopPropagation()}>
              <h3 className="auction-password-modal-title">Kick Player</h3>
              <div className="auction-settings-remove-teams">
                <div className="auction-settings-remove-teams-title">Kick Player</div>
                {draft.teams.filter((team) => team.user_id !== draft.host).length === 0 ? (
                  <div className="auction-settings-remove-teams-empty">No removable players joined.</div>
                ) : (
                  <div className="auction-settings-remove-teams-list">
                    {draft.teams
                      .filter((team) => team.user_id !== draft.host)
                      .map((team, index) => (
                        <label key={team.user_id ?? team.guest_id ?? index} className="auction-settings-remove-teams-item">
                          <input
                            type="checkbox"
                            checked={selectedTeamIdsToRemove.includes(team.user_id ?? '')}
                            onChange={() =>
                              setSelectedTeamIdsToRemove((previous) =>
                                previous.includes(team.user_id ?? '')
                                  ? previous.filter((id) => id !== team.user_id)
                                  : [...previous, team.user_id ?? ''],
                              )
                            }
                          />
                          <span>{team.global_name || team.username}</span>
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
      </main>
    </div>
  );
};

export default BoosterDraftPage;
