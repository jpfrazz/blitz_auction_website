import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  BossBattleHistoryEntry,
  fetchBossBattleHistory,
  fetchMatchHistoryByUserId,
  fetchStatsPageData,
} from '../../shared/api/stats';
import { fetchManualAchievements, ManualAchievementOverride } from '../../shared/api/achievements';
import { getAvatarUrl, onAvatarError } from '../../shared/utils/user';
import { getTrainerNameById } from '../../utils/parseSaveFile';
import {
  BOSS_TRAINER_GROUPS,
  getSeenItAllProgress,
  SeenItAllProgress,
} from '../Stats/achievements';
import { fetchAdminDiscordUsers } from '../../shared/api/users';
import { AdminDiscordUser, MatchHistoryTeam, StatsPageResponse } from '../../types';
import './SeenItAllProgressPanel.scss';

const ACHIEVEMENT_ID = 'seen-it-all';

const SeenItAllProgressPanel: React.FC = () => {
  const [users, setUsers] = useState<AdminDiscordUser[]>([]);
  const [stats, setStats] = useState<StatsPageResponse | null>(null);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedUser, setSelectedUser] = useState<AdminDiscordUser | null>(null);
  const [progress, setProgress] = useState<SeenItAllProgress | null>(null);
  const [loadingProgress, setLoadingProgress] = useState(false);
  const [progressError, setProgressError] = useState<string | null>(null);
  const [manualOverride, setManualOverride] = useState<boolean | null>(null);
  const [onlyMissing, setOnlyMissing] = useState(false);
  const selectionRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    setLoadingUsers(true);
    setUsersError(null);

    Promise.all([fetchStatsPageData(), fetchAdminDiscordUsers()])
      .then(([statsData, userRows]) => {
        if (cancelled) return;
        setStats(statsData);
        setUsers(userRows);
      })
      .catch((e) => {
        if (!cancelled) setUsersError(e instanceof Error ? e.message : 'Failed to load users.');
      })
      .finally(() => {
        if (!cancelled) setLoadingUsers(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // The player profile drops junk drafts before computing achievements; use
  // the same filter so this check shows what the player's profile actually sees.
  const junkDraftIds = useMemo(() => {
    const soldCount = new Map<string, number>();
    (stats?.auctions ?? []).forEach((auction) => {
      if (auction.winning_bid === null) return;
      soldCount.set(auction.draft_id, (soldCount.get(auction.draft_id) ?? 0) + 1);
    });
    const junk = new Set<string>();
    soldCount.forEach((count, draftId) => {
      if (count < 16 || count > 150) junk.add(draftId);
    });
    return junk;
  }, [stats?.auctions]);

  const suggestions = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return [];
    return users
      .filter((user) =>
        user.user_name.toLowerCase().includes(query) ||
        (user.global_name ?? '').toLowerCase().includes(query) ||
        user.user_id.includes(query),
      )
      .slice(0, 10);
  }, [search, users]);

  const clearResult = () => {
    selectionRef.current += 1;
    setSelectedUser(null);
    setProgress(null);
    setManualOverride(null);
    setProgressError(null);
    setSearch('');
    setShowSuggestions(false);
  };

  const handleSearchChange = (value: string) => {
    selectionRef.current += 1;
    setSearch(value);
    setShowSuggestions(true);
    setSelectedUser(null);
    setProgress(null);
    setManualOverride(null);
    setProgressError(null);
  };

  const handleSelectUser = async (user: AdminDiscordUser) => {
    const requestId = ++selectionRef.current;
    setSelectedUser(user);
    setSearch(user.global_name || user.user_name);
    setShowSuggestions(false);
    setProgress(null);
    setManualOverride(null);
    setProgressError(null);
    setLoadingProgress(true);

    try {
      const [history, overrides]: [MatchHistoryTeam[], ManualAchievementOverride[]] = await Promise.all([
        fetchMatchHistoryByUserId(user.user_id),
        fetchManualAchievements(user.user_id).catch(() => []),
      ]);
      if (requestId !== selectionRef.current) return;

      const eligibleHistory = history.filter((team) => !junkDraftIds.has(team.draft_id));
      const bossHistory = new Map<number, BossBattleHistoryEntry[]>();
      await Promise.all(
        eligibleHistory.map(async (team) => {
          try {
            bossHistory.set(team.team_id, await fetchBossBattleHistory(team.draft_id, user.user_id));
          } catch {
            // A run without approved boss battle history simply contributes no splits.
          }
        }),
      );
      if (requestId !== selectionRef.current) return;

      setProgress(getSeenItAllProgress(eligibleHistory, bossHistory));
      const override = overrides.find((item) => item.achievement_id === ACHIEVEMENT_ID);
      setManualOverride(override ? override.earned : null);
    } catch (e) {
      if (requestId !== selectionRef.current) return;
      setProgressError(e instanceof Error ? e.message : 'Failed to load Seen It All progress.');
    } finally {
      if (requestId === selectionRef.current) setLoadingProgress(false);
    }
  };

  const automaticEarned = progress !== null && progress.seenIds.size >= progress.total;
  const effectiveEarned = manualOverride !== null ? manualOverride : automaticEarned;
  const percentage = progress && progress.total > 0 ? (progress.seenIds.size / progress.total) * 100 : 0;

  return (
    <div className="admin-seen-it-all">
      <p className="admin-submissions-hint">
        Look up a user to see how many of the {BOSS_TRAINER_GROUPS.reduce((sum, group) => sum + group.ids.length, 0)}{' '}
        boss trainers they have faced. This uses the same approved boss battle history and junk-draft
        filter as the achievement on player profiles.
      </p>

      <div className="admin-seen-it-all-search">
        <input
          type="text"
          placeholder="Search users by name or Discord ID..."
          value={search}
          disabled={loadingUsers}
          onChange={(e) => handleSearchChange(e.target.value)}
          onFocus={() => setShowSuggestions(true)}
        />
        {selectedUser && (
          <button type="button" className="button" onClick={clearResult}>
            Clear
          </button>
        )}
        {showSuggestions && search.trim() && suggestions.length > 0 && (
          <div className="admin-seen-it-all-suggestions">
            {suggestions.map((user) => (
              <button
                type="button"
                key={user.user_id}
                className="admin-seen-it-all-suggestion"
                onClick={() => handleSelectUser(user)}
              >
                <img src={getAvatarUrl(user.user_id)} alt="" onError={onAvatarError} />
                <span className="admin-seen-it-all-suggestion-name">{user.global_name || user.user_name}</span>
                <span className="admin-seen-it-all-suggestion-id">{user.user_name}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {loadingUsers && <div className="admin-message">Loading users...</div>}
      {usersError && <div className="admin-message admin-error">{usersError}</div>}
      {loadingProgress && <div className="admin-message">Loading Seen It All progress...</div>}
      {progressError && <div className="admin-message admin-error">{progressError}</div>}

      {selectedUser && progress && !loadingProgress && (
        <div className="admin-seen-it-all-result">
          <div className="admin-seen-it-all-summary">
            <div className="admin-seen-it-all-player">
              <img src={getAvatarUrl(selectedUser.user_id)} alt="" onError={onAvatarError} />
              <div>
                <h3>{selectedUser.global_name || selectedUser.user_name}</h3>
                <span>{selectedUser.user_name}</span>
              </div>
            </div>
            <div className="admin-seen-it-all-count">
              <strong>{progress.seenIds.size}</strong> / {progress.total} boss trainers faced
            </div>
            <div className="admin-seen-it-all-bar">
              <div style={{ width: `${percentage}%` }} />
            </div>
            <div className="admin-seen-it-all-status">
              Profile status: <strong>{effectiveEarned ? 'Earned' : 'Not earned'}</strong>
              {manualOverride !== null && (
                <span className="admin-seen-it-all-override">
                  {' '}(manually {manualOverride ? 'granted' : 'revoked'})
                </span>
              )}
            </div>
          </div>

          <label className="admin-seen-it-all-filter">
            <input
              type="checkbox"
              checked={onlyMissing}
              onChange={(e) => setOnlyMissing(e.target.checked)}
            />
            Show only missing
          </label>

          <div className="admin-seen-it-all-groups">
            {BOSS_TRAINER_GROUPS.map((group) => {
              const visibleIds = onlyMissing
                ? group.ids.filter((id) => !progress.seenIds.has(id))
                : group.ids;
              if (visibleIds.length === 0) return null;
              const seenInGroup = group.ids.filter((id) => progress.seenIds.has(id)).length;

              return (
                <section className="admin-seen-it-all-group" key={group.label}>
                  <h4>
                    {group.label} <span>{seenInGroup}/{group.ids.length}</span>
                  </h4>
                  <div className="admin-seen-it-all-chips">
                    {visibleIds.map((id) => {
                      const seen = progress.seenIds.has(id);
                      const detail = progress.seenDetails.get(id);
                      const title = seen && detail
                        ? `Seen in draft ${detail.draftId} (team ${detail.teamId})${detail.version !== null ? `, version ${detail.version}` : ''}${detail.isLoss ? ' - loss' : ''}`
                        : `Missing: ${getTrainerNameById(id)} (trainer ${id})`;
                      return (
                        <span
                          key={id}
                          className={`admin-seen-it-all-chip ${seen ? 'seen' : 'missing'}`}
                          title={title}
                        >
                          {seen ? '✓' : '–'} {getTrainerNameById(id)}
                        </span>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default SeenItAllProgressPanel;
