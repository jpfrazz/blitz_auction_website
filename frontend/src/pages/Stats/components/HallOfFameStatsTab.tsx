import React, { useEffect, useMemo, useState } from 'react';
import { TbSettings, TbRefresh } from 'react-icons/tb';
import { fetchHallOfFameEligible } from '../../../shared/api/stats';
import { AdminHallOfFameEligibleEntry } from '../../../types';
import { getIconName } from '../../../utils/speciesUtils';

interface HallOfFameStatsTabProps {
  validDraftIds: Set<string>;
}

function parseTimeToSeconds(input: string): number | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(':').map((p) => p.trim());
  if (parts.length > 3 || parts.some((p) => p === '' || !/^\d+$/.test(p))) {
    return null;
  }
  const nums = parts.map((p) => parseInt(p, 10));
  if (nums.some((n) => isNaN(n))) return null;
  let seconds: number;
  if (nums.length === 3) {
    seconds = nums[0] * 3600 + nums[1] * 60 + nums[2];
  } else if (nums.length === 2) {
    seconds = nums[0] * 60 + nums[1];
  } else {
    seconds = nums[0];
  }
  return seconds;
}

const HallOfFameStatsTab: React.FC<HallOfFameStatsTabProps> = ({ validDraftIds }) => {
  const [entries, setEntries] = useState<AdminHallOfFameEligibleEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showFilters, setShowFilters] = useState(false);
  const [cutoffDate, setCutoffDate] = useState('');
  const [selectedChampion, setSelectedChampion] = useState('');
  const [fasterThan, setFasterThan] = useState('');
  const [pokemonFilter, setPokemonFilter] = useState('');

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetchHallOfFameEligible()
      .then((data) => setEntries(data.filter((entry) => entry.hall_of_fame_team.length > 0)))
      .catch((err: any) => setError(err?.message ?? 'Failed to load hall of fame teams.'))
      .finally(() => setLoading(false));
  }, []);

  const filteredEntries = useMemo(() => {
    const fasterThanSeconds = parseTimeToSeconds(fasterThan);
    const query = pokemonFilter.trim().toLowerCase();

    return entries.filter((entry) => {
      if (cutoffDate && entry.beat_date && entry.beat_date < cutoffDate) {
        return false;
      }
      if (selectedChampion && entry.beat_name !== selectedChampion) {
        return false;
      }
      if (fasterThanSeconds !== null) {
        const entrySeconds = entry.hours * 3600 + entry.minutes * 60 + entry.seconds;
        if (entrySeconds >= fasterThanSeconds) {
          return false;
        }
      }
      if (query) {
        const match = entry.hall_of_fame_team.some((mon) =>
          mon.name.toLowerCase().includes(query)
        );
        if (!match) {
          return false;
        }
      }
      return true;
    });
  }, [entries, cutoffDate, selectedChampion, fasterThan, pokemonFilter]);

  const resetFilters = () => {
    setCutoffDate('');
    setSelectedChampion('');
    setFasterThan('');
    setPokemonFilter('');
  };

  return (
    <section className="stats-content-grid">
      <article className="stats-panel">
        <div
          className="stats-panel-header hof-filter-bar"
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '1rem',
          }}
        >
          <h2 style={{ margin: 0 }}>Hall of Fame Teams</h2>
          <div className="pokemon-search-bar" style={{ display: 'flex', alignItems: 'center' }}>
            <div className={`stats-analysis-settings ${showFilters ? 'visible' : ''}`}>
              <button
                type="button"
                className="stats-reset-button"
                onClick={resetFilters}
                title="Reset filters to default"
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#888',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  fontSize: '1.1rem',
                  padding: '4px',
                  flexShrink: 0,
                  transition: 'color 0.2s ease',
                }}
              >
                <TbRefresh />
              </button>
              <div
                className="stats-setting-item"
                style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
              >
                <span style={{ fontSize: '0.85rem', color: '#888', whiteSpace: 'nowrap' }}>
                  Cutoff Date
                </span>
                <span
                  title="Exclude hall of fame runs that occurred before this date"
                  style={{
                    cursor: 'help',
                    color: '#888',
                    fontSize: '0.7rem',
                    border: '1px solid #444',
                    borderRadius: '50%',
                    width: '14px',
                    height: '14px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  i
                </span>
                <input
                  className="stats-filter-input"
                  type="date"
                  style={{ width: '130px' }}
                  value={cutoffDate}
                  onChange={(e) => setCutoffDate(e.target.value)}
                />
              </div>
              <div
                className="stats-setting-item"
                style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
              >
                <span style={{ fontSize: '0.85rem', color: '#888', whiteSpace: 'nowrap' }}>
                  Champion
                </span>
                <select
                  className="stats-filter-input"
                  style={{ width: '96px' }}
                  value={selectedChampion}
                  onChange={(e) => setSelectedChampion(e.target.value)}
                >
                  <option value="">All</option>
                  <option value="Wally">Wally</option>
                  <option value="Steven">Steven</option>
                </select>
              </div>
              <div
                className="stats-setting-item"
                style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
              >
                <span style={{ fontSize: '0.85rem', color: '#888', whiteSpace: 'nowrap' }}>
                  Faster Than
                </span>
                <span
                  title="Show only runs completed faster than this time (e.g. 1:30:00)"
                  style={{
                    cursor: 'help',
                    color: '#888',
                    fontSize: '0.7rem',
                    border: '1px solid #444',
                    borderRadius: '50%',
                    width: '14px',
                    height: '14px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  i
                </span>
                <input
                  className="stats-filter-input"
                  type="text"
                  placeholder="H:MM:SS"
                  style={{ width: '78px', textAlign: 'left' }}
                  value={fasterThan}
                  onChange={(e) => setFasterThan(e.target.value)}
                />
              </div>
              <div
                className="stats-setting-item"
                style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
              >
                <span style={{ fontSize: '0.85rem', color: '#888', whiteSpace: 'nowrap' }}>
                  Includes
                </span>
                <input
                  className="stats-filter-input"
                  type="text"
                  placeholder="e.g. Swampert"
                  style={{ width: '130px', textAlign: 'left' }}
                  value={pokemonFilter}
                  onChange={(e) => setPokemonFilter(e.target.value)}
                />
              </div>
              <div
                className="settings-divider"
                style={{
                  width: '1px',
                  height: '24px',
                  backgroundColor: '#333',
                  margin: '0 4px',
                  flexShrink: 0,
                }}
              />
            </div>
            <button
              type="button"
              className={`stats-settings-toggle ${showFilters ? 'active' : ''}`}
              onClick={() => setShowFilters(!showFilters)}
              title="Filters"
              style={{
                background: 'none',
                border: 'none',
                color: showFilters ? '#4caf50' : '#888',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                fontSize: '1.2rem',
                padding: '4px',
                transition: 'color 0.2s ease, transform 0.3s ease',
                transform: showFilters ? 'rotate(90deg)' : 'rotate(0deg)',
              }}
            >
              <TbSettings size={30} />
            </button>
          </div>
        </div>
        {error && <div className="admin-message admin-error">{error}</div>}
        {loading ? (
          <div className="admin-message">Loading hall of fame teams...</div>
        ) : filteredEntries.length === 0 ? (
          <div className="admin-message">
            {entries.length === 0
              ? 'No Hall of Fame qualifiers (runs that beat Steven or Wally) recorded yet.'
              : 'No hall of fame teams match the current filters.'}
          </div>
        ) : (
          <div className="admin-hof-entries">
            {filteredEntries.map((entry) => (
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
