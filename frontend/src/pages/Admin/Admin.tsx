import React, { ChangeEvent, Dispatch, SetStateAction, useEffect, useMemo, useState } from 'react';
import Header from '../../shared/components/Header';
import Footer from '../../shared/components/Footer';
import {
  fetchAdminCompletedDrafts,
  fetchAdminDiscordUsers,
  fetchAdminDraftTeamPlacements,
  fetchAdminHallOfFameEligible,
  fetchAdminRaceResults,
  removeAdminDraftTeam,
  updateAdminDiscordUser,
  updateAdminDraftPlacements,
  updateAdminHallOfFameTeam,
} from '../../shared/api/users';
import {
  AdminDiscordUser,
  AdminDraftSummary,
  AdminDraftTeamPlacement,
  AdminHallOfFameEligibleEntry,
  AdminRaceResult,
  HallOfFamePokemon,
  AdminMetricSummary,
} from '../../types';
import './Admin.scss';
import { fetchCurrentUser } from '../../shared/api/draftData';
import { getIconName } from '../../utils/speciesUtils';
import HallOfFameTeamEditorModal from './HallOfFameTeamEditorModal';

type AdminTab = 'draft-results' | 'discord-users' | 'upload-pokemon-data' | 'boss-battle-history' | 'hall-of-fame' | 'race-results' | 'metrics';

