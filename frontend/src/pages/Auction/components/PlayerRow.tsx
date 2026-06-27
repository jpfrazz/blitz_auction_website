import React from 'react';
import { Reorder, AnimatePresence } from 'framer-motion';
import { Team, Pokemon } from '../../../types';
import './PlayerRow.scss';

interface PlayerRowProps {
  teams: Team[];
  numPlayers: number;
  highestBidderId?: string | null;
  wsConnected?: boolean;
  currentUserId?: string | null;
  highestBid?: number;
}

const PlayerRow: React.FC<PlayerRowProps> = ({ teams, numPlayers, highestBidderId, wsConnected = true, currentUserId, highestBid }) => {
  const [animatingId, setAnimatingId] = React.useState<string | null>(null);
  const isInitial = React.useRef(true);

  // Local state to manage the visual order for dragging
  const [items, setItems] = React.useState<any[]>([]);

  // Settings
  const [twoRowMode, setTwoRowMode] = React.useState(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('eb-two-row-player-height') === 'true';
  });

  const [autoSortByFunds, setAutoSortByFunds] = React.useState(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('eb-auto-sort-by-funds') === 'true';
  });

  // Listen for settings changes
  React.useEffect(() => {
    const handleStorageChange = () => {
      setTwoRowMode(localStorage.getItem('eb-two-row-player-height') === 'true');
      setAutoSortByFunds(localStorage.getItem('eb-auto-sort-by-funds') === 'true');
    };

    window.addEventListener('storage', handleStorageChange);
    window.addEventListener('eb-settings-changed', handleStorageChange);
    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('eb-settings-changed', handleStorageChange);
    };
  }, []);

  // Prepare the list of teams and placeholders
  const sortedTeams = React.useMemo(() => {
    const baseTeams = [...teams];
    
    // Auto-sort by funds if enabled
    if (autoSortByFunds) {
      baseTeams.sort((a, b) => {
        const aFunds = a.budget_remaining ?? 0;
        const bFunds = b.budget_remaining ?? 0;
        return bFunds - aFunds; // Sort descending (highest funds first)
      });
    } else if (currentUserId) {
      // Default behavior: put current user first
      const myTeamIdx = baseTeams.findIndex(t => t?.user_id === currentUserId);
      if (myTeamIdx > 0) {
        const [myTeam] = baseTeams.splice(myTeamIdx, 1);
        baseTeams.unshift(myTeam);
      }
    }
    
    // Map existing teams to objects with a stable dragId, then pad with placeholders
    const padded = baseTeams.map((t, i) => ({ ...t, dragId: t.user_id || `team-${i}` }));
    while (padded.length < numPlayers) {
      padded.push({ isPlaceholder: true, dragId: `placeholder-${padded.length}` } as any);
    }
    return padded;
  }, [teams, currentUserId, numPlayers, autoSortByFunds]);

  // Sync local items with props when the underlying data changes (e.g. someone joins/leaves)
  React.useEffect(() => {
    setItems(prevItems => {
      const prevIds = new Set(prevItems.map(i => i.dragId));
      const nextIds = new Set(sortedTeams.map(i => i.dragId));

      const idsChanged = prevIds.size !== nextIds.size || sortedTeams.some(t => !prevIds.has(t.dragId));

      // If auto-sort is enabled, always reset to sorted order when data changes
      if (autoSortByFunds) {
        return sortedTeams;
      }

      // If structure changed (ids added/removed) or first load, reset to default sorted order
      if (prevItems.length === 0 || idsChanged) {
        return sortedTeams;
      }

      // Maintain the manual order by mapping current items to their updated data
      return prevItems.map(item => {
        const freshData = sortedTeams.find(t => t.dragId === item.dragId);
        return freshData ? { ...freshData } : item;
      });
    });
  }, [sortedTeams, autoSortByFunds]);

  React.useEffect(() => {
    if (isInitial.current) {
      isInitial.current = false;
      return;
    }

    if (highestBid && highestBid > 0 && highestBidderId) {
      setAnimatingId(highestBidderId);
      const timer = setTimeout(() => setAnimatingId(null), 500);
      return () => clearTimeout(timer);
    }
  }, [highestBid, highestBidderId]);

  const getIconName = (name: string) => {
    if (name.toLowerCase().startsWith('egg')) return 'egg';
    return name.toLowerCase();
  };

  return (
    <Reorder.Group 
      axis="x" 
      values={items} 
      onReorder={twoRowMode ? () => {} : setItems} 
      className={`auction-players-row ${twoRowMode ? 'two-row-mode' : ''}`}
      style={{ 
        listStyle: 'none', 
        padding: '0.5rem 0',
        margin: '-0.5rem 0',
        overflowX: 'auto', 
        overflowY: 'hidden' 
      }}
    >
      <AnimatePresence mode="popLayout">
        {items.map((team) => {
          const playerName = team.isPlaceholder ? null : (team.global_name || team.username || team.user_id);
          const isFilled = !team.isPlaceholder;
          const readinessClass = isFilled && team.ready ? 'player-ready' : 'player-not-ready';
          const teamMoney = team.budget_remaining ?? 0;
          const zeroMoneyClass = isFilled && teamMoney === 0 ? 'player-zero-money' : '';
          const playerStateClass = isFilled
            ? (zeroMoneyClass || readinessClass)
            : 'player-open';
          const wonPokemon = team.auctions_won ?? team.pokemon ?? [];
          const disconnectedClass = !wsConnected ? 'player-disconnected' : '';

        return (
          <Reorder.Item
            as="div"
            key={team.dragId}
            value={team}
            className={`auction-player-box ${playerStateClass} ${team.user_id === highestBidderId ? 'highest-bidder' : ''} ${disconnectedClass} ${team.user_id === animatingId ? 'player-bidding' : ''}`}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: isFilled && !team.ready ? 0.5 : 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            whileDrag={{ 
              scale: 1.05, 
              zIndex: 10,
              boxShadow: "0px 12px 24px rgba(0,0,0,0.4)",
              cursor: 'grabbing'
            }}
            transition={{ 
              type: "spring", 
              stiffness: 400, 
              damping: 35,
              opacity: { duration: 0.2 } 
            }}
            style={{ cursor: 'grab', position: 'relative', overflow: 'visible' }}
          >
            <div className="auction-player-name">
              {playerName || 'Open Slot'}
            </div>
            <div className="auction-player-money">${teamMoney.toLocaleString()}</div>
            <div className="auction-player-icons">
              {wonPokemon.map((pokemon: Pokemon) => (
                <img
                  key={`${pokemon.name}-${pokemon.form ?? 'base'}`}
                  src={`/MiniIcons/${getIconName(pokemon.name)}.png`}
                  alt={pokemon.name}
                  className="auction-player-icon"
                  loading="lazy"
                />
              ))}
            </div>
          </Reorder.Item>
        );
      })}
      </AnimatePresence>
    </Reorder.Group>
  );
};

export default PlayerRow;
