import { MOVES } from './movesData';

type TotalsMon = {
  total_turns?: number | null;
  ko_count?: number | null;
};

export interface EnemyTooltipMon {
  name: string;
  ability?: string | null;
  nature?: string | null;
  hp?: number | null;
  max_hp?: number | null;
  stats?: {
    atk: number;
    def: number;
    spa: number;
    spd: number;
    spe: number;
  } | null;
  moves?: number[] | null;
}

const formatCount = (value: number | null | undefined): string =>
  typeof value === 'number' && Number.isFinite(value) ? String(value) : '—';

/** Shared line appended to the sidebar/spectator mini-icon hover boxes. */
export const formatMonTotalsLine = (mon: TotalsMon): string =>
  `\nTotal Turns: ${formatCount(mon.total_turns)} | Total KOs: ${formatCount(mon.ko_count)}`;

/** Hover box for opposing mons: two compact stat rows instead of one per stat. */
export const formatEnemyMonTooltip = (mon: EnemyTooltipMon): string => {
  const s = mon.stats;
  const moveNames = (mon.moves ?? [])
    .map((id) => (Number(id) > 0 ? MOVES[id]?.name : undefined))
    .filter((name): name is string => Boolean(name));

  return [
    `${mon.name} (${mon.ability || 'Unknown'}) - ${mon.nature || 'Unknown'}`,
    `HP: ${formatCount(mon.max_hp)}  Atk: ${formatCount(s?.atk)}  Def: ${formatCount(s?.def)}`,
    `SpAtk: ${formatCount(s?.spa)}  SpDef: ${formatCount(s?.spd)}  Spd: ${formatCount(s?.spe)}`,
    `Moves: ${moveNames.length > 0 ? moveNames.join(', ') : '—'}`,
  ].join('\n');
};
