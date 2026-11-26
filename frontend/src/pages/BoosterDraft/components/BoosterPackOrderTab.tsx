import React from 'react';
import { boosterPlayerColor } from '../playerColors';
import './BoosterPackOrderTab.scss';

interface BoosterPackOrderTabProps {
  playerIds: string[];
  teamSize: number;
}

interface PassSegment {
  from: number;
  to: number;
}

export const BOOSTER_FIRST_PICK_NOTE = '1st Pick: Pick+Ban+Ward';

const CENTER_X = 150;
const CENTER_Y = 115;
const RADIUS_X = 112;
const RADIUS_Y = 68;
const CIRCLE_RADIUS = 19;

/** Packs pass to the next seat, wrapping from the last player back to P1. */
export function buildBoosterPassOrder(playerCount: number): PassSegment[] {
  if (playerCount < 2) return [];
  return Array.from({ length: playerCount }, (_, index) => ({
    from: index,
    to: (index + 1) % playerCount,
  }));
}

function ordinal(value: number): string {
  const suffix = value % 100 >= 11 && value % 100 <= 13
    ? 'th'
    : value % 10 === 1
      ? 'st'
      : value % 10 === 2
        ? 'nd'
        : value % 10 === 3
          ? 'rd'
          : 'th';
  return `${value}${suffix}`;
}

/**
 * One full cycle gives each player one pick. Team sizes that are not divisible
 * by the player count stop partway through the next cycle, which is how a
 * three-player 8-Pokemon draft ends after only two picks in cycle 3.
 */
export function boosterCycleNotes(playerCount: number, teamSize: number): string[] {
  if (playerCount < 2 || teamSize <= 0) return [];
  const fullCycles = Math.floor(teamSize / playerCount);
  const partialPicks = teamSize % playerCount;
  const cycleCount = fullCycles + (partialPicks > 0 ? 1 : 0);
  return Array.from({ length: cycleCount }, (_, index) => {
    const cycle = index + 1;
    const isPartial = partialPicks > 0 && cycle === cycleCount;
    return `${ordinal(cycle)} Cycle: ${cycle === 1 ? 'Pick+Ban' : 'Picks only'}${isPartial ? ' (partial)' : ''}`;
  });
}

function pointAt(index: number, count: number): { x: number; y: number } {
  const angle = -Math.PI / 2 + (index * 2 * Math.PI) / count;
  return {
    x: CENTER_X + RADIUS_X * Math.cos(angle),
    y: CENTER_Y + RADIUS_Y * Math.sin(angle),
  };
}

function arrowEndpoints(from: number, to: number, count: number) {
  const a = pointAt(from, count);
  const b = pointAt(to, count);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy) || 1;
  const unitX = dx / length;
  const unitY = dy / length;
  return {
    x1: a.x + unitX * (CIRCLE_RADIUS + 3),
    y1: a.y + unitY * (CIRCLE_RADIUS + 3),
    x2: b.x - unitX * (CIRCLE_RADIUS + 8),
    y2: b.y - unitY * (CIRCLE_RADIUS + 8),
  };
}

const BoosterPackOrderTab: React.FC<BoosterPackOrderTabProps> = ({ playerIds, teamSize }) => {
  const count = playerIds.length;
  const segments = buildBoosterPassOrder(count);

  if (count === 0) return null;

  return (
    <div className="booster-pack-order-tab">
      <div className="booster-pack-order-notes">
        <div>{BOOSTER_FIRST_PICK_NOTE}</div>
        {boosterCycleNotes(count, teamSize).map((note) => (
          <div key={note}>{note}</div>
        ))}
      </div>
      <svg
        className="booster-pack-order-diagram"
        viewBox="0 0 300 230"
        role="img"
        aria-label="Pack passing order"
      >
        <defs>
          <marker
            id="booster-pack-order-arrow"
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="5"
            markerHeight="5"
            orient="auto-start-reverse"
          >
            <path d="M 0 1 L 9 5 L 0 9 z" fill="rgba(255, 255, 255, 0.85)" />
          </marker>
        </defs>
        {segments.map((segment) => {
          const points = arrowEndpoints(segment.from, segment.to, count);
          return (
            <line
              key={`${segment.from}-${segment.to}`}
              className="booster-pack-order-arrow"
              x1={points.x1}
              y1={points.y1}
              x2={points.x2}
              y2={points.y2}
              markerEnd="url(#booster-pack-order-arrow)"
            />
          );
        })}
        {playerIds.map((playerId, index) => {
          const point = pointAt(index, count);
          return (
            <circle
              key={playerId}
              className="booster-pack-order-circle"
              cx={point.x}
              cy={point.y}
              r={CIRCLE_RADIUS}
              fill={boosterPlayerColor(index)}
            />
          );
        })}
      </svg>
    </div>
  );
};

export default BoosterPackOrderTab;
