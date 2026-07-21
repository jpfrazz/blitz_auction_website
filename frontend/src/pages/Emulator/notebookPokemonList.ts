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
const PAGE_SIZE = 8;

// Cursor center row in the visible window (from the ROM: maxShowed - (maxShowed/2 + maxShowed%2) - 1 = 3)
const CURSOR_CENTER = 3;

interface DraftedPokemon {
  name: string;
  pokedex_id?: number;
  form?: string | null;
}

interface ButtonInput {
  button: 'UP' | 'DOWN' | 'LEFT' | 'RIGHT' | 'A' | 'B' | 'WAIT';
  delayMs?: number;
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
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['']/g, "'")
    .replace(/[^a-z0-9' -]/g, '')
    .trim();
}

function findMenuIndex(pokemonName: string): number {
  const normalized = normalizeName(pokemonName);

  if (normalized === 'plusle and minun') {
    return NOTEBOOK_POKEMON_LIST.findIndex(n => normalizeName(n) === 'plusle');
  }

  return NOTEBOOK_POKEMON_LIST.findIndex(n => normalizeName(n) === normalized);
}

// BFS to find shortest input sequence from (scrollA, rowA) to (scrollB, rowB)
// in the in-game list menu. States are (scrollOffset, selectedRow).
// Movement modeled from ListMenuUpdateSelectedRowIndexAndScrollOffset in list_menu.c.
type MenuState = [number, number]; // [scrollOffset, selectedRow]

function findShortestPath(
  from: MenuState,
  to: MenuState,
  totalItems: number,
): ButtonInput[] {
  if (from[0] === to[0] && from[1] === to[1]) return [];

  const maxScroll = totalItems - PAGE_SIZE;
  const visited = new Map<string, string | null>(); // key -> parentKey
  const queue: MenuState[] = [from];
  const fromKey = `${from[0]},${from[1]}`;
  visited.set(fromKey, null);

  const toKey = `${to[0]},${to[1]}`;

  function nextStates([scroll, row]: MenuState): [MenuState, ButtonInput['button']][] {
    const result: [MenuState, ButtonInput['button']][] = [];

    // UP: move cursor up or scroll up
    if (scroll === 0) {
      if (row > 0) {
        result.push([[scroll, row - 1], 'UP']);
      }
    } else if (row > CURSOR_CENTER) {
      result.push([[scroll, row - 1], 'UP']);
    } else {
      result.push([[scroll - 1, row], 'UP']);
    }

    // DOWN: move cursor down or scroll down
    if (scroll >= maxScroll) {
      if (row < PAGE_SIZE - 1) {
        result.push([[scroll, row + 1], 'DOWN']);
      }
    } else if (row < CURSOR_CENTER) {
      result.push([[scroll, row + 1], 'DOWN']);
    } else {
      result.push([[scroll + 1, row], 'DOWN']);
    }

    // LEFT: page up by PAGE_SIZE
    const leftScroll = Math.max(0, scroll - PAGE_SIZE);
    if (leftScroll !== scroll) {
      const leftRow = Math.min(row, Math.min(CURSOR_CENTER, totalItems - leftScroll - 1));
      result.push([[leftScroll, leftRow], 'LEFT']);
    }

    // RIGHT: page down by PAGE_SIZE
    const rightScroll = Math.min(maxScroll, scroll + PAGE_SIZE);
    if (rightScroll !== scroll) {
      const rightRow = Math.min(row, Math.min(CURSOR_CENTER, totalItems - rightScroll - 1));
      result.push([[rightScroll, rightRow], 'RIGHT']);
    }

    return result;
  }

  while (queue.length > 0) {
    const current = queue.shift()!;
    const currentKey = `${current[0]},${current[1]}`;

    for (const [next, button] of nextStates(current)) {
      const nextKey = `${next[0]},${next[1]}`;
      if (visited.has(nextKey)) continue;
      visited.set(nextKey, currentKey);

      if (nextKey === toKey) {
        // Reconstruct path
        const path: ButtonInput[] = [];
        let reconstructKey: string | null = nextKey;
        while (reconstructKey !== fromKey) {
          const pk: string = visited.get(reconstructKey!)!;
          const [ps, pr] = pk.split(',').map(Number) as MenuState;
          for (const [candidate, btn] of nextStates([ps, pr])) {
            if (`${candidate[0]},${candidate[1]}` === reconstructKey!) {
              path.unshift({ button: btn });
              break;
            }
          }
          reconstructKey = pk;
        }
        return path;
      }

      queue.push(next);
    }
  }

  return []; // unreachable
}

export function buildNotebookWithdrawSequence(
  draftedPokemon: DraftedPokemon[],
): ButtonInput[] {
  // Split into batches of MAX_WITHDRAW slots each.
  // Plusle/Minun count as 2 slots.
  const batches: number[][] = [];
  let currentBatch: number[] = [];
  let slotsUsed = 0;
  const plusleIdx = findMenuIndex('Plusle');
  let plusleAdded = false;

  for (const mon of draftedPokemon) {
    const idx = findMenuIndex(mon.name);
    if (idx === -1) continue;

    const isPlusleMinun =
      normalizeName(mon.name) === 'plusle and minun' ||
      normalizeName(mon.name) === 'plusle' ||
      normalizeName(mon.name) === 'minun';

    if (isPlusleMinun) {
      if (plusleAdded) continue;
      if (slotsUsed + 2 > MAX_WITHDRAW) {
        batches.push(currentBatch);
        currentBatch = [];
        slotsUsed = 0;
      }
      plusleAdded = true;
      slotsUsed += 2;
      currentBatch.push(plusleIdx);
    } else {
      if (slotsUsed + 1 > MAX_WITHDRAW) {
        batches.push(currentBatch);
        currentBatch = [];
        slotsUsed = 0;
      }
      slotsUsed += 1;
      currentBatch.push(idx);
    }
  }
  if (currentBatch.length > 0) batches.push(currentBatch);

  if (batches.length === 0) return [];

  const totalItems = NOTEBOOK_POKEMON_LIST.length + 2;
  const maxScroll = totalItems - PAGE_SIZE;
  const inputs: ButtonInput[] = [];

  for (let b = 0; b < batches.length; b++) {
    const positions = batches[b].sort((a, c) => a - c);
    let currentState: MenuState = [0, 0];

    for (const targetPos of positions) {
      let targetRow = Math.min(CURSOR_CENTER, targetPos);
      let targetScroll = targetPos - targetRow;
      if (targetScroll > maxScroll) {
        targetScroll = maxScroll;
        targetRow = targetPos - targetScroll;
      }
      const target: MenuState = [targetScroll, targetRow];

      const seg = findShortestPath(currentState, target, totalItems);
      inputs.push(...seg);
      inputs.push({ button: 'A' });
      currentState = target;
    }

    // Exit notebook after each batch
    inputs.push({ button: 'B' });

    // Re-open notebook for next batch (wait for menu to close, then A twice)
    if (b < batches.length - 1) {
      inputs.push({ button: 'WAIT', delayMs: 1200 });
      inputs.push({ button: 'A' });
      inputs.push({ button: 'WAIT', delayMs: 400 });
      inputs.push({ button: 'A' });
      inputs.push({ button: 'WAIT', delayMs: 600 });
    }
  }

  return inputs;
}
