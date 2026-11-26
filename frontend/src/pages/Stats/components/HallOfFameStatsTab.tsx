import React, { useEffect, useMemo, useState } from 'react';
import { TbSettings, TbRefresh } from 'react-icons/tb';
import { fetchHallOfFameEligible } from '../../../shared/api/stats';
import { getAvatarUrl, onAvatarError } from '../../../shared/utils/user';
import { AdminHallOfFameEligibleEntry } from '../../../types';
import {
  buildDioramaSlots,
  getDioramaImageSources,
  getDioramaSlotStyle,
  type DioramaSlot,
} from '../../../utils/hallOfFameDiorama';
import {
  formatHallOfFameDate,
  formatHallOfFameTime,
  getHallOfFameClassification,
  getHallOfFameGlowRgb,
} from '../../../utils/hallOfFameLabels';

interface HallOfFameStatsTabProps {
  validDraftIds: Set<string>;
  casual1v1DraftIds: Set<string>;
  casualBoosterDraftIds?: Set<string>;
  currentUserId?: string | null;
  currentUsername?: string | null;
}

const DEFAULT_ENTRIES_PER_PAGE = 200;

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

interface SpotlightStyle extends React.CSSProperties {
  '--beam-origin-x': string;
  '--beam-source-w': string;
  '--beam-a': string;
  '--beam-b': string;
}

/** Deterministic pseudo-random value in [0, 1) so beams are stable, not animated. */
const seededRandom = (seed: number, salt: number): number => {
  const value = Math.sin(seed * 12.9898 + salt * 78.233) * 43758.5453;
  return value - Math.floor(value);
};

/** Static beam geometry seeded by team id, so entries vary widely as you scroll. */
const getSpotlightStyle = (
  teamId: number,
  side: 'left' | 'right',
): SpotlightStyle => {
  const salt = side === 'left' ? 0 : 4;
  const origin =
    side === 'left'
      ? seededRandom(teamId, salt) * 15
      : 85 + seededRandom(teamId, salt) * 15;
  const near = 26 + seededRandom(teamId, salt + 1) * 28;
  const far = Math.min(near + 18 + seededRandom(teamId, salt + 2) * 14, 76);
  const sourceWidth = 6 + seededRandom(teamId, salt + 3) * 5;
  return {
    '--beam-origin-x': `${origin.toFixed(1)}%`,
    '--beam-source-w': `${sourceWidth.toFixed(1)}%`,
    '--beam-a': `${near.toFixed(1)}%`,
    '--beam-b': `${far.toFixed(1)}%`,
  };
};

/** Only the entry owner (or franklynathan) may mirror its sprites. */
const canFlipHallOfFameEntry = (
  entry: AdminHallOfFameEligibleEntry,
  currentUserId: string | null,
  currentUsername: string | null,
): boolean => {
  if (currentUsername?.toLowerCase() === 'franklynathan') return true;
  if (currentUserId && entry.user_id) return entry.user_id === currentUserId;
  return (
    !entry.user_id && !!currentUsername && entry.user_name === currentUsername
  );
};

const DioramaPokemon: React.FC<{ slot: DioramaSlot; flippable: boolean }> = ({
  slot,
  flippable,
}) => {
  const sources = useMemo(
    () => getDioramaImageSources(slot.pokemon.name),
    [slot.pokemon.name],
  );
  const [sourceIndex, setSourceIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);

  useEffect(() => {
    setSourceIndex(0);
    setFlipped(false);
  }, [slot.pokemon.name]);

  const image = (
    <img
      src={sources[sourceIndex]}
      alt={slot.pokemon.name}
      title={slot.pokemon.name}
      style={flipped ? { transform: 'scaleX(-1)' } : undefined}
      onError={() =>
        setSourceIndex((current) => Math.min(current + 1, sources.length - 1))
      }
    />
  );

  const className = `hof-diorama-mon ${slot.side}${
    flippable ? ' hof-diorama-mon-flippable' : ''
  }`;
  const style = getDioramaSlotStyle(slot);

  return flippable ? (
    <button
      type="button"
      className={className}
      style={style}
      data-depth={slot.depth}
      aria-label={`Flip ${slot.pokemon.name}`}
      title={`Flip ${slot.pokemon.name}`}
      onClick={() => setFlipped((value) => !value)}
    >
      {image}
    </button>
  ) : (
    <div className={className} style={style} data-depth={slot.depth}>
      {image}
    </div>
  );
};

