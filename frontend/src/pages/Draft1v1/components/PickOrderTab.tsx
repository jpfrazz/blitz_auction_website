import React from 'react';
import './PickOrderTab.scss';

interface PickOrderCell {
  player: 'P1' | 'P2';
  action: 'Pick' | 'Ban';
  num: number;
}

interface PickOrderTabProps {
  player1Name?: string | null;
  player2Name?: string | null;
  currentPickNumber?: number | null;
  poolSize?: number;
}

// Chronological 1v1 pick/ban order (mirrors the backend engine):
// P1 picks first (no ban), P2 picks twice (no ban), P1 picks + bans once,
// then Pick+Ban turns alternate (P2, P1, ...) for the selected pool size.
function buildPickOrder(poolSize: number): PickOrderCell[] {
  const cells: PickOrderCell[] = [
    { player: 'P1', action: 'Pick', num: 1 },
    { player: 'P2', action: 'Pick', num: 2 },
    { player: 'P2', action: 'Pick', num: 3 },
    { player: 'P1', action: 'Pick', num: 4 },
    { player: 'P1', action: 'Ban', num: 5 },
  ];
  let n = 6;
  for (let round = 0; round < 5 + (poolSize - 32) / 4; round += 1) {
    cells.push({ player: 'P2', action: 'Pick', num: n++ });
    cells.push({ player: 'P2', action: 'Ban', num: n++ });
    cells.push({ player: 'P1', action: 'Pick', num: n++ });
    cells.push({ player: 'P1', action: 'Ban', num: n++ });
  }
  cells.push({ player: 'P2', action: 'Pick', num: n++ });
  cells.push({ player: 'P2', action: 'Ban', num: n++ });
  cells.push({ player: 'P1', action: 'Pick', num: n++ });
  return cells;
}

const PickOrderTab: React.FC<PickOrderTabProps> = ({ player1Name, player2Name, currentPickNumber, poolSize = 32 }) => (
  <div className="pick-order-tab">
    <div className="pick-order-legend">
      <span className="pick-order-legend-item">
        <span className="pick-order-cell pick-order-cell-sm p1" />
        {player1Name || 'Player 1'}
      </span>
      <span className="pick-order-legend-item">
        <span className="pick-order-cell pick-order-cell-sm p2" />
        {player2Name || 'Player 2'}
      </span>
      <span className="pick-order-legend-item">
        <span className="pick-order-cell pick-order-cell-sm pick-order-legend-pick" />
        Pick
      </span>
      <span className="pick-order-legend-item">
        <span className="pick-order-cell pick-order-cell-sm pick-order-legend-pick ban" />
        Ban
      </span>
    </div>
    <div className="pick-order-grid">
      {buildPickOrder(poolSize).map((cell) => (
        <div
          key={cell.num}
          className={`pick-order-cell ${cell.player.toLowerCase()} ${cell.action === 'Ban' ? 'ban' : ''} ${cell.num === currentPickNumber ? 'current' : ''}`}
          title={`${cell.player} ${cell.action} #${cell.num}`}
        >
          {cell.num}
        </div>
      ))}
    </div>
  </div>
);

export default PickOrderTab;