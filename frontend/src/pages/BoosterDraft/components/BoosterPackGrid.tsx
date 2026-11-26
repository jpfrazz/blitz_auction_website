import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  BoosterAction,
  BoosterHistoryEntry,
  BoosterPackState,
  BoosterPoolSlot,
  BoosterSlotStatus,
  Pokemon,
} from '../../../types';
import { boosterActionBadgeByPokemon, orderSlotsForHolder } from '../boosterPackOrder';
import {
  BOOSTER_PLAYER_COLORS,
  boosterColorShade,
  boosterColorWithAlpha,
  boosterPlayerColor,
} from '../playerColors';
import { getMysteryDungeonPortrait, loadPortraitMetadata } from '../../Draft1v1/components/mysteryDungeonArt';
import { getTcgArt } from '../../Draft1v1/components/tcgArt';
import { getShuffleIcon } from '../../Draft1v1/components/shuffleIcons';
import '../../Draft1v1/components/OneVOnePool.scss';
import './BoosterPackGrid.scss';

export const PLAYER_COLORS = BOOSTER_PLAYER_COLORS;

interface BoosterPackGridProps {
  pack: BoosterPackState;
  history: BoosterHistoryEntry[];
  playerIds: string[];
  isMyPack: boolean;
  canAct: boolean;
  action: BoosterAction | null;
  selectedSlot?: BoosterPoolSlot | null;
  onSelect: (slot: BoosterPoolSlot) => void;
  onHover?: (slot: BoosterPoolSlot | null) => void;
  markedSlots: Set<string>;
  onToggleMark: (slot: BoosterPoolSlot) => void;
  tileSize: number;
}

function displayName(slot: BoosterPoolSlot): string {
  const p = slot.pokemon;
  return p.form ? `${p.name} (${p.form})` : p.name;
}

function imageName(pokemon: Pokemon): string {
  return pokemon.name.replace(/\s*\(.*\)\s*/, '');
}

function playerNumber(playerIds: string[], userId: string | undefined): number {
  const index = playerIds.indexOf(userId ?? '');
  return index < 0 ? -1 : index + 1;
}

function statusClass(
  status: BoosterSlotStatus,
  playerIds: string[],
  pokemon: Pokemon,
  badgeByPokemon: Map<string, string>,
): { cls: string; color?: string; label?: string } {
  if (status === 'Available') return { cls: 'available' };
  if (status === 'Leftover') return { cls: 'booster-leftover', label: '—' };

  const isPick = 'Picked' in status;
  const actor = isPick ? status.Picked : status.Banned;
  const num = playerNumber(playerIds, actor);
  const key = `${pokemon.pokedex_id}-${pokemon.form ?? ''}`;
  return {
    cls: isPick ? 'booster-picked' : 'booster-banned',
    color: num > 0 ? BOOSTER_PLAYER_COLORS[num - 1] : '#9e9e9e',
    label: badgeByPokemon.get(key) ?? (isPick ? 'p?' : 'b?'),
  };
}

