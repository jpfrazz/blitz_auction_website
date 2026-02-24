import React from 'react';
import { TbArrowRight, TbArrowsSplit } from "react-icons/tb";
import { VscArrowBoth } from "react-icons/vsc";
import { Auction, Pokemon } from '../../../types';
import './CurrentPokemonPanel.scss';

interface CurrentPokemonPanelProps {
  current_auction: Auction;
  all_pokemon: Pokemon[];
}


// Helper to build the evolution tree for a given Pokémon
interface EvoNode {
  pokemon: Pokemon;
  children: EvoNode[];
  methodFromParent?: string;
  isMega?: boolean;
}

function buildEvolutionTree(
  root: Pokemon,
  allPokemon: Pokemon[],
  visited: Set<string> = new Set()
): EvoNode {
  // Unique key for a Pokémon (pokedex_id + form)
  const key = `${root.pokedex_id ?? root.id}-${root.form ?? ''}`;
  if (visited.has(key)) return { pokemon: root, children: [] };
  visited.add(key);

  // Find all Pokémon that evolve from this one (children)
  const children = allPokemon
    .filter(
      (p) =>
        p.evolves_from_id?.toString() === (root.pokedex_id ?? root.id).toString() &&
        (p.evolves_from_form ?? '') === (root.form ?? '')
    )
    .map((child) => {
      const isMega = child.form === 'Mega';
      return {
        ...buildEvolutionTree(child, allPokemon, visited),
        methodFromParent: child.evolution_method,
        isMega,
      };
    });

  return { pokemon: root, children };
}


// Render the evolution tree recursively (horizontal)
const EvolutionTree: React.FC<{ node: EvoNode }> = ({ node }) => {
  // Use evolutions folder for all images
  const getImageSrc = (pokemon: Pokemon) => {
      if (pokemon.evolves_from_id && (pokemon.form !== 'Mega' && pokemon.form !== 'Mega X')) {
        return `/evolutions/${pokemon.name}.png`;
      } else if (pokemon.form === 'Mega' || (pokemon.form === 'Mega X' && !pokemon.name.includes('Charizard'))) {
        let baseName = pokemon.name.startsWith('Mega ')
          ? pokemon.name.slice(5)
          : pokemon.name;
        return `/evolutions/${baseName}-Mega.png`;
      } else if (pokemon.name.includes('Charizard') && pokemon.form === 'Mega X'){ 
          pokemon.name = 'Mega Charizard X';
          return `/evolutions/Charizard X-Mega.png`;
      } else {
        return `/baseforms/${pokemon.name}.png`;
      }
  };
  return (
    <div className="evo-tree-node-horizontal">
      <div className="evo-pokemon-block-horizontal">
        <img
          src={getImageSrc(node.pokemon)}
          alt={node.pokemon.name}
          className="evo-pokemon-img"
        />
        <div className="evo-pokemon-name">{node.pokemon.name}</div>
        <div className="pokemon-type-ability">
          {node.pokemon.type1 && (
            <span className={`type-badge type-badge-${node.pokemon.type1.toLowerCase()}`}>
              {node.pokemon.type1.toUpperCase()}
            </span>
          )}
          {node.pokemon.type2 && (
            <span className={`type-badge type-badge-${node.pokemon.type2.toLowerCase()}`}>
              {node.pokemon.type2.toUpperCase()}
            </span>
          )}
        </div>
      </div>
      {node.children.length > 0 && (
        <div className="evo-children-block-horizontal">
          {node.children.map((child, idx) => (
            <React.Fragment key={child.pokemon.id + '-' + (child.pokemon.form ?? '')}>
              <div className="evo-arrow-block-horizontal">
                <div className="evo-arrow-container-horizontal">
                  {/* Use react-icons for arrows */}
                  {node.children.length > 1 ? (
                    <TbArrowsSplit size={32} color="#888" />
                  ) : child.isMega ? (
                    <VscArrowBoth size={32} color="#888" />
                  ) : (
                    <TbArrowRight size={32} color="#888" />
                  )}
                  <div className="evo-method-label-horizontal">{child.methodFromParent}</div>
                </div>
                <EvolutionTree node={child} />
              </div>
            </React.Fragment>
          ))}
        </div>
      )}
    </div>
  );
};