const HallOfFameStatsTab: React.FC<HallOfFameStatsTabProps> = ({
  validDraftIds,
  casual1v1DraftIds,
  casualBoosterDraftIds = new Set(),
  currentUserId = null,
  currentUsername = null,
}) => {
  const [entries, setEntries] = useState<AdminHallOfFameEligibleEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showFilters, setShowFilters] = useState(false);
  const [cutoffDate, setCutoffDate] = useState('');
  const [selectedChampion, setSelectedChampion] = useState('');
  const [selectedDraftType, setSelectedDraftType] = useState('');
  const [fasterThan, setFasterThan] = useState('');
  const [pokemonFilter, setPokemonFilter] = useState('');
  const [entriesPerPage, setEntriesPerPage] = useState(DEFAULT_ENTRIES_PER_PAGE);
  const [entriesPerPageInput, setEntriesPerPageInput] = useState(
    String(DEFAULT_ENTRIES_PER_PAGE),
  );
  const [page, setPage] = useState(0);

  // Load the full eligible list once per draft type so every page is reachable;
  // the entries-per-page field only controls how many are rendered at a time.
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    fetchHallOfFameEligible(undefined, selectedDraftType || undefined)
      .then((data) => {
        if (!active) return;
        setEntries(data.filter((entry) => entry.hall_of_fame_team.length > 0));
      })
      .catch((err: any) => {
        if (!active) return;
        setError(err?.message ?? 'Failed to load hall of fame teams.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [selectedDraftType]);

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
      if (selectedDraftType && entry.draft_type !== selectedDraftType) {
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
  }, [entries, cutoffDate, selectedChampion, selectedDraftType, fasterThan, pokemonFilter]);

  const pageCount = Math.max(1, Math.ceil(filteredEntries.length / entriesPerPage));
  const currentPage = Math.min(page, pageCount - 1);
  const pagedEntries = filteredEntries.slice(
    currentPage * entriesPerPage,
    (currentPage + 1) * entriesPerPage,
  );

  useEffect(() => {
    if (page !== currentPage) setPage(currentPage);
  }, [page, currentPage]);

  const commitEntriesPerPage = () => {
    const parsed = parseInt(entriesPerPageInput, 10);
    if (!Number.isNaN(parsed) && parsed > 0) {
      const clamped = Math.floor(parsed);
      setEntriesPerPage(clamped);
      setEntriesPerPageInput(String(clamped));
      setPage(0);
    } else {
      setEntriesPerPageInput(String(entriesPerPage));
    }
  };

  const resetFilters = () => {
    setCutoffDate('');
    setSelectedChampion('');
    setSelectedDraftType('');
    setFasterThan('');
    setPokemonFilter('');
    setEntriesPerPage(DEFAULT_ENTRIES_PER_PAGE);
    setEntriesPerPageInput(String(DEFAULT_ENTRIES_PER_PAGE));
    setPage(0);
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
          <div className="hof-heading-group">
            <h2 style={{ margin: 0 }}>Hall of Fame Teams</h2>
            <label className="hof-page-size-label">
              <span>Entries per page</span>
              <input
                className="stats-filter-input"
                type="number"
                min={1}
                step={1}
                aria-label="Entries per page"
                value={entriesPerPageInput}
                onChange={(e) => setEntriesPerPageInput(e.target.value)}
                onBlur={commitEntriesPerPage}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    commitEntriesPerPage();
                    (e.currentTarget as HTMLInputElement).blur();
                  }
                }}
              />
            </label>
          </div>
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
                className="stats-setting-item cutoff-date-label"
                style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
              >
                <span>Cutoff Date</span>
                <span
                  title="Exclude hall of fame runs that occurred before this date"
                  style={{
                    cursor: 'help',
                    color: 'var(--eb-primary)',
                    fontSize: '0.7rem',
                    border: '1px solid var(--eb-primary)',
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
                  style={{ width: '104px' }}
                  value={cutoffDate}
                  onChange={(e) => {
                    setCutoffDate(e.target.value);
                    setPage(0);
                  }}
                />
              </div>
              <div
                className="stats-setting-item champion-label"
                style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
              >
                <span>Champion</span>
                <select
                  className="stats-filter-input"
                  style={{ width: '96px' }}
                  value={selectedChampion}
                  onChange={(e) => {
                    setSelectedChampion(e.target.value);
                    setPage(0);
                  }}
                >
                  <option value="">Both</option>
                  <option value="Wally">Wally</option>
                  <option value="Steven">Steven</option>
                </select>
              </div>
              <div
                className="stats-setting-item"
                style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
              >
                <span>Draft Type</span>
                <select
                  className="stats-filter-input"
                  style={{ width: '99px' }}
                  value={selectedDraftType}
                  onChange={(e) => {
                    setSelectedDraftType(e.target.value);
                    setPage(0);
                  }}
                >
                  <option value="">All</option>
                  <option value="auction">Auction Draft</option>
                  <option value="1v1">1v1 Draft</option>
                  <option value="booster">Booster Draft</option>
                </select>
              </div>
              <div
                className="stats-setting-item faster-than-label"
                style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
              >
                <span>Faster Than</span>
                <span
                  title="Show only runs completed faster than this time (e.g. 1:30:00)"
                  style={{
                    cursor: 'help',
                    color: 'var(--eb-primary)',
                    fontSize: '0.7rem',
                    border: '1px solid var(--eb-primary)',
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
                  onChange={(e) => {
                    setFasterThan(e.target.value);
                    setPage(0);
                  }}
                />
              </div>
              <div
                className="stats-setting-item includes-label"
                style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
              >
                <span>Includes</span>
                <input
                  className="stats-filter-input"
                  type="text"
                  placeholder="e.g. Swampert"
                  style={{ textAlign: 'left' }}
                  value={pokemonFilter}
                  onChange={(e) => {
                    setPokemonFilter(e.target.value);
                    setPage(0);
                  }}
                />
              </div>
              <div
                className="settings-divider"
                style={{
                  width: '1px',
                  height: '24px',
                  backgroundColor: 'var(--eb-border, #2a2d31)',
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
                color: showFilters ? 'var(--eb-primary)' : 'var(--eb-text-muted, #b0b0b0)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                fontSize: '1.2rem',
                padding: '4px',
                transition: 'color 0.2s ease, transform 0.3s ease',
                transform: showFilters ? 'rotate(90deg)' : 'rotate(0deg)',
              }}
            >
              <TbSettings size={24} />
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
          <>
            <div className="admin-hof-entries">
              {pagedEntries.map((entry) => {
              const { left, right } = buildDioramaSlots(entry.hall_of_fame_team);
              const classification = getHallOfFameClassification(entry, {
                validDraftIds,
                casual1v1DraftIds,
                casualBoosterDraftIds,
              });
              const dateLabel = formatHallOfFameDate(entry.beat_date);
              const classificationText = dateLabel
                ? `${classification} • ${dateLabel}`
                : classification;
              const glowRgb = getHallOfFameGlowRgb(entry.draft_type);
              const canFlip = canFlipHallOfFameEntry(
                entry,
                currentUserId,
                currentUsername,
              );
              return (
                <div
                  className="admin-hof-entry"
                  key={entry.team_id}
                  style={{ '--hof-glow-rgb': glowRgb } as React.CSSProperties}
                >
                  <div className="hof-spotlights" aria-hidden="true">
                    <div
                      className="hof-spotlight left"
                      style={getSpotlightStyle(entry.team_id, 'left')}
                    />
                    <div
                      className="hof-spotlight right"
                      style={getSpotlightStyle(entry.team_id, 'right')}
                    />
                  </div>
                  <div className="admin-hof-entry-info">
                    <div className="admin-hof-entry-head">
                      <div className="admin-hof-entry-summary">
                        {entry.user_id ? (
                          <a
                            className="admin-hof-entry-player"
                            href={`/Stats/PlayerProfiles/${encodeURIComponent(entry.user_name ?? entry.user_id)}?userId=${encodeURIComponent(entry.user_id)}`}
                            target="_blank"
                            rel="noreferrer"
                            title="View match history"
                          >
                            <img
                              className="admin-hof-entry-avatar"
                              src={getAvatarUrl(entry.user_id)}
                              alt=""
                              onError={onAvatarError}
                            />
                            <span>{entry.user_name ?? '-'}</span>
                          </a>
                        ) : (
                          <div className="admin-hof-entry-player">
                            <img
                              className="admin-hof-entry-avatar"
                              src="/generic/DiscordAvatar.png"
                              alt=""
                            />
                            <span>{entry.user_name ?? '-'}</span>
                          </div>
                        )}{' '}
                        <span className="admin-hof-entry-beat">
                          beat {entry.beat_name} in {formatHallOfFameTime(entry)}
                        </span>
                      </div>
                    </div>
                    {entry.hall_of_fame_team.length > 0 && (
                      <div className="admin-hof-team-names">
                        {entry.hall_of_fame_team.map((mon, idx) => (
                          <React.Fragment key={`name-${idx}-${mon.name}`}>
                            {idx > 0 && (
                              <span className="admin-hof-team-separator" aria-hidden="true">
                                •
                              </span>
                            )}
                            <span className="admin-hof-team-name" title={mon.name}>
                              {mon.name}
                            </span>
                          </React.Fragment>
                        ))}
                      </div>
                    )}
                    <div className="admin-hof-classification">{classificationText}</div>
                  </div>
                  <div className="admin-hof-entry-body">
                    {entry.hall_of_fame_team.length > 0 ? (
                      <div className="hof-diorama">
                        <div className="hof-diorama-side left">
                          {left.map((slot, idx) => (
                            <DioramaPokemon
                              key={`left-${idx}-${slot.pokemon.name}`}
                              slot={slot}
                              flippable={canFlip}
                            />
                          ))}
                        </div>
                        <img
                          className="hof-diorama-trophy"
                          src="/generic/Trophy.png"
                          alt="Hall of Fame trophy"
                        />
                        <div className="hof-diorama-side right">
                          {right.map((slot, idx) => (
                            <DioramaPokemon
                              key={`right-${idx}-${slot.pokemon.name}`}
                              slot={slot}
                              flippable={canFlip}
                            />
                          ))}
                        </div>
                      </div>
                    ) : (
                      <span className="admin-hof-empty">No team entered yet.</span>
                    )}
                  </div>
                </div>
              );
              })}
            </div>
            {pageCount > 1 && (
              <div className="hof-pagination" aria-label="Hall of Fame pages">
                <button
                  type="button"
                  className="hof-page-button"
                  onClick={() => setPage(currentPage - 1)}
                  disabled={currentPage === 0}
                >
                  ‹ Previous
                </button>
                <span className="hof-page-status">
                  Page {currentPage + 1} of {pageCount} · showing{' '}
                  {currentPage * entriesPerPage + 1}–
                  {Math.min((currentPage + 1) * entriesPerPage, filteredEntries.length)} of{' '}
                  {filteredEntries.length}
                </span>
                <button
                  type="button"
                  className="hof-page-button"
                  onClick={() => setPage(currentPage + 1)}
                  disabled={currentPage >= pageCount - 1}
                >
                  Next ›
                </button>
              </div>
            )}
          </>
        )}
      </article>
    </section>
  );
};

export default HallOfFameStatsTab;