const Admin: React.FC = () => {
  const [hasRefereeRole, setHasRefereeRole] = useState<boolean | null>(null);
  const [tab, setTab] = useState<AdminTab>('draft-results');

  const [drafts, setDrafts] = useState<AdminDraftSummary[]>([]);
  const [draftsLoading, setDraftsLoading] = useState(false);
  const [selectedDraftId, setSelectedDraftId] = useState('');
  const [draftTeams, setDraftTeams] = useState<AdminDraftTeamPlacement[]>([]);
  const [draftTeamsLoading, setDraftTeamsLoading] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [draftSuccess, setDraftSuccess] = useState<string | null>(null);

  const [discordUsers, setDiscordUsers] = useState<AdminDiscordUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [usersSuccess, setUsersSuccess] = useState<string | null>(null);

  const [uploadingPokemon, setUploadingPokemon] = useState(false);
  const [uploadingMoves, setUploadingMoves] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null);

  const [bossBattleHistory, setBossBattleHistory] = useState<any[]>([]);
  const [bossBattleHistoryLoading, setBossBattleHistoryLoading] = useState(false);
  const [bossBattleHistoryError, setBossBattleHistoryError] = useState<string | null>(null);
  const [hallOfFameEntries, setHallOfFameEntries] = useState<AdminHallOfFameEligibleEntry[]>([]);
  const [hallOfFameTeamsLoading, setHallOfFameTeamsLoading] = useState(false);
  const [hallOfFameTeamsError, setHallOfFameTeamsError] = useState<string | null>(null);
  const [hallOfFameTeamsSuccess, setHallOfFameTeamsSuccess] = useState<string | null>(null);
  const [hallOfFameSaving, setHallOfFameSaving] = useState(false);
  const [editingHallOfFameEntry, setEditingHallOfFameEntry] = useState<AdminHallOfFameEligibleEntry | null>(null);
  const [raceResults, setRaceResults] = useState<AdminRaceResult[]>([]);
  const [raceResultsLoading, setRaceResultsLoading] = useState(false);
  const [raceResultsError, setRaceResultsError] = useState<string | null>(null);

  const [metrics, setMetrics] = useState<AdminMetricSummary[]>([]);
  const [metricsLoading, setMetricsLoading] = useState(false);
  const [metricsError, setMetricsError] = useState<string | null>(null);
  const [metricsSearch, setMetricsSearch] = useState('');
  const [metricsAutoRefresh, setMetricsAutoRefresh] = useState(false);
  const [metricsSortCol, setMetricsSortCol] = useState<keyof AdminMetricSummary>('request_count');
  const [metricsSortDir, setMetricsSortDir] = useState<'asc' | 'desc'>('desc');

  const loadMetrics = () => {
    setMetricsLoading(true);
    setMetricsError(null);
    fetch('/api/admin/metrics')
      .then(async (res) => {
        if (!res.ok) {
          const text = await res.text();
          throw new Error(text || res.statusText);
        }
        return res.json();
      })
      .then((data) => setMetrics(data))
      .catch((err: any) => setMetricsError(err?.message ?? 'Failed to load metrics.'))
      .finally(() => setMetricsLoading(false));
  };

  useEffect(() => {
    if (!hasRefereeRole || tab !== 'metrics') return;
    loadMetrics();

    if (!metricsAutoRefresh) return;
    const interval = setInterval(loadMetrics, 10000);
    return () => clearInterval(interval);
  }, [hasRefereeRole, tab, metricsAutoRefresh]);

  const metricsSummary = useMemo(() => {
    const totalEndpoints = metrics.length;
    const totalRequests = metrics.reduce((sum, item) => sum + (item.request_count || 0), 0);
    const totalErrors = metrics.reduce((sum, item) => sum + (item.error_count || 0), 0);
    const overallAvgMs = totalRequests > 0
      ? metrics.reduce((sum, item) => sum + (item.avg_duration_ms * item.request_count), 0) / totalRequests
      : 0;

    return { totalEndpoints, totalRequests, totalErrors, overallAvgMs };
  }, [metrics]);

  const filteredAndSortedMetrics = useMemo(() => {
    const searchLower = metricsSearch.toLowerCase().trim();
    let result = metrics;
    if (searchLower) {
      result = result.filter(
        (m) => m.path.toLowerCase().includes(searchLower) || m.method.toLowerCase().includes(searchLower),
      );
    }

    return [...result].sort((a, b) => {
      const valA = a[metricsSortCol];
      const valB = b[metricsSortCol];
      if (typeof valA === 'string' && typeof valB === 'string') {
        return metricsSortDir === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
      }
      const numA = Number(valA) || 0;
      const numB = Number(valB) || 0;
      return metricsSortDir === 'asc' ? numA - numB : numB - numA;
    });
  }, [metrics, metricsSearch, metricsSortCol, metricsSortDir]);

  const handleSort = (col: keyof AdminMetricSummary) => {
    if (metricsSortCol === col) {
      setMetricsSortDir((dir) => (dir === 'asc' ? 'desc' : 'asc'));
    } else {
      setMetricsSortCol(col);
      setMetricsSortDir('desc');
    }
  };

  const getSortIcon = (col: keyof AdminMetricSummary) => {
    if (metricsSortCol !== col) return '↕';
    return metricsSortDir === 'asc' ? '↑' : '↓';
  };


  useEffect(() => {
    fetchCurrentUser()
      .then((user) => {
        const roles = user.roles ?? [];
        setHasRefereeRole(roles.some((role) => role.role_name === 'Referee') || user.username === 'franklynathan' || user.username === 'jage04' || user.username === 'Jason' || user.username === 'mfrazz' || user.username === 'jpfrazz');
      })
      .catch(() => setHasRefereeRole(false));
  }, []);

  useEffect(() => {
    if (!hasRefereeRole) return;

    setDraftsLoading(true);
    setDraftError(null);
    fetchAdminCompletedDrafts()
      .then((rows) => {
        setDrafts(rows);
        if (rows.length > 0) {
          setSelectedDraftId((current) => current || rows[0].draft_id);
        }
      })
      .catch((err: any) => setDraftError(err?.message ?? 'Failed to load drafts.'))
      .finally(() => setDraftsLoading(false));
  }, [hasRefereeRole]);

  useEffect(() => {
    if (!hasRefereeRole || !selectedDraftId) return;

    setDraftTeamsLoading(true);
    setDraftError(null);
    setDraftSuccess(null);
    fetchAdminDraftTeamPlacements(selectedDraftId)
      .then((rows) => setDraftTeams(rows))
      .catch((err: any) => setDraftError(err?.message ?? 'Failed to load draft teams.'))
      .finally(() => setDraftTeamsLoading(false));
  }, [hasRefereeRole, selectedDraftId]);

  useEffect(() => {
    if (!hasRefereeRole || tab !== 'discord-users') return;

    setUsersLoading(true);
    setUsersError(null);
    fetchAdminDiscordUsers()
      .then((rows) => setDiscordUsers(rows))
      .catch((err: any) => setUsersError(err?.message ?? 'Failed to load users.'))
      .finally(() => setUsersLoading(false));
  }, [hasRefereeRole, tab]);

  useEffect(() => {
    if (!hasRefereeRole || tab !== 'boss-battle-history') return;

    setBossBattleHistoryLoading(true);
    setBossBattleHistoryError(null);
    fetch('/api/admin/boss-battle-history')
      .then(async (res) => {
        if (!res.ok) {
          const text = await res.text();
          throw new Error(text || res.statusText);
        }
        return res.json();
      })
      .then((rows) => setBossBattleHistory(rows))
      .catch((err: any) =>
        setBossBattleHistoryError(err?.message ?? 'Failed to load boss battle history.')
      )
      .finally(() => setBossBattleHistoryLoading(false));
  }, [hasRefereeRole, tab]);

  useEffect(() => {
    if (!hasRefereeRole || tab !== 'hall-of-fame') return;

    setHallOfFameTeamsLoading(true);
    setHallOfFameTeamsError(null);
    fetchAdminHallOfFameEligible()
      .then((rows) => setHallOfFameEntries(rows))
      .catch((err: any) =>
        setHallOfFameTeamsError(err?.message ?? 'Failed to load hall of fame teams.')
      )
      .finally(() => setHallOfFameTeamsLoading(false));
  }, [hasRefereeRole, tab]);

  useEffect(() => {
    if (!hasRefereeRole || tab !== 'race-results') return;

    setRaceResultsLoading(true);
    setRaceResultsError(null);
    fetchAdminRaceResults()
      .then((rows) => setRaceResults(rows))
      .catch((err: any) =>
        setRaceResultsError(err?.message ?? 'Failed to load race results.')
      )
      .finally(() => setRaceResultsLoading(false));
  }, [hasRefereeRole, tab]);

  const sortedTeams = useMemo(
    () => [...draftTeams].sort((a, b) => (a.placement ?? 9999) - (b.placement ?? 9999)),
    [draftTeams],
  );

  const handlePlacementChange = (teamId: number, placementText: string) => {
    const value = Number(placementText);
    setDraftTeams((current) =>
      current.map((team) => (team.team_id === teamId ? { ...team, placement: value || null } : team)),
    );
  };

  const handleSavePlacements = async () => {
    setDraftError(null);
    setDraftSuccess(null);

    if (!selectedDraftId || draftTeams.length === 0) return;

    const placements = draftTeams.map((team) => ({
      team_id: team.team_id,
      placement: team.placement ?? 0,
      pre_match_mmr: team.pre_match_mmr ?? 0,
    }));

    if (placements.some((entry) => entry.placement <= 0)) {
      setDraftError('All teams must have a placement greater than 0.');
      return;
    }

    if (placements.some((entry) => entry.pre_match_mmr <= 0)) {
      setDraftError('All teams must have a pre-match MMR value.');
      return;
    }

    const uniquePlacements = new Set(placements.map((entry) => entry.placement));
    if (uniquePlacements.size !== placements.length) {
      setDraftError('Placements must be unique.');
      return;
    }

    try {
      await updateAdminDraftPlacements(selectedDraftId, placements);
      setDraftSuccess('Placements updated.');
    } catch (err: any) {
      setDraftError(err?.message ?? 'Failed to update placements.');
    }
  };

  const handleRecalculateAll = async () => {
    if (!window.confirm("This will wipe all current MMR/Win/Loss records and recalculate them from the beginning of time based on draft history. Proceed?")) return;
    setDraftTeamsLoading(true);
    try {
      await fetch('/api/admin/recalculate-stats', { method: 'POST' });
      setDraftSuccess('All stats recalculated successfully.');
    } catch (err: any) {
      setDraftError('Recalculation failed.');
    } finally {
      setDraftTeamsLoading(false);
    }
  };

  const handleRemoveTeam = async (teamId: number, userName: string | null) => {
    if (!selectedDraftId) return;
    if (!window.confirm(`Remove ${userName ?? 'this team'} from the race? This will adjust MMR/Win/Loss records for all remaining participants.`)) return;

    setDraftError(null);
    setDraftSuccess(null);

    try {
      await removeAdminDraftTeam(selectedDraftId, teamId);
      setDraftTeams((current) => current.filter((team) => team.team_id !== teamId));
      setDraftSuccess(`Removed team #${teamId} from the draft.`);
    } catch (err: any) {
      setDraftError(err?.message ?? 'Failed to remove team.');
    }
  };

  const handleUserFieldChange = (
    userId: string,
    field: 'mmr' | 'wins' | 'losses',
    value: string,
  ) => {
    const asNumber = Number(value);
    setDiscordUsers((current) =>
      current.map((user) =>
        user.user_id === userId
          ? {
              ...user,
              [field]: Number.isFinite(asNumber) ? asNumber : user[field],
            }
          : user,
      ),
    );
  };

  const handleSaveUser = async (user: AdminDiscordUser) => {
    setUsersError(null);
    setUsersSuccess(null);

    try {
      await updateAdminDiscordUser(user.user_id, {
        mmr: user.mmr,
        wins: user.wins,
        losses: user.losses,
      });
      setUsersSuccess(`Saved ${user.user_name}.`);
    } catch (err: any) {
      setUsersError(err?.message ?? 'Failed to update user.');
    }
  };

  const reloadHallOfFame = () => {
    fetchAdminHallOfFameEligible()
      .then(setHallOfFameEntries)
      .catch((err: any) =>
        setHallOfFameTeamsError(err?.message ?? 'Failed to reload hall of fame teams.')
      );
  };

  const handleSaveHallOfFameTeam = async (team: HallOfFamePokemon[]) => {
    if (!editingHallOfFameEntry) return;

    setHallOfFameSaving(true);
    setHallOfFameTeamsError(null);
    setHallOfFameTeamsSuccess(null);
    try {
      await updateAdminHallOfFameTeam(editingHallOfFameEntry.team_id, team);
      setHallOfFameTeamsSuccess('Hall of Fame team saved.');
      setEditingHallOfFameEntry(null);
      reloadHallOfFame();
    } catch (err: any) {
      setHallOfFameTeamsError(
        err?.response?.data ?? err?.message ?? 'Failed to save Hall of Fame team.'
      );
    } finally {
      setHallOfFameSaving(false);
    }
  };

  const handleFileUpload = async (e: ChangeEvent<HTMLInputElement>, endpoint: string, setUploadingStatus: Dispatch<SetStateAction<boolean>>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingStatus(true);

    const form_data = new FormData();
    form_data.append('file', file);

    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            body: form_data
        });

        if (response.ok) {
            setUploadSuccess(`${file.name} uploaded successfull`);
        } else {
            const errorText = await response.text();
            setUploadError(`failed to upload file: ${errorText || response.statusText}`);
        }
    } catch (error) {
        const error_message = error instanceof Error ? error.message : 'An unknown error occured';
        setUploadError(`Failed to send file to server, ${error_message}`);
    } finally {
        setUploadingStatus(false);
        e.target.value = '';
    }
  };

  return (
    <div className="admin-page-root">
      <Header />
      <main className="admin-main">
        <section className="admin-panel">
          <h1>Admin</h1>

          {hasRefereeRole === null && <div className="admin-message">Checking permissions...</div>}
          {hasRefereeRole === false && (
            <div className="admin-message admin-error">This page is only available to referees.</div>
          )}

          {hasRefereeRole && (
            <>
              <div className="admin-tab-bar">
                <button
                  className={`admin-tab ${tab === 'draft-results' ? 'active' : ''}`}
                  onClick={() => setTab('draft-results')}
                  type="button"
                >
                  Draft Results
                </button>
                <button
                  className={`admin-tab ${tab === 'discord-users' ? 'active' : ''}`}
                  onClick={() => setTab('discord-users')}
                  type="button"
                >
                  Discord Users
                </button>
                <button
                  className={`admin-tab ${tab === 'upload-pokemon-data' ? 'active' : ''}`}
                  onClick={() => setTab('upload-pokemon-data')}
                  type="button"
                >
                  Upload Pokemon Data
                </button>
                <button
                  className={`admin-tab ${tab === 'boss-battle-history' ? 'active' : ''}`}
                  onClick={() => setTab('boss-battle-history')}
                  type="button"
                >
                  Boss Battle History
                </button>
                <button
                  className={`admin-tab ${tab === 'hall-of-fame' ? 'active' : ''}`}
                  onClick={() => setTab('hall-of-fame')}
                  type="button"
                >
                  Hall of Fame Teams
                </button>
                <button
                  className={`admin-tab ${tab === 'race-results' ? 'active' : ''}`}
                  onClick={() => setTab('race-results')}
                  type="button"
                >
                  Race Results
                </button>
                <button
                  className={`admin-tab ${tab === 'metrics' ? 'active' : ''}`}
                  onClick={() => setTab('metrics')}
                  type="button"
                >
                  Metrics
                </button>
              </div>

              {tab === 'draft-results' && (
                <div className="admin-tab-content">
                  <h2>Edit Draft Placements</h2>
                  {draftError && <div className="admin-message admin-error">{draftError}</div>}
                  {draftSuccess && <div className="admin-message admin-success">{draftSuccess}</div>}

                  <div className="admin-controls-row">
                    <label>
                      Draft:
                      <select
                        value={selectedDraftId}
                        onChange={(e) => setSelectedDraftId(e.target.value)}
                        disabled={draftsLoading || drafts.length === 0}
                      >
                        {drafts.map((draft) => (
                          <option key={draft.draft_id} value={draft.draft_id}>
                            {draft.draft_name} ({draft.draft_id.slice(0, 8)})
                          </option>
                        ))}
                      </select>
                    </label>
                    <button type="button" className="button" onClick={handleSavePlacements}>
                      Save Placements
                    </button>
                    <button type="button" className="button danger" onClick={handleRecalculateAll}>
                      Recalculate All History
                    </button>
                  </div>

                  {draftTeamsLoading ? (
                    <div className="admin-message">Loading draft teams...</div>
                  ) : (
                    <div className="admin-table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>Team ID</th>
                            <th>User ID</th>
                            <th>User</th>
                            <th>Pre-Match MMR</th>
                            <th>Placement</th>
                            <th>Remove User</th>
                          </tr>
                        </thead>
                        <tbody>
                          {sortedTeams.map((team) => (
                            <tr key={team.team_id}>
                              <td>{team.team_id}</td>
                              <td>{team.user_id ?? team.guest_id ?? '-'}</td>
                              <td>{team.user_name ?? '-'}</td>
                              <td>{team.pre_match_mmr ?? '-'}</td>
                              <td>
                                <input
                                  type="number"
                                  min={1}
                                  max={draftTeams.length}
                                  value={team.placement ?? ''}
                                  onChange={(e) => handlePlacementChange(team.team_id, e.target.value)}
                                />
                              </td>
                              <td>
                                <button
                                  type="button"
                                  className="button danger"
                                  style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem' }}
                                  onClick={() => handleRemoveTeam(team.team_id, team.user_name)}
                                >
                                  Remove
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {tab === 'discord-users' && (
                <div className="admin-tab-content">
                  <h2>Discord Users</h2>
                  {usersError && <div className="admin-message admin-error">{usersError}</div>}
                  {usersSuccess && <div className="admin-message admin-success">{usersSuccess}</div>}

                  {usersLoading ? (
                    <div className="admin-message">Loading users...</div>
                  ) : (
                    <div className="admin-table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>User ID</th>
                            <th>User Name</th>
                            <th>Discriminator</th>
                            <th>Global Name</th>
                            <th>Wins</th>
                            <th>Losses</th>
                            <th>MMR</th>
                            <th>Save</th>
                          </tr>
                        </thead>
                        <tbody>
                          {discordUsers.map((user) => (
                            <tr key={user.user_id}>
                              <td>{user.user_id}</td>
                              <td>{user.user_name}</td>
                              <td>{user.discriminator}</td>
                              <td>{user.global_name ?? '-'}</td>
                              <td>
                                <input
                                  type="number"
                                  value={user.wins}
                                  onChange={(e) => handleUserFieldChange(user.user_id, 'wins', e.target.value)}
                                />
                              </td>
                              <td>
                                <input
                                  type="number"
                                  value={user.losses}
                                  onChange={(e) => handleUserFieldChange(user.user_id, 'losses', e.target.value)}
                                />
                              </td>
                              <td>
                                <input
                                  type="number"
                                  value={user.mmr}
                                  onChange={(e) => handleUserFieldChange(user.user_id, 'mmr', e.target.value)}
                                />
                              </td>
                              <td>
                                <button type="button" className="button" onClick={() => handleSaveUser(user)}>
                                  Save
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {tab === 'upload-pokemon-data' && (
                <div className="admin-tab-content">
                    <h2>Upload Pokemon Data</h2>

                  {uploadError && <div className="admin-message admin-error">{uploadError}</div>}
                  {uploadSuccess && <div className="admin-message admin-success">{uploadSuccess}</div>}

                  <div className="admin-controls-row" style={{ alignItems: 'flex-start', marginTop: '20px', gap: '40px' }}>

                    <div className="upload-section">
                      <h3>Pokémon Roster</h3>
                      <p style={{ marginBottom: '15px' }}>Upload the main <code>pokemon.csv</code> database file.</p>

                      <input
                        type="file"
                        accept=".csv"
                        id="pokemon-csv-upload"
                        style={{ display: 'none' }}
                        onChange={(e) => handleFileUpload(e, '/api/pokemon', setUploadingPokemon)}
                        disabled={uploadingPokemon}
                      />
                      <label
                        htmlFor="pokemon-csv-upload"
                        className="button"
                        style={{
                          display: 'inline-block',
                          cursor: uploadingPokemon ? 'wait' : 'pointer',
                          opacity: uploadingPokemon ? 0.7 : 1
                        }}
                      >
                        {uploadingPokemon ? 'Uploading...' : 'Upload Pokémon CSV'}
                      </label>
                    </div>

                    <div className="upload-section">
                      <h3>Key Moves</h3>
                      <p style={{ marginBottom: '15px' }}>Upload the <code>key_moves.csv</code> file.</p>

                      <input
                        type="file"
                        accept=".csv"
                        id="moves-csv-upload"
                        style={{ display: 'none' }}
                        onChange={(e) => handleFileUpload(e, '/api/pokemon_key_moves', setUploadingMoves)}
                        disabled={uploadingMoves}
                      />
                      <label
                        htmlFor="moves-csv-upload"
                        className="button"
                        style={{
                          display: 'inline-block',
                          cursor: uploadingMoves ? 'wait' : 'pointer',
                          opacity: uploadingMoves ? 0.7 : 1
                        }}
                      >
                        {uploadingMoves ? 'Uploading...' : 'Upload Moves CSV'}
                      </label>
                    </div>

                  </div>
                </div>
              )}

              {tab === 'boss-battle-history' && (
                <div className="admin-tab-content">
                  <h2>Boss Battle History</h2>
                  {bossBattleHistoryError && <div className="admin-message admin-error">{bossBattleHistoryError}</div>}
                  {bossBattleHistoryLoading ? (
                    <div className="admin-message">Loading boss battle history...</div>
                  ) : bossBattleHistory.length === 0 ? (
                    <div className="admin-message">No boss battle history recorded yet.</div>
                  ) : (
                    <div className="admin-table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>ID</th>
                            <th>Draft ID</th>
                            <th>Team ID</th>
                            <th>User</th>
                            <th>Trainer ID</th>
                            <th>Version</th>
                            <th>Time</th>
                            <th>Loss</th>
                            <th>Created At</th>
                          </tr>
                        </thead>
                        <tbody>
                          {bossBattleHistory.map((battle) => (
                            <tr key={battle.id}>
                              <td>{battle.id}</td>
                              <td>{battle.draft_id.slice(0, 8)}</td>
                              <td>{battle.team_id}</td>
                              <td>{battle.user_name ?? battle.user_id ?? battle.guest_id ?? '-'}</td>
                              <td>{battle.trainer_id}</td>
                              <td>{battle.version ?? '-'}</td>
                              <td>{battle.hours}h {battle.minutes}m {battle.seconds}s</td>
                              <td>{battle.is_loss ? 'Yes' : 'No'}</td>
                              <td>{new Date(battle.created_at).toLocaleString()}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {tab === 'hall-of-fame' && (
                <div className="admin-tab-content">
                  <h2>Hall of Fame Teams</h2>
                  {hallOfFameTeamsError && <div className="admin-message admin-error">{hallOfFameTeamsError}</div>}
                  {hallOfFameTeamsSuccess && <div className="admin-message admin-success">{hallOfFameTeamsSuccess}</div>}
                  {hallOfFameTeamsLoading ? (
                    <div className="admin-message">Loading hall of fame teams...</div>
                  ) : hallOfFameEntries.length === 0 ? (
                    <div className="admin-message">No Hall of Fame qualifiers (runs that beat Steven or Wally) recorded yet.</div>
                  ) : (
                    <div className="admin-hof-entries">
                      {hallOfFameEntries.map((entry) => (
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
                              <span className="admin-hof-entry-time"> at {entry.hours}h {entry.minutes}m {entry.seconds}s</span>
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
                                        (e.currentTarget as HTMLImageElement).src = '/MiniIcons/question.png';
                                      }}
                                    />
                                    <span>{mon.name}</span>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <span className="admin-hof-empty">No team entered yet.</span>
                            )}
                            <button
                              type="button"
                              className="button"
                              onClick={() => setEditingHallOfFameEntry(entry)}
                            >
                              {entry.hall_of_fame_team.length > 0 ? 'Edit Team' : 'Enter Team'}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {editingHallOfFameEntry && (
                    <HallOfFameTeamEditorModal
                      entry={editingHallOfFameEntry}
                      saving={hallOfFameSaving}
                      onSave={handleSaveHallOfFameTeam}
                      onClose={() => setEditingHallOfFameEntry(null)}
                    />
                  )}
                </div>
              )}

              {tab === 'race-results' && (
                <div className="admin-tab-content">
                  <h2>Race Results</h2>
                  {raceResultsError && <div className="admin-message admin-error">{raceResultsError}</div>}
                  {raceResultsLoading ? (
                    <div className="admin-message">Loading race results...</div>
                  ) : raceResults.length === 0 ? (
                    <div className="admin-message">No races found.</div>
                  ) : (
                    <div className="admin-table-wrap">
                      <table className="admin-race-results-table">
                        <thead>
                          <tr>
                            <th>Race ID</th>
                            <th>Draft Name</th>
                            <th>Participants</th>
                            <th>Results</th>
                          </tr>
                        </thead>
                        <tbody>
                          {raceResults.map((race) => (
                            <tr key={race.draft_id}>
                              <td>{race.draft_id.slice(0, 8)}</td>
                              <td>{race.draft_name}</td>
                              <td>
                                {race.teams.length > 0
                                  ? race.teams.map((team) => team.user_name ?? '-').join(', ')
                                  : '-'}
                              </td>
                              <td>
                                {race.teams.length === 0 ? (
                                  '-'
                                ) : (
                                  <div className="admin-race-results-list">
                                    {race.teams.map((team) => (
                                      <div key={team.team_id} className="admin-race-result-row">
                                        <span className="admin-race-result-user">{team.user_name ?? '-'}:</span>
                                        <span className="admin-race-result-text">
                                          {team.result}
                                          {team.detail ? ` (${team.detail})` : ''}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}


              {tab === 'metrics' && (
                <div className="admin-tab-content">
                  <h2>Endpoint Metrics</h2>
                  {metricsError && <div className="admin-message admin-error">{metricsError}</div>}

                  <div className="admin-controls-row" style={{ flexWrap: 'wrap', marginBottom: '1.2rem' }}>
                    <div style={{ display: 'flex', gap: '1rem', flex: 1, minWidth: '280px' }}>
                      <div style={{ background: '#172637', padding: '0.6rem 1rem', borderRadius: '8px', border: '1px solid #2b3e52', flex: 1 }}>
                        <div style={{ fontSize: '0.75rem', color: '#94a3b8', textTransform: 'uppercase' }}>Endpoints</div>
                        <div style={{ fontSize: '1.4rem', fontWeight: 'bold' }}>{metricsSummary.totalEndpoints}</div>
                      </div>
                      <div style={{ background: '#172637', padding: '0.6rem 1rem', borderRadius: '8px', border: '1px solid #2b3e52', flex: 1 }}>
                        <div style={{ fontSize: '0.75rem', color: '#94a3b8', textTransform: 'uppercase' }}>Total Requests</div>
                        <div style={{ fontSize: '1.4rem', fontWeight: 'bold' }}>{metricsSummary.totalRequests.toLocaleString()}</div>
                      </div>
                      <div style={{ background: '#172637', padding: '0.6rem 1rem', borderRadius: '8px', border: '1px solid #2b3e52', flex: 1 }}>
                        <div style={{ fontSize: '0.75rem', color: '#94a3b8', textTransform: 'uppercase' }}>Avg Latency</div>
                        <div style={{ fontSize: '1.4rem', fontWeight: 'bold' }}>{metricsSummary.overallAvgMs.toFixed(1)} ms</div>
                      </div>
                      <div style={{ background: metricsSummary.totalErrors > 0 ? '#241417' : '#172637', padding: '0.6rem 1rem', borderRadius: '8px', border: metricsSummary.totalErrors > 0 ? '1px solid #7f2d2d' : '1px solid #2b3e52', flex: 1 }}>
                        <div style={{ fontSize: '0.75rem', color: metricsSummary.totalErrors > 0 ? '#ff8f8f' : '#94a3b8', textTransform: 'uppercase' }}>Total Errors</div>
                        <div style={{ fontSize: '1.4rem', fontWeight: 'bold', color: metricsSummary.totalErrors > 0 ? '#ff8f8f' : 'inherit' }}>{metricsSummary.totalErrors.toLocaleString()}</div>
                      </div>
                    </div>
                  </div>

                  <div className="admin-controls-row">
                    <input
                      type="text"
                      placeholder="Filter by path or method..."
                      value={metricsSearch}
                      onChange={(e) => setMetricsSearch(e.target.value)}
                      style={{ minWidth: '240px' }}
                    />
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={metricsAutoRefresh}
                        onChange={(e) => setMetricsAutoRefresh(e.target.checked)}
                      />
                      Auto-refresh (10s)
                    </label>
                    <button type="button" className="button" onClick={loadMetrics} disabled={metricsLoading}>
                      {metricsLoading ? 'Refreshing...' : 'Refresh'}
                    </button>
                  </div>

                  {metricsLoading && metrics.length === 0 ? (
                    <div className="admin-message">Loading metrics...</div>
                  ) : (
                    <div className="admin-table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th onClick={() => handleSort('method')} style={{ cursor: 'pointer', userSelect: 'none' }}>
                              Method {getSortIcon('method')}
                            </th>
                            <th onClick={() => handleSort('path')} style={{ cursor: 'pointer', userSelect: 'none' }}>
                              Path {getSortIcon('path')}
                            </th>
                            <th onClick={() => handleSort('request_count')} style={{ cursor: 'pointer', userSelect: 'none' }}>
                              Requests {getSortIcon('request_count')}
                            </th>
                            <th onClick={() => handleSort('avg_duration_ms')} style={{ cursor: 'pointer', userSelect: 'none' }}>
                              Avg (ms) {getSortIcon('avg_duration_ms')}
                            </th>
                            <th onClick={() => handleSort('min_duration_ms')} style={{ cursor: 'pointer', userSelect: 'none' }}>
                              Min (ms) {getSortIcon('min_duration_ms')}
                            </th>
                            <th onClick={() => handleSort('max_duration_ms')} style={{ cursor: 'pointer', userSelect: 'none' }}>
                              Max (ms) {getSortIcon('max_duration_ms')}
                            </th>
                            <th onClick={() => handleSort('p95_duration_ms')} style={{ cursor: 'pointer', userSelect: 'none' }}>
                              P95 (ms) {getSortIcon('p95_duration_ms')}
                            </th>
                            <th onClick={() => handleSort('p99_duration_ms')} style={{ cursor: 'pointer', userSelect: 'none' }}>
                              P99 (ms) {getSortIcon('p99_duration_ms')}
                            </th>
                            <th onClick={() => handleSort('error_count')} style={{ cursor: 'pointer', userSelect: 'none' }}>
                              Errors {getSortIcon('error_count')}
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredAndSortedMetrics.length === 0 ? (
                            <tr>
                              <td colSpan={9} style={{ textAlign: 'center', padding: '1rem' }}>
                                No metrics found matching criteria.
                              </td>
                            </tr>
                          ) : (
                            filteredAndSortedMetrics.map((item, idx) => (
                              <tr key={`${item.method}-${item.path}-${idx}`}>
                                <td>
                                  <strong style={{
                                    color: item.method === 'GET' ? '#4ade80' : item.method === 'POST' ? '#60a5fa' : item.method === 'PUT' ? '#fbbf24' : '#f87171'
                                  }}>
                                    {item.method}
                                  </strong>
                                </td>
                                <td><code>{item.path}</code></td>
                                <td>{item.request_count.toLocaleString()}</td>
                                <td>{item.avg_duration_ms.toFixed(1)}</td>
                                <td>{item.min_duration_ms.toFixed(1)}</td>
                                <td>{item.max_duration_ms.toFixed(1)}</td>
                                <td style={{ color: item.p95_duration_ms > 1000 ? '#f87171' : item.p95_duration_ms > 500 ? '#fbbf24' : 'inherit' }}>
                                  {item.p95_duration_ms.toFixed(1)}
                                </td>
                                <td style={{ color: item.p99_duration_ms > 1000 ? '#f87171' : item.p99_duration_ms > 500 ? '#fbbf24' : 'inherit' }}>
                                  {item.p99_duration_ms.toFixed(1)}
                                </td>
                                <td style={{ color: item.error_count > 0 ? '#ff8f8f' : 'inherit', fontWeight: item.error_count > 0 ? 'bold' : 'normal' }}>
                                  {item.error_count}
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </section>
      </main>
      <Footer />
    </div>
  );
};

export default Admin;
