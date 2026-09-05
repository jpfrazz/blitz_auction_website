import React, { useState, useEffect } from 'react';
import { TbPlayerPauseFilled, TbPlayerPlayFilled, TbClock } from 'react-icons/tb';
import { Pokemon, OneVOnePlayer } from '../../../types';
import './OneVOneInfoPanel.scss';

interface OneVOneInfoPanelProps {
  draft_id: string;
  isPaused: boolean;
  pauseActionPending: boolean;
  onTogglePause: () => void;
  currentPlayerLabel?: string | null;
  currentPlayer?: OneVOnePlayer | null;
  currentAction?: string | null;
  isMyTurn: boolean;
  turnExpiresAt?: string | null;
  currentServerTime?: string | null;
  pausedTimeRemaining?: number | null;
  canPause: boolean;
  timerEnabled: boolean;
  onToggleTimer: () => void;
  canToggleTimer: boolean;
  turnLength?: number;
  selectedPokemon?: Pokemon | null;
  canConfirm: boolean;
  onConfirm: () => void;
}

const getTypeIconSrc = (type: string) => {
  const formattedType = type.charAt(0).toUpperCase() + type.slice(1).toLowerCase();
  return `/TypeIcons/${formattedType}IC_SV.png`;
};

const OneVOneInfoPanel: React.FC<OneVOneInfoPanelProps> = ({
  draft_id,
  isPaused,
  pauseActionPending,
  onTogglePause,
  currentPlayerLabel,
  currentPlayer,
  currentAction,
  isMyTurn,
  turnExpiresAt,
  currentServerTime,
  pausedTimeRemaining,
  canPause,
  timerEnabled,
  onToggleTimer,
  canToggleTimer,
  turnLength = 60,
  selectedPokemon,
  canConfirm,
  onConfirm,
}) => {
  const [secondsRemaining, setSecondsRemaining] = useState(0);
  const [isResetting, setIsResetting] = useState(false);
  const [messageKey, setMessageKey] = useState(0);

  useEffect(() => {
    if (!timerEnabled) {
      setIsResetting(false);
      setSecondsRemaining(0);
      return;
    }
    if (isPaused) {
      setIsResetting(false);
      setSecondsRemaining(pausedTimeRemaining ?? turnLength);
      return;
    }

    setIsResetting(true);
    const resetTimer = setTimeout(() => setIsResetting(false), 500);

    const serverNowMs = new Date(currentServerTime ?? 0).getTime();
    const expiresAtMs = new Date(turnExpiresAt ?? 0).getTime();
    const offset = Date.now() - serverNowMs;

    const updateCountdown = () => {
      const adjustedNow = Date.now() - offset;
      const remainingMs = expiresAtMs - adjustedNow;
      const effectiveMs = Math.max(0, remainingMs);
      const remainingS = effectiveMs < 100 ? 0 : Math.ceil(effectiveMs / 1000);
      setSecondsRemaining(Math.min(remainingS, turnLength));
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 250);
    return () => {
      clearInterval(interval);
      clearTimeout(resetTimer);
    };
  }, [turnExpiresAt, currentServerTime, isPaused, pausedTimeRemaining, turnLength, timerEnabled]);

  useEffect(() => {
    setMessageKey((prev) => prev + 1);
  }, [currentPlayerLabel, currentAction]);

  const progress = turnLength > 0 ? secondsRemaining / turnLength : 0;

  let timerColor = '#00aa00';
  if (isPaused) {
    timerColor = '#66b2ff';
  } else if (secondsRemaining <= 3) {
    timerColor = '#ff0000';
  } else if (secondsRemaining <= 5) {
    timerColor = '#ff8800';
  }

  const nameColorClass = currentPlayer === 'P1' ? 'player-name-p1' : 'player-name-p2';

  return (
    <div className="auction-info-box one-v-one-info-box" style={{ flexShrink: 0 }}>
      <div className="auction-countdown-container">
        <div className="countdown-header-row">
          <div className={`countdown-text${!timerEnabled ? ' timer-off' : ''}`} style={{ color: timerEnabled ? timerColor : '#fff' }}>
            {!timerEnabled ? 'Timer Off' : isPaused ? 'Paused' : `${secondsRemaining}s`}
          </div>
          {timerEnabled && canPause && (
            <button
              type="button"
              className="pause-toggle-button"
              onClick={onTogglePause}
              disabled={pauseActionPending}
              aria-label={isPaused ? 'Unpause draft' : 'Pause draft'}
              title={isPaused ? 'Unpause' : 'Pause'}
            >
              {isPaused ? <TbPlayerPlayFilled /> : <TbPlayerPauseFilled />}
            </button>
          )}
        </div>
        <div className="countdown-bar-background">
          <div
            className="countdown-bar-progress"
            style={{
              width: timerEnabled ? `${progress * 100}%` : '100%',
              backgroundColor: timerEnabled ? timerColor : '#444',
              transition: isResetting ? 'width 0.2s ease-out' : 'width 0.25s ease-in-out',
            }}
          />
        </div>
      </div>

      {canToggleTimer && (
        <button type="button" className="timer-toggle-button" onClick={onToggleTimer}>
          <TbClock /> {timerEnabled ? 'Disable Timer' : 'Enable Timer'}
        </button>
      )}

      <div className={`one-v-one-info-message ${nameColorClass} message-changed`} key={messageKey}>
        {currentPlayerLabel && currentAction ? (
          <>
            {currentPlayerLabel}
            {"'s "}
            {currentAction}
          </>
        ) : isPaused ? (
          'Draft Paused'
        ) : (
          'Waiting for action...'
        )}
      </div>

      {selectedPokemon ? (
        <div className="auction-pokemon-section">
          <div className="pokemon-info-display">
            <img
              src={`/MiniIcons/${selectedPokemon.name.toLowerCase()}.png`}
              alt={selectedPokemon.name}
              className="pokemon-info-icon"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
            <h2 className="pokemon-name">{selectedPokemon.name}</h2>
            <div className="pokemon-info-types">
              {selectedPokemon.type1 && (
                <img src={getTypeIconSrc(selectedPokemon.type1)} alt={selectedPokemon.type1} className="pokemon-info-type-icon" />
              )}
              {selectedPokemon.type2 && (
                <img src={getTypeIconSrc(selectedPokemon.type2)} alt={selectedPokemon.type2} className="pokemon-info-type-icon" />
              )}
            </div>
          </div>
          <button
            type="button"
            className="bid-button one-v-one-confirm-button"
            disabled={!canConfirm || isPaused}
            onClick={onConfirm}
          >
            {currentAction === 'Ban' ? 'Ban' : 'Pick'}
          </button>
        </div>
      ) : isMyTurn ? (
        <div className="one-v-one-info-prompt">
          {currentAction === 'Ban'
            ? 'Choose a Pokémon to remove from the pool'
            : 'Choose a Pokémon to join your team'}
        </div>
      ) : null}
    </div>
  );
};

export default OneVOneInfoPanel;
