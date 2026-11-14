import React, { useEffect, useState } from 'react';
import { OneVOnePoolSlot, OneVOnePlayer, OneVOneHistoryEntry, Pokemon, Team, OneVOneState } from '../../../types';
import { getMysteryDungeonPortrait, loadPortraitMetadata } from './mysteryDungeonArt';
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
  const [mysteryDungeon, setMysteryDungeon] = useState(() => localStorage.getItem('eb-1v1-pokemon-art') === 'mystery-dungeon');
  const [metadata, setMetadata] = useState<Awaited<ReturnType<typeof loadPortraitMetadata>> | null>(null);
  const [loadedDizzy, setLoadedDizzy] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    const refresh = () => setMysteryDungeon(localStorage.getItem('eb-1v1-pokemon-art') === 'mystery-dungeon');
    window.addEventListener('eb-settings-changed', refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener('eb-settings-changed', refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);
  useEffect(() => {
    let active = true;
    if (mysteryDungeon) loadPortraitMetadata().then((data) => { if (active) setMetadata(data); }).catch(() => { if (active) setMetadata(null); });
    return () => { active = false; };
  }, [mysteryDungeon]);
  const sortedPool = orderPool(pool, history);
  const hoverClass = getHoverClass(isActive, currentPlayer, currentAction, currentUserTeam, oneVOne);
  const portraits = mysteryDungeon && metadata ? sortedPool.map((slot) => getMysteryDungeonPortrait(slot.pokemon, metadata)) : [];
  const dizzyPortraits = mysteryDungeon && metadata ? sortedPool.map((slot) => getMysteryDungeonPortrait(slot.pokemon, metadata, true)) : [];

  return (
    <div className="one-v-one-pool">
      <div className="one-v-one-pool-grid">
        {sortedPool.map((slot, idx) => {
          const status = statusClass(slot.status);
          const isSelected = selectedSlot && sameSlot(selectedSlot, slot);
          const label = slotLabels?.get(slotKey(slot));
          const isAvailable = slot.status === 'Available';
          const portrait = portraits[idx];
          const dizzyPortrait = dizzyPortraits[idx]?.url !== portrait?.url ? dizzyPortraits[idx] : null;
          const baseClasses = `one-v-one-pool-square ${status.cls} ${portrait ? 'mystery-dungeon' : ''} ${dizzyPortrait && loadedDizzy.has(dizzyPortrait.url) ? 'has-dizzy' : ''} ${isActive && isAvailable ? 'clickable' : ''} ${isSelected ? 'selected' : ''} ${isAvailable && hoverClass ? hoverClass : ''} ${isSelected && isAvailable && hoverClass ? `${hoverClass}-persistent` : ''}`;
          return (
            <div
              key={slotKey(slot)}
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
                  key={portrait?.url || 'standard'}
                  className={portrait ? 'portrait-normal' : undefined}
                  src={portrait?.url || `/baseforms/${imageName(slot.pokemon)}.png`}
                  alt={displayName(slot)}
                  onError={(e) => {
                    const image = e.currentTarget;
                    image.onerror = null;
                    image.src = `/baseforms/${imageName(slot.pokemon)}.png`;
                    const alternate = image.parentElement?.querySelector<HTMLImageElement>('.portrait-dizzy');
                    if (alternate) alternate.style.display = 'none';
                    image.parentElement?.classList.remove('mystery-dungeon');
                  }}
                />
                {dizzyPortrait && (
                  <img
                    className="portrait-dizzy"
                    src={dizzyPortrait.url}
                    alt=""
                    aria-hidden="true"
                    onLoad={() => setLoadedDizzy((loaded) => {
                      if (loaded.has(dizzyPortrait.url)) return loaded;
                      return new Set(loaded).add(dizzyPortrait.url);
                    })}
                    onError={(event) => {
                      event.currentTarget.parentElement?.classList.remove('has-dizzy');
                      event.currentTarget.style.display = 'none';
                    }}
                  />
                )}
              </div>
              {label && <span className="one-v-one-pool-badge">{label}</span>}
            </div>
          );
        })}
      </div>
      {portraits.some(Boolean) && (
        <details className="one-v-one-portrait-credits">
          <summary>Mystery Dungeon portrait credits</summary>
          <p>Portraits from <a href="https://sprites.pmdcollab.org/" target="_blank" rel="noreferrer">PMDCollab SpriteCollab</a>, <a href="https://creativecommons.org/licenses/by-nc/4.0/" target="_blank" rel="noreferrer">CC BY-NC 4.0</a>.</p>
          <ul>{sortedPool.map((slot, index) => portraits[index] && <li key={slotKey(slot)}><a href={portraits[index]!.source} target="_blank" rel="noreferrer">{displayName(slot)}</a>: {portraits[index]!.credits.join(', ')}</li>)}</ul>
        </details>
      )}
    </div>
  );
};

export default OneVOnePool;
