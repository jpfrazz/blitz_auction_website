import { getTcgArt } from './tcgArt';
import { Pokemon } from '../../../types';

const popplio = { id: 728, name: 'Popplio' } as Pokemon;

test('chooses a stable Popplio artwork for each pool seed', () => {
  const first = getTcgArt(popplio, 0);
  const second = getTcgArt(popplio, 1);
  expect(new Set([first, second])).toEqual(new Set([
    'https://s3.pokeos.com/pokeos-uploads/tcg/textless/465/45.png',
    'https://s3.pokeos.com/pokeos-uploads/tcg/textless/465/46.png',
  ]));
  expect(getTcgArt(popplio, 0)).toBe(first);
});

test('preserves single-image and missing-image behavior', () => {
  expect(getTcgArt({ id: 37, name: 'Vulpix' } as Pokemon, 0)).toMatch(/\/584\/70\.png$/);
  expect(getTcgArt({ id: 0, name: 'Unknown Pokemon' } as Pokemon, 0)).toBeUndefined();
});