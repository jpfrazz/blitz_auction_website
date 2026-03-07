import React from 'react';
import { Auction } from '../../../../types';
import { getUserLabel } from '../../../../shared/utils/user';
import './DraftHistoryTab.scss';

interface DraftHistoryTabProps {
  auctions: Auction[];
}

const DraftHistoryTab: React.FC<DraftHistoryTabProps> = ({ auctions }) => {
  const sortedAuctions = [...auctions].reverse();

  return (
    <div className="auction-draft-history-list" style={{ paddingTop: '1rem' }}>
      <ul>
        {sortedAuctions.map((auction, idx) => (
          <li key={idx}>
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <div style={{ width: '24px', display: 'flex', justifyContent: 'center', marginRight: '8px', flexShrink: 0 }}>
                <img
                  src={`/MiniIcons/${auction.pokemon.name.toLowerCase()}.png`}
                  alt={auction.pokemon.name}
                  className="draft-history-pokemon-icon"
                />
              </div>
              <div>
                <strong>{auction.pokemon.name}</strong>:
                {auction.highest_bid > 0
                  ? ` ${getUserLabel(auction.highest_bidder)} won for $${auction.highest_bid}`
                  : ' No bids yet'}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default DraftHistoryTab;
