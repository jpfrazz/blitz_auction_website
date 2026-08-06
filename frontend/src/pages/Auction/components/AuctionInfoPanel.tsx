import React, { useState, useEffect, useRef } from 'react';
import { Auction } from '../../../types';
import { fetchAutoBid, placeBid, setAutoBid } from '../../../shared/api/draftData';
import { getUserLabel, getUserId } from '../../../shared/utils/user';
import { TbPlayerPauseFilled , TbPlayerPlayFilled, TbSettings, TbInfoCircle } from 'react-icons/tb';
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
  const [showAutoBidModal, setShowAutoBidModal] = useState(false);
  const [autoBidValue, setAutoBidValue] = useState('');
  const [autoBidEnabled, setAutoBidEnabled] = useState(false);
  const [autoBidError, setAutoBidError] = useState<string | null>(null);
  const [autoBidSaving, setAutoBidSaving] = useState(false);
  const prevCompletedCountRef = useRef(completed_auctions.length);

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
      const state = (current_auction as any).state || (current_auction as any).auction_state;
      if (state && typeof state === 'object' && 'PAUSED' in state) {
        setSecondsRemaining(Number(state.PAUSED));
      }
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
  }, [currentAuctionExpiresAt, currentServerTime, isPaused, current_auction]);

  const progress = auctionLength > 0 ? secondsRemaining / auctionLength : 0;

  useEffect(() => {
    if (completed_auctions.length > prevCompletedCountRef.current) {
      const newAuctions = completed_auctions.slice(prevCompletedCountRef.current);
      const userWon = newAuctions.some(
        auction => getUserId(auction.highest_bidder) === currentUserId && currentUserId !== null
      );
      if (userWon) {
        setAutoBidEnabled(false);
        setAutoBidValue('');
        setAutoBidError(null);
      }
    }
    prevCompletedCountRef.current = completed_auctions.length;
  }, [completed_auctions, currentUserId]);

  const getAutoBidError = (error: any) => {
    const data = error?.response?.data;
    return (typeof data === 'string' && data.trim() !== '') ? data : (error?.message || 'Failed to update auto bid.');
  };

  const handleOpenAutoBid = async () => {
    setShowAutoBidModal(true);
    setAutoBidError(null);
    try {
      const state = await fetchAutoBid(draft_id);
      setAutoBidEnabled(state.enabled);
      setAutoBidValue(state.value != null ? String(state.value) : '');
    } catch (error) {
      console.error('Error fetching auto bid:', error);
    }
  };

  const handleAutoBidValueChange = (value: string) => {
    setAutoBidValue(value);
    const bidValue = parseInt(value, 10);
    if (bidValue && bidValue > userBudgetRemaining) {
      setAutoBidError("You don't have enough money for that bid.");
    } else {
      setAutoBidError(null);
    }
  };

  const handleToggleAutoBid = async () => {
    if (autoBidSaving) return;

    if (autoBidEnabled) {
      setAutoBidSaving(true);
      setAutoBidError(null);
      try {
        const state = await setAutoBid(draft_id, 0, false);
        setAutoBidEnabled(state.enabled);
        setAutoBidValue(state.value != null ? String(state.value) : '');
      } catch (error) {
        setAutoBidError(getAutoBidError(error));
      } finally {
        setAutoBidSaving(false);
      }
      return;
    }

    const bidValue = parseInt(autoBidValue, 10);
    if (!bidValue || bidValue <= 0) {
      setAutoBidError('Please enter an auto bid amount.');
      return;
    }
    if (bidValue % 100 !== 0) {
      setAutoBidError('Auto bid must be a multiple of 100.');
      return;
    }
    if (bidValue > userBudgetRemaining) {
      setAutoBidError("You don't have enough money for that bid.");
      return;
    }

    setAutoBidSaving(true);
    setAutoBidError(null);
    try {
      const state = await setAutoBid(draft_id, bidValue, true);
      setAutoBidEnabled(state.enabled);
      setAutoBidValue(state.value != null ? String(state.value) : autoBidValue);
    } catch (error) {
      setAutoBidError(getAutoBidError(error));
    } finally {
      setAutoBidSaving(false);
    }
  };

  const showBidNow = !currentAuctionExpiresAt;

  // Determine color based on remaining time
  let timerColor = '#00aa00'; // green
  if (isPaused) {
    timerColor = '#66b2ff'; // light blue
  } else if (!showBidNow && secondsRemaining <= 3) {
    timerColor = '#ff0000'; // red
  } else if (!showBidNow && secondsRemaining <= 5) {
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
    if (bidValue - current_auction.highest_bid > 3000) {
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

  const getIconName = (name: string) => {
    if (name.toLowerCase().startsWith('egg')) return 'egg';
    return name.toLowerCase();
  };

  return (
    <div className="auction-info-box" style={{ flexShrink: 0 }}>
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
            src={`/MiniIcons/${getIconName(current_auction.pokemon.name)}.png`}
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
      {canBid && (
        <button
          type="button"
          className="auto-bid-gear-button"
          onClick={() => void handleOpenAutoBid()}
          aria-label="Auto-Bid settings"
          title="Auto-Bid"
        >
          <TbSettings />
        </button>
      )}
    {/* Bid Warning Modal */}
    {showBidWarning && (
      <div className="auction-modal-overlay">
        <div className="auction-modal-content">
          <h3>Whoa, that's a big bid!</h3>
          <p>Your bid is more than $3000 above the current bid. Are you sure you want to bid so much?</p>
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
    {/* Auto-Bid Modal */}
    {showAutoBidModal && (
      <div className="auction-modal-overlay" onClick={() => setShowAutoBidModal(false)}>
        <div className="auction-modal-content auto-bid-modal" onClick={e => e.stopPropagation()}>
          <h3 className="auto-bid-modal-title">Auto-Bid</h3>
          <p className="auto-bid-modal-message">
            Automatically bid this value at the start of each sale
            <span className="auto-bid-info-tip" tabIndex={0}>
              <TbInfoCircle />
              <span className="auto-bid-info-tip-text">
                If two users enter the same auto-bid amount, the website randomly decides between them who gets the first bid
              </span>
            </span>
          </p>
          <input
            type="number"
            className="custom-bid-input auto-bid-input"
            placeholder=""
            value={autoBidValue}
            onChange={e => handleAutoBidValueChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void handleToggleAutoBid();
              }
            }}
            step={100}
            min={100}
            autoComplete="off"
            disabled={autoBidSaving}
          />
          {autoBidError && <div className="auto-bid-error">{autoBidError}</div>}
          <div className="auction-modal-actions">
            <button
              className={`auction-modal-confirm auto-bid-toggle${autoBidEnabled ? '' : ' auto-bid-toggle-off'}`}
              onClick={() => void handleToggleAutoBid()}
              disabled={autoBidSaving}
            >
              {autoBidSaving ? 'Saving...' : (autoBidEnabled ? 'Auto Bid: On' : 'Auto Bid: Off')}
            </button>
          </div>
          {autoBidEnabled && (
            <p className="auto-bid-modal-note">
              Auto-Bid turns off automatically the next time you win an auction
            </p>
          )}
        </div>
      </div>
    )}
    </div>
  );
};

export default AuctionInfoPanel;
