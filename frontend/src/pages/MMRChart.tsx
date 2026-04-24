import React, { useMemo, useState } from 'react';
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

const CustomTooltip = ({ active, payload, label, highlightedUser }: any) => {
  if (active && payload && payload.length) {
    const raceData = payload[0].payload;
    // Only show users who actually participated in this specific race (had a delta)
    const relevantEntries = payload.filter((item: any) => {
      const deltaKey = `${item.dataKey}_delta`;
      return raceData[deltaKey] !== undefined;
    });

    if (relevantEntries.length === 0) return null;

    return (
      <div style={{ 
        backgroundColor: '#222', 
        border: '1px solid #444', 
        padding: '10px', 
        borderRadius: '4px',
        boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
        zIndex: 100
      }}>
        <p style={{ margin: '0 0 8px', fontWeight: 'bold', borderBottom: '1px solid #444', paddingBottom: '4px', color: '#fff' }}>
          {raceData.date === 'Initial' ? 'Initial Rating' : raceData.date}
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {relevantEntries
            .sort((a: any, b: any) => {
              const pA = raceData[`${a.dataKey}_placement`] ?? 999;
              const pB = raceData[`${b.dataKey}_placement`] ?? 999;
              return pA - pB;
            })
            .map((entry: any) => {
              const delta = raceData[`${entry.dataKey}_delta`];
              const deltaText = delta >= 0 ? `+${delta}` : `${delta}`;
              const deltaColor = delta >= 0 ? '#4caf50' : '#f44336';
              const isHighlighted = entry.dataKey === highlightedUser;
              
              return (
                <div key={entry.dataKey} style={{ fontSize: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px' }}>
                  <span style={{ color: entry.color, fontWeight: isHighlighted ? 900 : 600, textDecoration: isHighlighted ? 'underline' : 'none' }}>{entry.name}:</span>
                  <span style={{ color: '#fff', fontWeight: isHighlighted ? 900 : 400 }}>
                    {entry.value} 
                    <span style={{ color: deltaColor, marginLeft: '6px', fontSize: '0.85rem', fontWeight: 'bold' }}>
                      ({deltaText})
                    </span>
                  </span>
                </div>
              );
            })}
        </div>
      </div>
    );
  }
  return null;
};

const MMRChart: React.FC<MMRChartProps> = ({ leaderboard, stats, minGames }) => {
  const [highlightedUser, setHighlightedUser] = useState<string | null>(null);

  const processedData = useMemo(() => {
    if (!stats || leaderboard.length === 0) return [];

    // Group ranked team entries by draft
    const drafts = new Map<string, { date: string, teams: any[] }>();

    // Create a map of draft_id -> date from auctions as a fallback
    const draftDates = new Map<string, string>();
    stats.auctions.forEach(a => {
      if (a.created_at && !draftDates.has(a.draft_id)) {
        draftDates.set(a.draft_id, a.created_at);
      }
    });

    stats.teams.forEach(t => {
      // Filter for ranked drafts with results. We don't check pre_match_mmr here
      // because we are simulating history and want this to work even if the
      // database hasn't been recalculated yet.
      const team = t as any; // Cast to access fields that might be missing in older frontend types
      if (!team.user_id || team.placement === null || team.ranked === false) return;

      if (!drafts.has(team.draft_id)) {
        // Use team.created_at if available, otherwise fall back to the draft's auction date
        const date = team.created_at || draftDates.get(team.draft_id) || '';
        drafts.set(team.draft_id, { date, teams: [] });
      }
      drafts.get(team.draft_id)!.teams.push(team);
    });

    // Sort drafts chronologically
    const sortedDrafts = Array.from(drafts.values())
      .filter(d => d.date !== '' && d.teams.length >= 6) // Filter for valid dates and minimum 6 participants
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    const currentMMRs = new Map<string, number>();
    const userRaceCounts = new Map<string, number>();
    
    // Everyone starts at 1500
    leaderboard.forEach(u => currentMMRs.set(u.user_id, 1500));

    // Point 0: The beginning
    const initialEntry: any = { 
      race: 0,
      date: 'Initial'
    };
    leaderboard.forEach(u => {
      initialEntry[u.user_id] = 1500;
    });
    const data = [initialEntry];

    // Simulate each race to find the MMR history snapshots
    sortedDrafts.forEach((draft, index) => {
      const participants = draft.teams;
      const deltas = new Map<string, number>();

      participants.forEach(p_i => {
        let delta = 0;
        const raceNum = (userRaceCounts.get(p_i.user_id) || 0) + 1;
        userRaceCounts.set(p_i.user_id, raceNum);
        
        const k = raceNum <= 5 ? 40 : 20;
        const rating_i = currentMMRs.get(p_i.user_id) || 1500;

        participants.forEach(p_j => {
          if (p_i.user_id === p_j.user_id) return;
          const rating_j = currentMMRs.get(p_j.user_id) || 1500;
          
          const expected = 1 / (1 + Math.pow(10, (rating_j - rating_i) / 400));
          const result = p_i.placement < p_j.placement ? 1 : 0;
          delta += k * (result - expected);
        });
        deltas.set(p_i.user_id, Math.round(delta));
      });

      // Apply draft updates to the running simulation
      deltas.forEach((delta, uid) => {
        currentMMRs.set(uid, (currentMMRs.get(uid) || 1500) + delta);
      });

      // Snapshot MMRs at this race index for all users
      const entry: any = { 
        race: index + 1,
        date: new Date(draft.date).toLocaleDateString('en-US')
      };

      participants.forEach(p => {
        entry[`${p.user_id}_placement`] = p.placement;
      });

      currentMMRs.forEach((mmr, uid) => {
        entry[uid] = mmr;
        if (deltas.has(uid)) {
          entry[`${uid}_delta`] = deltas.get(uid);
        }
      });
      data.push(entry);
    });

    return data;
  }, [stats, leaderboard]);

  const chartPlayers = useMemo(() => 
    leaderboard.filter(p => p.games_played >= minGames), 
    [leaderboard, minGames]
  );

  if (!stats) return <div style={{ color: '#888', padding: '40px', textAlign: 'center' }}>Loading chart data...</div>;

  return (
    <div 
      className="mmr-progression-chart" 
      style={{ 
        width: 'calc(100% - 2rem)', 
        margin: '20px auto 0', 
        height: '500px', 
        background: 'rgba(0,0,0,0.2)', 
        padding: '20px', 
        borderRadius: '8px',
        boxSizing: 'border-box'
      }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={processedData}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
          <XAxis 
            dataKey="race" 
            stroke="#888" 
            label={{ value: 'Race #', position: 'insideBottom', offset: -10, fontSize: '1.25rem', fill: '#bbb' }} 
          />
          <YAxis 
            stroke="#888" 
            domain={['auto', 'auto']}
            label={{ value: 'ELO', angle: -90, position: 'insideLeft', fontSize: '1.25rem', fill: '#bbb' }} 
          />
          <Tooltip content={<CustomTooltip highlightedUser={highlightedUser} />} />
          <Legend 
            content={(props) => (
              <ul style={{ listStyle: 'none', display: 'flex', flexWrap: 'wrap', gap: '15px', justifyContent: 'center', marginTop: '20px' }}>
                {chartPlayers.map((player, index) => (
                  <li 
                    key={player.user_id} 
                    onClick={() => setHighlightedUser(prev => prev === player.user_id ? null : player.user_id)}
                    style={{ 
                      display: 'flex', 
                      alignItems: 'center', 
                      gap: '8px', 
                      color: COLORS[index % COLORS.length],
                      cursor: 'pointer',
                      opacity: highlightedUser === null || highlightedUser === player.user_id ? 1 : 0.35,
                      transition: 'opacity 0.2s ease-in-out'
                    }}
                  >
                    <img 
                      src={player.avatar ? `https://cdn.discordapp.com/avatars/${player.user_id}/${player.avatar}.png` : ''} 
                      style={{ width: '20px', height: '20px', borderRadius: '50%', background: '#444' }}
                      alt=""
                    />
                    <span style={{ fontSize: '1rem', fontWeight: highlightedUser === player.user_id ? 'bold' : 'normal', textDecoration: highlightedUser === player.user_id ? 'underline' : 'none' }}>
                      {player.global_name || player.username}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          />
          {chartPlayers.map((player, index) => (
            <Line
              key={player.user_id}
              type="monotone"
              dataKey={player.user_id}
              name={player.global_name || player.username}
              stroke={COLORS[index % COLORS.length]}
              strokeWidth={highlightedUser === player.user_id ? 5 : 2}
              strokeOpacity={highlightedUser === null || highlightedUser === player.user_id ? 1 : 0.15}
              dot={(props: any) => {
                const { cx, cy, payload, dataKey } = props;
                const deltaKey = `${dataKey}_delta`;
                const lineColor = COLORS[index % COLORS.length];
                const opacity = highlightedUser === null || highlightedUser === player.user_id ? 1 : 0.15;
                // Only render a dot if the user participated in this race (i.e., has a delta)
                if (payload[deltaKey] !== undefined) {
                  return (
                    <circle cx={cx} cy={cy} r={highlightedUser === dataKey ? 6 : 3} fill={lineColor} stroke={lineColor} fillOpacity={opacity} strokeOpacity={opacity} strokeWidth={1} />
                  );
                }
                return null;
              }}
              activeDot={(props: any) => {
                const { cx, cy, payload, dataKey } = props;
                const deltaKey = `${dataKey}_delta`;
                const lineColor = COLORS[index % COLORS.length];
                const opacity = highlightedUser === null || highlightedUser === player.user_id ? 1 : 0.15;
                // Only render an active dot if the user participated in this race
                if (payload[deltaKey] !== undefined) {
                  return (
                    <circle cx={cx} cy={cy} r={highlightedUser === dataKey ? 7 : 4} fill={lineColor} stroke={lineColor} fillOpacity={opacity} strokeOpacity={opacity} strokeWidth={1} />
                  );
                }
                return null;
              }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};

export default MMRChart;