import { readFile, writeFile } from 'node:fs/promises';

const endpoint = 'https://www.pokeos.com/api/tcg/textless';
const indexPath = new URL('../src/pages/Draft1v1/components/tcgArtIndex.json', import.meta.url);
const existing = JSON.parse(await readFile(indexPath, 'utf8'));
const entries = {};
let offset = 0;
let total = Infinity;

while (offset < total) {
  const response = await fetch(`${endpoint}?limit=120&offset=${offset}`);
  if (!response.ok) throw new Error(`Catalog request failed: ${response.status}`);
  const page = await response.json();
  if (!Array.isArray(page.data) || !page.data.length) throw new Error('Unexpected empty catalog page');
  for (const card of page.data) {
    if (typeof card.pokemonKey === 'string' && typeof card.imageUrl === 'string' && card.imageUrl.startsWith('https://s3.pokeos.com/pokeos-uploads/tcg/textless/')) {
      entries[card.pokemonKey] ??= card.imageUrl;
    }
  }
  total = page.total;
  offset += page.data.length;
}

for (const [name, choices] of Object.entries(existing)) {
  if (Array.isArray(choices)) entries[name] = choices;
}
await writeFile(indexPath, `${JSON.stringify(entries, null, 2)}\n`);
console.log(`Indexed ${Object.keys(entries).length} Pokemon from ${offset} cards.`);