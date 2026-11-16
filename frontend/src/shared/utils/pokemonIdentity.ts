// Canonical identity for stats surfaces (cost breakdown, price history, tiers,
// player profiles). Bare names that actually refer to a regional form are
// normalised here so every surface aggregates them into a single row.
export interface PokemonIdentity {
  name: string;
  form: string;
  key: string;
}

const KNOWN_FORMS = ['Alola', 'Galar', 'Hisui', 'Paldea'];

const formOverrides: Record<string, { form: string; key: string }> = {
  'Wooper': { form: 'Paldea', key: 'Wooper-Paldea' },
  'Vulpix': { form: 'Alola', key: 'Vulpix-Alola' },
  'Voltorb': { form: 'Hisui', key: 'Voltorb-Hisui' },
  "Farfetch'd": { form: 'Galar', key: "Farfetch'd-Galar" },
  'Sandshrew': { form: 'Alola', key: 'Sandshrew-Alola' },
  'Meowth': { form: 'Galar', key: 'Meowth-Galar' },
  'Slowpoke': { form: 'Galar', key: 'Slowpoke-Galar' },
  'Zigzagoon': { form: 'Galar', key: 'Zigzagoon-Galar' },
};

/**
 * Resolve a pokemon name/form pair into the identity used for aggregation.
 *
 * Handles two quirks in our data:
 * - legacy rows sometimes carry the form in the name, e.g. "Farfetch'd-Galar";
 * - entries created before form support have a bare name even though the
 *   creature in the pool is a regional form (see `formOverrides`).
 */
export function resolvePokemonIdentity(name: string, form: string): PokemonIdentity {
  let currentName = name;
  let currentForm = form;

  for (const f of KNOWN_FORMS) {
    if (currentName.endsWith(`-${f}`)) {
      currentName = currentName.slice(0, -(f.length + 1));
      currentForm = f;
      break;
    }
  }

  if ((!currentForm || currentForm === 'base') && formOverrides[currentName]) {
    return { name: currentName, ...formOverrides[currentName] };
  }

  const effectiveForm = currentForm && currentForm !== 'base' ? currentForm : '';
  const key = `${currentName}${effectiveForm ? '-' + effectiveForm : ''}`;
  return { name: currentName, form: effectiveForm, key };
}
