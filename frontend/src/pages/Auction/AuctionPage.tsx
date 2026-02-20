import React, { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import Header from '../../shared/components/Header';
import { fetchDraftById, startDraft, joinDraft, fetchCurrentUser, claimEeveelution } from '../../shared/api/draftData';
import { getUserId } from '../../shared/utils/user';
import './AuctionPage.scss';
import '../../shared/style/theme.scss';
import PlayerRow from './components/PlayerRow';
import CurrentPokemonPanel from './components/CurrentPokemonPanel';
import AuctionInfoPanel from './components/AuctionInfoPanel';
import AuctionChatBox from './components/AuctionChatBox';
import PokemonTablePanel from './components/PokemonTablePanel/PokemonTablePanel';
import EeveelutionClaimModal from './components/EeveelutionClaimModal';
import { Draft } from '../../types';

function useAuctionId() {
  const location = useLocation();
  return location.search.replace(/^\?/, '');
}

const AuctionPage: React.FC = () => {
  const auctionId = useAuctionId();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loading, setLoading] = useState(false);
  const [startingDraft, setStartingDraft] = useState(false);
  const [joiningDraft, setJoiningDraft] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [isGuest, setIsGuest] = useState(false);
  const [showJoinModal, setShowJoinModal] = useState(false);
  const [joinPassword, setJoinPassword] = useState('');
  const [joinError, setJoinError] = useState<string | null>(null);
  const [showEeveelutionModal, setShowEeveelutionModal] = useState(false);

  const attemptJoinDraft = async (password?: string) => {
    if (!auctionId) return;

    setJoiningDraft(true);
    setJoinError(null);

    try {
      const updatedDraft = await joinDraft(auctionId, password);
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

    // Initial fetch
    setLoading(true);
    fetchCurrentUser()
      .then(user => {
        console.log("Fetched current user:", user);
        setCurrentUserId(user.user_id);
        setIsGuest(user.is_guest);
        return fetchDraftById(auctionId).then(draftData => ({ user, draftData }));
      })
      .then(({ user, draftData }) => {
        console.log("Fetched draft successfully", draftData);
        setDraft(draftData);

        const alreadyOnTeam = draftData.teams.some(team => team.user_id === user.user_id);
        if (draftData.draft_state === 'PENDING' && !alreadyOnTeam) {
          setShowJoinModal(true);
        }
      })
      .catch(error => console.error('Error fetching draft on initial load:', error))
      .finally(() => setLoading(false));
    
    // Set up interval to fetch every second
    const interval = setInterval(() => {
      fetchDraftById(auctionId)
        .then(data => {
          setDraft(data);
          console.log("Interval draft_state:", data);
        })
        .catch(error => console.error('Error fetching draft in interval:', error));
    }, 1000);
    
    return () => clearInterval(interval);
  }, [auctionId]);

  const handleStartDraft = async () => {
    if (!draft) return;
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

  return (
    <>
      <Header />
      <main className="auction-main-layout">
        {loading && <div>Loading draft...</div>}
        {!loading && draft && (
          <>
            {showJoinModal && (
              <div className="auction-password-modal-overlay">
                <div className="auction-password-modal" onClick={e => e.stopPropagation()}>
                  <h3 className="auction-password-modal-title">Join Draft</h3>
                  {draft.has_password && (
                    <input
                      className="auction-password-modal-input"
                      type="password"
                      value={joinPassword}
                      onChange={e => setJoinPassword(e.target.value)}
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
                      Join as Spectator
                    </button>
                    <button
                      className="button"
                      onClick={() => attemptJoinDraft(joinPassword)}
                      disabled={joiningDraft}
                    >
                      {joiningDraft ? 'Joining...' : 'Join as Racer'}
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
                highestBidderId={draft.current_auction ? getUserId(draft.current_auction.highest_bidder) : null}
              />
            </div>
            {/* Main content grid */}
            <div className="auction-content-grid">
              {/* Left: Current auctioned Pokémon and table */}
              <div className="auction-left-panel">
                {draft.draft_state === "PENDING" && currentUserId === draft.host && (
                  <button
                    onClick={handleStartDraft}
                    disabled={startingDraft}
                    className="button"
                  >
                    {startingDraft ? 'Starting Draft...' : 'Start Draft'}
                  </button>
                )}
                {draft.current_auction && <CurrentPokemonPanel current_auction={draft.current_auction} />}
                <PokemonTablePanel
                  auctions={draft.completed_auctions}
                  pokemon={draft.pokemon.filter((p: any) => p.stage === 'base')}
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
                    </div>
                  </div>
                ) : (
                  <>
                    {draft.current_auction && (
                      <AuctionInfoPanel
                        current_auction={draft.current_auction}
                        draft_id={draft.draft_id}
                        currentAuctionExpiresAt={draft.current_auction_expires_at}
                        canBid={Boolean(
                          currentUserId &&
                          draft.teams.some(team => team.user_id === currentUserId)
                        )}
                        userBudgetRemaining={draft.teams.find(team => team.user_id === currentUserId)?.budget_remaining || 0}
                      />
                    )}
                    <AuctionChatBox draftId={draft.draft_id} isGuest={isGuest} />
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
                ]}                teams={draft.teams}                currentUserId={currentUserId}
                onClaim={handleClaimEeveelution}
                onClose={() => setShowEeveelutionModal(false)}
              />
            )}
          </>
        )}
              
        {!loading && !draft && <div>No draft found.</div>}
      </main>
    </>
  );
};

export default AuctionPage;
