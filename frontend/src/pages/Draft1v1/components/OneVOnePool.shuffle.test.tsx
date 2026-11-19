import React from 'react';
import { render, screen } from '@testing-library/react';
import OneVOnePool from './OneVOnePool';

const slot = (pokedex_id: number, name: string, form?: string) => ({
  pokemon: { id: pokedex_id, pokedex_id, name, ...(form ? { form } : {}) },
  status: 'Available' as const,
  avg_price: 0,
});

afterEach(() => localStorage.removeItem('eb-1v1-pokemon-art'));

test('renders Shuffle icons, form-specific art, and fallback art in Shuffle Icons mode', () => {
  localStorage.setItem('eb-1v1-pokemon-art', 'shuffle');
  render(
    <OneVOnePool
      pool={[
        slot(25, 'Pikachu'),
        slot(263, 'Zigzagoon', 'Galar'),
        slot(37, 'Vulpix', 'Alola'),
        slot(824, 'Blipbug'),
        slot(65536, 'Egg'),
      ]}
      history={[]}
      isActive={false}
      onSelect={() => {}}
      tileSize={80}
    />,
  );

  expect(screen.getByAltText('Pikachu').getAttribute('src')).toBe(
    '/Pokemon%20Shuffle%20Icons/Shuffle025.png',
  );
  expect(screen.getByAltText('Zigzagoon (Galar)').getAttribute('src')).toBe(
    '/Pokemon%20Shuffle%20Icons/G%20-%20Zigzagoon.png',
  );
  expect(screen.getByAltText('Vulpix (Alola)').getAttribute('src')).toBe(
    '/Pokemon%20Shuffle%20Icons/Shuffle037A.png',
  );
  expect(screen.getByAltText('Blipbug').getAttribute('src')).toBe(
    '/Pokemon%20Shuffle%20Icons/Blipbug.png',
  );
  expect(screen.getByAltText('Egg').getAttribute('src')).toBe('/baseforms/Egg.png');

  expect(screen.getByText('Shuffle icon credits')).toBeTruthy();
  expect(screen.getByText('Official Games').tagName).toBe('STRONG');
  expect(screen.getByText('Haunted Cactus').tagName).toBe('STRONG');
  expect(screen.getByText('Loran-Hemlock').tagName).toBe('STRONG');
});

test('leaves standard art alone outside Shuffle Icons mode', () => {
  localStorage.setItem('eb-1v1-pokemon-art', 'standard');
  render(
    <OneVOnePool
      pool={[slot(25, 'Pikachu')]}
      history={[]}
      isActive={false}
      onSelect={() => {}}
      tileSize={80}
    />,
  );

  expect(screen.getByAltText('Pikachu').getAttribute('src')).toBe('/baseforms/Pikachu.png');
  expect(screen.queryByText('Shuffle icon credits')).toBeNull();
});
