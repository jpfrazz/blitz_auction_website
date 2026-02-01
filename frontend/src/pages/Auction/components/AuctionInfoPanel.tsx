import React, { useState, useEffect } from 'react';
import { Auction } from '../../../types';
import './AuctionInfoPanel.scss';

interface AuctionInfoPanelProps {
  current_auction: Auction;
}

const AuctionInfoPanel: React.FC<AuctionInfoPanelProps> = ({ current_auction }) => {
  const [secondsRemaining, setSecondsRemaining] = useState(0);
  const [initialSeconds, setInitialSeconds] = useState(0);
  const [customBidAmount, setCustomBidAmount] = useState('');

  useEffect(() => {
    const updateCountdown = () => {
      const expiresAt = new Date(current_auction.expires_at ?? 0).getTime();
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
  }, [current_auction.expires_at, initialSeconds]);

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

  const handleBid100 = () => {
    console.log('Bid $100');
    // TODO: Implement bidding logic
  };

  const handleCustomBid = () => {
    if (customBidAmount) {
      console.log(`Custom bid: $${customBidAmount}`);
      // TODO: Implement custom bid logic
    }
  };

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
        <div className="countdown-text" style={{ color: ringColor }}>{secondsRemaining}s</div>
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
          <p className="bidder-label">High Bidder: {current_auction.highest_bidder || 'No bids yet'}</p>
        </div>
      </div>

      <div className="bid-buttons-section">
        <button className="bid-button" onClick={handleBid100}>
          ▲ $100
        </button>
        <input
          type="number"
          className="custom-bid-input"
          placeholder="Custom amount"
          value={customBidAmount}
          onChange={e => setCustomBidAmount(e.target.value)}
          autoComplete="off"
        />
        <button className="bid-button" onClick={handleCustomBid}>
          Custom Bid
        </button>
      </div>
    </div>
  );
};

export default AuctionInfoPanel;
