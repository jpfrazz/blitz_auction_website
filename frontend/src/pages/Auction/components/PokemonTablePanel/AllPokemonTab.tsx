
import React, { useEffect, useState, useMemo } from 'react';
import { Pokemon, Auction } from '../../../../types';
import { getUserLabel } from '../../../../shared/utils/user';
import './AllPokemonTab.scss';
import CurrentPokemonPanel from '../CurrentPokemonPanel';
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

const getTypeIconSrc = (type: string) => {
  const formattedType = type.charAt(0).toUpperCase() + type.slice(1).toLowerCase();
  return `/TypeIcons/${formattedType}IC_SV.png`;
};

const AllPokemonTab: React.FC<AllPokemonTabProps> = ({ pokemon, auctions }) => {
  const [selectedPokemon, setSelectedPokemon] = useState<Pokemon | null>(null);
  const allPokemon = useMemo(() => pokemon, [pokemon]);

  // Add auction info to each row for table use
  const data = useMemo(() =>
    pokemon
      .filter((p: any) => p.stage === 'base')
      .map(p => {
        const pokedexId = p.pokedex_id ?? p.id;
        const auction = auctions.find(a => a.pokemon.pokedex_id === pokedexId);
        const hp = p.stats?.hp ?? 0;
        const attack = p.stats?.attack ?? 0;
        const defense = p.stats?.defense ?? 0;
        const specialAttack = p.stats?.sp_attack ?? p.stats?.specialAttack ?? 0;
        const specialDefense = p.stats?.sp_defense ?? p.stats?.specialDefense ?? 0;
        const speed = p.stats?.speed ?? 0;
        const baseStatTotal = hp + attack + defense + specialAttack + specialDefense + speed;
        const ability = (p as any).ability || [(p as any).ability1, (p as any).ability2, (p as any).hidden_ability].filter(Boolean).join('/');
        return {
          ...p,
          hp,
          attack,
          defense,
          specialAttack,
          specialDefense,
          speed,
          baseStatTotal,
          ability,
          cost: auction ? Number(auction.highest_bid) : undefined,
          draftedBy: auction ? getUserLabel(auction.highest_bidder) : '',
        };
      }),
    [pokemon, auctions]
  );

  // Helper to get all new types from evolutions (excluding Mega forms)
  const getEvolutionTypes = (basePokemon: any) => {
    const baseTypes = new Set([
      basePokemon.type1?.toLowerCase(),
      basePokemon.type2?.toLowerCase(),
    ].filter(Boolean));
    // Find all evolutions (direct and indirect, non-mega, non-base)
    const evolutions = allPokemon.filter(
      p => p.evolves_from_id?.toString() === (basePokemon.pokedex_id ?? basePokemon.id).toString() && (p.form ?? '').toLowerCase() !== 'mega'
    );
    // Recursively get types from all stages
    const seen = new Set();
    const collectTypes = (pkmn: Pokemon): string[] => {
      if (!pkmn || seen.has(pkmn.pokedex_id + ':' + (pkmn.form ?? ''))) return [];
      seen.add(pkmn.pokedex_id + ':' + (pkmn.form ?? ''));
      let types: string[] = [];
      if (pkmn.type1) types.push(pkmn.type1.toLowerCase());
      if (pkmn.type2) types.push(pkmn.type2.toLowerCase());
      // Find further evolutions
      const nextEvos = allPokemon.filter(
        p => p.evolves_from_id?.toString() === (pkmn.pokedex_id ?? pkmn.id).toString() && (p.form ?? '').toLowerCase() !== 'mega'
      );
      for (const evo of nextEvos) {
        types = types.concat(collectTypes(evo));
      }
      return types;
    };
    const evoTypeSet = new Set<string>();
    evolutions.forEach(evo => {
      collectTypes(evo).forEach(type => evoTypeSet.add(type));
    });
    // Remove base types
    const uniqueNewTypes = Array.from(evoTypeSet).filter(t => !Array.from(baseTypes).includes(t));
    return uniqueNewTypes;
  };

  const columns = useMemo<ColumnDef<any, any>[]>(
    () => [
      { accessorKey: 'name', header: 'Name' },
      { accessorKey: 'ability', header: 'Ability' },
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
      {
        accessorKey: 'evolutionTypes',
        header: 'Evolution Types',
        cell: ({ row }) => {
          const evoTypes = getEvolutionTypes(row.original);
          if (!evoTypes.length) return null;
          return (
            <div className="type-icon-group">
              {evoTypes.map(type => (
                <img
                  key={type} src={getTypeIconSrc(type)} alt={type} className="type-icon-table"
                />
              ))}
            </div>
          );
        },
        filterFn: (row, columnId, filterValue) => {
          const evoTypes = getEvolutionTypes(row.original);
          const filter = (filterValue as string).toLowerCase();
          return evoTypes.some(type => type.toLowerCase().includes(filter));
        },
      },
      {
        accessorKey: 'cost',
        header: 'Cost',
        sortingFn: 'basic',
        sortUndefined: 'last',
      },
      { accessorKey: 'draftedBy', header: 'Drafted By' },
    ],
    [allPokemon]
  );

  const [sorting, setSorting] = useState<SortingState>([{ id: 'name', desc: false }]);
  const [columnFilters, setColumnFilters] = useState<any[]>([]);

  const selectedPokemonAuction = useMemo<Auction | null>(() => {
    if (!selectedPokemon) {
      return null;
    }

    return {
      auction_id: 'preview',
      draft_id: 'preview',
      draft_order: 0,
      status: 'PENDING',
      pokemon: selectedPokemon,
      highest_bid: 0,
      highest_bidder: null,
    };
  }, [selectedPokemon]);

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
    <div className="all-pokemon-container">
      <div className="all-pokemon-table-wrapper">
        <table className="all-pokemon-table">
          <thead>
            {table.getHeaderGroups().map(headerGroup => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map(header => (
                  <th
                    key={header.id}
                    colSpan={header.colSpan}
                  >
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
                        <div className="type-icon-group">
                          {type1 && (
                            <img src={getTypeIconSrc(type1)} alt={type1} className="type-icon-table" />
                          )}
                          {type2 && (
                            <img src={getTypeIconSrc(type2)} alt={type2} className="type-icon-table" />
                          )}
                        </div>
                      </td>
                    );
                  }
                  if (cell.column.id === 'name') {
                    const name = cell.getValue() as string;
                    return (
                      <td key={cell.id}>
                        <div className="pokemon-name-cell">
                          <div className="pokemon-icon-wrapper">
                            <img
                              src={`/MiniIcons/${name.toLowerCase()}.png`}
                              alt={name}
                              className="pokemon-table-img"
                              onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                            />
                          </div>
                          <button
                            className="pokemon-name-button"
                            type="button"
                            onClick={() => setSelectedPokemon(cell.row.original as Pokemon)}
                          >
                            {name}
                          </button>
                        </div>
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

      {selectedPokemonAuction && (
        <div className="all-pokemon-modal-overlay" onClick={() => setSelectedPokemon(null)}>
          <div className="all-pokemon-modal" onClick={e => e.stopPropagation()}>
            <button
              type="button"
              className="all-pokemon-modal-close"
              onClick={() => setSelectedPokemon(null)}
            >
              ×
            </button>
            <CurrentPokemonPanel current_auction={selectedPokemonAuction} all_pokemon={allPokemon} />
          </div>
        </div>
      )}
    </div>
  );
};

export default AllPokemonTab;
