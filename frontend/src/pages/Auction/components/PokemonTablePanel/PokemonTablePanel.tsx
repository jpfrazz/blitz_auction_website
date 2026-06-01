import React, { useMemo, useState, useCallback } from 'react';
import AllPokemonTab from './AllPokemonTab';
import TeamPlannerTab from './TeamPlannerTab';
import DraftHistoryTab from './DraftHistoryTab';
import { Auction, Pokemon, Team } from '../../../../types';
import './PokemonTablePanel.scss';
import TierListTab from './TierListTab';
import PlayerSearchTab from './PlayerSearchTab';

const TAB_ALL = 'all';
const TAB_TEAM = 'team';
const TAB_HISTORY = 'history';
const TIER_LIST = 'tierlist';
const PLAYER_SEARCH = 'player-search';


interface PokemonTablePanelProps {
  auctions: Auction[];
  pokemon: Pokemon[];
  teams: Team[];
  currentUserId: string | null;
  onToggleEgg?: (id: number | null) => void;
  allPokemon: Pokemon[];
}

const PokemonTablePanel: React.FC<PokemonTablePanelProps> = ({ auctions, pokemon, teams, currentUserId, onToggleEgg, allPokemon }) => {
  const [tab, setTab] = useState<string>(TAB_ALL);

  const [minimizedPokemon, setMinimizedPokemon] = useState<Set<string>>(new Set());

  const handleToggleMinimize = useCallback((pokemonName: string) => {
    setMinimizedPokemon(prev => {
      const next = new Set(prev);
      if (next.has(pokemonName)) next.delete(pokemonName);
      else next.add(pokemonName);
      return next;
    });
  }, []);

  const nonRentalPokemon = useMemo(() => pokemon.filter(p => p.obtain_method !== 'Rental'), [pokemon]);

  return (
    <div className="pokemon-table-panel-outer">
      <div className="pokemon-table-tabs">
        <button
          className={tab === TAB_ALL ? 'active' : ''}
          onClick={() => setTab(TAB_ALL)}
        >
          All Pokémon
        </button>
        <button
          className={tab === TAB_TEAM ? 'active' : ''}
          onClick={() => setTab(TAB_TEAM)}
        >
          Team Planner
        </button>
        <button
          className={tab === TAB_HISTORY ? 'active' : ''}
          onClick={() => setTab(TAB_HISTORY)}
        >
          Draft History
        </button>
        <button
          className={tab === TIER_LIST ? 'active' : ''}
          onClick={() => setTab(TIER_LIST)}
        >
          Stats
        </button>
        <button
          className={tab === PLAYER_SEARCH ? 'active' : ''}
          onClick={() => setTab(PLAYER_SEARCH)}
        >
          Player Search
        </button>
      </div>
      <div className="auction-pokemon-table-box">
        <div className="pokemon-table-tab-content">
          {tab === TAB_ALL && <AllPokemonTab pokemon={nonRentalPokemon} auctions={auctions} allPokemon={allPokemon} />}
          {tab === TAB_TEAM && (
            <TeamPlannerTab 
              teams={teams} 
              currentUserId={currentUserId} 
              allPokemon={allPokemon} 
              minimizedPokemon={minimizedPokemon}
              onToggleMinimize={handleToggleMinimize}
              onToggleEgg={onToggleEgg}
            />
          )}
          {tab === TAB_HISTORY && <DraftHistoryTab auctions={auctions} />}
          {tab === TIER_LIST && <TierListTab />}
          {tab === PLAYER_SEARCH && <PlayerSearchTab />}
        </div>
      </div>
    </div>
  );
};

export default PokemonTablePanel;
