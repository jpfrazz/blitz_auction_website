import { getMysteryDungeonPortrait } from './mysteryDungeonArt';
import { Pokemon } from '../../../types';

type Metadata = Parameters<typeof getMysteryDungeonPortrait>[1];

const emptyMetadata = { tracker: {}, names: new Map<string, string>() } as Metadata;
const egg = { id: 1573, pokedex_id: 1573, name: 'Egg' } as Pokemon;

test('uses the local egg art for the egg in Mystery Dungeon mode', () => {
  expect(getMysteryDungeonPortrait(egg, emptyMetadata)?.url).toBe('/1v1/egg_icon.webp');
  expect(getMysteryDungeonPortrait(egg, emptyMetadata, true)?.url).toBe('/1v1/egg_icon_dizzy.webp');
});

test('leaves local egg art out of the SpriteCollab credits', () => {
  const portrait = getMysteryDungeonPortrait(egg, emptyMetadata);
  expect(portrait).toMatchObject({ credits: [], local: true });
});

test('still requires SpriteCollab metadata for regular Pokemon', () => {
  expect(getMysteryDungeonPortrait({ id: 25, pokedex_id: 25, name: 'Pikachu' } as Pokemon, emptyMetadata)).toBeNull();
});

const zigzagoonMetadata = {
  tracker: {
    '0263': {
      name: 'Zigzagoon',
      portrait_files: { Normal: true },
      portrait_credit: { primary: 'CHUNSOFT', secondary: [] },
      subgroups: {
        '0000': {
          name: '',
          portrait_files: { Normal: true },
          portrait_credit: { primary: 'CHUNSOFT', secondary: [] },
          subgroups: {},
        },
        '0001': {
          name: 'Galar',
          portrait_files: { Normal: true },
          portrait_credit: { primary: '<@galar-artist>', secondary: [] },
          subgroups: {},
        },
      },
    },
  },
  names: new Map([['<@galar-artist>', 'Galar Artist']]),
} as Metadata;

test('uses the regional subgroup portrait for a regional form', () => {
  const galarian = getMysteryDungeonPortrait(
    { id: 263, pokedex_id: 263, name: 'Zigzagoon', form: 'Galar' } as Pokemon,
    zigzagoonMetadata,
  );
  expect(galarian?.url).toBe(
    'https://raw.githubusercontent.com/PMDCollab/SpriteCollab/master/portrait/0263/0001/Normal.png',
  );
  expect(galarian?.credits).toEqual(['Galar Artist']);
});

test('uses the base portrait for a Pokemon without a form', () => {
  const base = getMysteryDungeonPortrait({ id: 263, pokedex_id: 263, name: 'Zigzagoon' } as Pokemon, zigzagoonMetadata);
  expect(base?.url).toBe(
    'https://raw.githubusercontent.com/PMDCollab/SpriteCollab/master/portrait/0263/Normal.png',
  );
});
