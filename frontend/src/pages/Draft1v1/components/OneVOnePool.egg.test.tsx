import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import OneVOnePool from './OneVOnePool';

jest.mock('./mysteryDungeonArt', () => {
  const actual = jest.requireActual('./mysteryDungeonArt');
  return {
    ...actual,
    loadPortraitMetadata: () => Promise.resolve({ tracker: {}, names: new Map() }),
  };
});

const eggSlot = {
  pokemon: { id: 1573, pokedex_id: 1573, name: 'Egg' },
  status: 'Available' as const,
  avg_price: 0,
};

test('shows the local egg art in Mystery Dungeon mode', async () => {
  localStorage.setItem('eb-1v1-pokemon-art', 'mystery-dungeon');
  render(<OneVOnePool pool={[eggSlot]} history={[]} isActive={false} onSelect={() => {}} tileSize={80} />);

  await waitFor(() => {
    expect(screen.getByAltText('Egg').getAttribute('src')).toBe('/1v1/egg_icon.webp');
  });
  localStorage.removeItem('eb-1v1-pokemon-art');
});

test('uses standard art in Standard mode and the local TCG art in TCG mode', () => {
  localStorage.setItem('eb-1v1-pokemon-art', 'standard');
  {
    const view = render(
      <OneVOnePool pool={[eggSlot]} history={[]} isActive={false} onSelect={() => {}} tileSize={80} />,
    );
    expect(screen.getByAltText('Egg').getAttribute('src')).toBe('/baseforms/Egg.png');
    view.unmount();
  }

  localStorage.setItem('eb-1v1-pokemon-art', 'tcg');
  {
    const view = render(
      <OneVOnePool pool={[eggSlot]} history={[]} isActive={false} onSelect={() => {}} tileSize={80} />,
    );
    expect(screen.getByAltText('Egg').getAttribute('src')).toBe('/tcgArt/Egg.png');
    view.unmount();
  }

  localStorage.removeItem('eb-1v1-pokemon-art');
});
