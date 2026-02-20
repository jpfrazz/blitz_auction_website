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

  const handlePlacementChange = (userId: string, placement: string) => {
    setPlacements({
      ...placements,
      [userId]: placement ? parseInt(placement, 10) : 0,
    });
  };

  const canSubmit = teams.every(team => team.user_id && placements[team.user_id]);

  const handleSubmit = async () => {
    if (!canSubmit) {
      setError('All teams must have a placement');
      return;
    }

    setError(null);
    setSubmitting(true);

    try {
      await onSubmit(placements);
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to submit results');
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

        <div className="results-form">
          {teams.map((team, index) => {
            if (!team.user_id) return null;
            
            const teamLabel = team.username || `Team ${index + 1}`;

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
                    <option key={place} value={place}>
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
