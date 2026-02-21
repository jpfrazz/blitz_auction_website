import React, { useState } from 'react';
import { Team } from '../../../types';
import './EeveelutionClaimModal.scss';

interface Eeveelution {
  pokedex_id: number;
  name: string;
  form: null | string;
  claimed_by?: string;
}

interface EeveelutionClaimModalProps {
  eeveelutions: Eeveelution[];
  teams: Team[];
  currentUserId: string | null;
  onClaim: (pokedexId: number, form: string | null) => Promise<void>;
  onClose: () => void;
}

const EeveelutionClaimModal: React.FC<EeveelutionClaimModalProps> = ({
  eeveelutions,
  teams,
  currentUserId,
  onClaim,
  onClose,
}) => {
  const [claiming, setClaiming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  const handleClaim = async (eeveelution: Eeveelution) => {
    setError(null);
    setClaiming(`${eeveelution.pokedex_id}-${eeveelution.form}`);

    try {
      await onClaim(eeveelution.pokedex_id, eeveelution.form);
    } catch (err: any) {
      setError(err?.message || 'Failed to claim Eeveelution');
    } finally {
      setClaiming(null);
    }
  };

  return (
    <div
      className="eeveelution-modal-overlay"
      onClick={onClose}
    >
      <div
        className="eeveelution-modal"
        onClick={e => e.stopPropagation()}
      >
        <div className="eeveelution-modal-header">
          <h3 className="eeveelution-modal-title">Claim Your Eeveelution</h3>
          <button className="eeveelution-modal-close" onClick={onClose}>×</button>
        </div>

        <div className="eeveelution-modal-description">
          <p>First person to evolve an Eevee into each evolution gets exclusive rights to that form!</p>
        </div>

        <div className="eeveelution-modal-instruction">
          <p>Select which Eeveelution you want to use:</p>
        </div>

        {error && <div className="eeveelution-modal-error">{error}</div>}

        <div className="eeveelution-grid">
          {eeveelutions.map(eeveelution => {
            const claimedInfo = getClaimedInfo(eeveelution.pokedex_id, eeveelution.form);
            const isClaimed = !!claimedInfo;
            const isCurrentUserClaim = claimedInfo?.userId === currentUserId;
            const key = `${eeveelution.pokedex_id}-${eeveelution.form}`;
            const isClaiming = claiming === key;

            return (
              <div key={key} className="eeveelution-card">
                <div className="eeveelution-card-image">
                  <img 
                    src={`/evolutions/${eeveelution.name}.png`}
                    alt={eeveelution.name}
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none';
                    }}
                  />
                </div>
                <div className="eeveelution-card-name">{eeveelution.name}</div>

                {isClaimed ? (
                  <button
                    className={`eeveelution-button claimed ${isCurrentUserClaim ? 'current-user' : ''}`}
                    disabled
                  >
                    {isCurrentUserClaim ? 'Your Pick!' : `Claimed by ${claimedInfo?.username}`}
                  </button>
                ) : (
                  <button
                    className="eeveelution-button"
                    onClick={() => handleClaim(eeveelution)}
                    disabled={isClaiming || claiming !== null}
                  >
                    {isClaiming ? 'Claiming...' : 'Claim!'}
                  </button>
                )}
              </div>
            );
          })}
        </div>

        <div className="eeveelution-modal-footer">
          <button className="button" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
};

export default EeveelutionClaimModal;
