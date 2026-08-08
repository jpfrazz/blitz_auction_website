import { SPECIES_BY_ID } from './speciesIdMap';

// Species identity resolution backed by the ROM's species.h (blitz files/species.h).
//
// The GBA save file stores the ROM species enum id, not the national dex number.
// SPECIES_BY_ID is the ground truth for what a species id refers to (including
// regional forms, megas, etc.), so lookups here are reliable even for nicknamed
// Pokemon and for species the database doesn't cover.

// Reverse index of species display name -> icon, built from SPECIES_BY_ID.
// Name-based lookups (which only have a name, e.g. stored Hall of Fame teams)
// resolve to the same icon the ROM species id would, including regional forms
// that reuse a base species icon (e.g. Vulpix-Alola -> vulpix), without the
// risk of a national dex number colliding with a ROM form/mega id.
const ICON_BY_NAME: Record<string, string> = {};
{
  const ids = Object.keys(SPECIES_BY_ID).map(Number).sort((a, b) => a - b);
  for (const id of ids) {
    const info = SPECIES_BY_ID[id];
    if (!info || info.name === 'Egg') continue;
    const key = info.name.toLowerCase();
    if (!(key in ICON_BY_NAME)) ICON_BY_NAME[key] = info.icon;

    // Index mega forms under their database-style names too ("Mega Ampharos",
    // "Mega Charizard X", "Charizard-Mega_X") so they resolve to the same ROM
    // icon file ("ampharos-mega", "charizard-mega-x").
    const megaMatch = key.match(/^(.+)-mega(?:-(x|y|z))?$/);
    if (megaMatch) {
      const core = megaMatch[1].replace(/-/g, ' ');
      const variant = megaMatch[2];
      if (variant) {
        const alt = `mega ${core} ${variant}`;
        if (!(alt in ICON_BY_NAME)) ICON_BY_NAME[alt] = info.icon;
      }
      const alt = `mega ${core}`;
      if (!(alt in ICON_BY_NAME)) ICON_BY_NAME[alt] = info.icon;
    }
  }
}

/**
 * Normalize a mega display name to the alternate name indexed in ICON_BY_NAME.
 * Handles the database naming ("Mega Ampharos", "Mega Charizard X",
 * "Charizard-Mega_X") that differs from the ROM naming ("Ampharos-Mega").
 */
const megaNameKey = (n: string): string | null => {
  if (n.startsWith('mega ')) {
    const parts = n.slice(5).trim().replace(/[^a-z0-9]/g, ' ').trim().split(/\s+/);
    if (!parts.length || !parts[0]) return null;
    return `mega ${parts.slice(0, 2).join(' ')}`;
  }
  const m = n.match(/^([a-z0-9]+)-mega(?:[ _-]?(x|y|z))?$/);
  if (m) {
    return m[2] ? `mega ${m[1]} ${m[2]}` : `mega ${m[1]}`;
  }
  return null;
};

/**
 * Resolve the MiniIcons file base name for a species id.
 * Falls back to the legacy name-based resolution when no id is provided.
 */
export const getIconName = (name: string, speciesId?: number) => {
  if (!name || name === '???') return 'egg';
  const n = name.toLowerCase();
  if (n.startsWith('egg')) return 'egg';

  if (speciesId != null) {
    const info = SPECIES_BY_ID[speciesId];
    if (info?.icon) return info.icon;
  }

  const byName = ICON_BY_NAME[n];
  if (byName) return byName;

  // Mega forms are stored under database-style names ("Mega Ampharos",
  // "Charizard-Mega_X") while their icon files use the ROM naming
  // ("ampharos-mega"), so resolve via the alternate index above.
  const megaKey = megaNameKey(n);
  if (megaKey) {
    const byMega = ICON_BY_NAME[megaKey];
    if (byMega) return byMega;
  }

  // Special handling for specific Pokemon with non-standard names
  if (n.includes('plusle')) return 'plusle';
  if (n.includes('minun')) return 'minun';
  if (n.includes('deerling')) return 'deerling';
  if (n.includes('mime jr')) return 'mime jr';
  if (n.includes('mime.')) return 'mime jr';

  // Fallback: handle by species ID if name lookup failed
  if (n.startsWith('id') && speciesId) {
    if (speciesId === 312) return 'minun';
    if (speciesId === 311) return 'plusle';
    if (speciesId === 1094 || speciesId === 1095 || speciesId === 1096 || speciesId === 1097) return 'deerling';
    if (speciesId === 439) return 'mime jr';
  }

  return n.replace(/é/g, 'e').replace(/[^a-z0-9- .]/g, '');
};

