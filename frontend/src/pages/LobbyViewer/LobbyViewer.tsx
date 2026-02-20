import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  useReactTable,
  SortingState,
} from '@tanstack/react-table';
import Header from '../../shared/components/Header';
import Footer from '../../shared/components/Footer';
import { fetchOpenDrafts } from '../../shared/api/draftData';
import { DraftLobby, DraftState } from '../../types';
import './LobbyViewer.scss';

function formatDraftState(draftState: DraftState): string {
  if (typeof draftState === 'string') {
    return draftState;
  }

  if ('PAUSED' in draftState) {
    return 'PAUSED';
  }

  if ('BIDDING' in draftState) {
    return 'BIDDING';
  }

  return 'UNKNOWN';
}

const LobbyViewer: React.FC = () => {
  const [drafts, setDrafts] = useState<DraftLobby[]>([]);
  const [loading, setLoading] = useState(true);
  const [sorting, setSorting] = useState<SortingState>([{ id: 'draft_name', desc: false }]);
  const [columnFilters, setColumnFilters] = useState<any[]>([]);

  useEffect(() => {
    fetchOpenDrafts()
      .then(setDrafts)
      .catch(error => console.error('Error fetching open drafts:', error))
      .finally(() => setLoading(false));
  }, []);

  const columns = useMemo<ColumnDef<DraftLobby>[]>(() => [
    {
      header: 'Draft Name',
      accessorKey: 'draft_name',
    },
    {
      header: 'Password',
      accessorKey: 'has_password',
      cell: info => (info.getValue<boolean>() ? '🔒' : '🔓'),
    },
    {
      header: 'Teams',
      cell: info => `${info.row.original.teams_joined}/${info.row.original.total_teams}`,
    },
    {
      header: 'Draft Status',
      cell: info => formatDraftState(info.row.original.draft_state),
    },
    {
      header: 'Join',
      cell: info => (
        <Link className="button lobby-viewer-join-button" to={`/Auction?${info.row.original.draft_id}`}>
          Join
        </Link>
      ),
      enableSorting: false,
    },
  ], []);

  const table = useReactTable({
    data: drafts,
    columns,
    state: { sorting, columnFilters },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  return (
    <>
      <Header />
      <main className="lobby-viewer-main">
        <h1 className="lobby-viewer-title">Lobby Viewer</h1>

        {loading && <div>Loading lobbies...</div>}

        {!loading && (
          <div className="lobby-viewer-table-wrapper">
            <table className="lobby-viewer-table">
              <thead>
                {table.getHeaderGroups().map(headerGroup => (
                  <tr key={headerGroup.id}>
                    {headerGroup.headers.map(header => (
                      <th key={header.id}>
                        <div className="lobby-header-container">
                          <div
                            className="lobby-header-title"
                            style={{ display: 'flex', alignItems: 'center', gap: 4 }}
                          >
                            {header.isPlaceholder
                              ? null
                              : flexRender(header.column.columnDef.header, header.getContext())}
                            {header.column.getCanSort() && (
                              <span
                                onClick={header.column.getToggleSortingHandler()}
                                style={{
                                  cursor: 'pointer',
                                  userSelect: 'none',
                                  marginLeft: 2,
                                }}
                                tabIndex={0}
                                role="button"
                                aria-label="Toggle sort"
                              >
                                {header.column.getIsSorted() ? (
                                  header.column.getIsSorted() === 'desc' ? '↓' : '↑'
                                ) : (
                                  '⇅'
                                )}
                              </span>
                            )}
                          </div>
                          {header.column.getCanFilter() && header.id !== 'join' ? (
                            <input
                              type="text"
                              value={
                                (header.column.getFilterValue() ?? '') as string
                              }
                              onChange={e =>
                                header.column.setFilterValue(e.target.value)
                              }
                              placeholder="Search..."
                              className="lobby-filter-input"
                            />
                          ) : null}
                        </div>
                      </th>
                    ))}
                  </tr>
                ))}
              </thead>
              <tbody>
                {table.getRowModel().rows.length === 0 && (
                  <tr>
                    <td colSpan={5} className="lobby-viewer-empty">
                      No active drafts found.
                    </td>
                  </tr>
                )}
                {table.getRowModel().rows.map(row => (
                  <tr key={row.id}>
                    {row.getVisibleCells().map(cell => (
                      <td key={cell.id}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
      <Footer />
    </>
  );
};

export default LobbyViewer;
