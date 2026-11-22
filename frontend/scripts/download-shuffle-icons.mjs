// Downloads the generations 1-7 Shuffle icons from Bulbagarden into the tracked
// "ShuffleIcons" folder so they are included in production builds. Direct
// media/upload URLs are blocked by Cloudflare, so the Special:Redirect endpoint
// is used instead. Safe to re-run: existing files are skipped.
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const folder = fileURLToPath(new URL('../public/ShuffleIcons', import.meta.url));
const userAgent = 'BlitzAuctionBot/1.0 (contact: admin@example.com)';
const concurrency = 10;
const pngSignature = '89504e470d0a1a0a';

await mkdir(folder, { recursive: true });

const pad = (value) => String(value).padStart(3, '0');
const baseNames = Array.from({ length: 802 }, (_, index) => `Shuffle${pad(index + 1)}.png`);
// Alternate variants from the same Bulbagarden category. "A" is the Alolan
// form suffix; these fill in the regional forms that the pool can contain.
const alternateNames = [
  '019A', '020A', '025A', '026A', '027A', '028A', '037A', '038A',
  '050A', '051A', '052A', '053A', '074A', '075A', '076A', '088A',
  '089A', '103A', '105A', '386A', '585A', '586A', '658A',
].map((suffix) => `Shuffle${suffix}.png`);
const names = [...baseNames, ...alternateNames];
let next = 0;
let downloaded = 0;
let skipped = 0;
let failed = 0;

async function worker() {
  while (next < names.length) {
    const name = names[next++];
    const destination = path.join(folder, name);

    try {
      if ((await stat(destination)).size > 1000) {
        skipped += 1;
        continue;
      }
    } catch {
      // File does not exist yet.
    }

    let saved = false;
    for (let attempt = 0; attempt < 3 && !saved; attempt += 1) {
      try {
        const response = await fetch(
          `https://archives.bulbagarden.net/wiki/Special:Redirect/file/${name}`,
          { headers: { 'User-Agent': userAgent } },
        );
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const buffer = Buffer.from(await response.arrayBuffer());
        if (buffer.subarray(0, 8).toString('hex') !== pngSignature) {
          throw new Error('response was not a PNG');
        }
        await writeFile(destination, buffer);
        downloaded += 1;
        saved = true;
      } catch (error) {
        if (attempt === 2) {
          failed += 1;
          console.error(`${name}: ${error.message}`);
        } else {
          await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
        }
      }
    }
  }
}

await Promise.all(Array.from({ length: concurrency }, worker));
console.log(`Shuffle icons: ${downloaded} downloaded, ${skipped} already present, ${failed} failed.`);
