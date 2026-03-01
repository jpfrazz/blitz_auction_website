import React from 'react';
import { Auction } from '../../../../types';
import { getUserLabel } from '../../../../shared/utils/user';
import './DraftHistoryTab.scss';

interface DraftHistoryTabProps {
  auctions: Auction[];
}

const DraftHistoryTab: React.FC<DraftHistoryTabProps> = ({ auctions }) => {
  const sortedAuctions = [...auctions].reverse();
  const soldAuctions = auctions.filter(auction => auction.highest_bid > 0);
  const averageSoldPrice =
    soldAuctions.length > 0
      ? Math.round(
          soldAuctions.reduce((total, auction) => total + auction.highest_bid, 0) /
            soldAuctions.length
        )
      : null;

  return (
    <div className="auction-draft-history-list">
      <h3>Draft History</h3>
      <div className="draft-history-average-price">
        Average Price:{' '}
        {averageSoldPrice !== null ? `$${averageSoldPrice.toLocaleString()}` : 'N/A'}
      </div>
      <ul>
        {sortedAuctions.map((auction, idx) => (
          <li key={idx}>
            <img
              src={`/MiniIcons/${auction.pokemon.name.toLowerCase()}.png`}
              alt={auction.pokemon.name}
              className="draft-history-pokemon-icon"
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
