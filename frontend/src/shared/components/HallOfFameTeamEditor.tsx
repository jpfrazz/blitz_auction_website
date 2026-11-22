import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { fetchPokemonList } from '../api/pokemon';
import { HallOfFamePokemon, Pokemon } from '../../types';
import { getIconName } from '../../utils/speciesUtils';
import './HallOfFameTeamEditor.scss';

export const HALL_OF_FAME_TEAM_SLOTS = 6;

export function hallOfFameTeamToTexts(team?: HallOfFamePokemon[] | null): string[] {
  const texts = new Array<string>(HALL_OF_FAME_TEAM_SLOTS).fill('');
  (team ?? []).slice(0, HALL_OF_FAME_TEAM_SLOTS).forEach((mon, index) => {
    texts[index] = mon.name;
  });
  return texts;
}

function pokemonByName(pokemonList: Pokemon[]): Map<string, Pokemon> {
  const map = new Map<string, Pokemon>();
  pokemonList.forEach((pokemon) => {
    const key = pokemon.name.toLowerCase();
    if (!map.has(key)) map.set(key, pokemon);
  });
  return map;
}

/**
 * Builds the API payload from the six text slots. Matching the original team
 * by slot/name keeps any KO counts that were captured from a real save.
 */
export function buildHallOfFameTeam(
  texts: string[],
  pokemonList: Pokemon[],
  previousTeam: HallOfFamePokemon[] = [],
): HallOfFamePokemon[] {
  const names = pokemonByName(pokemonList);
  const team: HallOfFamePokemon[] = [];
  for (let i = 0; i < HALL_OF_FAME_TEAM_SLOTS; i++) {
    const text = texts[i]?.trim();
    if (!text) continue;
    const pokemon = names.get(text.toLowerCase());
    const name = pokemon?.name ?? text;
    const previous =
      previousTeam.find((mon) => mon.name.toLowerCase() === name.toLowerCase()) ??
      previousTeam[i];
    const mon: HallOfFamePokemon = { name, icon: getIconName(name) };
    if (previous?.ko_count !== undefined && previous.ko_count !== null) {
      mon.ko_count = previous.ko_count;
    }
    team.push(mon);
  }
  return team;
}

interface HallOfFameTeamEditorProps {
  initialTeam?: HallOfFamePokemon[] | null;
  onChange: (team: HallOfFamePokemon[]) => void;
  disabled?: boolean;
}

const HallOfFameTeamEditor: React.FC<HallOfFameTeamEditorProps> = ({
  initialTeam,
  onChange,
  disabled = false,
}) => {
  const [pokemonList, setPokemonList] = useState<Pokemon[]>([]);
  const seedTeam = useRef<HallOfFamePokemon[]>(initialTeam ?? []);
  const [texts, setTexts] = useState<string[]>(() => hallOfFameTeamToTexts(initialTeam));
  const listId = `hof-pokemon-list-${useId().replace(/:/g, '')}`;

  useEffect(() => {
    let active = true;
    fetchPokemonList()
      .then((list) => { if (active) setPokemonList(list); })
      .catch(() => { if (active) setPokemonList([]); });
    return () => { active = false; };
  }, []);

  const names = useMemo(() => pokemonByName(pokemonList), [pokemonList]);

  const handleTextChange = (index: number, value: string) => {
    const next = [...texts];
    next[index] = value;
    setTexts(next);
    onChange(buildHallOfFameTeam(next, pokemonList, seedTeam.current));
  };

  return (
    <div className="hof-team-editor">
      <div className="hof-team-editor-grid">
        {Array.from({ length: HALL_OF_FAME_TEAM_SLOTS }, (_, index) => {
          const text = texts[index].trim().toLowerCase();
          const pokemon = text ? names.get(text) : undefined;
          const icon = text ? getIconName(pokemon?.name ?? text) : null;
          return (
            <div className="hof-team-editor-slot" key={index}>
              <div className="hof-team-editor-icon">
                {icon ? (
                  <img
                    src={`/MiniIcons/${icon}.png`}
                    alt=""
                    onError={(event) => {
                      (event.currentTarget as HTMLImageElement).src = '/MiniIcons/question.png';
                    }}
                  />
                ) : (
                  <span className="hof-team-editor-slot-num">{index + 1}</span>
                )}
              </div>
              <input
                list={listId}
                type="text"
                placeholder={`Pokemon ${index + 1}`}
                value={texts[index]}
                aria-label={`Hall of Fame Pokemon ${index + 1}`}
                disabled={disabled}
                onChange={(event) => handleTextChange(index, event.target.value)}
              />
            </div>
          );
        })}
      </div>
      <datalist id={listId}>
        {pokemonList.map((pokemon) => (
          <option key={`${pokemon.id}-${pokemon.name}`} value={pokemon.name} />
        ))}
      </datalist>
    </div>
  );
};

export default HallOfFameTeamEditor;
