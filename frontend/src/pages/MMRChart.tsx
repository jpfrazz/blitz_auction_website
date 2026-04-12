import React, { useMemo } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer
} from 'recharts';
import { LeaderboardEntry } from '../shared/api/users';
import { StatsPageResponse } from '../types';

interface MMRChartProps {
  leaderboard: LeaderboardEntry[];
  stats: StatsPageResponse | null;
  minGames: number;
}

const COLORS = [
  '#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0', '#9966FF', 
  '#FF9F40', '#8AC249', '#EA738D', '#33CC99', '#7BC4C4',
  '#DAAD86', '#659DBD', '#BC986A', '#8D8741', '#FBEEC1'
];

const MMRChart: React.FC<MMRChartProps> = ({ leaderboard, stats, minGames }) => {
  const processedData = useMemo(() => {
    if (!stats || leaderboard.length === 0) return [];

    const filteredLeaderboard = leaderboard.filter(p => p.games_played >= minGames);
    const userMap = new Map<string, number[]>();
    
    filteredLeaderboard.forEach(user => {
      userMap.set(user.user_id, []);
    });

    // Sort teams chronologically
    const sortedTeams = [...stats.teams]
      .filter(t => t.user_id && userMap.has(t.user_id))
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

    // Group pre-match MMRs by user
    sortedTeams.forEach(t => {
      if (t.user_id) {
        userMap.get(t.user_id)?.push(t.pre_match_mmr ?? 1500);
      }
    });

    // Add final current MMR
    filteredLeaderboard.forEach(user => {
      userMap.get(user.user_id)?.push(user.mmr);
    });

    let maxPoints = 0;
    userMap.forEach(points => {
      if (points.length > maxPoints) maxPoints = points.length;
    });

    const data = [];
    for (let i = 0; i < maxPoints; i++) {
      const entry: any = { race: i };
      userMap.forEach((points, userId) => {
        if (i < points.length) {
          entry[userId] = points[i];
        } else if (points.length > 0) {
          // Pad with last known value to keep lines going
          entry[userId] = points[points.length - 1];
        }
      });
      data.push(entry);
    }

    return data;
  }, [stats, leaderboard, minGames]);

  const topPlayers = useMemo(() => 
    leaderboard.filter(p => p.games_played >= minGames).slice(0, 15), 
    [leaderboard, minGames]
  );

  if (!stats) return <div style={{ color: '#888', padding: '40px', textAlign: 'center' }}>Loading chart data...</div>;

  return (
    <div className="mmr-progression-chart" style={{ width: '100%', height: '500px', marginTop: '20px', background: 'rgba(0,0,0,0.2)', padding: '20px', borderRadius: '8px' }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={processedData}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
          <XAxis 
            dataKey="race" 
            stroke="#888" 
            label={{ value: 'Race Number', position: 'insideBottom', offset: -5 }} 
          />
          <YAxis 
            stroke="#888" 
            domain={['auto', 'auto']}
            label={{ value: 'ELO', angle: -90, position: 'insideLeft' }} 
          />
          <Tooltip 
            contentStyle={{ backgroundColor: '#222', border: '1px solid #444', color: '#fff' }}
            itemStyle={{ color: '#fff' }}
          />
          <Legend 
            content={(props) => (
              <ul style={{ listStyle: 'none', display: 'flex', flexWrap: 'wrap', gap: '15px', justifyContent: 'center', marginTop: '20px' }}>
                {topPlayers.map((player, index) => (
                  <li key={player.user_id} style={{ display: 'flex', alignItems: 'center', gap: '8px', color: COLORS[index % COLORS.length] }}>
                    <img 
                      src={player.avatar ? `https://cdn.discordapp.com/avatars/${player.user_id}/${player.avatar}.png` : ''} 
                      style={{ width: '20px', height: '20px', borderRadius: '50%', background: '#444' }}
                      alt=""
                    />
                    <span style={{ fontSize: '0.85rem' }}>{player.global_name || player.username}</span>
                  </li>
                ))}
              </ul>
            )}
          />
          {topPlayers.map((player, index) => (
            <Line
              key={player.user_id}
              type="monotone"
              dataKey={player.user_id}
              stroke={COLORS[index % COLORS.length]}
              strokeWidth={2}
              dot={{ r: 3 }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};

export default MMRChart;