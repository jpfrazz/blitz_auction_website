import React, { useMemo } from 'react';
import { BoosterHistoryEntry, BoosterPackState, Pokemon } from '../../../types';
import { boosterColorShade, boosterColorWithAlpha, boosterPlayerColor } from '../playerColors';
import '../../Draft1v1/components/OneVOnePool.scss';
import './BoosterPackGrid.scss';
import './BoosterMyTeamTab.scss';

interface BoosterMyTeamTabProps {
  history: BoosterHistoryEntry[];
  packs: BoosterPackState[];
  playerIds: string[];
  currentUserId: string | null;
  teamSize: number;
}

function pokemonKey(pokemon: Pokemon): string {
  return `${pokemon.pokedex_id}-${pokemon.form ?? ''}`;
}

function displayName(pokemon: Pokemon): string {
  return pokemon.form ? `${pokemon.name} (${pokemon.form})` : pokemon.name;
}

function imageName(pokemon: Pokemon): string {
  return pokemon.name.replace(/\s*\(.*\)\s*/, '');
}

const BoosterMyTeamTab: React.FC<BoosterMyTeamTabProps> = ({
  history,
  packs,
  playerIds,
  currentUserId,
  teamSize,
}) => {
  // The backend reveals a viewer's own hidden pick in their held pack as soon
  // as it is submitted, while the public history only updates when the whole
  // pass resolves. Show both so the pick appears immediately without ever
  // duplicating it after the reveal.
  const picks = useMemo(() => {
    const revealed = history.filter(
      (entry) => entry.action === 'Pick' && entry.player_id === currentUserId,
    );
    const revealedKeys = new Set(revealed.map((entry) => pokemonKey(entry.pokemon)));
    const pending = currentUserId
      ? packs.flatMap((pack) =>
          pack.slots
            .filter((slot) => {
              const status = slot.status;
              return (
                typeof status === 'object' &&
                'Picked' in status &&
                status.Picked === currentUserId &&
                !revealedKeys.has(pokemonKey(slot.pokemon))
              );
            })
            .map((slot) => ({
              round: -1,
              pack_index: pack.pack_index,
              pokemon: slot.pokemon,
            })),
        )
      : [];
    return [...revealed, ...pending];
  }, [history, packs, currentUserId]);

  const color = boosterPlayerColor(playerIds.indexOf(currentUserId ?? ''));
  const panelStyle = {
    '--booster-my-team-color': color,
    '--booster-my-team-overlay': boosterColorWithAlpha(color, 0.18),
  } as React.CSSProperties;
  const tileStyle = {
    '--booster-picked-bg': boosterColorShade(color, 0.58),
    '--booster-picked-border': boosterColorShade(color, -0.3),
    '--booster-picked-overlay': boosterColorWithAlpha(color, 0.18),
  } as React.CSSProperties;

  return (
    <div className="booster-my-team-tab" style={panelStyle}>
      <span className="booster-my-team-count">{picks.length}/{teamSize}</span>
      {picks.length === 0 ? (
        <div className="booster-my-team-empty">
          {currentUserId ? 'No Pokémon drafted yet.' : 'Join the draft to see your team.'}
        </div>
      ) : (
        <div className="booster-my-team-grid">
          {picks.map((entry, index) => (
            <div className="one-v-one-pool-cell booster-my-team-cell" key={pokemonKey(entry.pokemon)}>
              <div
                className="one-v-one-pool-square booster-tile booster-picked"
                style={tileStyle}
                title={`Pick ${index + 1}: ${displayName(entry.pokemon)}`}
              >
                <img
                  src={`/baseforms/${imageName(entry.pokemon)}.png`}
                  alt={displayName(entry.pokemon)}
                  onError={(event) => {
                    const image = event.currentTarget;
                    image.onerror = null;
                    image.src = `/MiniIcons/${entry.pokemon.name.toLowerCase()}.png`;
                  }}
                />
              </div>
              <span className="one-v-one-pool-badge booster-my-team-order">{index + 1}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default BoosterMyTeamTab;
