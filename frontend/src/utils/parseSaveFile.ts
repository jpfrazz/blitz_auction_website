// Parses a raw GBA Emerald save file (Uint8Array) and returns structured data.
// Logic extracted from SaveChecker.tsx by FranklyNathan.
import { MAP_NAMES } from '../pages/Auction/mapNames';

const SECTION_SIZE = 4096;
const NUM_SECTIONS = 14;
const SLOT_SIZE = SECTION_SIZE * NUM_SECTIONS;
const FOOTER_OFFSET = 0xff4;
const SIGNATURE = 0x08012025;
const SECTOR_DATA_SIZE = 3968;

const ENCRYPTION_KEY_OFFSET = 0xac;
const MONEY_OFFSET = 0x4f0;
const VAR_BADGE_COUNT_OFFSET = 0x8d8;
const MAP_GROUP_OFFSET = 0x04;
const MAP_NUM_OFFSET = 0x05;
const PARTY_COUNT_OFFSET = 0x234;
const PARTY_START_OFFSET = 0x238;
const POKEMON_STRUCT_SIZE = 116;
const SUBSTRUCTURE_SIZE = 16;
const TRAINER_CARD_WINS_OFFSET = 0xEDD;
const TRAINER_CARD_WINS_COUNT_OFFSET = 0xF2B;
const TRAINER_CARD_WINS_MAX = 13;

const SUBSTRUCTURE_ORDERS = [
  'GAEM', 'GAME', 'GEAM', 'GEMA', 'GMAE', 'GMEA',
  'AGEM', 'AGME', 'AEGM', 'AEMG', 'AMGE', 'AMEG',
  'EGAM', 'EGMA', 'EAGM', 'EAMG', 'EMGA', 'EMAG',
  'MGAE', 'MGEA', 'MAGE', 'MAEG', 'MEGA', 'MEAG',
];

export const NATURES = [
  'Hardy', 'Lonely', 'Brave', 'Adamant', 'Naughty', 'Bold', 'Docile', 'Relaxed',
  'Impish', 'Lax', 'Timid', 'Hasty', 'Serious', 'Jolly', 'Naive', 'Modest',
  'Mild', 'Quiet', 'Bashful', 'Rash', 'Calm', 'Gentle', 'Sassy', 'Careful', 'Quirky',
];

