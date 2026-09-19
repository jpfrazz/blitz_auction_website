import React, { useRef, useState } from 'react';
import { parseSaveFile } from '../../utils/parseSaveFile';
import { BossBattleSubmissionBattle } from '../api/stats';
import './BossBattleEditor.scss';

export const BOSS_BASE_TRAINERS: { id: number; name: string }[] = [
  { id: 265, name: 'Roxanne' },
  { id: 855, name: 'Viola' },
  { id: 266, name: 'Brawly' },
  { id: 267, name: 'Wattson' },
  { id: 268, name: 'Flannery' },
  { id: 269, name: 'Norman' },
  { id: 270, name: 'Winona' },
  { id: 271, name: 'Tate & Liza' },
  { id: 272, name: 'Juan & Wallace' },
  { id: 601, name: 'Maxie' },
  { id: 34, name: 'Archie' },
  { id: 261, name: 'Sidney' },
  { id: 262, name: 'Phoebe' },
  { id: 263, name: 'Glacia' },
  { id: 264, name: 'Drake' },
  { id: 806, name: 'Tucker' },
  { id: 807, name: 'Spenser' },
  { id: 810, name: 'Lucy' },
  { id: 811, name: 'Brandon' },
  { id: 804, name: 'Steven' },
  { id: 656, name: 'Wally' },
];

const GYM_LEADER_IDS = new Set([265, 855, 266, 267, 268, 269, 270, 271, 272, 601, 34]);

const EMPTY_BATTLE: BossBattleSubmissionBattle = {
  trainer_id: 265,
  version: null,
  hours: 0,
  minutes: 0,
  seconds: 0,
  is_loss: false,
};

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.max(min, Math.min(max, value));
}

interface BossBattleEditorProps {
  battles: BossBattleSubmissionBattle[];
  onChange: (battles: BossBattleSubmissionBattle[]) => void;
  disabled?: boolean;
}

const BossBattleEditor: React.FC<BossBattleEditorProps> = ({ battles, onChange, disabled = false }) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const updateBattle = (index: number, patch: Partial<BossBattleSubmissionBattle>) => {
    onChange(battles.map((battle, i) => (i === index ? { ...battle, ...patch } : battle)));
  };

  const addBattle = () => {
    onChange([...battles, { ...EMPTY_BATTLE }]);
  };

  const removeBattle = (index: number) => {
    onChange(battles.filter((_, i) => i !== index));
  };

  const handleSaveFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const bytes = new Uint8Array(reader.result as ArrayBuffer);
        const parsed = parseSaveFile(bytes, {}, new Map());
        const wins: BossBattleSubmissionBattle[] = (parsed.trainer_card_wins ?? []).map((win) => ({
          trainer_id: win.trainer_id,
          version: win.version ?? null,
          hours: win.hours,
          minutes: win.minutes,
          seconds: win.seconds,
          is_loss: win.is_loss,
        }));
        if (wins.length === 0) {
          setImportError('No boss battles found on this trainer card.');
        } else {
          setImportError(null);
          onChange(wins);
        }
      } catch (e) {
        console.error('[BossBattleEditor] Failed to parse save file:', e);
        setImportError('Failed to parse this save file.');
      } finally {
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    };
    reader.readAsArrayBuffer(file);
  };

  return (
    <div className="boss-battle-editor">
      <div className="boss-battle-editor-toolbar">
        <button
          type="button"
          className="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled || battles.length > 0}
          title={battles.length > 0 ? 'Clear the list before importing another save' : 'Import battles from a .sav file'}
        >
          Auto-fill from .sav
        </button>
        <input ref={fileInputRef} type="file" accept=".sav" style={{ display: 'none' }} onChange={handleSaveFile} />
        <button type="button" className="button" onClick={addBattle} disabled={disabled}>
          + Add Battle
        </button>
      </div>
      {importError && !battles.length && <div className="boss-battle-editor-error">{importError}</div>}
      {battles.length === 0 ? (
        <div className="boss-battle-editor-empty">
          {importError || 'Enter boss battles manually, or auto-fill from a .sav file.'}
        </div>
      ) : (
        battles.map((battle, index) => {
          const known = BOSS_BASE_TRAINERS.find((trainer) => trainer.id === battle.trainer_id);
          const isGymLeader = GYM_LEADER_IDS.has(battle.trainer_id);
          return (
            <div className="boss-battle-editor-row" key={index}>
              <select
                value={known ? battle.trainer_id : ''}
                disabled={disabled}
                onChange={(e) => {
                  const id = Number(e.target.value);
                  updateBattle(index, { trainer_id: id, version: null });
                }}
              >
                <option value="">Custom...</option>
                {BOSS_BASE_TRAINERS.map((trainer) => (
                  <option key={trainer.id} value={trainer.id}>
                    {trainer.name}
                  </option>
                ))}
              </select>
              <input
                type="number"
                className="boss-battle-trainer-id"
                value={battle.trainer_id}
                min={0}
                disabled={disabled}
                title="Trainer ID"
                onChange={(e) => updateBattle(index, { trainer_id: clamp(Number(e.target.value), 0, 9999) })}
              />
              {isGymLeader && (
                <input
                  type="number"
                  className="boss-battle-version"
                  value={battle.version ?? 1}
                  min={1}
                  max={8}
                  disabled={disabled}
                  title="Gym leader version (1-8)"
                  onChange={(e) => updateBattle(index, { version: clamp(Number(e.target.value), 1, 8) })}
                />
              )}
              <div className="boss-battle-time">
                <input
                  type="number"
                  value={battle.hours}
                  min={0}
                  disabled={disabled}
                  onChange={(e) => updateBattle(index, { hours: clamp(Number(e.target.value), 0, 999) })}
                />
                <span className="boss-battle-time-unit">h</span>
                <input
                  type="number"
                  value={battle.minutes}
                  min={0}
                  max={59}
                  disabled={disabled}
                  onChange={(e) => updateBattle(index, { minutes: clamp(Number(e.target.value), 0, 59) })}
                />
                <span className="boss-battle-time-unit">m</span>
                <input
                  type="number"
                  value={battle.seconds}
                  min={0}
                  max={59}
                  disabled={disabled}
                  onChange={(e) => updateBattle(index, { seconds: clamp(Number(e.target.value), 0, 59) })}
                />
                <span className="boss-battle-time-unit">s</span>
              </div>
              <div className="boss-battle-result-toggle">
                <button
                  type="button"
                  className={`boss-battle-result-btn win ${!battle.is_loss ? 'active' : ''}`}
                  disabled={disabled}
                  onClick={() => updateBattle(index, { is_loss: false })}
                >
                  Win
                </button>
                <button
                  type="button"
                  className={`boss-battle-result-btn loss ${battle.is_loss ? 'active' : ''}`}
                  disabled={disabled}
                  onClick={() => updateBattle(index, { is_loss: true })}
                >
                  Loss
                </button>
              </div>
              <button
                type="button"
                className="boss-battle-remove"
                onClick={() => removeBattle(index)}
                disabled={disabled}
                title="Remove battle"
              >
                &times;
              </button>
            </div>
          );
        })
      )}
    </div>
  );
};

export default BossBattleEditor;