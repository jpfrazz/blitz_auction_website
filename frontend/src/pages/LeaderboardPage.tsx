import React, { useState, useEffect, useMemo } from 'react';
import { fetchLeaderboard, LeaderboardEntry } from '../shared/api/users';
import Header from '../shared/components/Header';
import './LeaderboardPage.scss';

const LeaderboardPage = () => {
    const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
    const [minGames, setMinGames] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

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

    const filteredAndSortedLeaderboard = useMemo(() => {
        return leaderboard
            .filter(player => player.games_played >= minGames)
            .sort((a, b) => b.mmr - a.mmr);
    }, [leaderboard, minGames]);

    const getRowClass = (index: number) => {
        switch (index) {
            case 0: return 'gold-row';
            case 1: return 'silver-row';
            case 2: return 'bronze-row';
            default: return '';
        }
    };

    if (loading) {
        return <div className="leaderboard-container">Loading...</div>;
    }

    if (error) {
        return <div className="leaderboard-container">{error}</div>;
    }

    return (
        <div className="leaderboard-page-wrapper">
            <Header />
            <div className="leaderboard-container">
            <div className="leaderboard-header">
                <h1>Blitz Season One is coming soon! Check back at the end of the month to see who's the best of the best.</h1>
                <div className="filter-container">
                    <label htmlFor="min-games-filter">Minimum Games Played: </label>
                    <input
                        id="min-games-filter"
                        type="number"
                        value={minGames}
                        onChange={(e) => setMinGames(Number(e.target.value) >= 0 ? Number(e.target.value) : 0)}
                        min="0"
                    />
                </div>
            </div>
            <table className="leaderboard-table">
                <thead>
                    <tr>
                        <th>Rank</th>
                        <th>Username</th>
                        <th>Win-Loss</th>
                        <th>Most Drafted Pokémon</th>
                    </tr>
                </thead>
                <tbody>
                    {filteredAndSortedLeaderboard.map((player, index) => (
                        <tr key={player.user_id} className={getRowClass(index)}>
                            <td>{index + 1}</td>
                            <td>{player.username}</td>
                            <td>{`${player.win} - ${player.loss}`}</td>
                            <td>
                                <div className="pokemon-list">
                                    {player.most_drafted_pokemon.map(p => (
                                        <img
                                            key={`${p.id}-${p.form}`}
                                            src={`/baseforms/${p.name}.png`}
                                            alt={p.name}
                                            title={p.name + (p.form ? ` (${p.form})` : '')}
                                            className="leaderboard-pokemon-img"
                                        />
                                    ))}
                                </div>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
            </div>
        </div>
    );
};

export default LeaderboardPage;