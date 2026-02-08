
import React, { useEffect, useState, useMemo } from 'react';
import { Pokemon, Auction } from '../../../../types';
import { getUserLabel } from '../../../../shared/utils/user';
import './AllPokemonTab.scss';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  flexRender,
  SortingState,
  ColumnDef,
} from '@tanstack/react-table';

interface AllPokemonTabProps {
  pokemon: Pokemon[];
  auctions: Auction[];
}

const AllPokemonTab: React.FC<AllPokemonTabProps> = ({ pokemon, auctions }) => {
  // Add auction info to each row for table use
  const data = useMemo(() =>
    pokemon
      .filter(p => p.form === 'base')
      .map(p => {
        const auction = auctions.find(a => a.pokemon.pokedex_id === p.id);
        const hp = p.stats?.hp ?? 0;
        const attack = p.stats?.attack ?? 0;
        const defense = p.stats?.defense ?? 0;
        const specialAttack = p.stats?.specialAttack ?? 0;
        const specialDefense = p.stats?.specialDefense ?? 0;
        const speed = p.stats?.speed ?? 0;
        const baseStatTotal = hp + attack + defense + specialAttack + specialDefense + speed;
        return {
          ...p,
          hp,
          attack,
          defense,
          specialAttack,
          specialDefense,
          speed,
          baseStatTotal,
          cost: auction ? auction.highest_bid : '',
          draftedBy: auction ? getUserLabel(auction.highest_bidder) : '',
        };
      }),
    [pokemon, auctions]
  );

  const columns = useMemo<ColumnDef<any, any>[]>(
    () => [
      { accessorKey: 'name', header: 'Name' },
      {
        accessorKey: 'type1',
        header: 'Type',
        filterFn: (row, columnId, filterValue) => {
          const type1 = row.original.type1?.toLowerCase() || '';
          const type2 = row.original.type2?.toLowerCase() || '';
          const filter = (filterValue as string).toLowerCase();
          return type1.includes(filter) || type2.includes(filter);
        },
      },
      { accessorKey: 'cost', header: 'Cost' },
      { accessorKey: 'draftedBy', header: 'Drafted By' },
      { accessorKey: 'hp', header: 'HP' },
      { accessorKey: 'attack', header: 'Atk' },
      { accessorKey: 'defense', header: 'Def' },
      { accessorKey: 'specialAttack', header: 'SpA' },
      { accessorKey: 'specialDefense', header: 'SpD' },
      { accessorKey: 'speed', header: 'Spe' },
      { accessorKey: 'baseStatTotal', header: 'BST' },
    ],
    []
  );

  const [sorting, setSorting] = useState<SortingState>([{ id: 'name', desc: false }]);
  const [columnFilters, setColumnFilters] = useState<any[]>([]);

  const table = useReactTable({
    data,
    columns,
    state: { sorting, columnFilters },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    debugTable: false,
  });

  return (
    <div className="all-pokemon-table-wrapper">
      <table className="all-pokemon-table">
        <thead>
          {table.getHeaderGroups().map(headerGroup => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map(header => (
                <th key={header.id}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    {flexRender(header.column.columnDef.header, header.getContext())}
                    {header.column.getCanSort() && (
                      <span
                        onClick={header.column.getToggleSortingHandler()}
                        style={{ cursor: 'pointer', userSelect: 'none', marginLeft: 2 }}
                        tabIndex={0}
                        role="button"
                        aria-label="Toggle sort"
                      >
                          {header.column.getIsSorted() ? (
                            header.column.getIsSorted() === 'desc' ? '↓' : '↑'
                        ) : '⇅'}
                      </span>
                    )}
                  </div>
                  <div>
                    {header.column.getCanFilter() ? (
                      <input
                        type="text"
                        value={(header.column.getFilterValue() ?? '') as string}
                        onChange={e => header.column.setFilterValue(e.target.value)}
                        placeholder={`Search...`}
                        style={{ width: '90%', marginTop: 4, fontSize: '0.9em' }}
                      />
                    ) : null}
                  </div>
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map(row => (
            <tr key={row.id}>
              {row.getVisibleCells().map(cell => {
                // Render both types as pills in the 'Type' column
                if (cell.column.id === 'type1') {
                  const type1 = cell.getValue() as string;
                  const type2 = cell.row.original.type2 as string | undefined;
                  if (!type1 && !type2) return <td key={cell.id}></td>;
                  return (
                    <td key={cell.id}>
                      <span className="type-pill-group">
                        {type1 && (
                          <span className={`type-pill type-pill-${type1.toLowerCase()}`}>{type1}</span>
                        )}
                        {type2 && (
                          <span className={`type-pill type-pill-${type2.toLowerCase()}`}>{type2}</span>
                        )}
                      </span>
                    </td>
                  );
                }
                if (cell.column.id === 'name') {
                  const name = cell.getValue() as string;
                  return (
                    <td key={cell.id}>
                      <img
                        src={`/MiniIcons/${name}.png`}
                        alt={name}
                          className="pokemon-table-img"
                          onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                        />
                      <span>{name}</span>
                    </td>
                  );
                }
                if (cell.column.id === 'baseStatTotal') {
                  const bst = cell.getValue() as number;
                  const warning = bst > 430 ? 'Warning: This mon will be disobedient for the first 2 gyms.' : undefined;
                  return (
                    <td
                      key={cell.id}
                      style={bst > 430 ? { color: 'red', fontWeight: 700 } : {}}
                      title={warning}
                    >
                      {bst}
                    </td>
                  );
                }
                return (
                  <td key={cell.id}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default AllPokemonTab;
