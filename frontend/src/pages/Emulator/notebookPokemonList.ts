// Ordered list of Pokémon as they appear in the in-game notebook menu (sGiftPokemonList).
// Each entry's index is its position in the scrolling menu (0 = first visible item).
// The display name matches gSpeciesInfo[species].speciesName from the ROM.
// Regional forms: only one form exists per species in the game, so no ambiguity.
//
// When updating the ROM's sGiftPokemonList, update this array to match.
export const NOTEBOOK_POKEMON_LIST: string[] = [
  'Amaura',
  //'Anorith',
  'Applin',
  'Archen',
  'Aron',
  'Bagon',
  'Beldum',
  'Binacle',
  'Blipbug',
  'Blitzle',
  'Bonsly',
  'Bounsweet',
  'Budew',
  'Buizel',
  'Bulbasaur',
  'Buneary',
  'Bunnelby',
  'Burmy',
  'Cacnea',
  'Carvanha',
  'Castform',
  'Cetoddle',
  'Charcadet',
  'Charmander',
  'Chespin',
  'Chewtle',
  'Chimchar',
  'Chinchou',
  'Chingling',
  'Clamperl',
  'Clauncher',
  'Clobbopus',
  'Corphish',
  'Corsola',
  'Cottonee',
  'Croagunk',
  'Cubone',
  'Cufant',
  'Cutiefly',
  'Cyndaquil',
  'Deerling',
  'Dewpider',
  'Diglett',
  //'Dratini',
  'Drifloon',
  'Drilbur',
  'Ducklett',
  'Duskull',
  'Ekans',
  'Electrike',
  'Elekid',
  'Elgyem',
  'Emolga',
  'Espurr',
  'Exeggcute',
  "Farfetch'd",
  'Feebas',
  'Fennekin',
  'Fidough',
  'Flabébé',
  'Fletchling',
  'Frigibax',
  'Frillish',
  'Froakie',
  'Fuecoco',
  'Gastly',
  'Geodude',
  'Gible',
  'Goomy',
  'Gossifleur',
  'Gothita',
  'Greavard',
  'Growlithe',
  'Grubbin',
  'Hatenna',
  'Helioptile',
  'Hippopotas',
  'Honedge',
  'Horsea',
  'Houndour',
  'Impidimp',
  'Inkay',
  'Jangmo-o',
  'Joltik',
  'Larvitar',
  'Lillipup',
  'Litleo',
  'Litten',
  'Litwick',
  'Lotad',
  'Machop',
  'Magby',
  'Magnemite',
  'Makuhita',
  'Mankey',
  'Mantyke',
  'Mareep',
  'Mawile',
  'Meditite',
  'Meowth',
  'Mime Jr.',
  'Minccino',
  'Minior',
  'Minun',
  'Misdreavus',
  'Morelull',
  'Mudbray',
  'Mudkip',
  'Munchlax',
  'Murkrow',
  'Nickit',
  'Nincada',
  'Noibat',
  'Nosepass',
  'Numel',
  'Nymble',
  'Oddish',
  'Onix',
  'Oshawott',
  'Pancham',
  'Pansear',
  'Paras',
  'Phantump',
  'Phanpy',
  'Plusle',
  'Pichu',
  'Pikipek',
  //'Pineco',
  'Piplup',
  'Poliwag',
  'Ponyta',
  'Poochyena',
  'Popplio',
  'Porygon',
  'Purrloin',
  'Ralts',
  'Remoraid',
  'Riolu',
  'Rockruff',
  'Roggenrola',
  'Rolycoly',
  'Rookidee',
  'Rotom',
  'Rowlet',
  'Rufflet',
  'Sableye',
  'Salandit',
  'Sandile',
  'Sandshrew',
  'Sandygast',
  'Scatterbug',
  'Scraggy',
  'Scyther',
  'Sewaddle',
  'Shellder',
  'Shellos',
  'Shinx',
  'Shroodle',
  'Shroomish',
  'Shuppet',
  'Sizzlipede',
  'Skiddo',
  'Skorupi',
  'Skrelp',
  'Slakoth',
  'Slowpoke',
  'Smeargle',
  'Smoliv',
  'Sneasel',
  'Snivy',
  'Snorunt',
  'Snover',
  'Snubbull',
  'Solosis',
  'Spheal',
  'Spoink',
  'Spritzee',
  'Squirtle',
  'Stantler',
  'Starly',
  'Staryu',
  'Stufful',
  'Surskit',
  'Swinub',
  'Swirlix',
  'Tadbulb',
  'Tarountula',
  'Teddiursa',
  'Tentacool',
  'Timburr',
  'Tinkatink',
  'Tirtouga',
  'Torchic',
  'Totodile',
  'Trapinch',
  'Treecko',
  'Trubbish',
  'Turtwig',
  'Tympole',
  'Tynamo',
  'Tyrogue',
  'Tyrunt',
  'Varoom',
  'Venipede',
  'Voltorb',
  'Vulpix',
  'Wattrel',
  'Wailmer',
  'Weedle',
  'Wingull',
  'Wishiwashi',
  'Wooper',
  'Yamper',
  'Yanma',
  'Zigzagoon',
  'Zorua',
  'Zubat',
];

