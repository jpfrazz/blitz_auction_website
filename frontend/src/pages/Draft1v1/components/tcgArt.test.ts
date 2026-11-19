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

test('uses regional keys for regional forms', () => {
  expect(getTcgArt({ id: 194, name: 'Wooper', form: 'Paldea' } as Pokemon, 0)).toMatch(/\/599\/73\.png$/);
  expect(getTcgArt({ id: 980, name: 'Clodsire', form: 'Paldea' } as Pokemon, 0)).toMatch(/\/599\/74\.png$/);
  expect(getTcgArt({ id: 100, name: 'Voltorb', form: 'Hisui' } as Pokemon, 0)).toBe('/tcgArt/hisuian-voltorb.jpg');
  expect(getTcgArt({ id: 37, name: 'Vulpix', form: 'Alola' } as Pokemon, 0)).toMatch(/\/594\/55\.png$/);
  expect(getTcgArt({ id: 52, name: 'Meowth', form: 'Galar' } as Pokemon, 0)).toMatch(/\/594\/334\.png$/);
  expect(getTcgArt({ id: 263, name: 'Zigzagoon', form: 'Galar' } as Pokemon, 0)).toBe(
    'https://s3.pokeos.com/pokeos-uploads/tcg/textless/583/95.png',
  );
  // The base key points at the Hoenn Zigzagoon art, not the Galarian card.
  expect(getTcgArt({ id: 263, name: 'Zigzagoon' } as Pokemon, 0)).toBe(
    'https://s3.pokeos.com/pokeos-uploads/tcg/textless/495/188.png',
  );
  // PokeOS has no textless Galarian Slowpoke or Galarian Farfetch'd art, so these are local.
  expect(getTcgArt({ id: 79, name: 'Slowpoke', form: 'Galar' } as Pokemon, 0)).toBe('/tcgArt/galarian-slowpoke.png');
  expect(getTcgArt({ id: 83, name: "Farfetch'd" } as Pokemon, 0)).toMatch(/\/546\/359\.png$/);
  expect(getTcgArt({ id: 83, name: "Farfetch'd", form: 'Galar' } as Pokemon, 0)).toBe('/tcgArt/galarian-farfetchd.jpg');
});

test('uses locally hosted art over the PokeOS catalog', () => {
  // PokeOS has no textless Nincada art, so this is a local art-only crop of Roaring Skies 9.
  expect(getTcgArt({ id: 290, name: 'Nincada' } as Pokemon, 0)).toBe('/tcgArt/nincada.webp');
  expect(getTcgArt({ id: 290, name: 'Nincada' } as Pokemon, 7)).toBe('/tcgArt/nincada.webp');
  expect(getTcgArt({ id: 322, name: 'Numel' } as Pokemon, 0)).toBe('/tcgArt/numel.png');
  expect(getTcgArt({ id: 926, name: 'Fidough' } as Pokemon, 0)).toBe('/tcgArt/fidough.jpg');
  expect(getTcgArt({ id: 577, name: 'Solosis' } as Pokemon, 0)).toBe('/tcgArt/solosis.jpg');
  expect(getTcgArt({ id: 824, name: 'Blipbug' } as Pokemon, 0)).toBe('/tcgArt/blipbug.jpg');
  expect(getTcgArt({ id: 234, name: 'Stantler' } as Pokemon, 0)).toBe('/tcgArt/stantler.jpg');
  expect(getTcgArt({ id: 653, name: 'Fennekin' } as Pokemon, 0)).toBe('/tcgArt/fennekin.jpg');
  expect(getTcgArt({ id: 433, name: 'Chingling' } as Pokemon, 0)).toBe('/tcgArt/Chingling.png');
  expect(getTcgArt({ id: 65536, name: 'Egg' } as Pokemon, 0)).toBe('/tcgArt/Egg.png');
});

test('uses the combined Plusle and Minun artwork for the paired Pokemon', () => {
  for (let seed = 0; seed < 20; seed += 1) {
    expect(getTcgArt({ id: 311, name: 'Plusle and Minun' } as Pokemon, seed)).toBe(
      '/tcgArt/Plusle and Minun.jpg',
    );
  }
});

test('does not use the flagged too-small artworks', () => {
  const flagged: Array<[string, number, string]> = [
    ['Poochyena', 261, '/583/171.png'],
    ['Purrloin', 509, '/569/174.png'],
    ['Stantler', 234, '/602/10.png'],
    ['Cyndaquil', 155, '/603/5.png'],
    ['Oshawott', 501, '/603/15.png'],
    ['Pancham', 674, '/495/243.png'],
  ];
  for (const [name, id, oldPath] of flagged) {
    for (let seed = 0; seed < 25; seed++) {
      const art = getTcgArt({ id, name } as Pokemon, seed);
      expect(art).toBeDefined();
      expect(art).not.toContain(oldPath);
    }
  }
});