import React from 'react';
import CurrentPokemonPanel from '../CurrentPokemonPanel';
import { Auction, Pokemon, Team } from '../../../../types';

interface TeamPlannerTabProps {
  teams: Team[];
  currentUserId: string | null;
  allPokemon: Pokemon[];
}

const TeamPlannerTab: React.FC<TeamPlannerTabProps> = ({ teams, currentUserId, allPokemon }) => {
  if (!currentUserId) {
    return <div className="auction-team-planner-placeholder">Loading your team...</div>;
  }

  const currentUserTeam = teams.find(team => team.user_id === currentUserId);

  if (!currentUserTeam) {
    return <div className="auction-team-planner-placeholder">You are not on a team in this draft.</div>;
  }

  const teamPokemon = currentUserTeam.auctions_won ?? currentUserTeam.pokemon ?? [];

  if (teamPokemon.length === 0) {
    return <div className="auction-team-planner-placeholder">No Pokémon drafted yet.</div>;
  }

  const teamPokemonAuctions: Auction[] = teamPokemon.map((pokemon, index) => ({
    auction_id: `team-planner-${pokemon.name}-${pokemon.form ?? 'base'}-${index}`,
    pokemon,
    status: 'COMPLETED',
    highest_bid: 0,
    highest_bidder: null,
  }));

  return (
    <div className="auction-team-planner-list">
      {teamPokemonAuctions.map(teamPokemonAuction => (
        <CurrentPokemonPanel
          key={teamPokemonAuction.auction_id}
          current_auction={teamPokemonAuction}
          all_pokemon={allPokemon}
        />
      ))}
    </div>
  );
};

export default TeamPlannerTab;