const MAX_WITHDRAW = 10;

interface DraftedPokemon {
  name: string;
  pokedex_id?: number;
  form?: string | null;
}

interface ButtonInput {
  button: 'UP' | 'DOWN' | 'LEFT' | 'RIGHT' | 'A' | 'B';
}

export const BUTTON_MAP: Record<string, number> = {
  B: 0,
  SELECT: 2,
  START: 3,
  UP: 4,
  DOWN: 5,
  LEFT: 6,
  RIGHT: 7,
  A: 8,
};

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/['']/g, "'")
    .replace(/[^a-z0-9'. -]/g, '')
    .trim();
}

function findMenuIndex(pokemonName: string): number {
  const normalized = normalizeName(pokemonName);

  // Special case: "Plusle and Minun" is a combined entry in the website database,
  // but in the game menu Plusle and Minun are separate entries.
  // Selecting Plusle gives both.
  if (normalized === 'plusle and minun') {
    return NOTEBOOK_POKEMON_LIST.findIndex(n => normalizeName(n) === 'plusle');
  }

  return NOTEBOOK_POKEMON_LIST.findIndex(n => normalizeName(n) === normalized);
}

export function buildNotebookWithdrawSequence(
  draftedPokemon: DraftedPokemon[],
): ButtonInput[] {
  const positions: number[] = [];
  let slotsUsed = 0;

  for (const mon of draftedPokemon) {
    if (slotsUsed >= MAX_WITHDRAW) break;

    const idx = findMenuIndex(mon.name);
    if (idx === -1) continue;

    // Plusle and Minun count as 2 slots
    const isPlusleMinun =
      normalizeName(mon.name) === 'plusle and minun' ||
      normalizeName(mon.name) === 'plusle' ||
      normalizeName(mon.name) === 'minun';

    if (isPlusleMinun) {
      // If we already added Plusle/Minun, skip
      const plusleIdx = findMenuIndex('Plusle');
      if (positions.includes(plusleIdx)) continue;
      if (slotsUsed + 2 > MAX_WITHDRAW) break;
      slotsUsed += 2;
    } else {
      slotsUsed += 1;
    }

    positions.push(idx);
  }

  positions.sort((a, b) => a - b);

  const inputs: ButtonInput[] = [];
  let currentPos = 0;

  for (const target of positions) {
    const delta = target - currentPos;
    if (delta < 0) continue;

    const pageDowns = Math.floor(delta / 8);
    const singleDowns = delta % 8;

    for (let i = 0; i < pageDowns; i++) {
      inputs.push({ button: 'RIGHT' });
    }
    for (let i = 0; i < singleDowns; i++) {
      inputs.push({ button: 'DOWN' });
    }

    inputs.push({ button: 'A' });
    currentPos = target;
  }

  inputs.push({ button: 'B' });

  return inputs;
}
