import React, { useState } from 'react';
import AllPokemonTab from './AllPokemonTab';
import TeamPlannerTab from './TeamPlannerTab';
import DraftHistoryTab from './DraftHistoryTab';
import { Auction, Pokemon, Team } from '../../../../types';
import './PokemonTablePanel.scss';

const TAB_ALL = 'all';
const TAB_TEAM = 'team';
const TAB_HISTORY = 'history';


interface PokemonTablePanelProps {
  auctions: Auction[];
  pokemon: Pokemon[];
  teams: Team[];
  currentUserId: string | null;
}

const PokemonTablePanel: React.FC<PokemonTablePanelProps> = ({ auctions, pokemon, teams, currentUserId }) => {
  const [tab, setTab] = useState<string>(TAB_ALL);

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
      </div>
      <div className="auction-pokemon-table-box">
        <div className="pokemon-table-tab-content">
          {tab === TAB_ALL && <AllPokemonTab pokemon={pokemon} auctions={auctions} />}
          {tab === TAB_TEAM && <TeamPlannerTab teams={teams} currentUserId={currentUserId} />}
          {tab === TAB_HISTORY && <DraftHistoryTab auctions={auctions} />}
        </div>
      </div>
    </div>
  );
};

export default PokemonTablePanel;
