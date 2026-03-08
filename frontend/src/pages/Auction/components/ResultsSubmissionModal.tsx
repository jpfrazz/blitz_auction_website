import React, { useState } from 'react';
import './ResultsSubmissionModal.scss';

interface Team {
  user_id: string | null;
  username: string;
}

interface ResultsSubmissionModalProps {
  teams: Team[];
  currentUserId: string | null;
  onSubmit: (placements: Record<string, number>) => Promise<void>;
  onClose: () => void;
}

const ResultsSubmissionModal: React.FC<ResultsSubmissionModalProps> = ({
  teams,
  currentUserId,
  onSubmit,
  onClose,
}) => {
  const [placements, setPlacements] = useState<Record<string, number>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handlePlacementChange = (userId: string, placement: string) => {
    setPlacements({
      ...placements,
      [userId]: placement ? parseInt(placement, 10) : 0,
    });
  };

  const selectedPlacements = teams
    .map(team => (team.user_id ? placements[team.user_id] ?? 0 : 0))
    .filter(place => place > 0);

  const hasDuplicatePlacements = new Set(selectedPlacements).size !== selectedPlacements.length;

  const canSubmit = teams.every(team => team.user_id && placements[team.user_id]) && !hasDuplicatePlacements;

  const handleSubmit = async () => {
    if (!teams.every(team => team.user_id && placements[team.user_id])) {
      setError('All teams must have a placement');
      setSuccess(null);
      return;
    }

    if (hasDuplicatePlacements) {
      setError('Each team must have a unique placement');
      setSuccess(null);
      return;
    }

    setError(null);
    setSuccess(null);
    setSubmitting(true);

    try {
      await onSubmit(placements);
      setSuccess('Results submitted successfully');
      window.setTimeout(() => {
        onClose();
      }, 1200);
    } catch (err: any) {
      setError(err?.message || 'Failed to submit results');
      setSuccess(null);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="results-modal-overlay"
      onClick={onClose}
    >
      <div
        className="results-modal"
        onClick={e => e.stopPropagation()}
      >
        <h3 className="results-modal-title">Submit Race Results</h3>
        <p className="results-modal-subtitle">
          Rank each team by their finishing position (1 = 1st place, etc.)
        </p>

        {error && <div className="results-modal-error">{error}</div>}
        {success && <div className="results-modal-success">{success}</div>}

        <div className="results-form">
          {teams.map((team, index) => {
            if (!team.user_id) return null;
            
            const teamLabel = team.username || `Team ${index + 1}`;
            const currentTeamPlacement = placements[team.user_id] || 0;
            const placementsTakenByOthers = new Set(
              teams
                .filter(other => other.user_id && other.user_id !== team.user_id)
                .map(other => (other.user_id ? placements[other.user_id] || 0 : 0))
                .filter(place => place > 0)
            );

            return (
              <div key={team.user_id} className="results-form-row">
                <label className="results-form-label">
                  {teamLabel}
                  {currentUserId === team.user_id && <span className="current-user-badge">You</span>}
                </label>
                <select
                  className="results-form-select"
                  value={placements[team.user_id] || 0}
                  onChange={e => handlePlacementChange(team.user_id!, e.target.value)}
                  disabled={submitting}
                >
                  <option value={0}>Select placement...</option>
                  {Array.from({ length: teams.length }, (_, i) => i + 1).map(place => (
                    <option
                      key={place}
                      value={place}
                      disabled={place !== currentTeamPlacement && placementsTakenByOthers.has(place)}
                    >
                      {place}{place === 1 ? 'st' : place === 2 ? 'nd' : place === 3 ? 'rd' : 'th'} Place
                    </option>
                  ))}
                </select>
              </div>
            );
          })}
        </div>

        <div className="results-modal-footer">
          <button
            className="button secondary"
            onClick={onClose}
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            className="button"
            onClick={handleSubmit}
            disabled={submitting || !canSubmit}
          >
            {submitting ? 'Submitting...' : 'Submit Results'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ResultsSubmissionModal;
