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
  teamPokemon.forEach(pokemon => {
    collectEvoItemsFromTree(pokemon, allPokemon, evoItemCounts);
  });

  const sortedItems = Object.entries(evoItemCounts).sort((a, b) => b[1] - a[1]);

  const teamPokemonAuctions: Auction[] = teamPokemon.map((pokemon, index) => ({
    auction_id: `team-planner-${pokemon.name}-${pokemon.form ?? 'base'}-${index}`,
    pokemon,
    status: 'COMPLETED',
    highest_bid: 0,
    highest_bidder: null,
  }));

  return (
    <div className="auction-team-planner-list">
      {/* Evolution item summary section */}
      {sortedItems.length > 0 && (
        <div className="evo-method-summary">
          <h3 style={{ marginBottom: '8px' }}>Evolution Items on Your Team</h3>
          <ul style={{ marginBottom: '16px' }}>
            {sortedItems.map(([item, count]) => (
              <li key={item} style={{ fontSize: '16px', marginBottom: '4px' }}>{count}x {item.charAt(0).toUpperCase() + item.slice(1)}</li>
            ))}
          </ul>
          <hr style={{ margin: '16px 0' }} />
        </div>
      )}
      <h3 style={{ marginBottom: '8px' }}>Your Team Planner</h3>
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
