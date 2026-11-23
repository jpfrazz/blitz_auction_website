import React, { useEffect, useRef, useState } from 'react';
import { RockPaperScissorsState, RpsChoice, Team } from '../../../types';
import './OneVOnePool.scss';
import './RockPaperScissorsPanel.scss';

interface RockPaperScissorsPanelProps {
  rps: RockPaperScissorsState;
  teams: Team[];
  currentUserId: string | null;
  isBusy: boolean;
  onPick: (choice: RpsChoice | null) => Promise<unknown>;
  onChooseFirstPick: (firstPick: boolean) => Promise<unknown>;
}

const MOVES: { choice: RpsChoice; image: string; className: string }[] = [
  { choice: 'Rock', image: '/generic/Rock.png', className: 'rps-rock' },
  { choice: 'Paper', image: '/generic/Paper.png', className: 'rps-paper' },
  { choice: 'Scissors', image: '/generic/Scissors.png', className: 'rps-scissors' },
];

type Phase = 'choosing' | 'reveal' | 'swap' | 'clash' | 'result' | 'decided';

const REVEAL_MS = 520;
// Give players a beat to recognize the revealed moves before tiles rearrange.
const SWAP_DELAY_MS = 1000;
const SWAP_MS = 260;
const CLASH_MS = 320;
const SHATTER_MS = 700;

const moveIndex = (choice: RpsChoice) => MOVES.findIndex((move) => move.choice === choice);

