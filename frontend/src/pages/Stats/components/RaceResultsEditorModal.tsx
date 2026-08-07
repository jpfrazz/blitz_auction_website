import React, { useMemo, useState } from 'react';
import { RaceResultTeam, RaceResultTeamUpdate } from '../../../types';

interface RaceResultsEditorModalProps {
  teams: RaceResultTeam[];
  saving: boolean;
  onSave: (teams: RaceResultTeamUpdate[]) => Promise<void>;
  onClose: () => void;
}

const RaceResultsEditorModal: React.FC<RaceResultsEditorModalProps> = ({
  teams,
  saving,
  onSave,
  onClose,
}) => {
  const [placements, setPlacements] = useState<Record<number, number | null>>(() => {
    const initial: Record<number, number | null> = {};
    teams.forEach((team) => {
      initial[team.team_id] = team.placement;
    });
    return initial;
  });

  const [wipeTrainers, setWipeTrainers] = useState<Record<number, string>>(() => {
    const initial: Record<number, string> = {};
    teams.forEach((team) => {
      initial[team.team_id] = team.wipe_trainer ?? '';
    });
    return initial;
  });

  const [localError, setLocalError] = useState<string | null>(null);

  const teamCount = teams.length;

  const selectedPlacements = useMemo(
    () => Object.values(placements).filter((p): p is number => p !== null),
    [placements],
  );

  const hasDuplicatePlacements = new Set(selectedPlacements).size !== selectedPlacements.length;

  const handlePlacementChange = (teamId: number, value: string) => {
    setPlacements((prev) => ({
      ...prev,
      [teamId]: value === '' ? null : Math.min(Math.max(parseInt(value, 10) || 0, 1), teamCount),
    }));
  };

  const handleWipeChange = (teamId: number, value: string) => {
    setWipeTrainers((prev) => ({ ...prev, [teamId]: value }));
  };

  const handleSubmit = async () => {
    if (hasDuplicatePlacements) {
      setLocalError('Each racer must have a unique placement.');
      return;
    }

    setLocalError(null);
    try {
      await onSave(
        teams.map((team) => ({
          team_id: team.team_id,
          placement: placements[team.team_id] ?? null,
          wipe_trainer: (wipeTrainers[team.team_id] ?? '').trim() || null,
        })),
      );
    } catch (e: any) {
      setLocalError(e?.response?.data ?? e?.message ?? 'Failed to save race results.');
    }
  };

  return (
    <div className="race-results-modal-overlay" onClick={onClose}>
      <div className="race-results-modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="race-results-modal-title">Enter Race Results</h3>
        <p className="race-results-modal-subtitle">
          Assign an overall placement to each racer (1 = 1st place). Optionally add a trainer
          they wiped to.
        </p>

        {localError && <div className="race-results-message race-results-error">{localError}</div>}

        <div className="race-results-editor-list">
          {teams.map((team) => {
            const teamLabel = team.user_name || 'Guest User';
            const currentPlacement = placements[team.team_id];
            const placementsTakenByOthers = new Set(
              teams
                .filter((other) => other.team_id !== team.team_id)
                .map((other) => placements[other.team_id])
                .filter((p): p is number => p !== null),
            );

            return (
              <div className="race-results-editor-row" key={team.team_id}>
                <span className="race-results-editor-label">{teamLabel}</span>
                <select
                  className="race-results-editor-select"
                  value={currentPlacement ?? ''}
                  onChange={(e) => handlePlacementChange(team.team_id, e.target.value)}
                  disabled={saving}
                >
                  <option value="">No placement</option>
                  {Array.from({ length: teamCount }, (_, i) => i + 1).map((place) => (
                    <option
                      key={place}
                      value={place}
                      disabled={place !== currentPlacement && placementsTakenByOthers.has(place)}
                    >
                      {place}
                      {place === 1 ? 'st' : place === 2 ? 'nd' : place === 3 ? 'rd' : 'th'} Place
                    </option>
                  ))}
                </select>
                <input
                  className="race-results-editor-input"
                  type="text"
                  placeholder="Wiped to..."
                  value={wipeTrainers[team.team_id] ?? ''}
                  onChange={(e) => handleWipeChange(team.team_id, e.target.value)}
                  disabled={saving}
                />
              </div>
            );
          })}
        </div>

        <div className="race-results-modal-footer">
          <button
            type="button"
            className="button secondary"
            onClick={onClose}
            disabled={saving}
          >
            Cancel
          </button>
          <button
            type="button"
            className="button"
            onClick={handleSubmit}
            disabled={saving}
          >
            {saving ? 'Saving...' : 'Save Results'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default RaceResultsEditorModal;
