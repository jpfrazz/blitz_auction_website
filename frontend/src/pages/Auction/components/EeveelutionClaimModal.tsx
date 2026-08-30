import React, { useState, useEffect } from 'react';
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
  isReferee?: boolean;
  onClaim: (pokedexId: number, form: string | null, targetUserId?: string | null) => Promise<void>;
  onUnclaim: (pokedexId: number, form: string | null, targetUserId?: string | null) => Promise<void>;
  bannedPokedexIds?: number[];
  onClose: () => void;
}

const EeveelutionClaimModal: React.FC<EeveelutionClaimModalProps> = ({
  eeveelutions,
  teams,
  currentUserId,
  isReferee = false,
  onClaim,
  onUnclaim,
  bannedPokedexIds = [],
  onClose,
}) => {
  const [claiming, setClaiming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [targetUserId, setTargetUserId] = useState<string | null>(currentUserId);

  useEffect(() => {
    setTargetUserId(currentUserId);
  }, [currentUserId]);

  // Determine which eeveelutions are already claimed by checking all teams
  const getClaimedInfo = (pokedexId: number, form: string | null): { username: string; userId: string } | null => {
    for (const team of teams) {
      if (team.auctions_won) {
        const claimed = team.auctions_won.find(
          p => p.pokedex_id === pokedexId && p.form === form
        );
        if (claimed) {
          return { username: team.username ?? '', userId: team.user_id ?? team.guest_id ?? '' };
        }
      }
    }
    return null;
  };

  const handleClaim = async (eeveelution: Eeveelution) => {
    setError(null);
    setClaiming(`${eeveelution.pokedex_id}-${eeveelution.form}`);

    try {
      await onClaim(eeveelution.pokedex_id, eeveelution.form, targetUserId);
    } catch (err: any) {
      setError(err?.message || 'Failed to claim Eeveelution');
    } finally {
      setClaiming(null);
    }
  };

  const handleUnclaim = async (eeveelution: Eeveelution, userIdToUnclaim: string) => {
    setError(null);
    setClaiming(`${eeveelution.pokedex_id}-${eeveelution.form}`);

    try {
      await onUnclaim(eeveelution.pokedex_id, eeveelution.form, userIdToUnclaim);
    } catch (err: any) {
      setError(err?.message || 'Failed to unclaim Eeveelution');
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
          <p>The first person to evolve an Eevee into each evolution gets exclusive rights to that form!</p>
        </div>

        {isReferee && (
          <div className="eeveelution-modal-referee-tools">
            <label htmlFor="target-user-select">Claiming on behalf of: </label>
            <select
              id="target-user-select"
              value={targetUserId || ''}
              onChange={(e) => setTargetUserId(e.target.value || null)}
            >
              <option value="">-- Select Team --</option>
              {teams.map((team, idx) => (
                <option key={team.user_id ?? team.guest_id ?? idx} value={team.user_id ?? team.guest_id ?? ''}>{team.username}</option>
              ))}
            </select>
          </div>
        )}

        <div className="eeveelution-modal-instruction">
          <p>Select which Eeveelution you've obtained in game:</p>
        </div>

        {error && <div className="eeveelution-modal-error">{error}</div>}

        <div className="eeveelution-grid">
          {eeveelutions.map(eeveelution => {
            const claimedInfo = getClaimedInfo(eeveelution.pokedex_id, eeveelution.form);
            const isClaimed = !!claimedInfo;
            const isCurrentUserClaim = claimedInfo?.userId === currentUserId;
            const canUnclaim = isCurrentUserClaim || (isReferee && isClaimed);
            const isBanned = bannedPokedexIds.includes(eeveelution.pokedex_id);
            const key = `${eeveelution.pokedex_id}-${eeveelution.form}`;
            const isClaiming = claiming === key;

            return (
              <div key={key} className={`eeveelution-card${isBanned ? ' banned' : ''}`}>
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

                {isBanned ? (
                  <button className="eeveelution-button banned" disabled>
                    Banned in 1v1 draft
                  </button>
                ) : isClaimed ? (
                  canUnclaim ? (
                    <button
                      className="eeveelution-button claimed current-user-unclaim"
                      onClick={() => handleUnclaim(eeveelution, claimedInfo!.userId)}
                      disabled={isClaiming || claiming !== null}
                    >
                      {isClaiming ? 'Unclaiming...' : isCurrentUserClaim ? 'Unclaim' : `Unclaim (${claimedInfo!.username})`}
                    </button>
                  ) : (
                    <button
                      className="eeveelution-button claimed"
                      disabled
                    >
                      {`Claimed by ${claimedInfo?.username}`}
                    </button>
                  )
                ) : (
                  <button
                    className="eeveelution-button"
                    onClick={() => handleClaim(eeveelution)}
                    disabled={isClaiming || claiming !== null}
                  >
                    {isClaiming ? 'Claiming...' : (isReferee && targetUserId !== currentUserId ? `Claim for ${teams.find(t => t.user_id === targetUserId)?.username || 'user'}` : 'Claim!')}
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
