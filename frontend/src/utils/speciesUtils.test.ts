import { getEnemyIconName, getIconName } from './speciesUtils';

describe('getEnemyIconName', () => {
  it('keeps the regular Ninetales-Alola sprite for Glacia', () => {
    expect(getIconName('Ninetales-Alola', 962)).toBe('ninetales-alola');
    expect(getEnemyIconName('Ninetales-Alola', 962)).toBe('ninetales-alola');
    // A nickname shouldn't change the form-specific icon.
    expect(getEnemyIconName('Snowy', 962)).toBe('ninetales-alola');
  });

  it('still uses the enemies folder Ninetales for Flannery', () => {
    expect(getEnemyIconName('Ninetales', 38)).toBe('enemies/ninetales');
  });

  it('still overrides the other enemy-only lines', () => {
    expect(getEnemyIconName('Vulpix', 37)).toBe('enemies/vulpix');
    expect(getEnemyIconName('Zorua-Hisui', 1002)).toBe('enemies/zorua');
    expect(getEnemyIconName('Zoroark-Hisui', 1003)).toBe('enemies/zoroark');
  });
});