// Mapping of trainer IDs to trainer names (for boss trainers)
const TRAINER_ID_TO_NAME: Record<number, string> = {
  // Gym Leaders (from opponents.h)
  265: "Roxanne 1", // TRAINER_ROXANNE_1
  266: "Brawly 1", // TRAINER_BRAWLY_1
  267: "Wattson 1", // TRAINER_WATTSON_1
  268: "Flannery 1", // TRAINER_FLANNERY_1
  269: "Norman 1", // TRAINER_NORMAN_1
  270: "Winona 1", // TRAINER_WINONA_1
  271: "Tate & Liza 1", // TRAINER_TATE_AND_LIZA_1
  272: "Juan & Wallace 1", // TRAINER_JUAN_1

  // Elite Four
  261: "Sidney", // TRAINER_SIDNEY
  262: "Phoebe", // TRAINER_PHOEBE
  263: "Glacia", // TRAINER_GLACIA
  264: "Drake", // TRAINER_DRAKE
  806: "Tucker", // TRAINER_TUCKER
  807: "Spenser", // TRAINER_SPENSER
  810: "Lucy", // TRAINER_LUCY
  811: "Brandon", // TRAINER_BRANDON
  804: "Steven", // TRAINER_STEVEN

  // Gym Leader Rematches (Versions 2 - 5)
  770: "Roxanne 2", // TRAINER_ROXANNE_2
  771: "Roxanne 3", // TRAINER_ROXANNE_3
  772: "Roxanne 4", // TRAINER_ROXANNE_4
  773: "Roxanne 5", // TRAINER_ROXANNE_5
  774: "Brawly 2", // TRAINER_BRAWLY_2
  775: "Brawly 3", // TRAINER_BRAWLY_3
  776: "Brawly 4", // TRAINER_BRAWLY_4
  777: "Brawly 5", // TRAINER_BRAWLY_5
  778: "Wattson 2", // TRAINER_WATTSON_2
  779: "Wattson 3", // TRAINER_WATTSON_3
  780: "Wattson 4", // TRAINER_WATTSON_4
  781: "Wattson 5", // TRAINER_WATTSON_5
  782: "Flannery 2", // TRAINER_FLANNERY_2
  783: "Flannery 3", // TRAINER_FLANNERY_3
  784: "Flannery 4", // TRAINER_FLANNERY_4
  785: "Flannery 5", // TRAINER_FLANNERY_5
  786: "Norman 2", // TRAINER_NORMAN_2
  787: "Norman 3", // TRAINER_NORMAN_3
  788: "Norman 4", // TRAINER_NORMAN_4
  789: "Norman 5", // TRAINER_NORMAN_5
  790: "Winona 2", // TRAINER_WINONA_2
  791: "Winona 3", // TRAINER_WINONA_3
  792: "Winona 4", // TRAINER_WINONA_4
  793: "Winona 5", // TRAINER_WINONA_5
  794: "Tate & Liza 2", // TRAINER_TATE_AND_LIZA_2
  795: "Tate & Liza 3", // TRAINER_TATE_AND_LIZA_3
  796: "Tate & Liza 4", // TRAINER_TATE_AND_LIZA_4
  797: "Tate & Liza 5", // TRAINER_TATE_AND_LIZA_5
  798: "Juan & Wallace 2", // TRAINER_JUAN_2
  799: "Juan & Wallace 3", // TRAINER_JUAN_3
  800: "Juan & Wallace 4", // TRAINER_JUAN_4
  801: "Juan & Wallace 5", // TRAINER_JUAN_5

  // Gym Leader Rematches (Versions 6 - 8)
  812: "Roxanne 6", // TRAINER_ROXANNE_6
  813: "Roxanne 7", // TRAINER_ROXANNE_7
  814: "Roxanne 8", // TRAINER_ROXANNE_8
  815: "Brawly 6", // TRAINER_BRAWLY_6
  816: "Brawly 7", // TRAINER_BRAWLY_7
  817: "Brawly 8", // TRAINER_BRAWLY_8
  818: "Wattson 6", // TRAINER_WATTSON_6
  819: "Wattson 7", // TRAINER_WATTSON_7
  820: "Wattson 8", // TRAINER_WATTSON_8
  821: "Flannery 6", // TRAINER_FLANNERY_6
  822: "Flannery 7", // TRAINER_FLANNERY_7
  823: "Flannery 8", // TRAINER_FLANNERY_8
  824: "Norman 6", // TRAINER_NORMAN_6
  825: "Norman 7", // TRAINER_NORMAN_7
  826: "Norman 8", // TRAINER_NORMAN_8
  827: "Winona 6", // TRAINER_WINONA_6
  828: "Winona 7", // TRAINER_WINONA_7
  829: "Winona 8", // TRAINER_WINONA_8
  830: "Tate & Liza 6", // TRAINER_TATE_AND_LIZA_6
  831: "Tate & Liza 7", // TRAINER_TATE_AND_LIZA_7
  832: "Tate & Liza 8", // TRAINER_TATE_AND_LIZA_8
  833: "Juan & Wallace 6", // TRAINER_JUAN_6
  834: "Juan & Wallace 7", // TRAINER_JUAN_7
  835: "Juan & Wallace 8", // TRAINER_JUAN_8

  855: "Viola 1",
  856: "Viola 2",
  857: "Viola 3",
  858: "Viola 4",
  859: "Viola 5",
  860: "Viola 6",
  861: "Viola 7",
  862: "Viola 8",

  601: "Maxie",
  34: "Archie",
};

function getTrainerNameById(trainerId: number): string {
  return TRAINER_ID_TO_NAME[trainerId] || `Trainer ${trainerId}`;
}

// Scan the save file for a specific time pattern to locate trainer card wins
function scanForTimePattern(data: Uint8Array, targetHours: number, targetMinutes: number, targetSeconds: number): number[] {
  const matches: number[] = [];

  for (let i = 0; i < data.length - 3; i++) {
    const hours = data[i] | (data[i + 1] << 8);
    const minutes = data[i + 2];
    const seconds = data[i + 3];

    if (hours === targetHours && minutes === targetMinutes && seconds === targetSeconds) {
      matches.push(i);
    }
  }

  return matches;
}

export interface SaveIvs {
  hp: number;
  atk: number;
  def: number;
  spa: number;
  spd: number;
  spe: number;
}

