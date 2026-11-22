import { Pokemon } from '../../types';
import { buildHallOfFameTeam, hallOfFameTeamToTexts } from './HallOfFameTeamEditor';

const pokemonList = [
  { id: 25, name: 'Pikachu' },
  { id: 133, name: 'Eevee' },
] as Pokemon[];

test('pads a stored Hall of Fame team into six editable slots', () => {
  const texts = hallOfFameTeamToTexts([{ name: 'Pikachu', icon: 'pikachu' }]);

  expect(texts).toEqual(['Pikachu', '', '', '', '', '']);
});

test('builds a submission team from non-empty slots with canonical names', () => {
  const texts = ['pikachu', '', 'Eevee', '', '', ''];

  const team = buildHallOfFameTeam(texts, pokemonList);

  expect(team.map((mon) => mon.name)).toEqual(['Pikachu', 'Eevee']);
  expect(team[0].icon).toBe('pikachu');
});

test('keeps KO counts from the stored team when rewriting the slots', () => {
  const previous = [
    { name: 'Pikachu', icon: 'pikachu', ko_count: 123 },
    { name: 'Eevee', icon: 'eevee', ko_count: 45 },
  ];
  const texts = ['Eevee', '', 'Pikachu', '', '', ''];

  const team = buildHallOfFameTeam(texts, pokemonList, previous);

  expect(team.map((mon) => [mon.name, mon.ko_count])).toEqual([
    ['Eevee', 45],
    ['Pikachu', 123],
  ]);
});