const RockPaperScissorsPanel: React.FC<RockPaperScissorsPanelProps> = ({
  rps,
  currentUserId,
  isBusy,
  onPick,
  onChooseFirstPick,
}) => {
  const [selectedChoice, setSelectedChoice] = useState<RpsChoice | null>(null);
  const [phase, setPhase] = useState<Phase>('choosing');
  const animatedResultRef = useRef<string | null>(null);
  const winnerRef = useRef(rps.winner);
  winnerRef.current = rps.winner;

  const isHost = !!currentUserId && currentUserId === rps.host;
  const isOpponent = !!currentUserId && currentUserId === rps.opponent;
  const isPlayer = isHost || isOpponent;
  const canPick = isPlayer && !rps.winner && !isBusy && phase === 'choosing';

  // A new round clears the previous pick.
  useEffect(() => {
    setSelectedChoice(null);
  }, [rps.round, rps.winner]);

  const lastRound = rps.last_round;
  const resultKey = lastRound
    ? `${lastRound.round}:${lastRound.host}:${lastRound.opponent}:${lastRound.winner ?? 'tie'}`
    : null;

  // Reveal -> pause -> (decisive only: swap) -> clash -> shatter/bonk. The
  // tiles stay mounted until the whole sequence finishes so no cutaway.
  useEffect(() => {
    if (!resultKey) {
      animatedResultRef.current = null;
      setPhase('choosing');
      return;
    }
    if (animatedResultRef.current === resultKey) return;
    animatedResultRef.current = resultKey;
    setPhase('reveal');

    const decisive = !!lastRound?.winner;
    const swapDelay = decisive ? SWAP_DELAY_MS : 0;
    const swapDuration = decisive ? SWAP_MS : 0;
    const swapStart = REVEAL_MS + swapDelay;
    const toSwap = decisive
      ? window.setTimeout(() => setPhase('swap'), swapStart)
      : null;
    const toClash = window.setTimeout(
      () => setPhase('clash'),
      swapStart + swapDuration,
    );
    const toResult = window.setTimeout(
      () => setPhase('result'),
      swapStart + swapDuration + CLASH_MS,
    );
    const toDone = window.setTimeout(
      () => setPhase(winnerRef.current ? 'decided' : 'choosing'),
      swapStart + swapDuration + CLASH_MS + SHATTER_MS,
    );
    return () => {
      if (toSwap !== null) window.clearTimeout(toSwap);
      window.clearTimeout(toClash);
      window.clearTimeout(toResult);
      window.clearTimeout(toDone);
    };
  }, [resultKey, lastRound?.winner]);

  // Re-clicking the picked tile clears it; clicking a different one swaps it.
  const handlePick = (choice: RpsChoice) => {
    const next = selectedChoice === choice ? null : choice;
    const previous = selectedChoice;
    setSelectedChoice(next);
    void onPick(next).catch(() => setSelectedChoice(previous));
  };

  // Bottom row is the local player (host as a fallback for spectators).
  const playerId = isPlayer && currentUserId ? currentUserId : rps.host;
  const enemyId = playerId === rps.host ? rps.opponent : rps.host;
  const playerChoice = lastRound
    ? playerId === rps.host ? lastRound.host : lastRound.opponent
    : null;
  const enemyChoice = lastRound
    ? playerId === rps.host ? lastRound.opponent : lastRound.host
    : null;
  const playerWon = !!lastRound?.winner && lastRound.winner === playerId;
  const attackingUp = playerWon ? -1 : 1;
  const animating = phase !== 'choosing' && !!lastRound;

  const winnerChoice = lastRound?.winner
    ? lastRound.winner === lastRound.host ? lastRound.host : lastRound.opponent
    : null;
  const loserChoice = lastRound?.winner
    ? lastRound.winner === lastRound.host ? lastRound.opponent : lastRound.host
    : null;
  const swapped = !!lastRound?.winner && phase !== 'reveal';

  // Both players see the full animation; only after it finishes does the
  // winner get the big result while the loser waits for the pick-order choice.
  const showOutcome = !!rps.winner && (phase === 'decided' || !lastRound);
  const isWinner = !!rps.winner && rps.winner === currentUserId;

  const motionStyle = (isEnemy: boolean, image: string) => ({
    '--rps-approach': isEnemy ? 1 : -1,
    '--rps-attack': attackingUp,
    '--rps-shard-image': `url("${image}")`,
  } as React.CSSProperties);

  // The winning tile trades places, in its own row, with the card directly
  // opposite the loser's pick. That lines the two chosen tiles up in the same
  // column for a head-to-head bonk.
  const swapShift = (rowIsEnemy: boolean, move: RpsChoice): number | null => {
    if (!winnerChoice || !loserChoice || rowIsEnemy !== !playerWon) return null;
    if (move === winnerChoice) return moveIndex(loserChoice) - moveIndex(winnerChoice);
    if (move === loserChoice) return moveIndex(winnerChoice) - moveIndex(loserChoice);
    return null;
  };

  const motionClass = (isEnemy: boolean) => {
    if (!animating) return '';
    if (phase === 'clash') return 'rps-approach';
    if (phase === 'result' || phase === 'decided') {
      if (!lastRound?.winner) return 'rps-bonk';
      const isWinnerSide = lastRound.winner === (isEnemy ? enemyId : playerId);
      return isWinnerSide ? 'rps-approach' : 'rps-shatter';
    }
    return '';
  };

  const swapProps = (rowIsEnemy: boolean, move: RpsChoice) => {
    const shift = swapShift(rowIsEnemy, move);
    return {
      className: swapped && shift !== null ? 'rps-swap' : '',
      style: { '--rps-column-shift': shift ?? 0 } as React.CSSProperties,
    };
  };

  return (
    <div className="one-v-one-pool-container rps-panel">
      <div className={`rps-panel-inner ${animating ? 'rps-revealing' : ''}`}>
        {showOutcome ? (
          <div className={`rps-outcome ${isWinner ? 'rps-outcome--win' : 'rps-outcome--wait'}`}>
            <div className="rps-outcome-title">
              {isWinner ? 'Winner!' : 'Waiting for opponent...'}
            </div>
            <div className={`rps-pick-order ${isWinner ? '' : 'rps-pick-order--disabled'}`}>
              <button
                type="button"
                className="button rps-choice-button"
                disabled={isBusy || !isWinner}
                onClick={() => void onChooseFirstPick(true).catch(() => {})}
              >
                1st Pick
              </button>
              <button
                type="button"
                className="button rps-choice-button"
                disabled={isBusy || !isWinner}
                onClick={() => void onChooseFirstPick(false).catch(() => {})}
              >
                2nd+3rd Pick
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="rps-face-down-row" aria-hidden="true">
              {MOVES.map((move) => {
                const flipped = animating && enemyChoice === move.choice;
                const swap = swapProps(true, move.choice);
                return (
                  <div
                    className={`rps-face-motion ${swap.className} ${flipped ? motionClass(true) : ''}`}
                    style={{
                      ...swap.style,
                      ...(flipped ? motionStyle(true, move.image) : {}),
                    }}
                    key={move.choice}
                  >
                    <div className={`rps-face-down-tile ${flipped ? 'is-flipped' : ''}`}>
                      <div className="rps-card-face rps-card-back" />
                      <div className={`rps-card-face rps-card-front rps-tile ${move.className}`}>
                        <img src={move.image} alt="" />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="rps-tile-grid">
              {MOVES.map((move) => {
                const isSelected = selectedChoice === move.choice;
                const muted = !!selectedChoice && !isSelected;
                const involved = animating && playerChoice === move.choice;
                const swap = swapProps(false, move.choice);
                return (
                  <button
                    key={move.choice}
                    type="button"
                    aria-label={move.choice}
                    aria-pressed={isSelected}
                    className={`rps-tile-cell ${swap.className} ${involved ? motionClass(false) : ''}`}
                    style={{
                      ...swap.style,
                      ...(involved ? motionStyle(false, move.image) : {}),
                    }}
                    onClick={() => handlePick(move.choice)}
                    disabled={!canPick}
                  >
                    <span
                      className={`one-v-one-pool-square rps-tile ${move.className} ${
                        canPick ? 'rps-clickable' : ''
                      } ${muted ? 'rps-muted' : ''}`}
                    >
                      <img src={move.image} alt={move.choice} />
                    </span>
                    <span className="rps-tile-label">{move.choice}</span>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default RockPaperScissorsPanel;
