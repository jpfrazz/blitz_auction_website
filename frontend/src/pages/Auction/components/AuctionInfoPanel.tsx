import React, { useState, useEffect } from 'react';
import { Auction } from '../../../types';
import { placeBid } from '../../../shared/api/draftData';
import { getUserLabel } from '../../../shared/utils/user';
import './AuctionInfoPanel.scss';

interface AuctionInfoPanelProps {
  current_auction: Auction;
  draft_id: string;
  currentAuctionExpiresAt?: string;
  canBid: boolean;
  userBudgetRemaining: number;
}

const AuctionInfoPanel: React.FC<AuctionInfoPanelProps> = ({
  current_auction,
  draft_id,
  currentAuctionExpiresAt,
  canBid,
  userBudgetRemaining,
}) => {
  const [secondsRemaining, setSecondsRemaining] = useState(0);
  const [initialSeconds, setInitialSeconds] = useState(0);
  const [customBidAmount, setCustomBidAmount] = useState('');

  useEffect(() => {
    const updateCountdown = () => {
      const expiresAt = new Date(currentAuctionExpiresAt ?? 0).getTime();
      const now = Date.now();
      const remaining = Math.max(0, Math.floor((expiresAt - now) / 1000));
      setSecondsRemaining(remaining);
      
      // Set initial seconds only once
      if (initialSeconds === 0 && remaining > 0) {
        setInitialSeconds(remaining);
      }
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    return () => clearInterval(interval);
  }, [currentAuctionExpiresAt, initialSeconds]);

  const circumference = 2 * Math.PI * 45;
  const progress = initialSeconds > 0 ? secondsRemaining / initialSeconds : 0;
  const strokeDashoffset = circumference - (progress * circumference);

  // Determine color based on remaining time
  let ringColor = '#00aa00'; // green
  if (secondsRemaining <= 3) {
    ringColor = '#ff0000'; // red
  } else if (secondsRemaining <= 5) {
    ringColor = '#ff8800'; // dark orange
  }

  const handleBid100 = async () => {
    const newBid = current_auction.highest_bid + 100;
    if (newBid > userBudgetRemaining) {
      console.error('Bid exceeds remaining budget');
      return;
    }
    try {
      const response = await placeBid(draft_id, current_auction.auction_id, newBid);
      if (!response.accepted) {
        console.error('Bid rejected:', response.error);
      }
    } catch (error) {
      console.error('Error placing bid:', error);
    }
  };

  const handleCustomBid = async () => {
    const bidValue = parseInt(customBidAmount);
    if (!bidValue || bidValue <= 0) {
      console.error('Invalid bid amount');
      return;
    }
    if (bidValue % 100 !== 0) {
      console.error('Bid must be a multiple of 100');
      return;
    }
    if (bidValue > userBudgetRemaining) {
      console.error('Bid exceeds remaining budget');
      return;
    }
    try {
      const response = await placeBid(draft_id, current_auction.auction_id, bidValue);
      if (response.accepted) {
        setCustomBidAmount('');
      } else {
        console.error('Bid rejected:', response.error);
      }
    } catch (error) {
      console.error('Error placing bid:', error);
    }
  };

  const showBidNow = !currentAuctionExpiresAt;

  return (
    <div className="auction-info-box">
      <div className="auction-countdown-ring">
        <svg width="140" height="140" viewBox="0 0 140 140">
          <circle cx="70" cy="70" r="45" className="countdown-ring-background" />
          <circle
            cx="70"
            cy="70"
            r="45"
            className="countdown-ring-progress"
            strokeDasharray={circumference}
            style={{ strokeDashoffset, stroke: ringColor }}
          />
        </svg>
        <div className="countdown-text" style={{ color: ringColor }}>
          {showBidNow ? 'Bid!' : `${secondsRemaining}s`}
        </div>
      </div>

      <div className="auction-pokemon-section">
        <h2 className="pokemon-name">{current_auction.pokemon.name}</h2>
        <img
          src={`/baseforms/${current_auction.pokemon.name}.png`}
          alt={current_auction.pokemon.name}
          className="auction-pokemon-image"
        />
        <div className="bid-info">
          <p className="current-bid">${current_auction.highest_bid}</p>
          <p className="bidder-label">
            High Bidder: {getUserLabel(current_auction.highest_bidder) || 'No bids yet'}
          </p>
        </div>
      </div>

      <div className="bid-buttons-section">
        <button className="bid-button" onClick={handleBid100} disabled={!canBid}>
          ▲ $100
        </button>
        <input
          type="number"
          className="custom-bid-input"
          placeholder="Custom amount"
          value={customBidAmount}
          onChange={e => setCustomBidAmount(e.target.value)}
          autoComplete="off"
          disabled={!canBid}
        />
        <button className="bid-button" onClick={handleCustomBid} disabled={!canBid}>
          Custom Bid
        </button>
      </div>
    </div>
  );
};

export default AuctionInfoPanel;
