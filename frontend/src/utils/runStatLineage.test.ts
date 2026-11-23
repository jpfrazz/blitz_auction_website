import type { Pokemon } from '../types';
import { buildRunStatLineage } from './runStatLineage';

const mon = (
  pokedex_id: number,
  name: string,
  form = '',
  evolves_from_id?: string,
  evolves_from_form?: string
): Pokemon => ({
  id: pokedex_id,
  pokedex_id,
  name,
  form,
  evolves_from_id,
  evolves_from_form,
});

// The subset of /api/pokemon relevant to the reported race.
const catalog: Pokemon[] = [
  mon(194, 'Wooper', 'Paldea'),
  mon(226, 'Mantine', '', '458'),
  mon(285, 'Shroomish'),
  mon(412, 'Burmy'),
  mon(413, 'Wormadam', 'Plant', '412'),
  mon(413, 'Wormadam', 'Sandy', '412'),
  mon(413, 'Wormadam', 'Trash', '412'),
  mon(479, 'Rotom'),
  mon(286, 'Breloom', '', '285'),
  mon(290, 'Nincada'),
  mon(291, 'Ninjask', '', '290'),
  mon(292, 'Shedinja', '', '290'),
  mon(222, 'Corsola'),
  mon(222, 'Corsola', 'Galar', '222'),
  mon(864, 'Cursola', '', '222', 'Galar'),
  mon(331, 'Cacnea'),
  mon(332, 'Cacturne', '', '331'),
  mon(458, 'Mantyke'),
  mon(587, 'Emolga'),
  mon(688, 'Binacle'),
  mon(689, 'Barbaracle', '', '688'),
  mon(742, 'Cutiefly'),
  mon(743, 'Ribombee', '', '742'),
  mon(679, 'Honedge'),
  mon(680, 'Doublade', '', '679'),
  mon(681, 'Aegislash-Shield', 'Shield', '680'),
  mon(681, 'Aegislash-Blade', 'Blade', '680'),
  mon(980, 'Clodsire', 'Paldea', '194', 'Paldea'),
];

const lineage = buildRunStatLineage(catalog);

describe('run stat evolution lineage', () => {
  it.each([
    [286, 'shroomish'], // Shroomish -> Breloom
    [1371, 'wooper'], // Wooper (Paldea) -> Clodsire (ROM id differs from dex id)
    [743, 'cutiefly'], // Cutiefly -> Ribombee
    [291, 'nincada'], // Nincada -> Ninjask
    [292, 'nincada'], // Nincada -> Shedinja
    [226, 'mantyke'], // Mantyke -> Mantine (parent is NOT the previous dex number)
    [689, 'binacle'], // Binacle -> Barbaracle
    [332, 'cacnea'], // Cacnea -> Cacturne
  ])('attributes evolved ROM species %i to drafted icon %s', (romId, icon) => {
    expect(lineage.getIcons(romId)).toContain(icon);
  });

  it('keeps the evolved species icon itself so drafting the evolution still matches', () => {
    expect(lineage.getIcons(286)).toContain('breloom');
    expect(lineage.getIcons(743)).toContain('ribombee');
    expect(lineage.getIcons(292)).toContain('shedinja');
  });

  it('leaves a non-evolving Pokemon on its own icon', () => {
    expect(lineage.getIcons(587)).toEqual(['emolga']);
  });

  it('handles a two-step line', () => {
    expect(lineage.getIcons(286)).toEqual(['breloom', 'shroomish']);
  });

  it('falls back to Nincada when Shedinja has no recorded parent', () => {
    const withoutShedinjaParent = buildRunStatLineage(
      catalog.map((p) =>
        p.pokedex_id === 292 ? { ...p, evolves_from_id: undefined } : p
      )
    );
    expect(withoutShedinjaParent.getIcons(292)).toContain('nincada');
  });

  it('shares stats across Burmy and Wormadam cloak forms', () => {
    // Burmy Binder can change the cloak without changing the drafted mon.
    expect(lineage.getIcons(1057)).toEqual(expect.arrayContaining(['burmy', 'burmy-sandy', 'burmy-trash']));
    expect(lineage.getIcons(413)).toEqual(expect.arrayContaining([
      'burmy',
      'wormadam-plant',
      'wormadam-sandy',
      'wormadam-trash',
    ]));
    expect(lineage.getIcons(1059)).toEqual(expect.arrayContaining([
      'burmy',
      'wormadam-plant',
      'wormadam-sandy',
      'wormadam-trash',
    ]));
  });

  it('shares stats across Rotom Catalog forms', () => {
    const rotomIcons = lineage.getIcons(1065);
    expect(rotomIcons).toEqual(expect.arrayContaining([
      'rotom',
      'rotom-heat',
      'rotom-wash',
      'rotom-frost',
      'rotom-fan',
      'rotom-mow',
    ]));
  });

  it('maps both Aegislash forms back through Doublade to Honedge', () => {
    const expected = ['aegislash', 'aegislash-blade', 'doublade', 'honedge'];
    expect(lineage.getIcons(681)).toEqual(expect.arrayContaining(expected));
    expect(lineage.getIcons(1156)).toEqual(expect.arrayContaining(expected));
  });

  it('shares stats across the Corsola -> Corsola-Galar -> Cursola line', () => {
    const expected = ['corsola', 'corsola-galar', 'cursola'];
    expect(lineage.getIcons(222)).toEqual(expect.arrayContaining(expected));
    expect(lineage.getIcons(986)).toEqual(expect.arrayContaining(expected));
    expect(lineage.getIcons(864)).toEqual(expect.arrayContaining(expected));
  });

  it('returns no icons for an unknown species so the caller can fall back', () => {
    expect(lineage.getIcons(99999)).toEqual([]);
  });
});
