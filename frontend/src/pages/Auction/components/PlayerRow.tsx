import React from 'react';
import { Team } from '../../../types';
import './PlayerRow.scss';

interface PlayerRowProps {
  teams: Team[];
  numPlayers: number;
  budgetRemaining: number;
  highestBidderId?: string | null;
}

const PlayerRow: React.FC<PlayerRowProps> = ({ teams, numPlayers, budgetRemaining, highestBidderId }) => {
  return (
    <div className="auction-players-row">
      {Array.from({ length: numPlayers }).map((_, idx) => {
        const team = teams[idx];
        const playerName = team?.user_id;
        const isFilled = Boolean(team);
        const teamMoney = budgetRemaining;
        const wonPokemon = team?.auctions_won ?? team?.pokemon ?? [];
        return (
          <div
            key={idx}
            className={`auction-player-box ${isFilled ? 'player-filled' : 'player-open'} ${team?.user_id === highestBidderId ? 'highest-bidder' : ''}`}
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
