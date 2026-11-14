import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import OneVOnePool, { maxTileSize } from './OneVOnePool';

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