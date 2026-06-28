import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
  horizontalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { restrictToHorizontalAxis } from '@dnd-kit/modifiers';
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

interface SortableItemProps {
  team: any;
  highestBidderId?: string | null;
  wsConnected?: boolean;
  animatingId: string | null;
  autoSortByFunds: boolean;
  getIconName: (name: string) => string;
}

const SortableItem: React.FC<SortableItemProps> = ({ team, highestBidderId, wsConnected, animatingId, autoSortByFunds, getIconName }) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: team.dragId,
  });

  const style = {
    transform: isDragging ? CSS.Transform.toString(transform) : undefined,
    opacity: isDragging ? 0.5 : 1,
    cursor: autoSortByFunds ? 'default' : 'grab',
  };

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

  const cardContent = (
    <>
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
    </>
  );

  if (autoSortByFunds) {
    return (
      <motion.div
        ref={setNodeRef}
        {...attributes}
        className={`auction-player-box ${playerStateClass} ${team.user_id === highestBidderId ? 'highest-bidder' : ''} ${disconnectedClass} ${team.user_id === animatingId ? 'player-bidding' : ''}`}
        layout
        layoutId={team.dragId}
        transition={{ duration: 0.4, ease: [0.25, 0.1, 0.25, 1] }}
      >
        {cardContent}
      </motion.div>
    );
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={`auction-player-box ${playerStateClass} ${team.user_id === highestBidderId ? 'highest-bidder' : ''} ${disconnectedClass} ${team.user_id === animatingId ? 'player-bidding' : ''}`}
    >
      {cardContent}
    </div>
  );
};

const PlayerRow: React.FC<PlayerRowProps> = ({ teams, numPlayers, highestBidderId, wsConnected = true, currentUserId, highestBid }) => {
  const [animatingId, setAnimatingId] = React.useState<string | null>(null);
  const isInitial = React.useRef(true);

  // Local state to manage the visual order for dragging
  const [items, setItems] = React.useState<any[]>([]);

  // dnd-kit sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      setItems((items) => {
        const oldIndex = items.findIndex((item) => item.dragId === active.id);
        const newIndex = items.findIndex((item) => item.dragId === over.id);

        return arrayMove(items, oldIndex, newIndex);
      });
    }
  };

  // Settings
  const [twoRowMode, setTwoRowMode] = React.useState(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('eb-two-row-player-height') === 'true';
  });

  const [autoSortByFunds, setAutoSortByFunds] = React.useState(() => {
    if (typeof window === 'undefined') return true;
    const stored = localStorage.getItem('eb-auto-sort-by-funds');
    return stored === null ? true : stored === 'true';
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

      // If structure changed (ids added/removed) or first load, reset to default sorted order
      if (prevItems.length === 0 || idsChanged) {
        return sortedTeams;
      }

      // If auto-sort is enabled, reorder items to match sorted order using arrayMove for animation
      if (autoSortByFunds) {
        let newOrder = [...prevItems];
        // Apply moves to transform current order to sorted order
        for (let targetIndex = 0; targetIndex < sortedTeams.length; targetIndex++) {
          const targetItem = sortedTeams[targetIndex];
          const currentIndex = newOrder.findIndex(item => item.dragId === targetItem.dragId);
          if (currentIndex !== -1 && currentIndex !== targetIndex) {
            newOrder = arrayMove(newOrder, currentIndex, targetIndex);
          }
        }
        // Update the data in the reordered items
        return newOrder.map(item => {
          const freshData = sortedTeams.find(t => t.dragId === item.dragId);
          return freshData ? { ...item, ...freshData } : item;
        });
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

  const containerClassName = `auction-players-row ${twoRowMode ? 'two-row-mode' : ''}`;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
      modifiers={!twoRowMode ? [restrictToHorizontalAxis] : undefined}
    >
      <SortableContext
        items={items.map(item => item.dragId)}
        strategy={horizontalListSortingStrategy}
      >
        <div className={containerClassName}>
          {items.map((team) => (
            <SortableItem
              key={team.dragId}
              team={team}
              highestBidderId={highestBidderId}
              wsConnected={wsConnected}
              animatingId={animatingId}
              autoSortByFunds={autoSortByFunds}
              getIconName={getIconName}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
};

export default PlayerRow;