export interface SavePokemon {
  personality: number;
  nickname: string;
  level: number;
  hp: number;
  max_hp: number;
  species_id: number;
  nature: string;
  ability_num: number;
  ivs: SaveIvs;
}

export interface SaveBoxPokemon {
  personality: number;
  nickname: string;
  species_id: number;
  ability_num: number;
  nature: string;
  ivs: SaveIvs;
}

export interface TrainerCardWin {
  trainer_id: number;
  hours: number;
  minutes: number;
  seconds: number;
  is_loss: boolean;
}

export interface SaveData {
  trainer_name: string;
  money: number;
  badge_count: number;
  map_name: string;
  party: SavePokemon[];
  box: SaveBoxPokemon[];
  trainer_card_wins: TrainerCardWin[];
  most_recent_loss: TrainerCardWin | null;
  most_recent_loss_name: string | null;
}

function decodeString(bytes: Uint8Array): string {
  let result = '';
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b === 0xff) break;
    if (b === 0x00) result += ' ';
    else if (b === 0x1b) result += 'é';
    else if (b === 0xad) result += '.';
    else if (b === 0xae) result += '-';
    else if (b >= 0xbb && b <= 0xd4) result += String.fromCharCode(b - 0xbb + 65);
    else if (b >= 0xd5 && b <= 0xee) result += String.fromCharCode(b - 0xd5 + 97);
    else if (b >= 0xa1 && b <= 0xaa) result += String.fromCharCode(b - 0xa1 + 48);
    // Any other byte is an unknown character. We ignore it to prevent '??' and allow parsing to continue.
  }
  return result.trim();
}

