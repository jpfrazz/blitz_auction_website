import React, { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import Header from '../../shared/components/Header';
import { fetchDraftById, startDraft, joinDraft, fetchCurrentUser } from '../../shared/api/draftData';
import { getUserId } from '../../shared/utils/user';
import './AuctionPage.scss';
import '../../shared/style/theme.scss';
import PlayerRow from './components/PlayerRow';
import CurrentPokemonPanel from './components/CurrentPokemonPanel';
import AuctionInfoPanel from './components/AuctionInfoPanel';
import AuctionChatBox from './components/AuctionChatBox';
import PokemonTablePanel from './components/PokemonTablePanel/PokemonTablePanel';
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
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  useEffect(() => {
    if (!auctionId) return;

    // Initial fetch
    setLoading(true);
    fetchCurrentUser()
      .then(user => {
        console.log("Fetched current user:", user);
        setCurrentUserId(user.user_id);
        return fetchDraftById(auctionId).then(draftData => ({ user, draftData }));
      })
      .then(({ user, draftData }) => {
        console.log("Fetched draft successfully", draftData);
        setDraft(draftData);

        const alreadyOnTeam = draftData.teams.some(team => team.user_id === user.user_id);
        if (draftData.draft_state === 'PENDING' && !alreadyOnTeam) {
          return joinDraft(auctionId).then(updatedDraft => {
            console.log("Joined draft successfully", updatedDraft);
            setDraft(updatedDraft);
          });
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

  return (
    <>
      <Header />
      <main className="auction-main-layout">
        {loading && <div>Loading draft...</div>}
        {!loading && draft && (
          <>
            {/* Top: Player boxes */}
            <div>
              <PlayerRow
                teams={draft.teams}
                numPlayers={draft.teams.length}
                budgetRemaining={draft.teams[0]?.budget_remaining || 20000}
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
                <PokemonTablePanel auctions={draft.completed_auctions} pokemon={draft.pokemon} />
              </div>
              {/* Right: Current auction info */}
              <div className="auction-right-panel">
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
                <AuctionChatBox />
              </div>
            </div>
          </>
        )}
              
        {!loading && !draft && <div>No draft found.</div>}
      </main>
    </>
  );
};

export default AuctionPage;
