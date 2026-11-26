import React from 'react';
import { BoosterAction, BoosterState, Pokemon } from '../../../types';
import { boosterPlayerColor } from '../playerColors';
import '../../Draft1v1/components/OneVOneInfoPanel.scss';
import './BoosterInfoPanel.scss';

interface BoosterInfoPanelProps {
  booster: BoosterState;
  currentUserId: string | null;
  hasPack: boolean;
  selectedPokemon?: Pokemon | null;
  canConfirm: boolean;
  onConfirm: () => void;
}

const getTypeIconSrc = (type: string) =>
  `/TypeIcons/${type.charAt(0).toUpperCase()}${type.slice(1).toLowerCase()}IC_SV.png`;

const BoosterInfoPanel: React.FC<BoosterInfoPanelProps> = ({
  booster,
  currentUserId,
  hasPack,
  selectedPokemon,
  canConfirm,
  onConfirm,
}) => {
  const me = booster.submissions.find((s) => s.user_id === currentUserId);
  const myColor = boosterPlayerColor(booster.player_ids.indexOf(currentUserId ?? ''));
  const picked = !!me?.has_picked;
  const banned = !!me?.has_banned;
  const warded = !!me?.has_warded;
  const action: BoosterAction | null = !hasPack
    ? null
    : !picked
      ? 'Pick'
      : booster.bans_enabled && !banned
        ? 'Ban'
        : booster.wards_enabled && !warded
          ? 'Ward'
          : null;
  const pickedCount = booster.submissions.filter((s) => s.has_picked).length;
  const bannedCount = booster.submissions.filter((s) => s.has_banned).length;
  const wardedCount = booster.submissions.filter((s) => s.has_warded).length;
  const total = booster.player_ids.length;
  const readyCount = pickedCount +
    (booster.bans_enabled ? bannedCount : 0) +
    (booster.wards_enabled ? wardedCount : 0);
  const requiredCount = total * (
    1 +
    (booster.bans_enabled ? 1 : 0) +
    (booster.wards_enabled ? 1 : 0)
  );
  const progress = Math.round((readyCount / Math.max(1, requiredCount)) * 100);

  return (
    <div className="auction-info-box one-v-one-info-box booster-info-box" style={{ flexShrink: 0 }}>
      <div className="auction-countdown-container">
        <div className="countdown-header-row">
          <div className="countdown-text booster-round-label">
            Pass {Math.min(booster.round, booster.total_rounds)} / {booster.total_rounds}
          </div>
          <span className="booster-phase-label">
            {booster.bans_enabled ? 'Pick & Ban' : 'Pick only'}
          </span>
        </div>
        <div className="countdown-bar-background">
          <div className="countdown-bar-progress" style={{ width: `${progress}%`, backgroundColor: '#317b58' }} />
        </div>
      </div>

      <div className="booster-submission-counts">
        <span>Picks ready: {pickedCount}/{total}</span>
        {booster.bans_enabled && <span>Bans ready: {bannedCount}/{total}</span>}
        {booster.wards_enabled && <span>Wards ready: {wardedCount}/{total}</span>}
      </div>

      <div
        className={`one-v-one-info-message ${action === 'Ban' ? 'player-name-p2' : 'player-name-p1'}`}
        style={action ? { color: myColor } : undefined}
      >
        {action === 'Pick'
          ? 'Your Pick'
          : action === 'Ban'
            ? 'Your Ban'
            : action === 'Ward'
              ? 'Your Ward'
              : hasPack
                ? 'Waiting for all players to pick…'
                : `Pass ${booster.round} in progress`}
      </div>

      {action === 'Ward' && <div className="booster-ward-note">Make a Pokémon Ban-Proof</div>}

      {!booster.bans_enabled && (
        <div className="booster-casual-note">No bans after the first cycle.</div>
      )}

      {selectedPokemon ? (
        <div className="auction-pokemon-section">
          <div className="pokemon-info-display">
            <img
              src={`/MiniIcons/${selectedPokemon.name.toLowerCase()}.png`}
              alt={selectedPokemon.name}
              className="pokemon-info-icon"
              onError={(event) => { (event.target as HTMLImageElement).style.display = 'none'; }}
            />
            <h2 className="pokemon-name">{selectedPokemon.name}</h2>
            <div className="pokemon-info-types">
              {selectedPokemon.type1 && (
                <img src={getTypeIconSrc(selectedPokemon.type1)} alt={selectedPokemon.type1} className="pokemon-info-type-icon" />
              )}
              {selectedPokemon.type2 && (
                <img src={getTypeIconSrc(selectedPokemon.type2)} alt={selectedPokemon.type2} className="pokemon-info-type-icon" />
              )}
            </div>
          </div>
          <button
            type="button"
            className="bid-button one-v-one-confirm-button"
            disabled={!canConfirm || !action}
            onClick={onConfirm}
          >
            {action ?? 'Pick'}
          </button>
        </div>
      ) : null}
    </div>
  );
};

export default BoosterInfoPanel;
