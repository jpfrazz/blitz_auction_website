import React from 'react';
import { Team } from '../../../types';
import './PlayerRow.scss';

interface PlayerRowProps {
  teams: Team[];
  numPlayers: number;
  highestBidderId?: string | null;
  wsConnected?: boolean;
  currentUserId?: string | null;
  highestBid?: number;
}

const PlayerRow: React.FC<PlayerRowProps> = ({ teams, numPlayers, highestBidderId, wsConnected = true, currentUserId, highestBid }) => {
  const [animatingId, setAnimatingId] = React.useState<string | null>(null);
  const isInitial = React.useRef(true);

  React.useEffect(() => {
    if (isInitial.current) {
      isInitial.current = false;
      return;
    }

    if (highestBid && highestBid > 0 && highestBidderId) {
      setAnimatingId(highestBidderId);
      const timer = setTimeout(() => setAnimatingId(null), 500);
      return () => clearTimeout(timer);
    }
  }, [highestBid, highestBidderId]);

  const sortedTeams = React.useMemo(() => {
    if (!currentUserId) return teams;
    const myTeamIdx = teams.findIndex(t => t?.user_id === currentUserId);
    // If not found or already at the start, return original
    if (myTeamIdx <= 0) return teams;

    const newTeams = [...teams];
    const [myTeam] = newTeams.splice(myTeamIdx, 1);
    newTeams.unshift(myTeam);
    return newTeams;
  }, [teams, currentUserId]);

  return (
    <div className="auction-players-row">
      {Array.from({ length: numPlayers }).map((_, idx) => {
        const team = sortedTeams[idx];
        const playerName = (team as any)?.global_name || team?.username || team?.user_id;
        const isFilled = Boolean(team);
        const readinessClass = isFilled && team?.ready ? 'player-ready' : 'player-not-ready';
        const teamMoney = team?.budget_remaining ?? 0;
        const zeroMoneyClass = isFilled && teamMoney === 0 ? 'player-zero-money' : '';
        const playerStateClass = isFilled
          ? (zeroMoneyClass || readinessClass)
          : 'player-open';
        const wonPokemon = team?.auctions_won ?? team?.pokemon ?? [];
        const disconnectedClass = !wsConnected ? 'player-disconnected' : '';
        return (
          <div
            key={idx}
            className={`auction-player-box ${playerStateClass} ${team?.user_id === highestBidderId ? 'highest-bidder' : ''} ${disconnectedClass} ${team?.user_id === animatingId ? 'player-bidding' : ''}`}
          >
            <div className="auction-player-name">
              {playerName || 'Open Slot'}
            </div>
            <div className="auction-player-money">${teamMoney.toLocaleString()}</div>
            <div className="auction-player-icons">
              {wonPokemon.map(pokemon => (
                <img
                  key={`${pokemon.name}-${pokemon.form ?? 'base'}`}
                  src={`/MiniIcons/${pokemon.name.toLowerCase()}.png`}
                  alt={pokemon.name}
                  className="auction-player-icon"
                  loading="lazy"
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default PlayerRow;