/**
 * Determine whether a save-file nickname is a real player-given nickname.
 *
 * Un-nicknamed Pokemon store the species name (or its base form's name) in the
 * nickname field, and long species names are truncated to 10 chars. So we treat
 * the mon as un-nicknamed when the nickname equals the species name or is a
 * prefix of it (e.g. "Sandshrew" for Sandshrew-Alola, "Mega Venus" truncation).
 */
export const isActuallyNicknamed = (
  nickname: string | undefined,
  speciesId: number,
  realName: string
): boolean => {
  if (!nickname) return false;
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const nickN = norm(nickname);
  const realN = norm(realName);
  if (!nickN || nickN === realN) return false;
  if (realN.startsWith(nickN)) return false;
  return true;
};

/**
 * Factory for a species metadata resolver. The returned function resolves a
 * ROM species id (+ optional nickname) to display metadata, preferring the
 * ROM species map for identity and the database for abilities/types when the
 * species maps cleanly to a national dex number.
 */
export const createResolveMetadata = (
  pokemonById: Map<number, any[]>,
  pokemonMetadata: Record<string, any>
) => {
  return (speciesId: number, nickname?: string): any => {
    const info = SPECIES_BY_ID[speciesId];

    // Egg
    if (info?.name === 'Egg') {
      return { name: 'Egg', abilities: ['Unknown'] };
    }

    // Plusle and Minun share a combined database entry at dex 311
    if (speciesId === 311 || speciesId === 312) {
      const combinedEntry = pokemonById.get(311)?.[0];
      if (combinedEntry) {
        const isMinun = speciesId === 312;
        return {
          ...combinedEntry,
          name: isMinun ? 'Minun' : 'Plusle',
          pokedex_id: speciesId,
          ability1: isMinun ? 'Minus' : 'Plus',
          ability2: isMinun ? 'Plus' : 'Minus',
        };
      }
    }

    let data: any = null;

    // The database is keyed by national dex number, which only matches the ROM
    // id for standard species (1-905) or a form whose base is a standard species.
    // Never do pokemonById.get(romId) for romId > 905: those ids can collide
    // with national dex numbers (e.g. ROM 959 = Sandshrew-Alola, dex 959 = Tinkaton).
    const lookupId = info?.baseId ?? speciesId;
    const dbSafe = info ? info.baseId <= 905 : speciesId <= 905;
    if (dbSafe) {
      const candidates = pokemonById.get(lookupId);
      if (candidates) {
        if (info?.form) {
          data = candidates.find(
            (p) => (p.form || '').toLowerCase() === info.form.toLowerCase()
          );
        }
        if (!data) {
          // Fall back to the base-form database entry (or the only candidate)
          data = candidates.find((p) => !p.form) ?? candidates[0];
        }
      }
    }

    // Legacy name-based fallback for species ids the ROM map doesn't cover
    if (!data && !info && nickname) {
      const searchName = nickname.toLowerCase();
      data = pokemonMetadata[searchName]
        ?? pokemonMetadata[searchName.normalize('NFD').replace(/[\u0300-\u036f]/g, '')];
      if (!data) {
        data = Object.values(pokemonMetadata).find(
          (p) => p.name?.toLowerCase().startsWith(searchName)
        );
      }
    }

    // No database metadata -> synthesize from the ROM species map so the name
    // and icon stay correct even when abilities are unknown.
    if (!data && info) {
      data = { ...info, abilities: ['Unknown'], pokedex_id: speciesId };
    }

    return data;
  };
};
