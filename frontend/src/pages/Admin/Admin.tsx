import React, { ChangeEvent, Dispatch, SetStateAction, useEffect, useMemo, useState } from 'react';
import Header from '../../shared/components/Header';
import Footer from '../../shared/components/Footer';
import {
  fetchAdminCompletedDrafts,
  fetchAdminDiscordUsers,
  fetchAdminDraftTeamPlacements,
  updateAdminDiscordUser,
  updateAdminDraftPlacements,
} from '../../shared/api/users';
import {
  AdminDiscordUser,
  AdminDraftSummary,
  AdminDraftTeamPlacement,
} from '../../types';
import './Admin.scss';
import { fetchCurrentUser } from '../../shared/api/draftData';

type AdminTab = 'draft-results' | 'discord-users' | 'upload-pokemon-data' | 'boss-battle-history';

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

  useEffect(() => {
    fetchCurrentUser()
      .then((user) => {
        const roles = user.roles ?? [];
        setHasRefereeRole(roles.some((role) => role.role_name === 'Referee') || user.username === 'franklynathan' || user.username === 'jage04' || user.username === 'Jason' || user.username === 'mfrazz');
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
      .then((data) => setBossBattleHistory(data))
      .catch((err: any) => setBossBattleHistoryError(err?.message ?? 'Failed to load boss battle history.'))
      .finally(() => setBossBattleHistoryLoading(false));
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
            </>
          )}
        </section>
      </main>
      <Footer />
    </div>
  );
};

export default Admin;
