import React, { useEffect, useState } from 'react';
import { fetchHallOfFameEligible } from '../../../shared/api/stats';
import { AdminHallOfFameEligibleEntry } from '../../../types';
import { getIconName } from '../../../utils/speciesUtils';

interface HallOfFameStatsTabProps {
  validDraftIds: Set<string>;
}

const HallOfFameStatsTab: React.FC<HallOfFameStatsTabProps> = ({ validDraftIds }) => {
  const [entries, setEntries] = useState<AdminHallOfFameEligibleEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetchHallOfFameEligible()
      .then((data) => setEntries(data.filter((entry) => entry.hall_of_fame_team.length > 0)))
      .catch((err: any) => setError(err?.message ?? 'Failed to load hall of fame teams.'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <section className="stats-content-grid">
      <article className="stats-panel">
        <h2>Hall of Fame Teams</h2>
        {error && <div className="admin-message admin-error">{error}</div>}
        {loading ? (
          <div className="admin-message">Loading hall of fame teams...</div>
        ) : entries.length === 0 ? (
          <div className="admin-message">
            No Hall of Fame qualifiers (runs that beat Steven or Wally) recorded yet.
          </div>
        ) : (
          <div className="admin-hof-entries">
            {entries.map((entry) => (
              <div className="admin-hof-entry" key={entry.team_id}>
                {entry.draft_type === '1v1' ? (
                  <div className="admin-hof-draft-type one-v-one">1v1 Draft</div>
                ) : (
                  <div
                    className={`admin-hof-draft-type ${validDraftIds.has(entry.draft_id) ? 'competitive' : 'casual'}`}
                  >
                    {validDraftIds.has(entry.draft_id) ? 'Competitive Draft' : 'Casual Draft'}
                  </div>
                )}
                <div className="admin-hof-entry-head">
                  {entry.user_id ? (
                    <a
                      className="admin-hof-entry-player"
                      href={`/Stats?tab=player-search&userId=${encodeURIComponent(entry.user_id)}`}
                      target="_blank"
                      rel="noreferrer"
                      title="View match history"
                    >
                      {entry.user_name ?? '-'}
                    </a>
                  ) : (
                    <div className="admin-hof-entry-player">{entry.user_name ?? '-'}</div>
                  )}
                  <div className="admin-hof-entry-race">
                    on{' '}
                    {entry.beat_date
                      ? new Date(entry.beat_date).toLocaleDateString('en-US', {
                          month: 'numeric',
                          day: 'numeric',
                          year: '2-digit',
                        })
                      : '-'}
                  </div>
                  <div className="admin-hof-entry-beat">
                    Beat {entry.beat_name}
                    <span className="admin-hof-entry-time">
                      {' '}
                      at {entry.hours}h {entry.minutes}m {entry.seconds}s
                    </span>
                  </div>
                </div>
                <div className="admin-hof-entry-body">
                  {entry.hall_of_fame_team.length > 0 ? (
                    <div className="admin-hof-team-icons">
                      {entry.hall_of_fame_team.map((mon, idx) => (
                        <div className="admin-hof-team-icon" key={idx} title={mon.name}>
                          <img
                            src={`/MiniIcons/${getIconName(mon.name)}.png`}
                            alt={mon.name}
                            onError={(e) => {
                              (e.currentTarget as HTMLImageElement).src =
                                '/MiniIcons/question.png';
                            }}
                          />
                          <span>{mon.name}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <span className="admin-hof-empty">No team entered yet.</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </article>
    </section>
  );
};

export default HallOfFameStatsTab;
