import React from 'react';
import CurrentPokemonPanel from '../CurrentPokemonPanel';
import { Auction, Pokemon, Team } from '../../../../types';
import './TeamPlannerTab.scss';

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
  const sortedTeamPokemon = [...teamPokemon].sort((a, b) => {
    const nameCompare = a.name.localeCompare(b.name);
    if (nameCompare !== 0) {
      return nameCompare;
    }

    return (a.form ?? '').localeCompare(b.form ?? '');
  });

  if (teamPokemon.length === 0) {
    return <div className="auction-team-planner-placeholder">No Pokémon drafted yet.</div>;
  }

  // Extract evolution items from the full tree
  function extractEvolutionItem(evolutionMethod: string | undefined) {
    if (!evolutionMethod) return null;
    const method = evolutionMethod.trim();
    if (/^(male|female)$/i.test(method)) return null;
    const parenMatch = method.match(/\(([^)]+)\)/);
    if (parenMatch) {
      const item = parenMatch[1].trim();
      if (/^(male|female)$/i.test(item)) return null;
      return item;
    }
    if (method.includes('Stone')) {
      return method;
    }
    const specialItems = [
      'Linking Cord',
      'Whipped Dream',
      'Dragon Scale',
      'Metal Coat',
      'Soothe Bell',
      "King's Rock"
    ];
    if (specialItems.some(item => method === item)) {
      return method;
    }
    return null;
  }

  // Recursively walk the evolution tree
  function collectEvoItemsFromTree(pokemon: Pokemon, allPokemon: Pokemon[], itemCounts: Record<string, number>) {
    const item = extractEvolutionItem(pokemon.evolution_method);
    if (item) {
      itemCounts[item] = (itemCounts[item] || 0) + 1;
    }
    // Find all children
    const children = allPokemon.filter(
      (p) =>
        p.evolves_from_id?.toString() === (pokemon.pokedex_id ?? pokemon.id).toString() &&
        (p.evolves_from_form ?? '') === (pokemon.form ?? '')
    );
    children.forEach(child => collectEvoItemsFromTree(child, allPokemon, itemCounts));
  }

  const evoItemCounts: Record<string, number> = {};
  sortedTeamPokemon.forEach(pokemon => {
    collectEvoItemsFromTree(pokemon, allPokemon, evoItemCounts);
  });

  const sortedItems = Object.entries(evoItemCounts).sort((a, b) => b[1] - a[1]);

  const eggMoves = Array.from(
    new Set(
      sortedTeamPokemon
        .flatMap((pokemon) => pokemon.key_moves ?? [])
        .filter((move) => (move.learn_method ?? '').toLowerCase().includes('egg'))
        .map((move) => move.move_name)
    )
  ).sort((a, b) => a.localeCompare(b));

  const teamPokemonAuctions: Auction[] = sortedTeamPokemon.map((pokemon, index) => ({
    auction_id: `team-planner-${pokemon.name}-${pokemon.form ?? 'base'}-${index}`,
    pokemon,
    status: 'COMPLETED',
    highest_bid: 0,
    highest_bidder: null,
  }));

  return (
    <div className="auction-team-planner-list">
      <h3 className="team-builder-main-title">Your Team Planner</h3>
      <div className="team-builder-header-split">
        <div className="team-builder-header-half">
          <h3>Evolution Items on Your Team</h3>
          {sortedItems.length > 0 ? (
            <ul className="team-builder-header-list">
              {sortedItems.map(([item, count]) => (
                <li key={item}>{count}x {item.charAt(0).toUpperCase() + item.slice(1)}</li>
              ))}
            </ul>
          ) : (
            <div className="team-builder-header-empty">No evolution items found.</div>
          )}
        </div>

        <div className="team-builder-header-divider" />

        <div className="team-builder-header-half">
          <h3>Egg Moves on Your Team</h3>
          {eggMoves.length > 0 ? (
            <ul className="team-builder-header-list">
              {eggMoves.map((move) => (
                <li key={move}>{move}</li>
              ))}
            </ul>
          ) : (
            <div className="team-builder-header-empty">No egg moves found.</div>
          )}
        </div>
      </div>

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