export function parseSaveFile(
  data: Uint8Array,
  pokemonMetadata: Record<string, any>,
  pokemonById: Map<number, any>
): SaveData {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  const getSlotSections = (slotOffset: number) => {
    const sectionOffsets: Record<number, number> = {};
    let validCount = 0;
    let maxSeq = 0;
    // Limit the scan to NUM_SECTIONS to prevent one slot candidate 
    // from "bleeding" into the other rotating save slot in the 128KB flash.
    // Standard Emerald uses 14 sections per slot.
    for (let i = 0; i < NUM_SECTIONS; i++) {
      const offset = slotOffset + i * SECTION_SIZE;
      if (offset + SECTION_SIZE > data.length) break;
      const sectionID = data[offset + FOOTER_OFFSET] | (data[offset + FOOTER_OFFSET + 1] << 8);
      const signature = view.getUint32(offset + FOOTER_OFFSET + 4, true);
      const seq = view.getUint32(offset + FOOTER_OFFSET + 8, true);
      if (signature === SIGNATURE && sectionID >= 0 && sectionID < NUM_SECTIONS) {
        sectionOffsets[sectionID] = offset;
        validCount += 1;
        if (seq !== 0xffffffff) maxSeq = Math.max(maxSeq, seq);
      }
    }
    return { slotOffset, sectionOffsets, validCount, maxSeq };
  };

  const possibleOffsets = [0, SLOT_SIZE];
  if (data.length >= SLOT_SIZE + 0x1000) {
    possibleOffsets.push(0x1000, 0x2000, 0x3000, 0x4000);
  }
  const slotCandidates = possibleOffsets
    .filter((o) => o + SECTION_SIZE <= data.length)
    .map(getSlotSections);

  const activeSlot = slotCandidates
    .filter((s) => s.validCount > 0)
    .sort((a, b) => b.validCount !== a.validCount ? b.validCount - a.validCount : b.maxSeq - a.maxSeq)[0];

  if (!activeSlot || activeSlot.validCount < 10) {
    throw new Error('Unable to locate a valid save slot.');
  }

  const { sectionOffsets } = activeSlot;
  const s0 = sectionOffsets[0];
  const s1 = sectionOffsets[1];
  if (s0 === undefined || s1 === undefined) {
    throw new Error('Required save sections not found.');
  }

  const encryptionKey = view.getUint32(s0 + ENCRYPTION_KEY_OFFSET, true);
  const trainer_name = decodeString(data.slice(s0, s0 + 12));
  const rawMoney = view.getUint32(s1 + MONEY_OFFSET, true);
  const money = (rawMoney ^ encryptionKey) >>> 0;

  const mapGroup = data[s1 + MAP_GROUP_OFFSET];
  const mapNum = data[s1 + MAP_NUM_OFFSET];
  const map_name =
    MAP_NAMES[mapGroup]?.[mapNum] || `Unknown Map (${mapGroup}, ${mapNum})`;

  const partyCount = Math.min(data[s1 + PARTY_COUNT_OFFSET], 6);
  const party: SavePokemon[] = [];

  for (let i = 0; i < partyCount; i++) {
    const pStart = s1 + PARTY_START_OFFSET + i * POKEMON_STRUCT_SIZE;
    const personality = view.getUint32(pStart, true);
    const otId = view.getUint32(pStart + 4, true);
    const key = (personality ^ otId) >>> 0;

    const order = SUBSTRUCTURE_ORDERS[personality % 24];

    const growthIdx = order.indexOf('G');
    const growthOffset = pStart + 32 + growthIdx * SUBSTRUCTURE_SIZE;
    const decryptedGrowth0 = (view.getUint32(growthOffset, true) ^ key) >>> 0;
    const species_id = decryptedGrowth0 & 0x7FF;

    const miscIdx = order.indexOf('M');
    const miscOffset = pStart + 32 + miscIdx * SUBSTRUCTURE_SIZE;
    const miscWord2 = (view.getUint32(miscOffset + 8, true) ^ key) >>> 0;
    const decryptedMisc = (view.getUint32(miscOffset + 4, true) ^ key) >>> 0;
    
    const ability_num = (miscWord2 >> 29) & 3;
    const ivs: SaveIvs = {
      hp:  decryptedMisc & 0x1f,
      atk: (decryptedMisc >> 5) & 0x1f,
      def: (decryptedMisc >> 10) & 0x1f,
      spe: (decryptedMisc >> 15) & 0x1f,
      spa: (decryptedMisc >> 20) & 0x1f,
      spd: (decryptedMisc >> 25) & 0x1f,
    };

    const level = data[pStart + 100];
    const hp = view.getUint16(pStart + 102, true);
    const max_hp = view.getUint16(pStart + 104, true);
    const nickname = decodeString(data.slice(pStart + 8, pStart + 20));

    if (species_id > 0) {
      party.push({
        personality,
        nickname,
        level,
        hp,
        max_hp,
        species_id,
        ability_num,
        nature: NATURES[personality % 25],
        ivs,
      });
    }
  }

  const box: SaveBoxPokemon[] = [];
  const BOX_START_OFFSET = 4;
  const BOX_POKEMON_SIZE = 96;
  const TOTAL_BOXES = 8;
  const POKEMON_PER_BOX = 30;
  const PC_BOX_SECTIONS = [5, 6, 7, 8, 9, 10, 11, 12, 13];

  // Reassemble PokemonStorage from all sectors
  const storageData = new Uint8Array(TOTAL_BOXES * POKEMON_PER_BOX * BOX_POKEMON_SIZE);
  let storageOffset = 0;

  for (const sectionId of PC_BOX_SECTIONS) {
    if (sectionOffsets[sectionId] !== undefined) {
      const sectionOffset = sectionOffsets[sectionId];
      const chunkSize = Math.min(SECTOR_DATA_SIZE, storageData.length - storageOffset);
      for (let i = 0; i < chunkSize; i++) {
        storageData[storageOffset + i] = data[sectionOffset + BOX_START_OFFSET + i];
      }
      storageOffset += chunkSize;
    }
  }

  // Parse all boxes from the reassembled storage
  const storageView = new DataView(storageData.buffer, storageData.byteOffset, storageData.byteLength);
  for (let boxNum = 0; boxNum < TOTAL_BOXES; boxNum++) {
    for (let i = 0; i < POKEMON_PER_BOX; i++) {
      const pStart = boxNum * POKEMON_PER_BOX * BOX_POKEMON_SIZE + i * BOX_POKEMON_SIZE;
      if (pStart + BOX_POKEMON_SIZE > storageData.length) break;

      const personality = storageView.getUint32(pStart, true);
      const otId = storageView.getUint32(pStart + 4, true);
      const key = (personality ^ otId) >>> 0;
      const order = SUBSTRUCTURE_ORDERS[personality % 24];

      const growthIdx = order.indexOf('G');
      const growthOffset = pStart + 32 + growthIdx * SUBSTRUCTURE_SIZE;
      const decryptedGrowth0 = (storageView.getUint32(growthOffset, true) ^ key) >>> 0;
      const species_id = decryptedGrowth0 & 0x7FF;

      const miscIdx = order.indexOf('M');
      const miscOffset = pStart + 32 + miscIdx * SUBSTRUCTURE_SIZE;
      const miscWord2 = (storageView.getUint32(miscOffset + 8, true) ^ key) >>> 0;
      const decryptedMisc = (storageView.getUint32(miscOffset + 4, true) ^ key) >>> 0;

      const ability_num = (miscWord2 >> 29) & 3;
      const ivs: SaveIvs = {
        hp:  decryptedMisc & 0x1f,
        atk: (decryptedMisc >> 5) & 0x1f,
        def: (decryptedMisc >> 10) & 0x1f,
        spe: (decryptedMisc >> 15) & 0x1f,
        spa: (decryptedMisc >> 20) & 0x1f,
        spd: (decryptedMisc >> 25) & 0x1f,
      };

      if (species_id > 0 && species_id < 0xffff) {
        const nickname = decodeString(storageData.slice(pStart + 8, pStart + 20));
        box.push({
          personality,
          nickname,
          species_id,
          ability_num,
          nature: NATURES[personality % 25],          ivs,
        });
      }
    }
  }

  let badge_count = 0;
  if (sectionOffsets[2] !== undefined) {
    badge_count = view.getUint16(sectionOffsets[2] + VAR_BADGE_COUNT_OFFSET, true);
  }

  // Scan for the specific time pattern (0h 4m 8s) to locate trainer card wins
  const timeMatches = scanForTimePattern(data, 0, 4, 8);
  console.log(`[SaveParser] Found ${timeMatches.length} matches for time 0h 4m 8s at offsets:`, timeMatches);
  console.log(`[SaveParser] Section offsets:`, sectionOffsets);

  // Calculate the relative offset within section 2
  if (sectionOffsets[2] !== undefined && timeMatches.length > 0) {
    const relativeOffset = timeMatches[0] - sectionOffsets[2];
    console.log(`[SaveParser] Relative offset within section 2: ${relativeOffset} (0x${relativeOffset.toString(16)})`);
  }

  // Calculate the relative offset within section 1
  if (sectionOffsets[1] !== undefined && timeMatches.length > 0) {
    const relativeOffset1 = timeMatches[0] - sectionOffsets[1];
    console.log(`[SaveParser] Relative offset within section 1: ${relativeOffset1} (0x${relativeOffset1.toString(16)})`);
  }

  // Calculate the relative offset within section 0
  if (sectionOffsets[0] !== undefined && timeMatches.length > 0) {
    const relativeOffset0 = timeMatches[0] - sectionOffsets[0];
    console.log(`[SaveParser] Relative offset within section 0: ${relativeOffset0} (0x${relativeOffset0.toString(16)})`);
  }

  // Parse trainer card wins - use the actual location where the time pattern was found
  const trainer_card_wins: TrainerCardWin[] = [];
  let most_recent_loss: TrainerCardWin | null = null;

  if (timeMatches.length > 0) {
    const timeOffset = timeMatches[0];
    // The trainer ID is 2 bytes before the time (TrainerCardWin struct: trainerId (2), hours (2), minutes (1), seconds (1))
    const trainerIdOffset = timeOffset - 2;
    const trainerId = view.getUint16(trainerIdOffset, true);
    const hours = view.getUint16(timeOffset, true);
    const minutes = data[timeOffset + 2];
    const seconds = data[timeOffset + 3];

    const isLoss = (trainerId & 0x8000) !== 0;
    const actualTrainerId = trainerId & 0x7FFF;

    console.log(`[SaveParser] Found trainer card entry at offset ${trainerIdOffset}: trainerId=${trainerId} (actual=${actualTrainerId}), isLoss=${isLoss}, time=${hours}h${minutes}m${seconds}s`);

    const win: TrainerCardWin = {
      trainer_id: actualTrainerId,
      hours,
      minutes,
      seconds,
      is_loss: isLoss,
    };

    trainer_card_wins.push(win);

    if (isLoss) {
      most_recent_loss = win;
    }

    console.log(`[SaveParser] Most recent loss:`, most_recent_loss);
  }

  const most_recent_loss_name = most_recent_loss ? getTrainerNameById(most_recent_loss.trainer_id) : null;

  return { trainer_name, money, badge_count, map_name, party, box, trainer_card_wins, most_recent_loss, most_recent_loss_name };
}
