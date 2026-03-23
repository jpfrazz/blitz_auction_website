import React, { useEffect, useState, useRef } from 'react';
import { CSSTransition } from 'react-transition-group';
import { connectDraftWebSocket } from '../../shared/api/draftWebSocket';
import { useLocation } from 'react-router-dom';
import Header from '../../shared/components/Header';
import { fetchDraftById, fetchDraftPokemon, fetchDraftCurrentAuction, readyUpDraft, joinDraft, fetchCurrentUser, claimEeveelution, unclaimEeveelution, startDraft, pauseDraft, unpauseDraft, submitRaceResults, updatePendingDraftSettings } from '../../shared/api/draftData';
import { getUserId } from '../../shared/utils/user';
import './AuctionPage.scss';
import '../../shared/style/theme.scss';
import PlayerRow from './components/PlayerRow';
import CurrentPokemonPanel from './components/CurrentPokemonPanel';
import AuctionInfoPanel from './components/AuctionInfoPanel';
import AuctionChatBox from './components/AuctionChatBox';
import AuctionStatsPanel from './components/AuctionStatsPanel';
import PokemonTablePanel from './components/PokemonTablePanel/PokemonTablePanel';
import EeveelutionClaimModal from './components/EeveelutionClaimModal';
import ResultsSubmissionModal from './components/ResultsSubmissionModal';
import { Draft, Auction, Pokemon } from '../../types';
import confetti from 'canvas-confetti';

const AUCTION_ALERT_SOUND_PATH = encodeURI('/14 Battle! (Wild Pokémon).mp3');
const AUCTION_ALERT_SOUND_MUTED_KEY = 'auction_alert_sound_muted';
const AUCTION_ALERT_SOUND_MUTED_EVENT = 'auction-alert-muted-changed';
const AUCTION_ALERT_VOLUME = 0.1;

function useAuctionId() {
  const location = useLocation();
  return location.search.replace(/^\?/, '');
}

