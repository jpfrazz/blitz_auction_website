import React, { useState } from 'react';
import { Team } from '../../types';
import { FaArrowRight } from 'react-icons/fa';
import './EeveelutionClaimButton.scss';

interface Eeveelution {
  pokedex_id: number;
  name: string;
  form: null | string;
}

interface EeveelutionClaimButtonProps {
  eeveelutions: Eeveelution[];
  teams: Team[];
  currentUserId: string | null;
  currentUsername: string | null;
  onClaim: (pokedexId: number, form: string | null) => Promise<void>;
  onUnclaim: (pokedexId: number, form: string | null) => Promise<void>;
}

const EeveelutionClaimButton: React.FC<EeveelutionClaimButtonProps> = ({
  eeveelutions,
  teams,
  currentUserId,
  currentUsername,
  onClaim,
  onUnclaim,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [claiming, setClaiming] = useState<string | null>(null);
  const [notification, setNotification] = useState<string | null>(null);
  const [isClosing, setIsClosing] = useState(false);

  // Determine which eeveelutions are already claimed by checking all teams
  const getClaimedInfo = (pokedexId: number, form: string | null): { username: string; userId: string } | null => {
    for (const team of teams) {
      if (team.auctions_won) {
        const claimed = team.auctions_won.find(
          p => p.pokedex_id === pokedexId && p.form === form
        );
        if (claimed) {
          return { username: team.username, userId: team.user_id };
        }
      }
    }
    return null;
  };

  const showNotification = (message: string) => {
    setNotification(message);
    setTimeout(() => setNotification(null), 3000);
  };

  const handleClaim = async (eeveelution: Eeveelution) => {
    const claimedInfo = getClaimedInfo(eeveelution.pokedex_id, eeveelution.form);

    if (claimedInfo) {
      if (claimedInfo.userId === currentUserId) {
        // Unclaim if it's our own
        setClaiming(`${eeveelution.pokedex_id}-${eeveelution.form}`);
        try {
          await onUnclaim(eeveelution.pokedex_id, eeveelution.form);
          setIsClosing(true);
          setTimeout(() => {
            setIsExpanded(false);
            setIsClosing(false);
          }, 300);
        } catch (err: any) {
          showNotification(err?.message || 'Failed to unclaim Eeveelution');
        } finally {
          setClaiming(null);
        }
      } else {
        // Show notification for already claimed by others
        showNotification(`${claimedInfo.username} has already claimed that Eeveelution!`);
      }
    } else {
      // Claim if not claimed
      setClaiming(`${eeveelution.pokedex_id}-${eeveelution.form}`);
      try {
        await onClaim(eeveelution.pokedex_id, eeveelution.form);
        setIsClosing(true);
        setTimeout(() => {
          setIsExpanded(false);
          setIsClosing(false);
        }, 300);
      } catch (err: any) {
        const errorMsg = err?.message || '';
        if (errorMsg.includes('Already claimed by')) {
          const user = errorMsg.replace('Already claimed by', '').trim();
          showNotification(`${user} has already claimed that Eeveelution!`);
        } else if (errorMsg.includes('already claimed an Eeveelution')) {
          showNotification("You've already claimed an Eeveelution!");
        } else {
          showNotification(errorMsg || 'Failed to claim Eeveelution');
        }
      } finally {
        setClaiming(null);
      }
    }
  };

  const handleBack = () => {
    setIsClosing(true);
    setTimeout(() => {
      setIsExpanded(false);
      setIsClosing(false);
    }, 300);
  };

  return (
    <div className="eeveelution-claim-button-container">
      {/* Notification */}
      {notification && (
        <div className="eeveelution-notification">
          {notification}
        </div>
      )}

      {!isExpanded ? (
        <button
          className="eeveelution-main-button"
          onClick={() => setIsExpanded(true)}
        >
          Claim Eeveelution
        </button>
      ) : (
        <div className={`eeveelution-expanded-buttons ${isClosing ? 'closing' : ''}`}>
          {eeveelutions.map(eeveelution => {
            const claimedInfo = getClaimedInfo(eeveelution.pokedex_id, eeveelution.form);
            const isClaimed = !!claimedInfo;
            const isCurrentUserClaim = claimedInfo?.userId === currentUserId;
            const key = `${eeveelution.pokedex_id}-${eeveelution.form}`;
            const isClaiming = claiming === key;

            return (
              <button
                key={key}
                className={`eeveelution-individual-button ${isClaimed ? 'claimed' : ''} ${isCurrentUserClaim ? 'current-user' : ''}`}
                onClick={() => handleClaim(eeveelution)}
                disabled={isClaiming}
                title={isClaimed ? `Claimed by ${claimedInfo?.username}` : `Claim ${eeveelution.name}`}
              >
                <img
                  src={`/MiniIcons/${eeveelution.name.toLowerCase()}.png`}
                  alt={eeveelution.name}
                  className={`eeveelution-icon ${isClaimed && !isCurrentUserClaim ? 'greyed-out' : ''}`}
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = 'none';
                  }}
                />
              </button>
            );
          })}
          <button
            className="eeveelution-individual-button eeveelution-back-button"
            onClick={handleBack}
            title="Go back"
          >
            <FaArrowRight className="back-icon" />
          </button>
        </div>
      )}
    </div>
  );
};

export default EeveelutionClaimButton;
