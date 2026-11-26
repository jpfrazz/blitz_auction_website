import React, { useMemo, useState } from 'react';
import { StatsPageResponse } from '../../types';
import type { RunStatLineage } from '../../utils/runStatLineage';
import { computeWinHistoryByPokemonKey } from './costBreakdownKos';
import './PokemonWinHistoryTable.scss';

interface PokemonWinHistoryTableProps {
  pokemonKey: string;
  pokemonName: string;
  stats: StatsPageResponse;
  cutoffDate?: string;
  validDraftIds: Set<string>;
  casualOneVOneDraftIds: Set<string>;
  casualBoosterDraftIds?: Set<string>;
  runStatLineage: RunStatLineage;
}

type WinSortKey = 'date' | 'player' | 'type' | 'kos';

interface WinRow {
  id: string;
  timestamp: number;
  date: string;
  player: string;
  type: string;
  kos: number | null;
}

const COLUMNS: Array<{ key: WinSortKey; label: string }> = [
  { key: 'date', label: 'Date' },
  { key: 'player', label: 'Player' },
  { key: 'type', label: 'Type' },
  { key: 'kos', label: 'KOs' },
];

const FIRST_CLICK_DIRECTION: Record<WinSortKey, 'asc' | 'desc'> = {
  date: 'desc',
  player: 'asc',
  type: 'asc',
  kos: 'desc',
};

const PokemonWinHistoryTable: React.FC<PokemonWinHistoryTableProps> = ({
  pokemonKey,
  pokemonName,
  stats,
  cutoffDate,
  validDraftIds,
  casualOneVOneDraftIds,
  casualBoosterDraftIds = new Set(),
  runStatLineage,
}) => {
  const [sort, setSort] = useState<{ key: WinSortKey; direction: 'asc' | 'desc' }>({
    key: 'date',
    direction: 'desc',
  });

  const rows = useMemo<WinRow[]>(() => {
    const cutoff = cutoffDate ? new Date(cutoffDate).getTime() : 0;
    const playerNames = new Map(
      (stats.players ?? []).map((player) => [player.user_id, player.user_name]),
    );

    const history = computeWinHistoryByPokemonKey(
      stats.winning_races ?? [],
      stats.winning_run_kos ?? [],
      stats.auctions ?? [],
      stats.teams ?? [],
      stats.players ?? [],
      runStatLineage,
      validDraftIds,
      casualOneVOneDraftIds,
      casualBoosterDraftIds,
    ).get(pokemonKey) ?? [];

    return history
      .map((entry, index) => {
        const timestamp = entry.created_at ? new Date(entry.created_at).getTime() : 0;
        if (cutoff > 0 && (timestamp === 0 || timestamp < cutoff)) return null;

        const playerId = entry.user_id ?? entry.guest_id;
        return {
          id: `${entry.team_id}-${entry.draft_id}-${index}`,
          timestamp,
          date: entry.created_at ? new Date(entry.created_at).toLocaleDateString() : 'Unknown',
          player: (playerId && playerNames.get(playerId)) || 'Unknown',
          type: entry.draft_type === '1v1'
            ? '1v1'
            : entry.draft_type === 'booster'
              ? casualBoosterDraftIds.has(entry.draft_id) ? 'Casual Booster' : 'Booster'
              : 'Auction',
          kos: entry.ko_count,
        } as WinRow;
      })
      .filter((row): row is WinRow => row !== null);
  }, [
    pokemonKey,
    stats,
    cutoffDate,
    validDraftIds,
    casualOneVOneDraftIds,
    casualBoosterDraftIds,
    runStatLineage,
  ]);

  const sortedRows = useMemo(() => {
    const multiplier = sort.direction === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      let difference = 0;
      switch (sort.key) {
        case 'date':
          difference = a.timestamp - b.timestamp;
          break;
        case 'player':
          difference = a.player.localeCompare(b.player);
          break;
        case 'type':
          difference = a.type.localeCompare(b.type);
          break;
        case 'kos':
          if (a.kos == null && b.kos == null) difference = 0;
          else if (a.kos == null) return 1;
          else if (b.kos == null) return -1;
          else difference = a.kos - b.kos;
          break;
      }
      return multiplier * difference || a.timestamp - b.timestamp;
    });
  }, [rows, sort]);

  const handleSort = (key: WinSortKey) => {
    setSort((current) => current.key === key
      ? { key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
      : { key, direction: FIRST_CLICK_DIRECTION[key] });
  };

  if (rows.length === 0) {
    return <div className="win-history-empty">No wins recorded yet!</div>;
  }

  return (
    <div className="win-history-table" role="table" aria-label={`Win history for ${pokemonName}`}>
      <div className="win-history-head" role="row">
        {COLUMNS.map((column) => (
          <button
            key={column.key}
            type="button"
            className="win-history-sort"
            onClick={() => handleSort(column.key)}
          >
            {column.label}{sort.key === column.key ? (sort.direction === 'asc' ? ' ↑' : ' ↓') : ''}
          </button>
        ))}
      </div>
      <div className="win-history-body">
        {sortedRows.map((row) => (
          <div className="win-history-row" role="row" key={row.id}>
            <span>{row.date}</span>
            <span title={row.player}>{row.player}</span>
            <span>{row.type}</span>
            <span>{row.kos ?? '—'}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default PokemonWinHistoryTable;