const AuctionPage: React.FC = () => {
  const auctionId = useAuctionId();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [currentAuction, setCurrentAuction] = useState<Auction | null>(null);
  const [pokemon, setPokemon] = useState<Pokemon[]>([]);
  const [loading, setLoading] = useState(false);
  const [startingDraft, setStartingDraft] = useState(false);
  const [readyingUp, setReadyingUp] = useState(false);
  const [pausingDraft, setPausingDraft] = useState(false);
  const [joiningDraft, setJoiningDraft] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [isGuest, setIsGuest] = useState(false);
  const [hasRefereeRole, setHasRefereeRole] = useState(false);
  const [showJoinModal, setShowJoinModal] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [joinPassword, setJoinPassword] = useState('');
  const [joinError, setJoinError] = useState<string | null>(null);
  const [showEeveelutionModal, setShowEeveelutionModal] = useState(false);
  const [showResultsSubmissionModal, setShowResultsSubmissionModal] = useState(false);
  const [avatar, setAvatar] = useState<string | undefined>(undefined);
  const [wsConnected, setWsConnected] = useState(true);
  const [isAuctionSoundMuted, setIsAuctionSoundMuted] = useState<boolean>(() => {
    if (typeof window === 'undefined') {
      return true;
    }

    return localStorage.getItem(AUCTION_ALERT_SOUND_MUTED_KEY) !== 'false';
  });
  const [showDraftSettingsModal, setShowDraftSettingsModal] = useState(false);
  const [pendingNumTeams, setPendingNumTeams] = useState('');
  const [pendingNumAuctions, setPendingNumAuctions] = useState('');
  const [selectedTeamIdsToRemove, setSelectedTeamIdsToRemove] = useState<string[]>([]);
  const [savingDraftSettings, setSavingDraftSettings] = useState(false);
  const [draftSettingsError, setDraftSettingsError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const auctionAlertAudioRef = useRef<HTMLAudioElement | null>(null);
  const auctionAlertStopTimerRef = useRef<number | null>(null);
  const previousAuctionIdRef = useRef<string | null>(null);
  const prevCompletedAuctionsLengthRef = useRef<number | null>(null);
  const hasInitializedAuctionTrackingRef = useRef(false);
  const pokemonPanelRef = useRef<HTMLDivElement>(null);

  const [lastKnownAuction, setLastKnownAuction] = useState<Auction | null>(null);

  useEffect(() => {
    if (currentAuction) {
      setLastKnownAuction(currentAuction);
    }
  }, [currentAuction]);

  useEffect(() => {
    document.body.classList.add('auction-page-active');
    // Cleanup function to remove the class when the component unmounts
    return () => {
      document.body.classList.remove('auction-page-active');

      if (auctionAlertStopTimerRef.current) {
        window.clearTimeout(auctionAlertStopTimerRef.current);
        auctionAlertStopTimerRef.current = null;
      }

      if (auctionAlertAudioRef.current) {
        auctionAlertAudioRef.current.pause();
        auctionAlertAudioRef.current = null;
      }
    };
  }, []); // The empty array ensures this runs only once on mount and cleanup on unmount

  useEffect(() => {
    const handleMutedChanged = (event: Event) => {
      const customEvent = event as CustomEvent<boolean>;
      if (typeof customEvent.detail === 'boolean') {
        setIsAuctionSoundMuted(customEvent.detail);
      }
    };

    window.addEventListener(AUCTION_ALERT_SOUND_MUTED_EVENT, handleMutedChanged as EventListener);

    return () => {
      window.removeEventListener(AUCTION_ALERT_SOUND_MUTED_EVENT, handleMutedChanged as EventListener);
    };
  }, []);

  const playAuctionStartAlert = async () => {
    if (!auctionAlertAudioRef.current) {
      auctionAlertAudioRef.current = new Audio(AUCTION_ALERT_SOUND_PATH);
      auctionAlertAudioRef.current.preload = 'auto';
    }

    const audio = auctionAlertAudioRef.current;
    audio.volume = AUCTION_ALERT_VOLUME;

    if (auctionAlertStopTimerRef.current) {
      window.clearTimeout(auctionAlertStopTimerRef.current);
      auctionAlertStopTimerRef.current = null;
    }

    audio.currentTime = 0;

    try {
      await audio.play();
    } catch {
      return;
    }

    auctionAlertStopTimerRef.current = window.setTimeout(() => {
      audio.pause();
      audio.currentTime = 0;
      auctionAlertStopTimerRef.current = null;
    }, 2000);
  };

  useEffect(() => {
    const currentAuctionId = currentAuction?.auction_id ?? null;

    if (!hasInitializedAuctionTrackingRef.current) {
      hasInitializedAuctionTrackingRef.current = true;
      previousAuctionIdRef.current = currentAuctionId;
      return;
    }

    const isNewAuction = currentAuctionId !== null
      && previousAuctionIdRef.current !== currentAuctionId;

    if (isNewAuction && !isAuctionSoundMuted) {
      void playAuctionStartAlert();
    }

    previousAuctionIdRef.current = currentAuctionId;
  }, [currentAuction?.auction_id, isAuctionSoundMuted]);

  useEffect(() => {
    if (!draft) return;

    const currentLength = draft.completed_auctions.length;

    if (prevCompletedAuctionsLengthRef.current === null) {
      prevCompletedAuctionsLengthRef.current = currentLength;
      return;
    }

    if (currentLength > prevCompletedAuctionsLengthRef.current) {
      const newAuctions = draft.completed_auctions.slice(prevCompletedAuctionsLengthRef.current);
      newAuctions.forEach(auction => {
        if (getUserId(auction.highest_bidder) === currentUserId) {
          confetti({
            particleCount: 100,
            spread: 70,
            origin: { y: 0.6 },
            zIndex: 1500,
          });
        }
      });
      prevCompletedAuctionsLengthRef.current = currentLength;
    }
  }, [draft?.completed_auctions, currentUserId]);

  const connectWebSocket = (draftId: string) => {
    if (wsRef.current) {
      wsRef.current.close();
    }
    wsRef.current = connectDraftWebSocket(draftId, setDraft, setCurrentAuction, setWsConnected);
  };

  const attemptJoinDraft = async (password?: string) => {
    if (!auctionId) return;

    setJoiningDraft(true);
    setJoinError(null);

    try {
      const updatedDraft = await joinDraft(auctionId, password);
      if(!isLoggedIn) {
        fetchCurrentUser()
          .then(user => {
            setCurrentUserId(user.user_id);
            setIsGuest(user.is_guest);
            setHasRefereeRole((user.roles ?? []).some((role) => role.role_name === 'Referee'));
            setIsLoggedIn(true);
          })
      }
      setDraft(updatedDraft);
      setShowJoinModal(false);
      setJoinPassword('');
    } catch (error: any) {
      setJoinError(error?.response?.data?.error || error?.message || 'Failed to join draft.');
    } finally {
      setJoiningDraft(false);
    }
  };

  useEffect(() => {
    if (!auctionId) return;

    setLoading(true);
    fetchCurrentUser()
      .then(user => {
        setCurrentUserId(user.user_id);
        setIsGuest(user.is_guest);
        setHasRefereeRole((user.roles ?? []).some((role) => role.role_name === 'Referee'));
        setIsLoggedIn(!!user.user_id);
        if(!user.is_guest) {
          setAvatar(user.avatar)
        }
        return Promise.all([
            fetchDraftById(auctionId),
            fetchDraftPokemon(auctionId),
            fetchDraftCurrentAuction(auctionId)
        ]).then(([draftData, pokemonData, current_auction]) => ({ user, draftData, pokemonData, current_auction }));
      })
      .then(({ user, draftData, pokemonData, current_auction }) => {
        setDraft(draftData);
        setCurrentAuction(current_auction);
        setPokemon(pokemonData);
        console.log('Fetched draft data:', draftData);
        connectWebSocket(auctionId);
        const alreadyOnTeam = draftData.teams.some(team => team.user_id === user.user_id);
        if (draftData.draft_state === 'PENDING' && !alreadyOnTeam) {
          setShowJoinModal(true)
        }
      })
      .catch(error => console.error('Error fetching draft on initial load:', error))
      .finally(() => setLoading(false));

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [auctionId]);

  const handleReadyUp = async () => {
    if (!draft) return;
    setReadyingUp(true);
    try {
      const updated = await readyUpDraft(draft.draft_id);
      setDraft(updated);
    } catch (error) {
      console.error('Error readying up:', error);
    } finally {
      setReadyingUp(false);
    }
  };

  const handleStartDraft = async () => {
    if (!draft) return;
    const requiredTeams = Number(draft.total_teams ?? 0);
    const joinedTeams = draft.teams.length;
    const readyTeams = draft.teams.filter(team => team.ready === true).length;
    const canStart = requiredTeams > 0 && joinedTeams >= requiredTeams && readyTeams >= requiredTeams;
    if (!canStart) return;
    setStartingDraft(true);
    try {
      const updated = await startDraft(draft.draft_id);
      setDraft(updated);
    } catch (error) {
      console.error('Error starting draft:', error);
    } finally {
      setStartingDraft(false);
    }
  };

  const auctionState = (currentAuction as any)?.state || (currentAuction as any)?.auction_state;
  const isDraftPaused = draft
    ? (auctionState === 'PAUSED'
      || (typeof auctionState === 'object' && auctionState !== null && 'PAUSED' in auctionState))
    : false;

  const handleTogglePauseDraft = async () => {
    if (!draft) return;
    setPausingDraft(true);
    try {
      if (isDraftPaused) {
        await unpauseDraft(draft.draft_id);
      } else {
        await pauseDraft(draft.draft_id);
      }
    } catch (error) {
      console.error('Error toggling pause:', error);
    } finally {
      setPausingDraft(false);
    }
  };

  const currentUserTeam = draft?.teams.find(team => team.user_id === currentUserId);
  const currentUserReady = Boolean(currentUserTeam?.ready);
  const requiredTeams = Number(draft?.total_teams ?? 0);
  const joinedTeams = draft?.teams.length ?? 0;
  const readyTeams = draft?.teams.filter(team => team.ready === true).length ?? 0;
  const allTeamsReady = Boolean(
    draft && requiredTeams > 0 && joinedTeams >= requiredTeams && readyTeams >= requiredTeams
  );

  const handleClaimEeveelution = async (pokedexId: number, form: string | null) => {
    if (!draft) return;
    try {
      await claimEeveelution(draft.draft_id, pokedexId, form);
      // Refresh draft data
      const updated = await fetchDraftById(draft.draft_id);
      setDraft(updated);
    } catch (error) {
      console.error('Error claiming eeveelution:', error);
      throw error;
    }
  };

  const handleUnclaimEeveelution = async (pokedexId: number, form: string | null) => {
    if (!draft) return;
    try {
      await unclaimEeveelution(draft.draft_id, pokedexId, form);
      const updated = await fetchDraftById(draft.draft_id);
      setDraft(updated);
    } catch (error) {
      console.error('Error unclaiming eeveelution:', error);
      throw error;
    }
  };

  const handleOpenDraftSettings = () => {
    if (!draft) return;
    setPendingNumTeams(String(draft.total_teams));
    setPendingNumAuctions(String(draft.total_auctions));
    setSelectedTeamIdsToRemove([]);
    setDraftSettingsError(null);
    setShowDraftSettingsModal(true);
  };

  const handleSaveDraftSettings = async () => {
    if (!draft) return;

    const nextNumTeams = Number(pendingNumTeams);
    const nextNumAuctions = Number(pendingNumAuctions);

    if (!Number.isInteger(nextNumTeams) || nextNumTeams <= 0) {
      setDraftSettingsError('Number of teams must be a positive whole number.');
      return;
    }

    if (!Number.isInteger(nextNumAuctions) || nextNumAuctions <= 0) {
      setDraftSettingsError('Total auctions must be a positive whole number.');
      return;
    }

    setSavingDraftSettings(true);
    setDraftSettingsError(null);

    try {
      const updatedDraft = await updatePendingDraftSettings(
        draft.draft_id,
        nextNumTeams,
        nextNumAuctions,
        selectedTeamIdsToRemove,
      );
      setDraft(updatedDraft);
      setSelectedTeamIdsToRemove([]);
      setShowDraftSettingsModal(false);
    } catch (error: any) {
      setDraftSettingsError(error?.response?.data || error?.message || 'Failed to update draft settings.');
    } finally {
      setSavingDraftSettings(false);
    }
  };

  const handlePendingNumTeamsChange = (value: string) => {
    setPendingNumTeams(value);

    if (value.trim() === '') {
      setPendingNumAuctions('');
      return;
    }

    const parsedTeams = Number(value);
    if (!Number.isFinite(parsedTeams)) {
      return;
    }

    setPendingNumAuctions(String(parsedTeams * 8));
  };

  const toggleTeamRemoval = (teamId: string) => {
    setSelectedTeamIdsToRemove((prev) => {
      if (prev.includes(teamId)) {
        return prev.filter((id) => id !== teamId);
      }

      return [...prev, teamId];
    });
  };

  const handleSubmitResults = async (placements: Record<string, number>) => {
    if (!draft) {
      throw new Error('Draft not loaded');
    }

    await submitRaceResults(draft.draft_id, placements);
  };

  const showCurrentPokemon = Boolean(draft && currentAuction && draft.draft_state !== 'COMPLETED');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <Header />
      <main className="auction-main-layout">
        {loading && <div>Loading draft...</div>}
        {!loading && draft && (
          <>
            {showJoinModal && (
              <div className="auction-password-modal-overlay">
                <div className="auction-password-modal" onClick={e => e.stopPropagation()}>
                  <h3 className="auction-password-modal-title">Join As...</h3>
                  {draft.has_password && (
                    <input
                      className="auction-password-modal-input"
                      type="password"
                      value={joinPassword}
                      onChange={e => {
                        setJoinPassword(e.target.value);
                        if (joinError) {
                          setJoinError(null);
                        }
                      }}
                      placeholder="Password"
                      autoFocus
                    />
                  )}
                  {joinError && <div className="auction-password-modal-error">{joinError}</div>}
                  <div className="auction-password-modal-actions">
                      <button
                        className="button"
                        onClick={() => {
                          setShowJoinModal(false);
                          setJoinError(null);
                        }}
                        disabled={joiningDraft}
                      >
                        Spectator
                      </button>
                    <button
                      className="button"
                      onClick={() => attemptJoinDraft(joinPassword)}
                      disabled={joiningDraft}
                    >
                      {joiningDraft ? 'Joining...' : 'Racer'}
                    </button>
                  </div>
                </div>
              </div>
            )}
            {showDraftSettingsModal && draft && (
              <div className="auction-password-modal-overlay">
                <div className="auction-password-modal" onClick={e => e.stopPropagation()}>
                  <h3 className="auction-password-modal-title">Edit Pending Draft Settings</h3>
                  <div className="auction-settings-field-row">
                    <label className="auction-settings-field-label">
                      Number of Teams
                      <input
                        className="auction-password-modal-input"
                        type="number"
                        min={1}
                        value={pendingNumTeams}
                        onChange={(e) => handlePendingNumTeamsChange(e.target.value)}
                        disabled={savingDraftSettings}
                      />
                    </label>
                    <label className="auction-settings-field-label">
                      Total Pokemon
                      <input
                        className="auction-password-modal-input"
                        type="number"
                        min={1}
                        value={pendingNumAuctions}
                        onChange={(e) => setPendingNumAuctions(e.target.value)}
                        disabled={savingDraftSettings}
                      />
                    </label>
                  </div>
                  <div className="auction-settings-remove-teams">
                    <div className="auction-settings-remove-teams-title">Remove Joined Teams</div>
                    {draft.teams.filter((team) => team.user_id !== draft.host).length === 0 ? (
                      <div className="auction-settings-remove-teams-empty">No removable teams joined.</div>
                    ) : (
                      <div className="auction-settings-remove-teams-list">
                        {draft.teams
                          .filter((team) => team.user_id !== draft.host)
                          .map((team) => (
                            <label key={team.user_id} className="auction-settings-remove-teams-item">
                              <input
                                type="checkbox"
                                checked={selectedTeamIdsToRemove.includes(team.user_id)}
                                onChange={() => toggleTeamRemoval(team.user_id)}
                                disabled={savingDraftSettings}
                              />
                              <span>{team.username}</span>
                            </label>
                          ))}
                      </div>
                    )}
                  </div>
                  {draftSettingsError && <div className="auction-password-modal-error">{draftSettingsError}</div>}
                  <div className="auction-password-modal-actions">
                    <button
                      className="button"
                      onClick={() => {
                        setShowDraftSettingsModal(false);
                        setSelectedTeamIdsToRemove([]);
                        setDraftSettingsError(null);
                      }}
                      disabled={savingDraftSettings}
                    >
                      Cancel
                    </button>
                    <button
                      className="button"
                      onClick={handleSaveDraftSettings}
                      disabled={savingDraftSettings}
                    >
                      {savingDraftSettings ? 'Saving...' : 'Save'}
                    </button>
                  </div>
                </div>
              </div>
            )}
            {/* Top: Player boxes */}
            <div className="auction-top-row-wrapper">
              <PlayerRow
                teams={draft.teams}
                numPlayers={draft.teams.length}
                highestBidderId={currentAuction ? getUserId(currentAuction.highest_bidder) : null}
                wsConnected={wsConnected}
              />
            </div>
            {/* Main content grid */}
            <div className="auction-content-grid">
              {/* Left: Current auctioned Pokémon and table */}
              <div className="auction-left-panel">
                <CSSTransition
                  in={showCurrentPokemon}
                  timeout={500}
                  classNames="pokemon-panel-transition"
                  unmountOnExit
                  nodeRef={pokemonPanelRef}
                >
                  <div ref={pokemonPanelRef} className="pokemon-panel-wrapper">
                    {(currentAuction || lastKnownAuction) && <CurrentPokemonPanel current_auction={(currentAuction || lastKnownAuction)!} all_pokemon={pokemon} />}
                  </div>
                </CSSTransition>
                <PokemonTablePanel
                  auctions={draft.completed_auctions}
                  pokemon={pokemon}
                  teams={draft.teams}
                  currentUserId={currentUserId}
                />
              </div>
              {/* Right: Current auction info or post-draft completion UI */}
              <div className="auction-right-panel">
                {draft.draft_state === 'COMPLETED' ? (
                  <div className="draft-completed-panel">
                    <h3 className="draft-completed-title">Draft Completed!</h3>
                    <div className="draft-completed-buttons">
                      <button
                        className="button"
                        onClick={() => setShowEeveelutionModal(true)}
                      >
                        Claim Eeveelution
                      </button>
                      {hasRefereeRole && (
                        <button
                          className="button"
                          onClick={() => setShowResultsSubmissionModal(true)}
                        >
                          Submit Results
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  <>
                    {draft.draft_state === "PENDING" && (
                      <div className="draft-completed-panel">
                        <h3 className="draft-completed-title">Ready Up!</h3>
                        <div className="draft-completed-buttons">
                          {currentUserId === draft.host && (
                            <>
                              <button
                                onClick={handleOpenDraftSettings}
                                className="button"
                              >
                                Edit Draft Settings
                              </button>
                              <button
                                onClick={handleStartDraft}
                                disabled={startingDraft || !allTeamsReady}
                                className="button"
                              >
                                {startingDraft ? 'Starting Draft...' : 'Start Draft'}
                              </button>
                            </>
                          )}
                          {currentUserTeam && !currentUserReady && (
                            <button
                              onClick={handleReadyUp}
                              disabled={readyingUp}
                              className="button"
                            >
                              {readyingUp ? 'Readying Up...' : 'Ready Up'}
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                    {currentAuction && (
                      <AuctionInfoPanel
                        current_auction={currentAuction}
                        draft_id={draft.draft_id}
                        currentAuctionExpiresAt={currentAuction.expires_at}
                        currentServerTime={currentAuction.current_server_time}
                        isHost={currentUserId === draft.host}
                        isPaused={isDraftPaused}
                        pauseActionPending={pausingDraft}
                        onTogglePause={handleTogglePauseDraft}
                        canBid={Boolean(
                          currentUserId &&
                          draft.teams.some(team => team.user_id === currentUserId)
                        )}
                        currentUserId={currentUserId}
                        userBudgetRemaining={draft.teams.find(team => team.user_id === currentUserId)?.budget_remaining || 0}
                        completed_auctions={draft.completed_auctions}
                        total_auctions={draft.total_auctions}
                        auctionLength={draft.auction_length}
                      />
                    )}
                    {draft.draft_state !== 'PENDING' && currentAuction && (
                      <AuctionStatsPanel
                        completed_auctions={draft.completed_auctions}
                        total_auctions={draft.total_auctions}
                      />
                    )}
                    <AuctionChatBox draftId={draft.draft_id} isGuest={isGuest} isLoggedIn={isLoggedIn} />
                  </>
                )}
              </div>
            </div>

            {/* Modals */}
            {showEeveelutionModal && draft && (
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
                ]} teams={draft.teams} currentUserId={currentUserId}
                onClaim={handleClaimEeveelution}
                onUnclaim={handleUnclaimEeveelution}
                onClose={() => setShowEeveelutionModal(false)}
              />
            )}
            {showResultsSubmissionModal && draft && (
              <ResultsSubmissionModal
                teams={draft.teams}
                currentUserId={currentUserId}
                onSubmit={handleSubmitResults}
                onClose={() => setShowResultsSubmissionModal(false)}
              />
            )}
          </>
        )}

        {!loading && !draft && <div>No draft found.</div>}
      </main>
    </div>
  );
};

export default AuctionPage;
