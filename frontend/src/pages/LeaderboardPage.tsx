import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { fetchLeaderboard, fetchSeason2Leaderboard, LeaderboardEntry, Season2LeaderboardEntry } from '../shared/api/users';
import { fetchStatsPageData } from '../shared/api/stats';
import { getDiscordAvatarUrl, onAvatarError } from '../shared/utils/user';
import Header from '../shared/components/Header';
import { StatsPageResponse } from '../types';
import './LeaderboardPage.scss';
import MMRChart from './MMRChart';

function formatPokemonName(name: string): string {
  const lower = name.toLowerCase();
  if (lower.startsWith("farfetch'd")) {
    return "farfetch'd";
  }
  return lower.replace(/'/g, '');
}

function getPlacementLabel(placement: number | null): string {
  if (placement === null) return '-';

  const suffix = placement % 10 === 1 && placement % 100 !== 11
    ? 'st'
    : placement % 10 === 2 && placement % 100 !== 12
      ? 'nd'
      : placement % 10 === 3 && placement % 100 !== 13
        ? 'rd'
        : 'th';

  return `${placement}${suffix}`;
}

type LeaderboardTab = 'season2' | 'table' | 'progression';

const LeaderboardPage = () => {
    const [activeTab, setActiveTab] = useState<LeaderboardTab>('season2');
    const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
    const [minRaces, setMinRaces] = useState(6); // Default to 6 races
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [season2Leaderboard, setSeason2Leaderboard] = useState<Season2LeaderboardEntry[]>([]);
    const [season2MinRaces, setSeason2MinRaces] = useState(0); // Season 2 defaults to 0 races
    const [season2Loading, setSeason2Loading] = useState(true);
    const [season2Error, setSeason2Error] = useState<string | null>(null);

    const [stats, setStats] = useState<StatsPageResponse | null>(null);
    const [statsLoading, setStatsLoading] = useState(false);
    const [expandedUserId, setExpandedUserId] = useState<string | null>(null);

    useEffect(() => {
        const getLeaderboard = async () => {
            try {
                setLoading(true);
                const data = await fetchLeaderboard();
                setLeaderboard(data);
            } catch (err) {
                setError('Failed to fetch leaderboard data.');
                console.error(err);
            } finally {
                setLoading(false);
            }
        };

        getLeaderboard();
    }, []);

    useEffect(() => {
        const getSeason2Leaderboard = async () => {
            try {
                setSeason2Loading(true);
                const data = await fetchSeason2Leaderboard();
                setSeason2Leaderboard(data);
            } catch (err) {
                setSeason2Error('Failed to fetch season 2 leaderboard data.');
                console.error(err);
            } finally {
                setSeason2Loading(false);
            }
        };

        getSeason2Leaderboard();
    }, []);

    const season1Stats = useMemo<StatsPageResponse | null>(() => {
        if (!stats) return null;
        return {
            ...stats,
            teams: stats.teams.filter((t) => (t.season ?? 1) !== 2),
            auctions: stats.auctions.filter((a) => (a.season ?? 1) !== 2),
        };
    }, [stats]);

    const season2Stats = useMemo<StatsPageResponse | null>(() => {
        if (!stats) return null;
        return {
            ...stats,
            teams: stats.teams.filter((t) => (t.season ?? 1) === 2),
            auctions: stats.auctions.filter((a) => (a.season ?? 1) === 2),
        };
    }, [stats]);

    // Seasons are fully siloed: match history, race counts and drafts shown on a
    // tab only ever come from that season's data.
    const activeStats = activeTab === 'season2' ? season2Stats : season1Stats;

    const userTeamsByDraft = useMemo(() => {
        if (!activeStats) return new Map<string, Map<string, any[]>>();
        // Map<draftId, Map<userId, Auction[]>>
        const map = new Map<string, Map<string, any[]>>();
        activeStats.auctions.forEach(a => {
            if (a.winning_bid === null) return;
            if (!map.has(a.draft_id)) map.set(a.draft_id, new Map());
            const draftMap = map.get(a.draft_id)!;
            const uid = a.winning_user_id || a.winning_guest_id || '';
            if (!draftMap.has(uid)) draftMap.set(uid, []);
            draftMap.get(uid)!.push(a);
        });
        return map;
    }, [activeStats]);

    useEffect(() => {
        setStatsLoading(true);
        fetchStatsPageData()
            .then(setStats)
            .catch(console.error)
            .finally(() => setStatsLoading(false));
    }, []);

    const userRaceCounts = useMemo(() => {
        if (!season1Stats) return new Map<string, number>();
        const map = new Map<string, number>();
        season1Stats.teams.forEach(t => {
            const team = t as any;
            if (team.user_id && team.placement !== null && team.ranked !== false) {
                map.set(team.user_id, (map.get(team.user_id) || 0) + 1);
            }
        });
        return map;
    }, [season1Stats]);

    const filteredAndSortedLeaderboard = useMemo(() => {
        return leaderboard
            .filter(player => {
                const raceCount = userRaceCounts.get(player.user_id) || 0;
                return raceCount >= minRaces;
            })
            .sort((a, b) => b.mmr - a.mmr);
    }, [leaderboard, minRaces, userRaceCounts]);

    const filteredSeason2Leaderboard = useMemo(() => {
        return season2Leaderboard
            .filter(player => player.races_played >= season2MinRaces)
            .sort((a, b) => b.total_points - a.total_points);
    }, [season2Leaderboard, season2MinRaces]);

    const draftsInfo = useMemo(() => {
        if (!activeStats) return new Map<string, { date: string, participants: { userId: string, username: string, placement: number }[] }>();
        const map = new Map<string, { date: string, participants: { userId: string, username: string, placement: number }[] }>();

        const playersMap = new Map();
        activeStats.players.forEach(p => playersMap.set(p.user_id, p));

        activeStats.teams.forEach(t => {
            // Season 2 standings are driven by race placements, not ELO placements.
            const position = activeTab === 'season2' ? t.race_placement : t.placement;
            if (position === null || position === undefined) return;
            if (!map.has(t.draft_id)) {
                map.set(t.draft_id, { date: '', participants: [] });
            }
            const draft = map.get(t.draft_id)!;
            const uid = t.user_id || t.guest_id || '';
            const pInfo = playersMap.get(uid);
            draft.participants.push({
                userId: uid,
                username: pInfo?.global_name || pInfo?.user_name || uid || 'Guest',
                placement: position
            });
        });

        const seenDrafts = new Set();
        activeStats.auctions.forEach(a => {
            if (seenDrafts.has(a.draft_id)) return;
            const draft = map.get(a.draft_id);
            if (draft) {
                draft.date = a.created_at || '';
                seenDrafts.add(a.draft_id);
            }
        });

        map.forEach(d => d.participants.sort((a, b) => a.placement - b.placement));

        return map;
    }, [activeStats, activeTab]);

    const userMatches = useMemo(() => {
        if (!expandedUserId || !activeStats) return [];
        return Array.from(draftsInfo.entries())
            .filter(([_, info]) => info.participants.some(p => p.userId === expandedUserId))
            .map(([id, info]) => ({ draftId: id, ...info }))
            .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    }, [expandedUserId, draftsInfo, activeStats]);

    const handleRowClick = useCallback((userId: string) => {
        setExpandedUserId(prev => prev === userId ? null : userId);
    }, []);

    const getRowClass = (index: number) => {
        switch (index) {
            case 0: return 'gold-row';
            case 1: return 'silver-row';
            case 2: return 'bronze-row';
            default: return '';
        }
    };

    const handleMinRacesChange = (value: number) => {
        const parsed = Number(value) >= 0 ? Number(value) : 0;
        if (activeTab === 'season2') {
            setSeason2MinRaces(parsed);
        } else {
            setMinRaces(parsed);
        }
    };

    if (loading) {
        return <div className="leaderboard-container">Loading...</div>;
    }

    if (error) {
        return <div className="leaderboard-container">{error}</div>;
    }

    const minRacesValue = activeTab === 'season2' ? season2MinRaces : minRaces;

    return (
        <div className="leaderboard-page-wrapper">
            <Header />
            <div className="leaderboard-tabs-container">
                <button
                    className={`leaderboard-tab-btn ${activeTab === 'season2' ? 'active' : ''}`}
                            onClick={() => setActiveTab('season2')}
                        >
                            Season 2 Standings
                        </button>
                <button
                    className={`leaderboard-tab-btn ${activeTab === 'table' ? 'active' : ''}`}
                            onClick={() => setActiveTab('table')}
                        >
                            Season 1 Standings
                        </button>
                <button
                    className={`leaderboard-tab-btn ${activeTab === 'progression' ? 'active' : ''}`}
                            onClick={() => setActiveTab('progression')}
                        >
                            Season 1 ELO Progression
                        </button>
            </div>
            <div className="leaderboard-container">
            <div className="leaderboard-header">
                <h1>{activeTab === 'season2' ? 'Ever Grande Prix Season Two Leaderboard' : 'Ever Grande Prix Season One Leaderboard'}</h1>
                {(activeTab === 'table' || activeTab === 'season2') && (
                    <div className="leaderboard-controls">
                        <div className="filter-container">
                            <label htmlFor="min-races-filter">Min Races: </label>
                            <input
                                id="min-races-filter"
                                type="number"
                                value={minRacesValue}
                                onChange={(e) => handleMinRacesChange(Number(e.target.value))}
                                min="0"
                            />
                        </div>
                    </div>
                )}
            </div>

            {activeTab === 'progression' ? (
                <div className="progression-container">
                    <MMRChart leaderboard={leaderboard} stats={season1Stats} minRaces={0} />
                </div>
            ) : activeTab === 'season2' ? (
            <table className="leaderboard-table" style={{ tableLayout: 'fixed' }}>
                <thead>
                    <tr>
                        <th style={{ width: '80px' }}>Rank</th>
                        <th style={{ width: '250px' }}>Username</th>
                        <th style={{ width: '250px' }}>Display Name</th>
                        <th style={{ width: '110px' }}>Total Points</th>
                        <th style={{ width: '150px' }}>Races Played</th>
                        <th>Most Drafted Pokémon</th>
                    </tr>
                </thead>
                <tbody>
                    {season2Loading ? (
                        <tr>
                            <td colSpan={6} style={{ textAlign: 'center', color: '#888', padding: '20px' }}>Loading...</td>
                        </tr>
                    ) : season2Error ? (
                        <tr>
                            <td colSpan={6} style={{ textAlign: 'center', color: '#888', padding: '20px' }}>{season2Error}</td>
                        </tr>
                    ) : filteredSeason2Leaderboard.length === 0 ? (
                        <tr>
                            <td colSpan={6} style={{ textAlign: 'center', color: '#888', padding: '20px' }}>No Season 2 races recorded yet.</td>
                        </tr>
                    ) : filteredSeason2Leaderboard.map((player, index) => (
                        <React.Fragment key={player.user_id}>
                            <tr
                                className={`${getRowClass(index)} ${expandedUserId === player.user_id ? 'expanded' : ''}`}
                                onClick={() => handleRowClick(player.user_id)}
                                style={{ cursor: 'pointer' }}
                            >
                                <td>{index + 1}</td>
                            <td>
                                <div className="leaderboard-username-cell">
                                    {player.avatar ? (
                                        <img
                                            src={getDiscordAvatarUrl(player.user_id, player.avatar)}
                                            alt=""
                                            className="leaderboard-avatar"
                                            onError={(e) => onAvatarError(e, player.user_id, player.avatar)}
                                        />
                                    ) : (
                                        <div className="leaderboard-avatar-placeholder" />
                                    )}
                                    <span>{player.username}</span>
                                </div>
                            </td>
                            <td>{player.global_name ?? '-'}</td>
                            <td>{player.total_points}</td>
                            <td>{player.races_played}</td>
                            <td>
                                <div className="pokemon-list">
                                    {player.most_drafted_pokemon.map((p) => (
                                        <div key={`${p.id}-${p.form}`} style={{ position: 'relative', display: 'inline-block' }}>
                                            <img
                                                src={`/MiniIcons/${formatPokemonName(p.name)}.png`}
                                                alt={p.name}
                                                title={`${p.name}${p.form ? ` (${p.form})` : ''} - Drafted ${p.count} times`}
                                                className="leaderboard-pokemon-img"
                                                style={{ width: '24px', height: '24px', objectFit: 'contain' }}
                                            />
                                            {p.count !== undefined && (
                                                <span style={{
                                                    position: 'absolute',
                                                    top: '-5px',
                                                    right: '-5px',
                                                    backgroundColor: 'rgba(0, 0, 0, 0.85)',
                                                    color: '#fff',
                                                    fontSize: '0.8rem',
                                                    padding: '1px 3px',
                                                    borderRadius: '4px',
                                                    border: '1px solid #444',
                                                    lineHeight: '1',
                                                    fontWeight: 'bold',
                                                    zIndex: 1,
                                                    pointerEvents: 'none'
                                                }}>
                                                    {p.count}
                                                </span>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </td>
                        </tr>
                        {expandedUserId === player.user_id && (
                            <tr className="leaderboard-history-dropdown-row" style={{ backgroundColor: 'rgba(0, 0, 0, 0.15)' }}>
                                <td colSpan={6} style={{ padding: 0 }}>
                                    {renderMatchHistory(
                                        statsLoading,
                                        stats,
                                        userMatches,
                                        player.user_id,
                                        userTeamsByDraft
                                    )}
                                </td>
                            </tr>
                        )}
                        </React.Fragment>
                    ))}
                </tbody>
            </table>
            ) : (
            <table className="leaderboard-table" style={{ tableLayout: 'fixed' }}>
                <thead>
                    <tr>
                        <th style={{ width: '80px' }}>Rank</th>
                        <th style={{ width: '250px' }}>Username</th>
                        <th style={{ width: '250px' }}>Display Name</th>
                        <th style={{ width: '150px' }}>Win-Loss</th>
                        <th>Most Drafted Pokémon</th>
                    </tr>
                </thead>
                <tbody>
                    {filteredAndSortedLeaderboard.map((player, index) => (
                        <React.Fragment key={player.user_id}>
                            <tr
                                className={`${getRowClass(index)} ${expandedUserId === player.user_id ? 'expanded' : ''}`}
                                onClick={() => handleRowClick(player.user_id)}
                                style={{ cursor: 'pointer' }}
                            >
                                <td>{index + 1}</td>
                            <td>
                                <div className="leaderboard-username-cell">
                                    {player.avatar ? (
                                        <img
                                            src={getDiscordAvatarUrl(player.user_id, player.avatar)}
                                            alt=""
                                            className="leaderboard-avatar"
                                            onError={(e) => onAvatarError(e, player.user_id, player.avatar)}
                                        />
                                    ) : (
                                        <div className="leaderboard-avatar-placeholder" />
                                    )}
                                    <span>{player.username}</span>
                                </div>
                            </td>
                            <td>{player.global_name ?? '-'}</td>
                            <td>{`${player.win} - ${player.loss}`}</td>
                            <td>
                                <div className="pokemon-list">
                                    {player.most_drafted_pokemon.map((p) => (
                                        <div key={`${p.id}-${p.form}`} style={{ position: 'relative', display: 'inline-block' }}>
                                            <img
                                                src={`/MiniIcons/${formatPokemonName(p.name)}.png`}
                                                alt={p.name}
                                                title={`${p.name}${p.form ? ` (${p.form})` : ''} - Drafted ${p.count} times`}
                                                className="leaderboard-pokemon-img"
                                                style={{ width: '24px', height: '24px', objectFit: 'contain' }}
                                            />
                                            {p.count !== undefined && (
                                                <span style={{
                                                    position: 'absolute',
                                                    top: '-5px',
                                                    right: '-5px',
                                                    backgroundColor: 'rgba(0, 0, 0, 0.85)',
                                                    color: '#fff',
                                                    fontSize: '0.8rem',
                                                    padding: '1px 3px',
                                                    borderRadius: '4px',
                                                    border: '1px solid #444',
                                                    lineHeight: '1',
                                                    fontWeight: 'bold',
                                                    zIndex: 1,
                                                    pointerEvents: 'none'
                                                }}>
                                                    {p.count}
                                                </span>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </td>
                        </tr>
                        {expandedUserId === player.user_id && (
                            <tr className="leaderboard-history-dropdown-row" style={{ backgroundColor: 'rgba(0, 0, 0, 0.15)' }}>
                                <td colSpan={5} style={{ padding: 0 }}>
                                    {renderMatchHistory(
                                        statsLoading,
                                        stats,
                                        userMatches,
                                        player.user_id,
                                        userTeamsByDraft
                                    )}
                                </td>
                            </tr>
                        )}
                        </React.Fragment>
                    ))}
                </tbody>
            </table>
            )}
            </div>
        </div>
    );
};

function renderMatchHistory(
    statsLoading: boolean,
    stats: StatsPageResponse | null,
    userMatches: { draftId: string, date: string, participants: { userId: string, username: string, placement: number }[] }[],
    playerUserId: string,
    userTeamsByDraft: Map<string, Map<string, any[]>>
) {
    return (
        <div style={{
            maxHeight: '400px',
            overflowY: 'auto',
            overflowX: 'auto',
            borderTop: '1px solid rgba(255, 255, 255, 0.05)',
            borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
            animation: 'slideDown 0.3s ease-out',
        }}>
            {statsLoading && !stats ? (
                <div style={{ textAlign: 'center', color: '#888', padding: '20px' }}>Loading match history...</div>
            ) : userMatches.length === 0 ? (
                <div style={{ textAlign: 'center', color: '#888', padding: '20px' }}>No ranked match history found.</div>
            ) : (
                <table className="leaderboard-history-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                    <thead>
                        <tr style={{ textAlign: 'left', color: '#666', borderBottom: '1px solid rgba(255, 255, 255, 0.1)' }}>
                            <th style={{ padding: '12px', width: '80px' }}>Date</th>
                            <th style={{ padding: '12px', minWidth: '300px' }}>Race Standings</th>
                            <th style={{ padding: '12px', minWidth: '450px' }}>Draft</th>
                        </tr>
                    </thead>
                    <tbody>
                        {userMatches.map(match => (
                            <tr key={match.draftId} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.05)' }}>
                                <td style={{ padding: '12px', whiteSpace: 'nowrap', verticalAlign: 'top' }}>
                                    {match.date ? new Date(match.date).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: '2-digit' }) : '-'}
                                </td>
                                <td style={{ padding: '12px' }}>
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                                            {match.participants.map(p => (
                                                <span
                                                    key={p.userId}
                                                    style={{
                                                        color: p.userId === playerUserId ? '#fff' : 'inherit',
                                                        opacity: p.userId === playerUserId ? 1 : 0.7,
                                                        fontWeight: p.userId === playerUserId ? 'bold' : 'normal',
                                                        backgroundColor: p.userId === playerUserId ? 'rgba(76, 175, 80, 0.2)' : 'rgba(255, 255, 255, 0.05)',
                                                        padding: '2px 6px',
                                                        borderRadius: '4px',
                                                        border: p.userId === playerUserId ? '1px solid rgba(76, 175, 80, 0.3)' : '1px solid transparent'
                                                    }}
                                                >
                                                    {getPlacementLabel(p.placement)}: {p.username}
                                                </span>
                                            ))}
                                        </div>
                                    </td>
                                    <td style={{ padding: '12px' }}>
                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                                            {(userTeamsByDraft.get(match.draftId)?.get(playerUserId) || [])
                                                .sort((a, b) => (b.winning_bid ?? 0) - (a.winning_bid ?? 0))
                                                .map(a => (
                                                <div
                                                    key={a.auction_id}
                                                    style={{ display: 'flex', alignItems: 'center', backgroundColor: 'rgba(255, 255, 255, 0.03)', padding: '4px 8px', borderRadius: '4px', border: '1px solid rgba(255, 255, 255, 0.05)' }}
                                                    title={`${a.name}${a.form ? ` (${a.form})` : ''}: $${a.winning_bid}`}
                                                >
                                                    <img
                                                        src={`/MiniIcons/${formatPokemonName(a.name)}.png`}
                                                        alt={a.name}
                                                        style={{ maxWidth: '20px', maxHeight: '20px', width: 'auto', height: 'auto', objectFit: 'contain', marginRight: '6px' }}
                                                    />
                                                    <span style={{ fontSize: '1.1rem', color: 'inherit', opacity: 0.7 }}>${a.winning_bid}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>
        );
}

export default LeaderboardPage;
