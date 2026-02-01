import React, { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import Header from '../../shared/components/Header';
import Footer from '../../shared/components/Footer';
import { fetchDraftById } from '../../shared/api/draftData';
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

  useEffect(() => {
    if (!auctionId) return;
    
    // Initial fetch
    setLoading(true);
    fetchDraftById(auctionId)
      .then(setDraft)
      .finally(() => setLoading(false));
    
    // Set up interval to fetch every second
    const interval = setInterval(() => {
      fetchDraftById(auctionId)
        .then(setDraft)
        .catch(error => console.error('Error fetching draft:', error));
    }, 1000);
    
    return () => clearInterval(interval);
  }, [auctionId]);

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
                players={draft.players}
                numPlayers={draft.settings.num_players}
                startingMoney={draft.settings.starting_money}
              />
            </div>
            {/* Main content grid */}
            <div className="auction-content-grid">
              {/* Left: Current auctioned Pokémon and table */}
              <div className="auction-left-panel">
                <CurrentPokemonPanel current_auction={draft.current_auction} />
                <PokemonTablePanel auctions={draft.completed_auctions} pokemonIds={draft.settings.pokemon_ids} />
              </div>
              {/* Right: Current auction info */}
              <div className="auction-right-panel">
                <AuctionInfoPanel current_auction={draft.current_auction} />
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
