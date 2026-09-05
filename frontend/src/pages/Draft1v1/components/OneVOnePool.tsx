import React from 'react';
import { OneVOnePoolSlot, OneVOnePlayer, OneVOneHistoryEntry, Pokemon, Team, OneVOneState } from '../../../types';
import './OneVOnePool.scss';

interface OneVOnePoolProps {
  pool: OneVOnePoolSlot[];
  history: OneVOneHistoryEntry[];
  slotLabels?: Map<string, string>;
  currentPlayer?: OneVOnePlayer | null;
  currentAction?: string | null;
  isActive: boolean;
  selectedSlot?: OneVOnePoolSlot | null;
  onSelect: (slot: OneVOnePoolSlot) => void;
  onHover?: (slot: OneVOnePoolSlot | null) => void;
  currentUserTeam?: Team | null;
  oneVOne?: OneVOneState | null;
}

function slotKey(slot: OneVOnePoolSlot): string {
  return `${slot.pokemon.pokedex_id}-${slot.pokemon.form ?? ''}`;
}

function displayName(slot: OneVOnePoolSlot): string {
  const p = slot.pokemon;
  if (p.form) return `${p.name} (${p.form})`;
  return p.name;
}

function imageName(pokemon: Pokemon): string {
  const n = pokemon.name.replace(/\s*\(.*\)\s*/, '');
  return n;
}

function statusClass(status: OneVOnePoolSlot['status']): { cls: string; text: string } {
  if (typeof status === 'object' && status !== null && 'Picked' in status) {
    return { cls: status.Picked === 'P1' ? 'p1' : 'p2', text: `Picked by ${status.Picked}` };
  }
  if (typeof status === 'object' && status !== null && 'Banned' in status) {
    const which = status.Banned === 'P1' ? 'p1' : 'p2';
    return { cls: `banned banned-${which}`, text: `Banned by ${status.Banned}` };
  }
  return { cls: 'available', text: 'Available' };
}

function sameSlot(a: OneVOnePoolSlot, b: OneVOnePoolSlot): boolean {
  return a.pokemon.pokedex_id === b.pokemon.pokedex_id && (a.pokemon.form ?? '') === (b.pokemon.form ?? '');
}

function sectionIndex(status: OneVOnePoolSlot['status']): number {
  if (typeof status === 'object' && status !== null && 'Picked' in status) {
    return status.Picked === 'P1' ? 0 : 1;
  }
  if (status === 'Available') return 2;
  if (typeof status === 'object' && status !== null && 'Banned' in status) {
    return status.Banned === 'P1' ? 3 : 4;
  }
  return 2;
}

function historyOrder(slot: OneVOnePoolSlot, history: OneVOneHistoryEntry[]): number {
  const idx = history.findIndex((h) => h.pokemon.pokedex_id === slot.pokemon.pokedex_id && (h.pokemon.form ?? '') === (slot.pokemon.form ?? ''));
  return idx === -1 ? Number.MAX_SAFE_INTEGER : idx;
}

function orderPool(pool: OneVOnePoolSlot[], history: OneVOneHistoryEntry[]): OneVOnePoolSlot[] {
  return [...pool].sort((a, b) => {
    const sa = sectionIndex(a.status);
    const sb = sectionIndex(b.status);
    if (sa !== sb) return sa - sb;
    if (sa === 0 || sa === 1 || sa === 3 || sa === 4) {
      return historyOrder(a, history) - historyOrder(b, history);
    }
    if (sa === 2) {
      if (b.avg_price !== a.avg_price) return (b.avg_price || 0) - (a.avg_price || 0);
      return (a.pokemon.pokedex_id || 0) - (b.pokemon.pokedex_id || 0);
    }
    return 0;
  });
}

function getHoverClass(
  isActive: boolean,
  currentPlayer: OneVOnePlayer | null | undefined,
  currentAction: string | null | undefined,
  currentUserTeam: Team | null | undefined,
  oneVOne: OneVOneState | null | undefined
): string {
  if (!isActive || !currentPlayer || !currentAction || !currentUserTeam || !oneVOne) {
    return '';
  }

  const isCurrentUserP1 = teamMatchesId(currentUserTeam, oneVOne.player1);
  const isCurrentUserP2 = teamMatchesId(currentUserTeam, oneVOne.player2);

  if ((currentPlayer === 'P1' && isCurrentUserP1) || (currentPlayer === 'P2' && isCurrentUserP2)) {
    if (currentAction === 'Pick') {
      return currentPlayer === 'P1' ? 'hover-p1-pick' : 'hover-p2-pick';
    }
    if (currentAction === 'Ban') {
      return currentPlayer === 'P1' ? 'hover-p1-ban' : 'hover-p2-ban';
    }
  }

  return '';
}

function teamMatchesId(t: Team, id: string): boolean {
  return [t.user_id, t.guest_id].includes(id);
}

const OneVOnePool: React.FC<OneVOnePoolProps> = ({
  pool,
  history,
  slotLabels,
  currentPlayer,
  currentAction,
  isActive,
  selectedSlot,
  onSelect,
  onHover,
  currentUserTeam,
  oneVOne,
}) => {
  const sortedPool = orderPool(pool, history);
  const hoverClass = getHoverClass(isActive, currentPlayer, currentAction, currentUserTeam, oneVOne);

  return (
    <div className="one-v-one-pool">
      <div className="one-v-one-pool-grid">
        {sortedPool.map((slot, idx) => {
          const status = statusClass(slot.status);
          const isSelected = selectedSlot && sameSlot(selectedSlot, slot);
          const label = slotLabels?.get(slotKey(slot));
          const isAvailable = slot.status === 'Available';
          const baseClasses = `one-v-one-pool-square ${status.cls} ${isActive && isAvailable ? 'clickable' : ''} ${isSelected ? 'selected' : ''} ${isAvailable && hoverClass ? hoverClass : ''} ${isSelected && isAvailable && hoverClass ? `${hoverClass}-persistent` : ''}`;
          return (
            <div
              key={`${slot.pokemon.pokedex_id}-${slot.pokemon.form ?? ''}-${idx}`}
              className="one-v-one-pool-cell"
            >
              <div
                className={baseClasses}
                onClick={() => {
                  if (isActive && isAvailable) onSelect(slot);
                }}
                onMouseEnter={() => onHover?.(slot)}
                onMouseLeave={() => onHover?.(null)}
                title={displayName(slot)}
              >
                <img
                  src={`/baseforms/${imageName(slot.pokemon)}.png`}
                  alt={displayName(slot)}
                  onError={(e) => {
                    (e.target as HTMLImageElement).src = '/baseforms/egg.png';
                  }}
                />
              </div>
              {label && <span className="one-v-one-pool-badge">{label}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default OneVOnePool;
