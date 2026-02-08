import React, { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import Header from '../../shared/components/Header';
import Footer from '../../shared/components/Footer';
import { fetchDraftById, startDraft, joinDraft, fetchCurrentUser } from '../../shared/api/draftData';
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
    fetchDraftById(auctionId)
      .then(data => {
        console.log("Fetched draft successfully", data);
        setDraft(data);
        // Join the draft
        return joinDraft(auctionId);
      })
      .then(updatedDraft => {
        console.log("Joined draft successfully", updatedDraft);
        setDraft(updatedDraft);
      })
      .then(() => {
        fetchCurrentUser()
          .then(user => {
            console.log("Fetched current user:", user);
            setCurrentUserId(user.user_id);
          })
          .catch(error => console.error('Error fetching current user:', error));
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
                players={draft.teams.map(t => t.user_id)}
                numPlayers={draft.teams.length}
                startingMoney={draft.teams[0]?.money || 20000}
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
                {draft.current_auction && <AuctionInfoPanel current_auction={draft.current_auction} draft_id={draft.draft_id} />}
                <AuctionChatBox />
              </div>
            </div>
          </>
        )}
              
        {!loading && !draft && <div>No draft found.</div>}
      </main>
      <Footer />
    </>
  );
};

export default AuctionPage;