const BoosterPackGrid: React.FC<BoosterPackGridProps> = ({
  pack,
  history,
  playerIds,
  isMyPack,
  canAct,
  action,
  selectedSlot,
  onSelect,
  onHover,
  markedSlots,
  onToggleMark,
  tileSize,
}) => {
  const [artMode, setArtMode] = useState(() =>
    localStorage.getItem('eb-pokemon-tile-art') ||
    localStorage.getItem('eb-1v1-pokemon-art') ||
    'standard',
  );
  const [tcgArtSeed] = useState(() => Math.floor(Math.random() * 0x100000000));
  const [metadata, setMetadata] = useState<Awaited<ReturnType<typeof loadPortraitMetadata>> | null>(null);
  const [loadedDizzy, setLoadedDizzy] = useState<Set<string>>(() => new Set());
  const gridRef = useRef<HTMLDivElement>(null);
  const [gridWidth, setGridWidth] = useState(0);

  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const measure = () => setGridWidth(grid.clientWidth || grid.getBoundingClientRect().width || 0);
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(grid);
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  useEffect(() => {
    const refresh = () => setArtMode(
      localStorage.getItem('eb-pokemon-tile-art') ||
      localStorage.getItem('eb-1v1-pokemon-art') ||
      'standard',
    );
    window.addEventListener('eb-settings-changed', refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener('eb-settings-changed', refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);

  useEffect(() => {
    let active = true;
    if (artMode === 'mystery-dungeon') {
      loadPortraitMetadata()
        .then((data) => { if (active) setMetadata(data); })
        .catch(() => { if (active) setMetadata(null); });
    }
    return () => { active = false; };
  }, [artMode]);

  const holderIndex = playerIds.indexOf(pack.holder_id);
  const holderColor = boosterPlayerColor(holderIndex);

  const sortedSlots = useMemo(
    () => orderSlotsForHolder(pack.slots, history, playerIds, pack.holder_id, pack.pack_index),
    [pack.slots, history, playerIds, pack.holder_id, pack.pack_index],
  );
  const badgeByPokemon = useMemo(
    () => boosterActionBadgeByPokemon(history, pack.slots, pack.pack_index),
    [history, pack.slots, pack.pack_index],
  );

  const portraits = artMode === 'mystery-dungeon' && metadata
    ? sortedSlots.map((slot) => getMysteryDungeonPortrait(slot.pokemon, metadata))
    : [];
  const dizzyPortraits = artMode === 'mystery-dungeon' && metadata
    ? sortedSlots.map((slot) => getMysteryDungeonPortrait(slot.pokemon, metadata, true))
    : [];

  // Fit as many tiles as possible on the top row, then wrap the extras like
  // text. Other packs use roughly half the tile size; tracks stay fixed to the
  // scrubbed size so the scrub bar really resizes them instead of stretching
  // 1fr columns. The grid's horizontal padding is excluded from the fit.
  const slotCount = Math.max(1, sortedSlots.length);
  const desiredTileSize = isMyPack ? tileSize : Math.max(28, Math.round(tileSize * 0.58));
  const measuredWidth = Math.max(1, (gridWidth > 0 ? gridWidth : 960) - 8);
  const fitColumns = Math.max(1, Math.floor((measuredWidth + 4) / (desiredTileSize + 4)));
  const columns = Math.max(1, Math.min(slotCount, fitColumns));

  const panelStyle = {
    '--booster-holder-color': holderColor,
  } as React.CSSProperties;
  const gridStyle = {
    '--booster-columns': columns,
    '--pool-tile-size': `${desiredTileSize}px`,
  } as React.CSSProperties;

  return (
    <section
      className="booster-pack-panel"
      style={panelStyle}
      aria-label={`Pack ${pack.pack_index + 1}, held by player ${holderIndex + 1 || '?'}`}
    >
      <div ref={gridRef} className="one-v-one-pool-grid booster-pack-grid" style={gridStyle}>
        {sortedSlots.map((slot, index) => {
          const status = statusClass(slot.status, playerIds, slot.pokemon, badgeByPokemon);
          const key = `${slot.pokemon.pokedex_id}-${slot.pokemon.form ?? ''}`;
          const isAvailable = slot.status === 'Available';
          const isWarded = isAvailable && !!slot.warded_by;
          const canSelectSlot = canAct && isAvailable &&
            !(action === 'Ban' && isWarded) &&
            !(action === 'Ward' && isWarded);
          const isSelected = !!selectedSlot &&
            selectedSlot.pokemon.pokedex_id === slot.pokemon.pokedex_id &&
            (selectedSlot.pokemon.form ?? '') === (slot.pokemon.form ?? '');
          const isMarked = isAvailable && markedSlots.has(key);
          const portrait = portraits[index];
          const tcgArt = artMode === 'tcg' ? getTcgArt(slot.pokemon, tcgArtSeed) : undefined;
          const shuffleArt = artMode === 'shuffle' ? getShuffleIcon(slot.pokemon) : undefined;
          const dizzyPortrait = dizzyPortraits[index]?.url !== portrait?.url ? dizzyPortraits[index] : null;
          const hoverClass = canSelectSlot
            ? action === 'Ban'
              ? 'booster-hover-ban'
              : action === 'Ward'
                ? 'booster-hover-ward'
                : 'booster-hover-pick'
            : '';
          const persistentClass = hoverClass && isSelected ? `${hoverClass}-persistent` : '';
          const classes = [
            'one-v-one-pool-square',
            'booster-tile',
            status.cls,
            isWarded ? 'booster-warded' : '',
            portrait ? 'mystery-dungeon' : '',
            portrait?.local ? 'local-art' : '',
            tcgArt ? 'tcg-art' : '',
            shuffleArt ? 'shuffle-art' : '',
            dizzyPortrait && loadedDizzy.has(dizzyPortrait.url) ? 'has-dizzy' : '',
            canSelectSlot ? 'clickable' : '',
            isSelected ? 'selected' : '',
            isMarked ? 'marked' : '',
            hoverClass,
            persistentClass,
          ]
            .filter(Boolean)
            .join(' ');
          const tileStyle = {
            ...(status.color ? { '--booster-player-color': status.color } : {}),
            ...(status.cls === 'booster-picked' && status.color
              ? {
                  '--booster-picked-bg': boosterColorShade(status.color, 0.58),
                  '--booster-picked-border': boosterColorShade(status.color, -0.3),
                  '--booster-picked-overlay': boosterColorWithAlpha(status.color, 0.18),
                }
              : {}),
            ...(hoverClass
              ? {
                  '--booster-hover-bg': boosterColorShade(holderColor, 0.58),
                  '--booster-hover-border': boosterColorShade(holderColor, -0.3),
                  '--booster-hover-overlay': boosterColorWithAlpha(holderColor, 0.18),
                }
              : {}),
          } as React.CSSProperties;
          return (
            <div className="one-v-one-pool-cell" key={key}>
              <div
                className={classes}
                style={tileStyle}
                onClick={() => {
                  if (canSelectSlot) onSelect(slot);
                }}
                onContextMenu={(event) => {
                  event.preventDefault();
                  if (isAvailable) onToggleMark(slot);
                }}
                onMouseEnter={() => onHover?.(slot)}
                onMouseLeave={() => onHover?.(null)}
                title={`${displayName(slot)}${isAvailable ? ' — right-click to mark' : ''}`}
              >
                <img
                  key={portrait?.url || tcgArt || shuffleArt || 'standard'}
                  className={portrait ? 'portrait-normal' : undefined}
                  src={portrait?.url || tcgArt || shuffleArt || `/baseforms/${imageName(slot.pokemon)}.png`}
                  alt={displayName(slot)}
                  onError={(event) => {
                    const image = event.currentTarget;
                    image.onerror = null;
                    image.src = `/baseforms/${imageName(slot.pokemon)}.png`;
                    image.parentElement?.classList.remove('mystery-dungeon');
                    image.parentElement?.classList.remove('tcg-art');
                    image.parentElement?.classList.remove('shuffle-art');
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
              {status.label && (
                <span className="one-v-one-pool-badge booster-pack-badge">
                  {status.label}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
};

export default BoosterPackGrid;
