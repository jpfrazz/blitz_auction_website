import React, { useEffect, useMemo, useState } from 'react';
import { AdminHallOfFameEligibleEntry, HallOfFamePokemon, Pokemon } from '../../types';
import { fetchPokemonList } from '../../shared/api/pokemon';
import { getIconName } from '../../utils/speciesUtils';

interface HallOfFameTeamEditorModalProps {
  entry: AdminHallOfFameEligibleEntry;
  saving: boolean;
  onSave: (team: HallOfFamePokemon[]) => Promise<void>;
  onClose: () => void;
}

const MAX_SLOTS = 6;

function formatBeatTime(hours: number, minutes: number, seconds: number): string {
  return `${hours}h ${minutes}m ${seconds}s`;
}

const HallOfFameTeamEditorModal: React.FC<HallOfFameTeamEditorModalProps> = ({
  entry,
  saving,
  onSave,
  onClose,
}) => {
  const [pokemonList, setPokemonList] = useState<Pokemon[]>([]);
  const [texts, setTexts] = useState<string[]>(() => {
    const initial = new Array<string>(MAX_SLOTS).fill('');
    entry.hall_of_fame_team.forEach((mon, i) => {
      if (i < MAX_SLOTS) initial[i] = mon.name;
    });
    return initial;
  });
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    fetchPokemonList()
      .then(setPokemonList)
      .catch(() => setPokemonList([]));
  }, []);

  const pokemonByName = useMemo(() => {
    const map = new Map<string, Pokemon>();
    pokemonList.forEach((p) => {
      const key = p.name.toLowerCase();
      if (!map.has(key)) map.set(key, p);
    });
    return map;
  }, [pokemonList]);

  const handleTextChange = (idx: number, value: string) => {
    setTexts((prev) => {
      const next = [...prev];
      next[idx] = value;
      return next;
    });
  };

  const iconFor = (idx: number): string | null => {
    const text = texts[idx].trim().toLowerCase();
    if (!text) return null;
    const pokemon = pokemonByName.get(text);
    return getIconName(pokemon?.name ?? text, pokemon?.pokedex_id ?? pokemon?.id);
  };

  const buildTeam = (): HallOfFamePokemon[] => {
    const team: HallOfFamePokemon[] = [];
    for (let i = 0; i < MAX_SLOTS; i++) {
      const text = texts[i].trim();
      if (!text) continue;
      const pokemon = pokemonByName.get(text.toLowerCase());
      const name = pokemon?.name ?? text;
      team.push({ name, icon: getIconName(name, pokemon?.pokedex_id ?? pokemon?.id) });
    }
    return team;
  };

  const handleSubmit = async () => {
    setLocalError(null);
    const team = buildTeam();
    if (team.length === 0) {
      setLocalError('Enter at least one Pokemon.');
      return;
    }
    try {
      await onSave(team);
    } catch (e: any) {
      setLocalError(e?.response?.data ?? e?.message ?? 'Failed to save Hall of Fame team.');
    }
  };

  const handleClear = async () => {
    setLocalError(null);
    try {
      await onSave([]);
    } catch (e: any) {
      setLocalError(e?.response?.data ?? e?.message ?? 'Failed to clear Hall of Fame team.');
    }
  };

  return (
    <div className="race-results-modal-overlay" onClick={onClose}>
      <div
        className="race-results-modal hof-team-editor-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="race-results-modal-title">Hall of Fame Team</h3>
        <p className="race-results-modal-subtitle">
          {entry.user_name ?? 'Guest User'} — {entry.draft_name}
          <br />
          Beat {entry.beat_name} at {formatBeatTime(entry.hours, entry.minutes, entry.seconds)}.
          Enter up to 6 Pokemon the player had in their party.
        </p>

        {localError && <div className="race-results-message race-results-error">{localError}</div>}

        <div className="hof-team-editor-grid">
          {Array.from({ length: MAX_SLOTS }, (_, i) => {
            const icon = iconFor(i);
            return (
              <div className="hof-team-editor-slot" key={i}>
                <div className="hof-team-editor-icon">
                  {icon ? (
                    <img
                      src={`/MiniIcons/${icon}.png`}
                      alt=""
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).src = '/MiniIcons/question.png';
                      }}
                    />
                  ) : (
                    <span className="hof-team-editor-slot-num">{i + 1}</span>
                  )}
                </div>
                <input
                  list={`hof-pokemon-list-${entry.team_id}`}
                  type="text"
                  placeholder={`Pokemon ${i + 1}`}
                  value={texts[i]}
                  onChange={(e) => handleTextChange(i, e.target.value)}
                  disabled={saving}
                />
              </div>
            );
          })}
        </div>
        <datalist id={`hof-pokemon-list-${entry.team_id}`}>
          {pokemonList.map((p) => (
            <option key={`${p.id}-${p.name}`} value={p.name} />
          ))}
        </datalist>

        <div className="race-results-modal-footer">
          {entry.hall_of_fame_team.length > 0 && (
            <button type="button" className="button danger" onClick={handleClear} disabled={saving}>
              Clear Team
            </button>
          )}
          <button type="button" className="button secondary" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="button" className="button" onClick={handleSubmit} disabled={saving}>
            {saving ? 'Saving...' : 'Save Team'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default HallOfFameTeamEditorModal;