const CurrentPokemonPanel: React.FC<CurrentPokemonPanelProps> = ({ current_auction, all_pokemon }) => {
  const pokemonData: Pokemon = current_auction.pokemon;
  const [showTipModal, setShowTipModal] = React.useState(false);
  // Build the evolution tree for the current Pokémon
  const evoTree = buildEvolutionTree(pokemonData, all_pokemon);
  const getStatColorClass = (value: number) => {
    if (value < 30) return 'stat-bar-red';
    if (value <= 49) return 'stat-bar-orange';
    if (value <= 69) return 'stat-bar-yellow';
    if (value <= 99) return 'stat-bar-light-green';
    if (value <= 149) return 'stat-bar-dark-green';
    return 'stat-bar-light-blue';
  };

  const getStatWidth = (value: number) => {
    const max = 150;
    return `${Math.min(100, (value / max) * 100)}%`;
  };

  const keyMoves = pokemonData.key_moves ?? [];

  const normalizeLearnMethod = (method?: string) => {
    if (!method) return '';
    return method.toLowerCase().replace(/\s+/g, '_');
  };

  const getLearnMethodRank = (method?: string) => {
    const normalizedMethod = normalizeLearnMethod(method);

    if (/^\d+$/.test(normalizedMethod)) return 0;
    if (normalizedMethod === 'move_reminder') return 1;
    if (normalizedMethod === 'move_tutor') return 2;
    if (normalizedMethod === 'egg') return 4;
    return 3;
  };

  const sortedKeyMoves = [...keyMoves].sort((a, b) => {
    const rankDiff = getLearnMethodRank(a.learn_method) - getLearnMethodRank(b.learn_method);
    if (rankDiff !== 0) return rankDiff;

    const methodA = normalizeLearnMethod(a.learn_method);
    const methodB = normalizeLearnMethod(b.learn_method);

    if (/^\d+$/.test(methodA) && /^\d+$/.test(methodB)) {
      return Number(methodA) - Number(methodB);
    }

    return a.move_name.localeCompare(b.move_name);
  });

  const formatLearnMethod = (method?: string) => {
    if (!method) return '';
    // Split on slash, trim, replace underscores, and join with comma
    return method
      .split('/')
      .map((m) => m.replace(/_/g, ' ').trim())
      .join('/');
  };

  return (
    <div className="auction-current-pokemon-box">
      <div className="pokemon-left-column">
        <div className="pokemon-header">
          <div className="pokemon-left" style={{ display: 'flex', alignItems: 'center' }}>
            <h2 className="pokemon-name" style={{ marginRight: 8 }}>{pokemonData.name}</h2>
            {pokemonData.description && (
              <button
                className="pokemon-tip-btn"
                title="Show tip"
                onClick={() => setShowTipModal(true)}
                style={{ marginLeft: 4 }}
              >
                <span role="img" aria-label="tip">★</span>
              </button>
            )}
          </div>
        </div>

        <div className="pokemon-type-ability">
          {pokemonData.ability && (
            <span className="ability-text">{pokemonData.ability}</span>
          )}
        </div>

        <div className="pokemon-stats">
          {pokemonData.stats && (
            <>
            <div className="stat-row">
              <span className="stat-label">HP</span>
              <span className="stat-value">{pokemonData.stats.hp}</span>
              <div
                className="stat-bar"
                style={{ width: getStatWidth(pokemonData.stats.hp) }}
              >
                <div 
                  className={`stat-bar-fill ${getStatColorClass(pokemonData.stats.hp)}`}
                  style={{ width: '100%' }}
                />
              </div>
            </div>
            <div className="stat-row">
              <span className="stat-label">Atk</span>
              <span className="stat-value">{pokemonData.stats.attack}</span>
              <div
                className="stat-bar"
                style={{ width: getStatWidth(pokemonData.stats.attack) }}
              >
                <div 
                  className={`stat-bar-fill ${getStatColorClass(pokemonData.stats.attack)}`}
                  style={{ width: '100%' }}
                />
              </div>
            </div>
            <div className="stat-row">
              <span className="stat-label">Def</span>
              <span className="stat-value">{pokemonData.stats.defense}</span>
              <div
                className="stat-bar"
                style={{ width: getStatWidth(pokemonData.stats.defense) }}
              >
                <div 
                  className={`stat-bar-fill ${getStatColorClass(pokemonData.stats.defense)}`}
                  style={{ width: '100%' }}
                />
              </div>
            </div>
            <div className="stat-row">
              <span className="stat-label">SpA</span>
              <span className="stat-value">
                {pokemonData.stats.sp_attack ?? pokemonData.stats.specialAttack}
              </span>
              <div
                className="stat-bar"
                style={{
                  width: getStatWidth(
                    pokemonData.stats.sp_attack ?? pokemonData.stats.specialAttack
                  ),
                }}
              >
                <div 
                  className={`stat-bar-fill ${getStatColorClass(
                    pokemonData.stats.sp_attack ?? pokemonData.stats.specialAttack
                  )}`}
                  style={{ width: '100%' }}
                />
              </div>
            </div>
            <div className="stat-row">
              <span className="stat-label">SpD</span>
              <span className="stat-value">
                {pokemonData.stats.sp_defense ?? pokemonData.stats.specialDefense}
              </span>
              <div
                className="stat-bar"
                style={{
                  width: getStatWidth(
                    pokemonData.stats.sp_defense ?? pokemonData.stats.specialDefense
                  ),
                }}
              >
                <div 
                  className={`stat-bar-fill ${getStatColorClass(
                    pokemonData.stats.sp_defense ?? pokemonData.stats.specialDefense
                  )}`}
                  style={{ width: '100%' }}
                />
              </div>
            </div>
            <div className="stat-row">
              <span className="stat-label">Spe</span>
              <span className="stat-value">{pokemonData.stats.speed}</span>
              <div
                className="stat-bar"
                style={{ width: getStatWidth(pokemonData.stats.speed) }}
              >
                <div 
                  className={`stat-bar-fill ${getStatColorClass(pokemonData.stats.speed)}`}
                  style={{ width: '100%' }}
                />
              </div>
            </div>
            </>
          )}
        </div>

        {keyMoves.length > 0 && (
          <div className="pokemon-key-moves">
            <div className="key-moves-title">Key Moves</div>
            <div className="key-moves-list">
              {sortedKeyMoves.map((move, index) => (
                <div
                  className="key-move-row"
                  key={`${move.move_name}-${index}`}
                >
                  {move.species ? (
                    <>
                      <img
                        src={`/MiniIcons/${move.species.toLowerCase()}.png`}
                        alt={move.species}
                        className="key-move-species-img"
                        style={{ width: 24, height: 24, marginRight: 6, verticalAlign: 'middle' }}
                      />
                      {move.move_name} ({formatLearnMethod(move.learn_method)})
                    </>
                  ) : (
                    <>{move.move_name} ({formatLearnMethod(move.learn_method)})</>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="pokemon-right-column">
        <div className="pokemon-evolution-tree-section">
          <EvolutionTree node={evoTree} />
        </div>
      </div>

      {/* Tip Modal */}
      {showTipModal && pokemonData.description && (
        <div className="pokemon-tip-modal-overlay" onClick={() => setShowTipModal(false)}>
          <div className="pokemon-tip-modal" onClick={e => e.stopPropagation()}>
            <div className="pokemon-tip-modal-header">
              <button className="pokemon-tip-modal-close" onClick={() => setShowTipModal(false)}>&times;</button>
            </div>
            <div className="pokemon-tip-modal-content">
              {(() => {
                const lines = pokemonData.description.split(/\\n|\n/);
                return (
                  <>
                    {lines[0] && <h1 style={{marginTop: 0}}>{lines[0]}</h1>}
                    {lines.slice(1).map((line, idx) => (
                      <React.Fragment key={idx}>
                        {line}
                        {idx < lines.length - 2 && <br />}
                      </React.Fragment>
                    ))}
                  </>
                );
              })()}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CurrentPokemonPanel;
