import React, { useState } from 'react';
import { AdminHallOfFameEligibleEntry, HallOfFamePokemon } from '../../types';
import HallOfFameTeamEditor from '../../shared/components/HallOfFameTeamEditor';

interface HallOfFameTeamEditorModalProps {
  entry: AdminHallOfFameEligibleEntry;
  saving: boolean;
  onSave: (team: HallOfFamePokemon[]) => Promise<void>;
  onClose: () => void;
}

function formatBeatTime(hours: number, minutes: number, seconds: number): string {
  return `${hours}h ${minutes}m ${seconds}s`;
}

const HallOfFameTeamEditorModal: React.FC<HallOfFameTeamEditorModalProps> = ({
  entry,
  saving,
  onSave,
  onClose,
}) => {
  const [team, setTeam] = useState<HallOfFamePokemon[]>(entry.hall_of_fame_team);
  const [editorKey, setEditorKey] = useState(0);
  const [localError, setLocalError] = useState<string | null>(null);

  const handleSubmit = async () => {
    setLocalError(null);
    if (team.length === 0) {
      setLocalError('Enter at least one Pokemon.');
      return;
    }
    try {
      await onSave(team);
    } catch (e: any) {
      setLocalError(e?.response?.data ?? e?.message ?? 'Failed to save Hall of Fame team.');
    }
  };

  const handleClear = async () => {
    setLocalError(null);
    try {
      await onSave([]);
      setTeam([]);
      setEditorKey((key) => key + 1);
    } catch (e: any) {
      setLocalError(e?.response?.data ?? e?.message ?? 'Failed to clear Hall of Fame team.');
    }
  };

  return (
    <div className="race-results-modal-overlay" onClick={onClose}>
      <div
        className="race-results-modal hof-team-editor-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="race-results-modal-title">Hall of Fame Team</h3>
        <p className="race-results-modal-subtitle">
          {entry.user_name ?? 'Guest User'} — {entry.draft_name}
          <br />
          Beat {entry.beat_name} at {formatBeatTime(entry.hours, entry.minutes, entry.seconds)}.
          Enter up to 6 Pokemon the player had in their party.
        </p>

        {localError && <div className="race-results-message race-results-error">{localError}</div>}

        <HallOfFameTeamEditor
          key={editorKey}
          initialTeam={entry.hall_of_fame_team}
          onChange={setTeam}
          disabled={saving}
        />

        <div className="race-results-modal-footer">
          {team.length > 0 && (
            <button type="button" className="button danger" onClick={handleClear} disabled={saving}>
              Clear Team
            </button>
          )}
          <button type="button" className="button secondary" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="button" className="button" onClick={handleSubmit} disabled={saving}>
            {saving ? 'Saving...' : 'Save Team'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default HallOfFameTeamEditorModal;
