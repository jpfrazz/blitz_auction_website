import React, { useEffect, useState } from 'react';
import { fetchHallOfFameEligible } from '../../../shared/api/stats';
import { AdminHallOfFameEligibleEntry } from '../../../types';
import { getIconName } from '../../../utils/speciesUtils';

const HallOfFameStatsTab: React.FC = () => {
  const [entries, setEntries] = useState<AdminHallOfFameEligibleEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetchHallOfFameEligible()
      .then(setEntries)
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
                <div className="admin-hof-entry-head">
                  <div className="admin-hof-entry-player">{entry.user_name ?? '-'}</div>
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
