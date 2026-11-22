import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import OneVOnePool, { maxTileSize, slotKey } from './OneVOnePool';
import { OneVOnePoolSlot } from '../../../types';

const availableSlot = (pokedexId: number, name: string): OneVOnePoolSlot => ({
  pokemon: { id: pokedexId, pokedex_id: pokedexId, name },
  status: 'Available',
  avg_price: 0,
});

test('limits tile size to fit the grid and falls back to the minimum', () => {
  expect(maxTileSize(800, 600, 32)).toBe(104);
  expect(maxTileSize(800, 100, 40)).toBe(48);
  expect(maxTileSize(800, 2000, 32)).toBe(160);
});

test('exposes a tile-size slider and applies the supplied size to the grid', () => {
  const onTileSizeChange = jest.fn();
  const { container } = render(
    <OneVOnePool pool={[]} history={[]} isActive={false} onSelect={() => {}} tileSize={80} onTileSizeChange={onTileSizeChange} />,
  );

  expect(container.querySelector('.one-v-one-pool-grid')?.getAttribute('style')).toContain('--pool-tile-size: 80px');
  fireEvent.change(screen.getByRole('slider', { name: 'Tile size' }), { target: { value: '120' } });
  expect(onTileSizeChange).toHaveBeenCalledWith(120);
});

test('omits the slider when the pool has no size callback', () => {
  render(<OneVOnePool pool={[]} history={[]} isActive={false} onSelect={() => {}} tileSize={80} />);
  expect(screen.queryByRole('slider', { name: 'Tile size' })).toBeNull();
});

test('right-click toggles a local mark without selecting the pokemon', () => {
  const slot = availableSlot(1, 'Bulbasaur');
  const onSelect = jest.fn();
  const onToggleMark = jest.fn();

  const Harness = () => {
    const [markedSlots, setMarkedSlots] = React.useState<Set<string>>(() => new Set());
    return (
      <OneVOnePool
        pool={[slot]}
        history={[]}
        isActive
        onSelect={onSelect}
        markedSlots={markedSlots}
        onToggleMark={(target) => {
          onToggleMark(target);
          const key = slotKey(target);
          setMarkedSlots((previous) => {
            const next = new Set(previous);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
          });
        }}
        tileSize={80}
      />
    );
  };

  const { container } = render(<Harness />);
  const tile = container.querySelector('.one-v-one-pool-square') as HTMLElement;

  expect(fireEvent.contextMenu(tile)).toBe(false);
  expect(onToggleMark).toHaveBeenCalledWith(slot);
  expect(onSelect).not.toHaveBeenCalled();
  expect(tile.classList.contains('marked')).toBe(true);

  fireEvent.contextMenu(tile);
  expect(tile.classList.contains('marked')).toBe(false);
});

test('never shows a mark on a pokemon that is already picked or banned', () => {
  const picked: OneVOnePoolSlot = { ...availableSlot(2, 'Ivysaur'), status: { Picked: 'P1' } };
  const banned: OneVOnePoolSlot = { ...availableSlot(3, 'Charizard'), status: { Banned: 'P2' } };
  const { container } = render(
    <OneVOnePool
      pool={[picked, banned]}
      history={[]}
      isActive={false}
      onSelect={() => {}}
      tileSize={80}
      markedSlots={new Set([slotKey(picked), slotKey(banned)])}
    />,
  );

  const tiles = Array.from(container.querySelectorAll('.one-v-one-pool-square'));
  expect(tiles.length).toBe(2);
  expect(tiles.some((tile) => tile.classList.contains('marked'))).toBe(false);
});