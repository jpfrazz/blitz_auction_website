import React, { useState, useCallback } from 'react';
import { Team } from '../../types';
import { buildNotebookWithdrawSequence, BUTTON_MAP } from './notebookPokemonList';
import './NotebookWithdrawButton.scss';

interface NotebookWithdrawButtonProps {
  teams: Team[];
  currentUserId: string | null;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const NotebookWithdrawButton: React.FC<NotebookWithdrawButtonProps> = ({
  teams,
  currentUserId,
}) => {
  const [isRunning, setIsRunning] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const handleWithdraw = useCallback(async () => {
    if (isRunning) return;

    const emu = window.EJS_emulator?.gameManager;
    if (!emu?.simulateInput) {
      setStatus('Emulator not ready');
      setTimeout(() => setStatus(null), 3000);
      return;
    }

    const myTeam = teams.find(t => t.user_id === currentUserId);
    const pokemon = myTeam?.auctions_won ?? myTeam?.pokemon ?? [];

    if (pokemon.length === 0) {
      setStatus('No Pokémon drafted');
      setTimeout(() => setStatus(null), 3000);
      return;
    }

    const inputs = buildNotebookWithdrawSequence(pokemon);
    if (inputs.length === 0) {
      setStatus('No matching Pokémon in notebook');
      setTimeout(() => setStatus(null), 3000);
      return;
    }

    const emulator = window.EJS_emulator as any;
    const originalKeyChange = emulator?.keyChange;

    setIsRunning(true);
    setStatus('Withdrawing...');

    try {
      if (emulator) {
        emulator.keyChange = () => {};
      }

      for (const input of inputs) {
        const btnIndex = BUTTON_MAP[input.button];
        if (btnIndex === undefined) continue;

        emu.simulateInput(0, btnIndex, 1);
        await sleep(50);
        emu.simulateInput(0, btnIndex, 0);
        await sleep(50);
      }
      setStatus('Done!');
    } catch (err) {
      console.error('Notebook withdraw failed:', err);
      setStatus('Error during withdraw');
    } finally {
      if (emulator && originalKeyChange) {
        emulator.keyChange = originalKeyChange;
      }
    }

    setTimeout(() => {
      setIsRunning(false);
      setStatus(null);
    }, 2000);
  }, [isRunning, teams, currentUserId]);

  return (
    <div className="notebook-withdraw-container">
      {status && (
        <div className="notebook-withdraw-notification">{status}</div>
      )}
      <button
        className="notebook-withdraw-button"
        onClick={handleWithdraw}
        disabled={isRunning}
        title="Press this button while interacting with your notebook to withdraw all drafted Pokémon"
      >
        {isRunning ? 'Withdrawing...' : 'Auto Notebook Withdraw'}
      </button>
    </div>
  );
};

export default NotebookWithdrawButton;
