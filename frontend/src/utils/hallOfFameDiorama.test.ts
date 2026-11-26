import type { HallOfFamePokemon } from '../types';
import {
  buildDioramaSlots,
  getDioramaImageNames,
  getDioramaImageSources,
  getDioramaSlotStyle,
} from './hallOfFameDiorama';

const team = (names: string[]): HallOfFamePokemon[] =>
  names.map((name) => ({ name, icon: name.toLowerCase() }));

describe('buildDioramaSlots', () => {
  it('lines a six-pokemon team up evenly on either side of the trophy', () => {
    const { left, right } = buildDioramaSlots(
      team(['Ribombee', 'Luxray', 'Feraligatr', 'Chesnaught', 'Arcanine', 'Perrserker']),
    );

    expect(left.map((slot) => [slot.pokemon.name, slot.depth])).toEqual([
      ['Ribombee', 2],
      ['Luxray', 1],
      ['Feraligatr', 0],
    ]);
    expect(right.map((slot) => [slot.pokemon.name, slot.depth])).toEqual([
      ['Chesnaught', 0],
      ['Arcanine', 1],
      ['Perrserker', 2],
    ]);
  });

  it('keeps the pokemon beside the trophy in the foreground', () => {
    const { left, right } = buildDioramaSlots(team(['A', 'B', 'C', 'D', 'E', 'F']));

    expect(left[0].depth).toBeGreaterThan(left[left.length - 1].depth);
    expect(right[0].depth).toBeLessThan(right[right.length - 1].depth);
  });

  it('handles short and odd-sized teams without crashing', () => {
    expect(buildDioramaSlots([])).toEqual({ left: [], right: [] });

    const { left, right } = buildDioramaSlots(team(['A', 'B', 'C']));
    expect(left.map((slot) => slot.pokemon.name)).toEqual(['A']);
    expect(right.map((slot) => slot.pokemon.name)).toEqual(['B', 'C']);
  });
});

describe('getDioramaSlotStyle', () => {
  it('raises and shrinks background pokemon while keeping them behind foreground ones', () => {
    const { left } = buildDioramaSlots(team(['A', 'B', 'C', 'D', 'E', 'F']));
    const background = getDioramaSlotStyle(left[0]);
    const foreground = getDioramaSlotStyle(left[2]);

    expect(background.transform).toBe('translateY(-24px) scale(0.92)');
    expect(foreground.transform).toBe('translateY(0px) scale(1)');
    expect(Number(background.zIndex)).toBeLessThan(Number(foreground.zIndex));
  });

  it('caps the vertical offset for unusually deep lineups', () => {
    const style = getDioramaSlotStyle({
      pokemon: { name: 'A', icon: 'a' },
      side: 'right',
      depth: 99,
    });

    expect(style.transform).toBe('translateY(-60px) scale(0.8)');
  });
});

describe('getDioramaImageNames', () => {
  it('uses the PascalCase sprite names already in the folders', () => {
    expect(getDioramaImageNames('Ribombee')[0]).toBe('Ribombee');
    expect(getDioramaImageNames('Mr. Mime')[0]).toBe('Mr. Mime');
    expect(getDioramaImageNames('Mime Jr.')[0]).toBe('Mime Jr');
  });

  it('converts database and ROM mega names into the evolution sprite name', () => {
    expect(getDioramaImageNames('Mega Charizard X')[0]).toBe('Charizard X-Mega');
    expect(getDioramaImageNames('Charizard-Mega_Y')[0]).toBe('Charizard-Mega_Y');
    expect(getDioramaImageNames('Charizard-Mega_X')).toContain('Charizard X-Mega');
    expect(getDioramaImageNames('Mega Ampharos')[0]).toBe('Ampharos-Mega');
  });

  it('offers the base form when a form-specific sprite may be missing', () => {
    expect(getDioramaImageNames('Vulpix-Alola')).toEqual([
      'Vulpix-Alola',
      'Vulpix',
    ]);
  });

  it('finds a regional evolution sprite when only that form ships one', () => {
    expect(getDioramaImageNames('Perrserker')).toContain('Perrserker-Galar');
  });
});

describe('getDioramaImageSources', () => {
  it('prefers full sprites from evolutions, then baseforms, then the mini icon', () => {
    const sources = getDioramaImageSources('Ribombee');

    expect(sources.slice(0, 2)).toEqual([
      '/evolutions/Ribombee.png',
      '/baseforms/Ribombee.png',
    ]);
    expect(sources.slice(-2)).toEqual([
      '/MiniIcons/ribombee.png',
      '/MiniIcons/question.png',
    ]);
  });

  it('finds form-specific evolution sprites first', () => {
    const sources = getDioramaImageSources('Perrserker-Galar');

    expect(sources[0]).toBe('/evolutions/Perrserker-Galar.png');
    expect(sources).toContain('/baseforms/Perrserker.png');
    expect(getDioramaImageSources('Perrserker')).toContain(
      '/evolutions/Perrserker-Galar.png',
    );
  });

  it('uses the baseform folder for pokemon that do not evolve', () => {
    const sources = getDioramaImageSources('Vulpix-Alola');

    expect(sources[0]).toBe('/baseforms/Vulpix.png');
    expect(sources).toContain('/evolutions/Vulpix-Alola.png');
  });

  it('encodes spaces in sprite URLs such as mega forms', () => {
    expect(getDioramaImageSources('Mega Charizard X')[0]).toBe(
      '/evolutions/Charizard%20X-Mega.png',
    );
  });

  it('resolves irregular species names and forms to their exact full sprite', () => {
    expect(getDioramaImageSources('Basculegion-M')[0]).toBe(
      '/evolutions/Basculegion-Male.png',
    );
    expect(getDioramaImageSources('Flabébé-Red')[0]).toBe(
      '/baseforms/Flabebe.png',
    );
    expect(getDioramaImageSources('Kommo-o')[0]).toBe(
      '/evolutions/Kommo-o.png',
    );
    expect(getDioramaImageSources('Plusle and Minun')[0]).toBe(
      '/baseforms/Plusle%20and%20Minun.png',
    );
  });

  it('uses the stored icon for the mini-sprite fallback when the name is unknown', () => {
    const sources = getDioramaImageSources('Nickname', 'nidorina');

    expect(sources).toContain('/MiniIcons/nidorina.png');
    expect(sources[sources.length - 1]).toBe('/MiniIcons/question.png');
  });

  it('falls back to the question icon for empty names', () => {
    expect(getDioramaImageSources('')).toEqual(['/MiniIcons/question.png']);
    expect(getDioramaImageSources('???')).toEqual(['/MiniIcons/question.png']);
  });
});
