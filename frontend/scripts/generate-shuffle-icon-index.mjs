// Generates shuffleIconIndex.json. The Bulbagarden gen 1-7 files are named by
// dex number, while the local gen 8-9 folder is named by Pokémon name, so this
// index translates the website's pokedex_id (+ form) into a filename.
// Only clearly identifiable forms are mapped; anything ambiguous is omitted so
// the tile falls back to standard art rather than showing the wrong form.
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const indexPath = fileURLToPath(new URL('../src/pages/Draft1v1/components/shuffleIconIndex.json', import.meta.url));
const pad = (value) => String(value).padStart(3, '0');

const index = {};
for (let dex = 1; dex <= 802; dex += 1) {
  index[String(dex)] = `Shuffle${pad(dex)}.png`;
}

// Alolan forms use Bulbagarden's "A" suffixed files.
for (const dex of [26, 27, 28, 37, 38, 103, 105]) {
  index[`${dex}|Alola`] = `Shuffle${pad(dex)}A.png`;
}

// Key format is "<pokedex_id>" for base forms and "<pokedex_id>|<form>" for
// alternate forms. A Pokémon with a form never reuses its base icon.
const curated = [
  // Generations 1-7 alternate forms (from the local folder)
  ['52|Galar', 'G - Meowth.png'],
  ['79|Galar', 'G - Slowpoke.png'],
  ['83|Galar', 'G - Farfetchd.png'],
  ['100|Hisui', 'H-Voltorb.png'],
  ['101|Hisui', 'H-Electrode.png'],
  ['149|Mega', 'M-Dragonite.png'],
  ['157|Hisui', 'H- Typhlosion.png'],
  ['194|Paldea', 'Paldean Wooper2.png'],
  ['222|Galar', 'Galarian Corsola.png'],
  ['263|Galar', 'G - Zigzagoon.png'],
  ['503|Hisui', 'H- Samurott.png'],
  ['628|Hisui', 'H-Braviary.png'],
  ['701|Mega', 'Mega Hawlucha.png'],
  ['705|Hisui', 'H- Sligoo.png'],
  ['706|Hisui', 'H- Goodra.png'],
  ['724|Hisui', 'H- Decidueye.png'],

  // Generations 8-9 (name-based files in the local folder)
  ['819', 'Skwovet.png'],
  ['821', 'Rookidee.png'],
  ['823', 'Corviknight.png'],
  ['824', 'Blipbug.png'],
  ['825', 'dottler.png'],
  ['827', 'Nickit.png'],
  ['829', 'Gossifleur.png'],
  ['831', 'Wooloo.png'],
  ['835', 'Yamper.png'],
  ['837', 'Rolycoly.png'],
  ['840', 'Applin.png'],
  ['843', 'Silicobra.png'],
  ['850', 'Sizzlipeed.png'],
  ['851', 'Centiskorch.png'],
  ['852', 'Clobbopus.png'],
  ['859', 'impidimp.png'],
  ['861', 'Grimmsnarl.png'],
  ['878', 'Cufant.png'],
  ['899', 'Wyrdeer.png'],
  ['900', 'Kleavor.png'],
  ['901', 'Ursaluna.png'],
  ['902|F', 'Basculegion Fe.png'],
  ['902|M', 'Basculegion M.png'],
  ['909', 'Fuecoco.png'],
  ['910', 'crocalor.png'],
  ['911', 'skeledirge.png'],
  ['917', 'tarountula.png'],
  ['918', 'Spidops.png'],
  ['919', 'nymble.png'],
  ['920', 'Lokix.png'],
  ['926', 'Fidough.png'],
  ['927', 'Dachsbun.png'],
  ['928', 'Smoliv.png'],
  ['929', 'Dolliv.png'],
  ['930', 'Arboliva.png'],
  ['935', 'charcadet.png'],
  ['936', 'Armarouge.png'],
  ['937', 'ceruledge.png'],
  ['938', 'Toadbulb.png'],
  ['939', 'Bellibolt.png'],
  ['940', 'Wattrel.png'],
  ['941', 'Kilowattrel.png'],
  ['942', 'Maschiff.png'],
  ['943', 'Mabosstiff.png'],
  ['948', 'Shroodle.png'],
  ['949', 'Grafaiai.png'],
  ['957', 'tinkatink.png'],
  ['958', 'tinkatuff.png'],
  ['959', 'tinkaton.png'],
  ['962', 'bombirdier.png'],
  ['965', 'Varoom.png'],
  ['966', 'Revavroom.png'],
  ['971', 'Greavard.png'],
  ['972', 'Houndstone.png'],
  ['974', 'Cetoddle.png'],
  ['975', 'Cetitan.png'],
  ['979', 'anihilape.png'],
  ['980|Paldea', 'Clodsire.png'],
  ['996', 'Frigibax.png'],
  ['997', 'Arctibax.png'],
  ['998', 'Baxcalibur.png'],
  ['1011', 'Dipplin.png'],
  ['1019', 'Hydrapple2.png'],
];

for (const [key, filename] of curated) index[key] = filename;

await writeFile(indexPath, `${JSON.stringify(index, null, 2)}\n`);
console.log(`Wrote ${Object.keys(index).length} Shuffle icon mappings.`);
