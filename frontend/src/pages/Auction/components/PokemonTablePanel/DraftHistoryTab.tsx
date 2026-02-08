import React from 'react';
import { Auction } from '../../../../types';
import { getUserLabel } from '../../../../shared/utils/user';
import './DraftHistoryTab.scss';

interface DraftHistoryTabProps {
  auctions: Auction[];
}

const DraftHistoryTab: React.FC<DraftHistoryTabProps> = ({ auctions }) => {
  return (
    <div className="auction-draft-history-list">
      <h3>Draft History</h3>
      <ul>
        {auctions.map((auction, idx) => (
          <li key={idx}>
            <img
              src={`/baseforms/${auction.pokemon.name}.png`}
              alt={auction.pokemon.name}
              className="draft-history-pokemon-sprite"
            />
            <strong>{auction.pokemon.name}</strong>: 
            {auction.highest_bid > 0
              ? ` ${getUserLabel(auction.highest_bidder)} won for $${auction.highest_bid}`
              : ' No bids yet'}
          </li>
        ))}
      </ul>
    </div>
  );
};

export default DraftHistoryTab;
