import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { FaTrash } from 'react-icons/fa';
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
import { fetchOpenDrafts, fetchCurrentUser, deleteDraft } from '../../shared/api/draftData';
import { DraftLobby, DraftState } from '../../types';
import './LobbyViewer.scss';

function formatDraftState(draftState: DraftState): string {
  if (typeof draftState === 'string') {
    return draftState === 'BIDDING' ? 'DRAFTING' : draftState;
  }

  if ('PAUSED' in draftState) {
    return 'PAUSED';
  }

  if ('BIDDING' in draftState) {
    return 'DRAFTING';
  }

  return 'UNKNOWN';
}

function getTimeAgo(dateString?: string): string {
  if (!dateString) return '-';
  const now = new Date();
  const created = new Date(dateString);
  const diffInSeconds = Math.floor((now.getTime() - created.getTime()) / 1000);

  if (diffInSeconds < 60) return 'Just now';
  const diffInMinutes = Math.floor(diffInSeconds / 60);
  if (diffInMinutes < 60) return `${diffInMinutes}m ago`;
  const diffInHours = Math.floor(diffInMinutes / 60);
  return `${diffInHours}h ${diffInMinutes % 60}m ago`;
}

const LobbyViewer: React.FC = () => {
  const [drafts, setDrafts] = useState<DraftLobby[]>([]);
  const [loading, setLoading] = useState(true);
  const [sorting, setSorting] = useState<SortingState>([{ id: 'created_at', desc: true }]);
  const [columnFilters, setColumnFilters] = useState<any[]>([]);
  const [isGuest, setIsGuest] = useState<boolean | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  const handleDeleteLobby = useCallback(async (draftId: string) => {
    if (!window.confirm('Are you sure you want to delete this lobby?')) return;
    
    // Optimistically remove from local state so it leaves the screen immediately
    setDrafts(prev => prev.filter(d => d.draft_id !== draftId));

    try {
      await deleteDraft(draftId);
    } catch (error) {
      console.error('Error deleting draft:', error);
      // If the API call fails, re-sync with server to restore the item
      fetchOpenDrafts().then(setDrafts);
    }
  }, []);

  useEffect(() => {
    fetchOpenDrafts()
      .then(setDrafts)
      .catch(error => console.error('Error fetching open drafts:', error))
      .finally(() => setLoading(false));
    fetchCurrentUser()
      .then(user => {
        setIsGuest(user.is_guest);
        setCurrentUserId(user.user_id);
      })
      .catch(() => {
        setIsGuest(null);
        setCurrentUserId(null);
      });
  }, []);

  const filteredDrafts = useMemo(() => {
    const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000);
    return drafts.filter(draft => {
      if (!draft.created_at) return true;
      return new Date(draft.created_at) > sixHoursAgo;
    });
  }, [drafts]);

  const columns = useMemo<ColumnDef<DraftLobby>[]>(() => [
    {
      header: 'Draft Name',
      accessorKey: 'draft_name',
    },
    {
      header: 'Created',
      accessorKey: 'created_at',
      cell: info => getTimeAgo(info.getValue<string>()),
      enableColumnFilter: false,
    },
    {
      header: 'Password',
      accessorKey: 'has_password',
      cell: info => (info.getValue<boolean>() ? '🔒' : '🔓'),
      enableColumnFilter: false,
    },
    {
      header: 'Ranked',
      accessorKey: 'ranked',
      cell: info => (info.getValue<boolean>() ? '✓' : '✗'),
      enableColumnFilter: false,
    },
    {
      header: 'Format',
      id: 'format',
      cell: info => {
        const type = info.row.original.draft_type || 'auction';
        return type === '1v1' ? '1v1' : 'Auction';
      },
    },
    {
      header: 'Teams',
      id: 'teams',
      cell: info => `${info.row.original.teams_joined}/${info.row.original.total_teams}`,
    },
    {
      header: 'Status',
      id: 'status',
      cell: info => formatDraftState(info.row.original.draft_state),
    },
    {
      header: 'Join',
      id: 'join',
      cell: info => {
        const ranked = info.row.original.ranked;
        const disableJoin = ranked && isGuest;
        const isCreator = info.row.original.host === currentUserId;

        const is1v1 = info.row.original.draft_type === '1v1';
        const joinTarget = is1v1 ? `/Draft1v1?${info.row.original.draft_id}` : `/Auction?${info.row.original.draft_id}`;

        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Link
              className={`button lobby-viewer-join-button${disableJoin ? ' disabled' : ''}`}
              to={disableJoin ? '#' : joinTarget}
              tabIndex={disableJoin ? -1 : 0}
              aria-disabled={disableJoin ? 'true' : undefined}
              onClick={e => {
                if (disableJoin) e.preventDefault();
              }}
              style={disableJoin ? { pointerEvents: 'none', opacity: 0.5 } : {}}
            >
              Join
            </Link>
            {isCreator && (
              <button
                className="lobby-viewer-delete-button"
                onClick={() => handleDeleteLobby(info.row.original.draft_id)}
                title="Delete Lobby"
              >
                <FaTrash />
              </button>
            )}
          </div>
        );
      },
      enableSorting: false,
    },
  ], [isGuest, currentUserId, handleDeleteLobby]);

  const table = useReactTable({
    data: filteredDrafts,
    columns,
    state: { sorting, columnFilters },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
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
                      <th
                        key={header.id}
                        style={{ width: header.id !== 'draft_name' ? '12%' : undefined }}
                      >
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
                              style={{ width: header.id === 'draft_name' ? '66.6%' : undefined }}
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
                    <td colSpan={7} className="lobby-viewer-empty">
                      No active drafts found.
                    </td>
                  </tr>
                )}
                {table.getRowModel().rows.map(row => (
                  <tr key={row.id}>
                    {row.getVisibleCells().map(cell => (
                      <td
                        key={cell.id}
                        data-label={cell.column.columnDef.header as string}
                        style={{ width: cell.column.id !== 'draft_name' ? '12%' : undefined }}
                      >
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
    </div>
  );
};

export default LobbyViewer;
