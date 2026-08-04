#!/usr/bin/env node
// Generates frontend/src/utils/speciesIdMap.ts from the ROM's species.h.
//
// The GBA save file stores the Blitz ROM's species enum ID (see species.h),
// NOT the national dex number. This script parses species.h to build a map of
// species ID -> { name, icon, baseId, form } so the frontend can resolve any
// species (regional forms, megas, etc.) without relying on dex-number lookups.
//
// Usage: node scripts/generate_species_map.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const SPECIES_H = path.join(repoRoot, 'blitz files', 'species.h');
const MINI_ICONS_DIR = path.join(repoRoot, 'frontend', 'public', 'MiniIcons');
const OUT = path.join(repoRoot, 'frontend', 'src', 'utils', 'speciesIdMap.ts');

// ---------------------------------------------------------------------------
// Parse species.h
// ---------------------------------------------------------------------------
const src = fs.readFileSync(SPECIES_H, 'utf8');

const numeric = new Map(); // id -> canonical enum name
const aliasOf = new Map(); // enum name -> target enum name
for (const rawLine of src.split('\n')) {
  const line = rawLine.replace(/\r/g, '');
  let m = line.match(/^\s*#define\s+SPECIES_([A-Z0-9_]+)\s+(\d+)\s*$/);
  if (m) {
    const id = Number(m[2]);
    if (id > 0 && id < 5000) numeric.set(id, m[1]);
    continue;
  }
  m = line.match(/^\s*#define\s+SPECIES_([A-Z0-9_]+)\s+SPECIES_([A-Z0-9_]+)\s*$/);
  if (m) aliasOf.set(m[1], m[2]);
}

// SPECIES_EGG is defined as (SPECIES_GLIMMORA_MEGA + 1)
numeric.set(1573, 'EGG');

// Resolve an alias transitively to a numeric species id.
function resolveIdByName(name) {
  if (numericByName.has(name)) return numericByName.get(name);
  const seen = new Set();
  let cur = name;
  while (aliasOf.has(cur)) {
    if (seen.has(cur)) return undefined;
    seen.add(cur);
    cur = aliasOf.get(cur);
  }
  return numericByName.get(cur);
}

const numericByName = new Map();
for (const [id, name] of numeric) numericByName.set(name, id);

// ---------------------------------------------------------------------------
// Icon name helpers (match the frontend/public/MiniIcons naming conventions)
// ---------------------------------------------------------------------------
const iconFiles = new Set(
  fs.readdirSync(MINI_ICONS_DIR)
    .filter((f) => f.toLowerCase().endsWith('.png'))
    .map((f) => f.slice(0, -4).toLowerCase())
);

const ICON_SPECIALS = {
  farfetchd: "farfetch'd",
  sirfetchd: "sirfetch'd",
  mr_mime: 'mr-mime',
  mr_rime: 'mr-rime',
  mime_jr: 'mime-jr',
  type_null: 'type-null',
  porygon_z: 'porygon-z',
  nidoran_f: 'nidoran-f',
  nidoran_m: 'nidoran-m',
  ho_oh: 'ho-oh',
  jangmo_o: 'jangmo-o',
  hakamo_o: 'hakamo-o',
  kommo_o: 'kommo-o',
  egg: 'egg',
};

function rawIconName(name) {
  return name.toLowerCase().replace(/_/g, '-');
}

function pickIcon(name, baseName) {
  const n = name.toLowerCase();
  if (ICON_SPECIALS[n]) return ICON_SPECIALS[n];
  const raw = rawIconName(name);
  if (iconFiles.has(raw)) return raw;
  // Fall back to the nearest base species icon (e.g. CHERRIM_OVERCAST -> cherrim)
  if (baseName && baseName !== name) {
    const baseRaw = rawIconName(baseName);
    if (iconFiles.has(baseRaw)) return baseRaw;
    if (ICON_SPECIALS[baseName.toLowerCase()]) return ICON_SPECIALS[baseName.toLowerCase()];
  }
  return raw; // no file exists; the frontend onError will show question.png
}

// ---------------------------------------------------------------------------
// Display name helpers
// ---------------------------------------------------------------------------
const NAME_SPECIALS = {
  FARFETCHD: "Farfetch'd",
  SIRFETCHD: "Sirfetch'd",
  MR_MIME: 'Mr. Mime',
  MR_RIME: 'Mr. Rime',
  MIME_JR: 'Mime Jr.',
  NIDORAN_F: 'Nidoran-F',
  NIDORAN_M: 'Nidoran-M',
  TYPE_NULL: 'Type: Null',
  PORYGON_Z: 'Porygon-Z',
  FLABEBE: 'Flabébé',
  HO_OH: 'Ho-Oh',
  JANGMO_O: 'Jangmo-o',
  HAKAMO_O: 'Hakamo-o',
  KOMMO_O: 'Kommo-o',
  EGG: 'Egg',
};

function displayName(name) {
  if (NAME_SPECIALS[name]) return NAME_SPECIALS[name];
  // Forms of specially-named species, e.g. FARFETCHD_GALAR -> "Farfetch'd-Galar"
  const parts = name.split('_');
  for (let i = parts.length - 1; i >= 1; i--) {
    const prefix = parts.slice(0, i).join('_');
    if (NAME_SPECIALS[prefix]) {
      const suffix = parts
        .slice(i)
        .map((t) => t.charAt(0).toUpperCase() + t.slice(1).toLowerCase())
        .join('-');
      return `${NAME_SPECIALS[prefix]}-${suffix}`;
    }
  }
  return parts
    .map((t) => t.charAt(0).toUpperCase() + t.slice(1).toLowerCase())
    .join('-');
}

// ---------------------------------------------------------------------------
// Derive base species (id + form tokens) by finding the longest prefix of the
// enum name that is itself a known species.
// ---------------------------------------------------------------------------
function deriveBase(name) {
  const parts = name.split('_');
  for (let cut = parts.length - 1; cut >= 1; cut--) {
    const prefix = parts.slice(0, cut).join('_');
    const baseId = resolveIdByName(prefix);
    if (baseId !== undefined && baseId < numeric.size + 1) {
      return { baseId, formTokens: parts.slice(cut) };
    }
  }
  return null;
}

function normalizeForm(tokens) {
  if (!tokens || tokens.length === 0) return '';
  return tokens
    .map((t) => {
      const lower = t.toLowerCase();
      if (lower === 'mega_x') return 'Mega X';
      if (lower === 'mega_y') return 'Mega Y';
      if (lower === 'mega_z') return 'Mega Z';
      return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
    })
    .join(' ');
}

// ---------------------------------------------------------------------------
// Build the map
// ---------------------------------------------------------------------------
const entries = [];
for (const [id, name] of numeric) {
  const base = deriveBase(name);
  const baseId = base ? base.baseId : id;
  const form = base ? normalizeForm(base.formTokens) : '';
  const baseName = base ? [...name.split('_').slice(0, name.split('_').length - base.formTokens.length)].join('_') : name;

  // Root base (recurse so megas-of-forms collapse to a real dex number).
  let rootBaseId = baseId;
  const seen = new Set();
  let curName = base ? baseName : name;
  while (curName && !seen.has(curName)) {
    seen.add(curName);
    const b = deriveBase(curName);
    if (!b) break;
    curName = [...curName.split('_').slice(0, curName.split('_').length - b.formTokens.length)].join('_');
    rootBaseId = b.baseId;
  }

  entries.push({
    id,
    name,
    display: displayName(name),
    icon: pickIcon(name, baseName),
    baseId,
    rootBaseId,
    form,
  });
}

entries.sort((a, b) => a.id - b.id);

// ---------------------------------------------------------------------------
// Write the TS module
// ---------------------------------------------------------------------------
const lines = [];
lines.push('// Auto-generated by scripts/generate_species_map.mjs from "blitz files/species.h".');
lines.push('// Do not edit by hand. Regenerate after changing the ROM species list.');
lines.push('export interface SpeciesInfo {');
lines.push('  name: string;');
lines.push('  icon: string;');
lines.push('  baseId: number;');
lines.push('  form: string;');
lines.push('}');
lines.push('');
lines.push('export const SPECIES_BY_ID: Record<number, SpeciesInfo> = {');
for (const e of entries) {
  const form = e.form ? e.form : '';
  lines.push(
    `  ${e.id}: { name: ${JSON.stringify(e.display)}, icon: ${JSON.stringify(e.icon)}, baseId: ${e.rootBaseId}, form: ${JSON.stringify(form)} },`
  );
}
lines.push('};');
lines.push('');

fs.writeFileSync(OUT, lines.join('\n'), 'utf8');

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
const noIcon = entries.filter((e) => !iconFiles.has(e.icon.toLowerCase()) && !(e.icon === 'egg'));
const noBase = entries.filter((e) => e.rootBaseId === e.id && e.name !== 'EGG' && !deriveBase(e.name));
console.log(`Wrote ${entries.length} species to ${path.relative(repoRoot, OUT)}`);
console.log(`Species missing icon files (will show question.png): ${noIcon.length}`);
console.log(`Base species with no derivable base (looked up by own id): ${noBase.length}`);
console.log('\nNo-icon sample (first 25):');
console.log(noIcon.slice(0, 25).map((e) => `${e.id} ${e.name}`).join('\n'));
