import React from 'react';
import './PlayerRow.scss';

interface PlayerRowProps {
  players: string[];
  numPlayers: number;
  startingMoney: number;
}

const PlayerRow: React.FC<PlayerRowProps> = ({ players, numPlayers, startingMoney }) => {
  return (
    <div className="auction-players-row">
      {Array.from({ length: numPlayers }).map((_, idx) => {
        const playerName = players[idx];
        const isFilled = Boolean(playerName);
        return (
          <div
            key={idx}
            className={`auction-player-box ${isFilled ? 'player-filled' : 'player-open'}`}
          >
            <div className="auction-player-name">
              {playerName || 'Open Slot'}
            </div>
            <div className="auction-player-money">${startingMoney.toLocaleString()}</div>
          </div>
        );
      })}
    </div>
  );
};

export default PlayerRow;
