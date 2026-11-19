import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  DraftRaceResults,
  RaceResultTeam,
  RaceResultTeamUpdate,
} from '../../../types';
import {
  fetchDraftRaceResults,
  updateDraftRaceResults,
} from '../../../shared/api/stats';
import RaceResultsEditorModal from './RaceResultsEditorModal';

interface RaceResultsTabProps {
  draftId: string;
}

function teamSortKey(team: RaceResultTeam): number {
  return team.placement === null ? Number.MAX_SAFE_INTEGER : team.placement;
}

function formatEntry(team: RaceResultTeam): string {
  const userName = team.user_name || 'Guest User';
  let entry = `${userName}`;
  if (team.result) {
    entry += ` (${team.result}${team.detail ? ` [${team.detail}]` : ''})`;
  }
  return entry;
}

const RaceResultsTab: React.FC<RaceResultsTabProps> = ({ draftId }) => {
  const navigate = useNavigate();
  const [results, setResults] = useState<DraftRaceResults | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchDraftRaceResults(draftId);
      setResults(data);
    } catch (e: any) {
      console.error('[RaceResultsTab] Error fetching race results:', e);
      setError('Failed to load race results.');
    } finally {
      setLoading(false);
    }
  }, [draftId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleSave = async (teams: RaceResultTeamUpdate[]) => {
    setSaving(true);
    try {
      await updateDraftRaceResults(draftId, teams);
      setEditorOpen(false);
      await load();
    } finally {
      setSaving(false);
    }
  };

  const openFullRaceStats = (team: RaceResultTeam) => {
    const userId = team.user_id ?? team.guest_id;
    if (!userId) return;
    const params = new URLSearchParams({
      userId,
      teamId: String(team.team_id),
    });
    const displayName = team.user_name || 'Guest User';
    navigate(`/Stats/PlayerProfiles/${encodeURIComponent(displayName)}?${params.toString()}`);
  };

  if (loading) {
    return <div className="race-results-message">Loading race results...</div>;
  }

  if (error) {
    return <div className="race-results-message race-results-error">{error}</div>;
  }

  if (!results) {
    return null;
  }

  const sortedTeams = [...results.teams].sort((a, b) => {
    const byPlacement = teamSortKey(a) - teamSortKey(b);
    if (byPlacement !== 0) {
      return byPlacement;
    }
    return (a.user_name || '').localeCompare(b.user_name || '');
  });

  return (
    <div className="race-results-container">
      <div className="race-results-list">
        {sortedTeams.length === 0 && (
          <div className="race-results-message">No racers found.</div>
        )}
        {sortedTeams.map((team) => (
          <div
            className={`race-results-entry ${team.placement === null ? 'unranked' : ''}`}
            key={team.team_id}
          >
            <span className="race-results-placement">
              {team.placement !== null ? `${team.placement}.` : '-'}
            </span>
            <span className="race-results-user">{formatEntry(team)}</span>
            <button
              type="button"
              className="tab-chip race-results-full-stats-button"
              onClick={() => openFullRaceStats(team)}
            >
              Full Race Stats
            </button>
          </div>
        ))}
      </div>

      {results.can_edit && (
        <div className="race-results-actions">
          <button
            type="button"
            className="tab-chip race-results-edit-button"
            onClick={() => setEditorOpen(true)}
          >
            Enter Race Results
          </button>
        </div>
      )}

      {editorOpen && (
        <RaceResultsEditorModal
          teams={results.teams}
          saving={saving}
          onSave={handleSave}
          onClose={() => setEditorOpen(false)}
        />
      )}
    </div>
  );
};

export default RaceResultsTab;
