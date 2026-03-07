import React from 'react';
import { Auction } from '../../../types';
import './AuctionStatsPanel.scss';

interface AuctionStatsPanelProps {
  completed_auctions: Auction[];
  total_auctions: number;
}

const AuctionStatsPanel: React.FC<AuctionStatsPanelProps> = ({ completed_auctions, total_auctions }) => {
  const soldAuctions = completed_auctions.filter(auction => auction.highest_bid > 0);
  const averageSoldPrice =
    soldAuctions.length > 0
      ? Math.round(
          soldAuctions.reduce((total, auction) => total + auction.highest_bid, 0) /
            soldAuctions.length
        )
      : null;

  return (
    <div className="auction-stats-panel">
      <div className="stat-box">
        <span>Now Selling: {completed_auctions.length + 1}/{total_auctions}</span>
      </div>
      <div className="stat-box">
        <span>
          Avg. Price: {averageSoldPrice !== null ? `$${averageSoldPrice.toLocaleString()}` : 'N/A'}
        </span>
      </div>
    </div>
  );
};

export default AuctionStatsPanel;