import React, { useState, useEffect, useRef } from 'react';
import { Auction } from '../../../types';
import { placeBid } from '../../../shared/api/draftData';
import { getUserLabel, getUserId } from '../../../shared/utils/user';
import { TbPlayerPauseFilled , TbPlayerPlayFilled } from 'react-icons/tb';
import './AuctionInfoPanel.scss';

interface AuctionInfoPanelProps {
  current_auction: Auction;
  draft_id: string;
  currentAuctionExpiresAt?: string;
  currentServerTime?: string;
  isHost: boolean;
  isPaused: boolean;
  pauseActionPending: boolean;
  onTogglePause: () => void;
  canBid: boolean;
  userBudgetRemaining: number;
  completed_auctions: Auction[];
  total_auctions: number;
  currentUserId: string | null;
  auctionLength: number;
}

const AuctionInfoPanel: React.FC<AuctionInfoPanelProps> = ({
  current_auction,
  draft_id,
  currentAuctionExpiresAt,
  currentServerTime,
  isHost,
  isPaused,
  pauseActionPending,
  onTogglePause,
  canBid,
  userBudgetRemaining,
  completed_auctions,
  total_auctions,
  currentUserId,
  auctionLength,
}) => {
  const [secondsRemaining, setSecondsRemaining] = useState(0);
  const [customBidAmount, setCustomBidAmount] = useState('');
  const [showBidWarning, setShowBidWarning] = useState(false);
  const [pendingBid, setPendingBid] = useState<number | null>(null);
  const [isResetting, setIsResetting] = useState(false);
  const [isBidAnimating, setIsBidAnimating] = useState(false);
  const [bidNotification, setBidNotification] = useState<string | null>(null);
  const isInitialBid = useRef(true);
  const bidNotificationTimerRef = useRef<number | null>(null);

  const showBidNotification = (message: string) => {
    setBidNotification(message);

    if (bidNotificationTimerRef.current) {
      window.clearTimeout(bidNotificationTimerRef.current);
    }

    bidNotificationTimerRef.current = window.setTimeout(() => {
      setBidNotification(null);
      bidNotificationTimerRef.current = null;
    }, 3000);
  };

  useEffect(() => {
    return () => {
      if (bidNotificationTimerRef.current) {
        window.clearTimeout(bidNotificationTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (isInitialBid.current) {
      isInitialBid.current = false;
      return;
    }

    if (current_auction.highest_bid > 0) {
      setIsBidAnimating(true);
      const timer = setTimeout(() => setIsBidAnimating(false), 500);
      return () => clearTimeout(timer);
    }
  }, [current_auction.highest_bid]);

  useEffect(() => {
    if (isPaused) {
      setIsResetting(false);
      return;
    }

    // When the expiration time changes (e.g. a bid is placed), trigger a fast reset animation
    setIsResetting(true);
    const resetTimer = setTimeout(() => setIsResetting(false), 500);

    const serverNowMs = new Date(currentServerTime ?? 0).getTime();
    const expiresAtMs = new Date(currentAuctionExpiresAt ?? 0).getTime();

    const offset = Date.now() - serverNowMs;

    const updateCountdown = () => {
      const adjustedNow = Date.now() - offset;
      const remainingMs = expiresAtMs - adjustedNow;
      
      // Snap to 0 if less than 0.5s remains to ensure "empty" state is visible
      const effectiveMs = Math.max(0, remainingMs);
      const remainingS = effectiveMs < 100 ? 0 : Math.ceil(effectiveMs / 1000);
      setSecondsRemaining(Math.min(remainingS, 10));
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 250);
    return () => {
      clearInterval(interval);
      clearTimeout(resetTimer);
    };
  }, [currentAuctionExpiresAt, currentServerTime, isPaused]);

  const progress = auctionLength > 0 ? secondsRemaining / auctionLength : 0;

  // Determine color based on remaining time
  let timerColor = '#00aa00'; // green
  if (secondsRemaining <= 3) {
    timerColor = '#ff0000'; // red
  } else if (secondsRemaining <= 5) {
    timerColor = '#ff8800'; // dark orange
  }

  const getTypeIconSrc = (type: string) => {
    const formattedType = type.charAt(0).toUpperCase() + type.slice(1).toLowerCase();
    return `/TypeIcons/${formattedType}IC_SV.png`;
  };

  const highBidderId = getUserId(current_auction.highest_bidder);
  const isCurrentUserHighBidder = highBidderId === currentUserId && highBidderId !== null;

  const handleBid100 = async () => {
    const newBid = current_auction.highest_bid + 100;
    if (newBid > userBudgetRemaining) {
      showBidNotification("You don't have enough money for that bid.");
      return;
    }
    try {
      const response = await placeBid(draft_id, current_auction.auction_id, newBid);
      if (response.status != 200) {
        if (response.data?.toLowerCase().includes('brokie')) {
          showBidNotification("You don't have enough money for that bid.");
        } else {
          showBidNotification(response.data || (isCurrentUserHighBidder ? "You're already the high bidder!" : 'Bid failed. Please try again.'));
        }
        console.error('Bid rejected:', response.data);
      }
    } catch (error) {
      showBidNotification(isCurrentUserHighBidder ? "You're already the high bidder!" : 'Bid failed. Please try again.');
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
      showBidNotification("You don't have enough money for that bid.");
      return;
    }
    if (bidValue - current_auction.highest_bid > 2000) {
      setPendingBid(bidValue);
      setShowBidWarning(true);
      return;
    }
    await actuallyPlaceBid(bidValue);
  };

  const actuallyPlaceBid = async (bidValue: number) => {
    try {
      const response = await placeBid(draft_id, current_auction.auction_id, bidValue);
      if (response.status != 200) {
        if (response.data?.toLowerCase().includes('brokie')) {
          showBidNotification("You don't have enough money for that bid.");
        } else {
          showBidNotification(response.data || (isCurrentUserHighBidder ? "You're already the high bidder!" : 'Bid failed. Please try again.'));
        }
        console.error('Bid rejected:', response.data);
      }
    } catch (error) {
      showBidNotification(isCurrentUserHighBidder ? "You're already the high bidder!" : 'Bid failed. Please try again.');
      console.error('Error placing bid:', error);
    }
  };

  const showBidNow = !currentAuctionExpiresAt;

  return (
    <div className="auction-info-box">
      <div className="auction-countdown-container">
        {bidNotification && (
          <div className="auction-bid-notification" role="status" aria-live="polite">
            {bidNotification}
          </div>
        )}
        <div className="countdown-header-row">
          <div className="countdown-text" style={{ color: timerColor }}>
            {isPaused ? 'Paused' : (showBidNow ? 'Bid!' : `${secondsRemaining}s`)}
          </div>
          {isHost && (
            <button
              type="button"
              className="pause-toggle-button"
              onClick={onTogglePause}
              disabled={pauseActionPending}
              aria-label={isPaused ? 'Unpause draft' : 'Pause draft'}
              title={isPaused ? 'Unpause' : 'Pause'}
            >
              {isPaused ? <TbPlayerPlayFilled /> : <TbPlayerPauseFilled />}
            </button>
          )}
        </div>
        <div className="countdown-bar-background">
          <div
            className="countdown-bar-progress"
            style={{
              width: `${progress * 100}%`,
              backgroundColor: timerColor,
              transition: isResetting ? 'width 0.2s ease-out' : 'width 0.25s ease-in-out'
            }}
          />
        </div>
      </div>

      <div className="auction-pokemon-section">
        <div className="pokemon-info-display">
          <img
            src={`/MiniIcons/${current_auction.pokemon.name.toLowerCase()}.png`}
            alt={current_auction.pokemon.name}
            className="pokemon-info-icon"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />
          <h2 className="pokemon-name">{current_auction.pokemon.name}</h2>
          <div className="pokemon-info-types">
            {current_auction.pokemon.type1 && (
              <img
                src={getTypeIconSrc(current_auction.pokemon.type1)}
                alt={current_auction.pokemon.type1}
                className="pokemon-info-type-icon"
              />
            )}
            {current_auction.pokemon.type2 && (
              <img
                src={getTypeIconSrc(current_auction.pokemon.type2)}
                alt={current_auction.pokemon.type2}
                className="pokemon-info-type-icon"
              />
            )}
          </div>
        </div>
        <div className="bid-info">
          <p className={`current-bid ${isBidAnimating ? 'bid-animate' : ''}`}>${current_auction.highest_bid}</p>
          <p className="bidder-label">
            {isCurrentUserHighBidder
              ? "You're the high bidder!"
              : `High Bidder: ${getUserLabel(current_auction.highest_bidder) || 'No bids yet'}`
            }
          </p>
        </div>
      </div>

      <div className="bid-buttons-section">
        <button
          className="bid-button"
          onClick={handleBid100}
          disabled={!canBid || isPaused || (secondsRemaining >= 9)}
        >
          ▲ $100
        </button>
        <input
          type="number"
          className="custom-bid-input"
          placeholder=""
          value={customBidAmount}
          onChange={e => setCustomBidAmount(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void handleCustomBid();
            }
          }}
          step={100}
          min={100}
          autoComplete="off"
          disabled={!canBid || isPaused}
        />
        <button className="bid-button" onClick={handleCustomBid} disabled={!canBid || isPaused}>
          Custom Bid
        </button>
      </div>
    {/* Bid Warning Modal */}
    {showBidWarning && (
      <div className="auction-modal-overlay">
        <div className="auction-modal-content">
          <h3>Whoa, that's a big bid!</h3>
          <p>Your bid is more than $2000 above the current bid. Are you sure you want to bid so much?</p>
          <div className="auction-modal-actions">
            <button
              className="auction-modal-confirm"
              onClick={async () => {
                if (pendingBid) await actuallyPlaceBid(pendingBid);
                setShowBidWarning(false);
                setPendingBid(null);
              }}
            >
              Yes, Place Bid
            </button>
            <button
              className="auction-modal-cancel"
              onClick={() => {
                setShowBidWarning(false);
                setPendingBid(null);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    )}
    </div>
  );
};

export default AuctionInfoPanel;
