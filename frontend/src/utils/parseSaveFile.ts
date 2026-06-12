// Parses a raw GBA Emerald save file (Uint8Array) and returns structured data.
// Logic extracted from SaveChecker.tsx by FranklyNathan.

const SECTION_SIZE = 4096;
const NUM_SECTIONS = 14;
const SLOT_SIZE = SECTION_SIZE * NUM_SECTIONS;
const FOOTER_OFFSET = 0xff4;
const SIGNATURE = 0x08012025;

const ENCRYPTION_KEY_OFFSET = 0xac;
const MONEY_OFFSET = 0x4f0;
const VAR_BADGE_COUNT_OFFSET = 0x76a;
const PARTY_COUNT_OFFSET = 0x234;
const PARTY_START_OFFSET = 0x238;
const POKEMON_STRUCT_SIZE = 116;
const SUBSTRUCTURE_SIZE = 16;

const SUBSTRUCTURE_ORDERS = [
  'GAEM', 'GAME', 'GEAM', 'GEMA', 'GMAE', 'GMEA',
  'AGEM', 'AGME', 'AEGM', 'AEMG', 'AMGE', 'AMEG',
  'EGAM', 'EGMA', 'EAGM', 'EAMG', 'EMGA', 'EMAG',
  'MGAE', 'MGEA', 'MAGE', 'MAEG', 'MEGA', 'MEAG',
];

export const NATURES = [
  'Hardy', 'Lonely', 'Brave', 'Adamant', 'Naughty', 'Bold', 'Docile', 'Relaxed',
  'Impish', 'Lax', 'Timid', 'Hasty', 'Serious', 'Jolly', 'Naive', 'Modest',
  'Mild', 'Quiet', 'Rash', 'Calm', 'Gentle', 'Sassy', 'Careful', 'Quirky', 'Bashful',
];

export interface SaveIvs {
  hp: number;
  atk: number;
  def: number;
  spa: number;
  spd: number;
  spe: number;
}

export interface SavePokemon {
  nickname: string;
  level: number;
  hp: number;
  max_hp: number;
  species_id: number;
  nature: string;
  ivs: SaveIvs;
}

export interface SaveData {
  trainer_name: string;
  money: number;
  badge_count: number;
  party: SavePokemon[];
}

function decodeString(bytes: Uint8Array): string {
  let result = '';
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b === 0xff) break;
    if (b === 0x00) result += ' ';
    else if (b >= 0xbb && b <= 0xd4) result += String.fromCharCode(b - 0xbb + 65);
    else if (b >= 0xd5 && b <= 0xee) result += String.fromCharCode(b - 0xd5 + 97);
    else if (b >= 0xa1 && b <= 0xaa) result += String.fromCharCode(b - 0xa1 + 48);
    else result += '?';
  }
  return result.trim();
}

export function parseSaveFile(data: Uint8Array): SaveData {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  const getSlotSections = (slotOffset: number) => {
    const sectionOffsets: Record<number, number> = {};
    let validCount = 0;
    let maxSeq = 0;
    for (let i = 0; i < 32; i++) {
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
  const trainer_name = decodeString(data.slice(s0, s0 + 8));
  const rawMoney = view.getUint32(s1 + MONEY_OFFSET, true);
  const money = (rawMoney ^ encryptionKey) >>> 0;

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
    const encryptedSpecies = view.getUint16(growthOffset, true);
    const species_id = (encryptedSpecies ^ (key & 0xffff)) & 0xffff;

    const miscIdx = order.indexOf('M');
    const miscOffset = pStart + 32 + miscIdx * SUBSTRUCTURE_SIZE;
    const decryptedMisc = (view.getUint32(miscOffset + 4, true) ^ key) >>> 0;
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
    const nickname = decodeString(data.slice(pStart + 8, pStart + 18));

    if (species_id > 0) {
      party.push({
        nickname: nickname || `Species ${species_id}`,
        level,
        hp,
        max_hp,
        species_id,
        nature: NATURES[personality % 25],
        ivs,
      });
    }
  }

  let badge_count = 0;
  if (sectionOffsets[2] !== undefined) {
    badge_count = view.getUint16(sectionOffsets[2] + VAR_BADGE_COUNT_OFFSET, true);
  }

  return { trainer_name, money, badge_count, party };
}
