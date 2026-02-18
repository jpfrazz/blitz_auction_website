import React from 'react';
import { Auction, Pokemon } from '../../../types';
import './CurrentPokemonPanel.scss';

interface CurrentPokemonPanelProps {
  current_auction: Auction;
}

const CurrentPokemonPanel: React.FC<CurrentPokemonPanelProps> = ({ current_auction }) => {
  const pokemonData: Pokemon = current_auction.pokemon;

  const typeClass1 = pokemonData.type1 
    ? `type-badge-${pokemonData.type1.toLowerCase()}` 
    : '';
  const typeClass2 = pokemonData.type2 
    ? `type-badge-${pokemonData.type2.toLowerCase()}` 
    : '';
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

  return (
    <div className="auction-current-pokemon-box">
      <div className="pokemon-left-column">
        <div className="pokemon-header">
          <div className="pokemon-left">
            <h2 className="pokemon-name">{pokemonData.name}</h2>
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
      </div>

      <div className="pokemon-right-column">
        <div className="pokemon-image-section">
          <img 
            src={`/baseforms/${pokemonData.name}.png`} 
            alt={pokemonData.name}
            className="pokemon-large-image"
          />
        </div>

        <div className="pokemon-type-ability">
          {pokemonData.type1 && (
            <span className={`type-badge ${typeClass1}`}>
              {pokemonData.type1.toUpperCase()}
            </span>
          )}
          {pokemonData.type2 && (
            <span className={`type-badge ${typeClass2}`}>
              {pokemonData.type2.toUpperCase()}
            </span>
          )}
        </div>
      </div>
    </div>
  );
};

export default CurrentPokemonPanel;
