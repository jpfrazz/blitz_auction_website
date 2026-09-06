import React, { useState, useCallback, useRef } from 'react';
import { buildNotebookWithdrawSequence, BUTTON_MAP } from './notebookPokemonList';
import HoverTip from '../../shared/components/HoverTip';
import './NotebookWithdrawButton.scss';

interface NotebookWithdrawButtonProps {
  pokemon: { name: string; pokedex_id?: number; form?: string | null }[];
  onWithdrawingChange?: (withdrawing: boolean) => void;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const NotebookWithdrawButton: React.FC<NotebookWithdrawButtonProps> = ({
  pokemon,
  onWithdrawingChange,
}) => {
  const [isRunning, setIsRunning] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [tipHover, setTipHover] = useState(false);

  const handleWithdraw = useCallback(async () => {
    if (isRunning) return;

    const emu = window.EJS_emulator?.gameManager;
    if (!emu?.simulateInput) {
      setStatus('Emulator not ready');
      setTimeout(() => setStatus(null), 3000);
      return;
    }

    if (pokemon.length === 0) {
      setStatus('No Pokémon to withdraw');
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
    onWithdrawingChange?.(true);

    try {
      if (emulator) {
        emulator.keyChange = () => {};
      }

      for (const input of inputs) {
        if (input.button === 'WAIT') {
          await sleep(input.delayMs ?? 100);
          continue;
        }
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
      onWithdrawingChange?.(false);
    }

    setTimeout(() => {
      setIsRunning(false);
      setStatus(null);
    }, 2000);
  }, [isRunning, pokemon, onWithdrawingChange]);

  return (
    <div
      className="notebook-withdraw-container"
      ref={containerRef}
      onMouseEnter={() => setTipHover(true)}
      onMouseLeave={() => setTipHover(false)}
    >
      {status && (
        <div className="notebook-withdraw-notification">{status}</div>
      )}
      <HoverTip
        text="To quickly withdraw your team, press A on the notebook in your room and leave the cursor on Amaura (the first Pokémon listed). Then, press this button!"
        color="#6366f1"
        anchorRef={containerRef}
        hover={tipHover}
      />
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
