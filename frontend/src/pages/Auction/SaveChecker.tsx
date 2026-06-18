import React, { useEffect, useState } from 'react';
import Header from '../../shared/components/Header';
import Footer from '../../shared/components/Footer';
import { fetchPokemonList } from '../../shared/api/pokemon';
import './SaveChecker.scss';
import { MAP_NAMES } from './mapNames';

const SECTION_SIZE = 4096;
const NUM_SECTIONS = 14;
const SLOT_SIZE = SECTION_SIZE * NUM_SECTIONS;
const FOOTER_OFFSET = 0xFF4;
const SIGNATURE = 0x08012025;

// Section boundaries
const SECTION_DATA_SIZE = 3968; // 0xF80 bytes
const ENCRYPTION_KEY_OFFSET = 0xAC; // In SaveBlock2 (Section 0)
const MONEY_OFFSET = 0x4F0; // Money is at 0x4F0 in Section 1
const VAR_BADGE_COUNT_OFFSET = 0x8D8;
const MAP_GROUP_OFFSET = 0x04; // In SaveBlock1 (Section 1)
const MAP_NUM_OFFSET = 0x05;   // In SaveBlock1 (Section 1)
const FLAGS_START_OFFSET = 0x63D; // Found via debug scanner
const FLAG_BADGE08_GET = 0x867;
const PARTY_COUNT_OFFSET = 0x234;
const PARTY_START_OFFSET = 0x238;
const POKEMON_STRUCT_SIZE = 116;

const SUBSTRUCTURE_SIZE = 16;
const SUBSTRUCTURE_ORDERS = [
  "GAEM", "GAME", "GEAM", "GEMA", "GMAE", "GMEA",
  "AGEM", "AGME", "AEGM", "AEMG", "AMGE", "AMEG",
  "EGAM", "EGMA", "EAGM", "EAMG", "EMGA", "EMAG",
  "MGAE", "MGEA", "MAGE", "MAEG", "MEGA", "MEAG"
];

// Important Emerald Flag Offsets (Standard pokemerald)
const NATURES = [
  "Hardy", "Lonely", "Brave", "Adamant", "Naughty", "Bold", "Docile", "Relaxed", "Impish", "Lax",
  "Timid", "Hasty", "Serious", "Jolly", "Naive", "Modest", "Mild", "Quiet", "Rash", "Calm",
  "Gentle", "Sassy", "Careful", "Quirky", "Bashful"
];

const NATURE_EFFECTS: Record<string, string> = {
  "Hardy": "",
  "Lonely": " (+Atk -Def)",
  "Brave": " (+Atk -Spe)",
  "Adamant": " (+Atk -SpAtk)",
  "Naughty": " (+Atk -SpDef)",
  "Bold": " (+Def -Atk)",
  "Docile": "",
  "Relaxed": " (+Def -Spe)",
  "Impish": " (+Def -SpAtk)",
  "Lax": " (+Def -SpDef)",
  "Timid": " (+Spe -Atk)",
  "Hasty": " (+Spe -Def)",
  "Serious": "",
  "Jolly": " (+Spe -SpAtk)",
  "Naive": " (+Spe -SpDef)",
  "Modest": " (+SpAtk -Atk)",
  "Mild": " (+SpAtk -Def)",
  "Quiet": " (+SpAtk -Spe)",
  "Rash": " (+SpAtk -SpDef)",
  "Calm": " (+SpDef -Atk)",
  "Gentle": " (+SpDef -Def)",
  "Sassy": " (+SpDef -Spe)",
  "Careful": " (+SpDef -SpAtk)",
  "Quirky": "",
  "Bashful": ""
};

interface Pokemon {
  nickname: string;
  level: number;
  hp: number;
  maxHp: number;
  speciesId: number;
  nature: string;
  ability_num: number;
  ivs: {
    hp: number;
    atk: number;
    def: number;
    spa: number;
    spd: number;
    spe: number;
  };
}

interface BoxPokemon {
  nickname: string;
  speciesId: number;
  ability_num: number;
  nature: string;
  ivs: {
    hp: number;
    atk: number;
    def: number;
    spa: number;
    spd: number;
    spe: number;
  };
}

const SaveChecker: React.FC = () => {
  const [trainerName, setTrainerName] = useState<string | null>(null);
  const [party, setParty] = useState<Pokemon[]>([]);
  const [box1, setBox1] = useState<BoxPokemon[]>([]);
  const [money, setMoney] = useState<number | null>(null);
  const [badgeCount, setBadgeCount] = useState<number | null>(null);
  const [mapName, setMapName] = useState<string | null>(null);
  const [isBadge8Get, setIsBadge8Get] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pokemonMetadata, setPokemonMetadata] = useState<Record<string, any>>({});
  const [pokemonById, setPokemonById] = useState<Map<number, any>>(new Map());

  useEffect(() => {
    fetchPokemonList().then((list) => {
      const map: Record<string, any> = {};
      const idMap = new Map<number, any>();
      for (const p of (list as any[])) {
        const entry = {
          ...p,
          abilities: [p.ability1, p.ability2 || p.ability1, p.hidden_ability || p.ability1]
        };
        const name = p.name?.toLowerCase();
        if (name) {
          map[name] = entry;
          // Index by normalized name as well to handle accents (e.g., flabébé -> flabebe)
          const normalized = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
          if (normalized !== name) map[normalized] = entry;
        }
        
        const id = p.id || p.pokedex_id;
        if (id) {
          const isMega = p.name?.toLowerCase().includes('mega');
          if (!isMega) idMap.set(Number(id), entry);
        }
      }
      setPokemonMetadata(map);
      setPokemonById(idMap);
    }).catch(() => {});
  }, []);

  const resolveMetadata = (speciesId: number, nickname: string) => {
    // 1. Try ID lookup
    let data = pokemonById.get(speciesId);

    // 2. Fallback to nickname lookup (handling truncated GBA names)
    if (!data && nickname) {
      let searchName = nickname.toLowerCase();
      data = pokemonMetadata[searchName];
      
      // Try normalized lookup for accented names
      if (!data) {
        const normalized = searchName.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        data = pokemonMetadata[normalized];
      }

      // Handle forms (e.g. "Deerling" matching "Deerling-Spring") or truncated names
      if (!data) {
        data = Object.values(pokemonMetadata).find(p => 
          p.name.toLowerCase().startsWith(searchName)
        );
      }
    }

    // Handle Mega Evolution redirection to treat them as base forms
    if (data && data.name.toLowerCase().includes('mega')) {
      const baseName = data.name.toLowerCase()
        .replace(/\s*\(mega .*\)/, '') // Handles "(Mega ...)"
        .replace(/^mega\s*/, '') // Handles "Mega ..."
        .trim();
      if (pokemonMetadata[baseName]) return pokemonMetadata[baseName];
    }

    return data;
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const buffer = e.target?.result as ArrayBuffer;
        const data = new Uint8Array(buffer);
        parseSaveData(data);
      } catch (err) {
        console.error(err);
        setError("Failed to parse save file. Ensure it is a valid GBA .sav file.");
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const decodeString = (bytes: Uint8Array) => {
    let result = "";
    for (let i = 0; i < bytes.length; i++) {
      const b = bytes[i];
      if (b === 0xFF) break; // End of string
      if (b === 0x00) result += " ";
      else if (b === 0x1B) result += "é";
      else if (b === 0xAD) result += ".";
      else if (b === 0xAE) result += "-";
      else if (b >= 0xBB && b <= 0xD4) result += String.fromCharCode(b - 0xBB + 65); // A-Z
      else if (b >= 0xD5 && b <= 0xEE) result += String.fromCharCode(b - 0xD5 + 97); // a-z
      else if (b >= 0xA1 && b <= 0xAA) result += String.fromCharCode(b - 0xA1 + 48); // 0-9
      // Any other byte is an unknown character. We ignore it to prevent '??' and allow parsing to continue.
    }
    return result.trim();
  };

  const parseSaveData = (data: Uint8Array) => {
    const view = new DataView(data.buffer);

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
          if (seq !== 0xFFFFFFFF) {
            maxSeq = Math.max(maxSeq, seq);
          }
        } else if (signature === SIGNATURE) {
           // Log if we find a valid signature but the ID is out of bounds
           console.warn(`Found valid signature at ${offset.toString(16)} but ID ${sectionID} is invalid.`);
        }
      }

      return { slotOffset, sectionOffsets, validCount, maxSeq };
    };

    const slotCandidates = [] as Array<ReturnType<typeof getSlotSections>>;
    const possibleOffsets = [0, SLOT_SIZE];
    if (data.length >= SLOT_SIZE + 0x1000) {
      // Some .sav files include padding or extra reserved space, so allow a second candidate
      possibleOffsets.push(0x1000, 0x2000, 0x3000, 0x4000);
    }

    for (const offset of possibleOffsets) {
      if (offset + SECTION_SIZE > data.length) continue;
      slotCandidates.push(getSlotSections(offset));
    }

    const activeSlot = slotCandidates
      .filter((slot) => slot.validCount > 0)
      .sort((a, b) => {
        if (b.validCount !== a.validCount) return b.validCount - a.validCount;
        return b.maxSeq - a.maxSeq;
      })[0];

    if (!activeSlot || activeSlot.validCount < 10) {
      throw new Error('Unable to locate a valid save slot in the uploaded file.');
    }

    const { sectionOffsets, slotOffset: activeSlotOffset } = activeSlot;
    const s0 = sectionOffsets[0];
    const s1 = sectionOffsets[1];
    const s2 = sectionOffsets[2];

    console.log(`Sections found: ${Object.keys(sectionOffsets).join(", ")}`);
    if (s0 === undefined || s1 === undefined) {
      throw new Error('Required save sections (0 and 1) not found.');
    }

    // Get Encryption Key from SaveBlock2 (Section 0)
    const encryptionKey = view.getUint32(s0 + ENCRYPTION_KEY_OFFSET, true);

    // Trainer Name is at start of Section 0
    setTrainerName(decodeString(data.slice(s0, s0 + 12)));

    // Money is XOR encrypted with the key
    const rawMoney = view.getUint32(s1 + MONEY_OFFSET, true);
    const decryptedMoney = (rawMoney ^ encryptionKey) >>> 0;

    // Extract Map Name
    const mapGroup = data[s1 + MAP_GROUP_OFFSET];
    const mapNum = data[s1 + MAP_NUM_OFFSET];
    const currentMapName = MAP_NAMES[mapGroup]?.[mapNum] || `Unknown Map (${mapGroup}, ${mapNum})`;
    
    console.log(`DEBUG: Map Extraction`);
    console.log(`  s1 (Section 1 offset): 0x${s1.toString(16)}`);
    console.log(`  MAP_GROUP_OFFSET: 0x${MAP_GROUP_OFFSET.toString(16)}`);
    console.log(`  mapGroup (raw): ${mapGroup}`);
    console.log(`  mapNum (raw): ${mapNum}`);
    console.log(`  Resolved Name: ${currentMapName}`);

    setMapName(currentMapName);

    // Extract Party
    const partyCount = Math.min(data[s1 + PARTY_COUNT_OFFSET] || 0, 6);
    const extractedParty: Pokemon[] = [];

    for (let i = 0; i < partyCount; i++) {
      const pStart = s1 + PARTY_START_OFFSET + (i * POKEMON_STRUCT_SIZE);
      
      // Personality and OTID are used to decrypt the species
      const personality = view.getUint32(pStart, true);
      const otId = view.getUint32(pStart + 4, true);
      const key = (personality ^ otId) >>> 0;

      // Substructures are shuffled based on personality
      const order = SUBSTRUCTURE_ORDERS[personality % 24];
      
      // 1. Get Species from Growth Block
      const growthIdx = order.indexOf('G');
      const growthOffset = pStart + 32 + (growthIdx * SUBSTRUCTURE_SIZE);
      const rawWord0 = view.getUint32(growthOffset, true);
      const growthFull = new Uint32Array([
        (rawWord0 ^ key) >>> 0,
        (view.getUint32(growthOffset + 4, true) ^ key) >>> 0,
        (view.getUint32(growthOffset + 8, true) ^ key) >>> 0,
        (view.getUint32(growthOffset + 12, true) ^ key) >>> 0
      ]);

      // Expansion packs species into 11 bits (0-10) and Tera Type into 5 bits (11-15)
      // Masking with 0x7FF extracts the clean Species ID
      const speciesId = growthFull[0] & 0x7FF;
      const nickname = decodeString(data.slice(pStart + 8, pStart + 20));

      // DEBUG: Identify Species ID Mismatch
      if (i < 6) {
        console.log(`DEBUG: Party[${i}] "${nickname}"`);
        console.log(`  Extracted speciesId: ${speciesId} (0x${speciesId.toString(16)})`);
        console.log(`  Raw Word 0: 0x${rawWord0.toString(16).padStart(8, '0')}`);
        console.log(`  Decrypted Word 0: 0x${growthFull[0].toString(16).padStart(8, '0')}`);
        if (i === 0) {
          console.log(`  Database Map Sample (Internal IDs in DB):`, Array.from(pokemonById.keys()).slice(0, 20));
        }
      }

      // 2. Get IVs from Miscellaneous Block
      const miscIdx = order.indexOf('M');
      const miscOffset = pStart + 32 + (miscIdx * SUBSTRUCTURE_SIZE);
      const miscFull = new Uint32Array([
        (view.getUint32(miscOffset, true) ^ key) >>> 0,
        (view.getUint32(miscOffset + 4, true) ^ key) >>> 0,
        (view.getUint32(miscOffset + 8, true) ^ key) >>> 0,
        (view.getUint32(miscOffset + 12, true) ^ key) >>> 0
      ]);

      // Blitz/Expansion stores the ability index in Miscellaneous Word 2 (bits 29-30)
      const ability_num = (miscFull[2] >> 29) & 3;

      const decryptedMisc = miscFull[1];
      const ivs = {
        hp: decryptedMisc & 0x1F,
        atk: (decryptedMisc >> 5) & 0x1F,
        def: (decryptedMisc >> 10) & 0x1F,
        spe: (decryptedMisc >> 15) & 0x1F,
        spa: (decryptedMisc >> 20) & 0x1F,
        spd: (decryptedMisc >> 25) & 0x1F,
      };

      // Level and HP are in the Party-specific data (after the 96-byte box struct)
      // Expansion: Box(96) + 4 (status) = 100.
      const level = data[pStart + 100];
      const hp = view.getUint16(pStart + 102, true);
      const maxHp = view.getUint16(pStart + 104, true);

      if (speciesId > 0) {
        extractedParty.push({
          nickname,
          level,
          hp,
          maxHp,
          speciesId,
          ability_num,
          nature: NATURES[personality % 25],
          ivs
        });
      }
    }

    setParty(extractedParty);
    setMoney(decryptedMoney);

    // 4. Extract Badge Count Variable from Section 2
    if (s2 !== undefined) {

      const badges = view.getUint16(s2 + VAR_BADGE_COUNT_OFFSET, true);
      setBadgeCount(badges);

      // Extract Badge 8 Flag (FLAG_BADGE08_GET)
      const flagsStart = s2 + FLAGS_START_OFFSET;
      const byteIdx = FLAG_BADGE08_GET >> 3;
      const bitMask = 1 << (FLAG_BADGE08_GET & 7);
      const badge8Value = (data[flagsStart + byteIdx] & bitMask) !== 0;
      setIsBadge8Get(badge8Value);
    } else {
      console.warn("Section 2 (Variables) not found in save slot.");
      setBadgeCount(0);
    }

    // Extract Box 1 (Section 5)
    const extractedBox1: BoxPokemon[] = [];
    if (sectionOffsets[5] !== undefined) {
      const s5 = sectionOffsets[5];
      const BOX_START_OFFSET = 4; // currentBox variable is 4 bytes
      const BOX_POKEMON_SIZE = 96; // 32 (header) + 4 * 16 (data blocks)

      for (let i = 0; i < 30; i++) {
        const pStart = s5 + BOX_START_OFFSET + (i * BOX_POKEMON_SIZE);
        
        const personality = view.getUint32(pStart, true);
        const otId = view.getUint32(pStart + 4, true);
        const key = (personality ^ otId) >>> 0;
        const order = SUBSTRUCTURE_ORDERS[personality % 24];
        
        const growthIdx = order.indexOf('G');
        const growthOffset = pStart + 32 + (growthIdx * SUBSTRUCTURE_SIZE);
        const decryptedGrowth0 = (view.getUint32(growthOffset, true) ^ key) >>> 0;
        
        const speciesId = decryptedGrowth0 & 0x7FF;

        // Get IVs from Miscellaneous Block
        const miscIdx = order.indexOf('M');
        const miscOffset = pStart + 32 + (miscIdx * SUBSTRUCTURE_SIZE);
        const miscFull = new Uint32Array([
          (view.getUint32(miscOffset, true) ^ key) >>> 0,
          (view.getUint32(miscOffset + 4, true) ^ key) >>> 0,
          (view.getUint32(miscOffset + 8, true) ^ key) >>> 0,
          (view.getUint32(miscOffset + 12, true) ^ key) >>> 0
        ]);

        const ability_num = (miscFull[2] >> 29) & 3;

        const decryptedMisc = miscFull[1];
        const ivs = {
          hp: decryptedMisc & 0x1F,
          atk: (decryptedMisc >> 5) & 0x1F,
          def: (decryptedMisc >> 10) & 0x1F,
          spe: (decryptedMisc >> 15) & 0x1F,
          spa: (decryptedMisc >> 20) & 0x1F,
          spd: (decryptedMisc >> 25) & 0x1F,
        };

        if (speciesId > 0 && speciesId < 0xFFFF) {
          const nickname = decodeString(data.slice(pStart + 8, pStart + 20));

          extractedBox1.push({
            nickname,
            speciesId,
            ability_num,
            nature: NATURES[personality % 25],
            ivs
          });
        }
      }
    }
    setBox1(extractedBox1);

    setError(null);
  };

  return (
    <>
      <Header />
      <main className="save-checker-main">
        <div className="save-checker-container">
          <h1 className="save-checker-title">Emerald Blitz Save Checker</h1>
          <p className="save-checker-description">
            Upload your <code>.sav</code> file to verify your progress and set flags.
          </p>

          <div className="upload-section">
            <label htmlFor="save-upload" className="custom-file-upload">
              Choose .sav File
            </label>
            <input id="save-upload" type="file" accept=".sav" onChange={handleFileUpload} />
          </div>

          {error && <div className="save-checker-error">{error}</div>}

          {money !== null && trainerName && (
            <div className="save-results-wrapper">
              <div className="trainer-header">
                <h2>Trainer {trainerName}</h2>
              </div>
            <div className="stats-summary">
              <div className="stat-item">
                <span className="stat-label">Wallet</span>
                <span className="stat-value">₽{money.toLocaleString()}</span>
              </div>
              <div className="stat-item">
                <span className="stat-label">Badges</span>
                <span className="stat-value">{badgeCount}</span>
              </div>
              <div className="stat-item">
                <span className="stat-label">Location</span>
                <span className="stat-value">{mapName}</span>
              </div>
            </div>
            </div>
          )}

          {party.length > 0 && (
            <div className="party-section">
              <h2>Current Party</h2>
              <div className="party-grid">
                {party.map((mon, i) => {
                  const speciesData = resolveMetadata(mon.speciesId, mon.nickname);
                  const realName = mon.speciesId === 412 ? "Egg" : (speciesData?.name || `ID ${mon.speciesId}`);
                  const abilityName = speciesData?.abilities ? speciesData.abilities[mon.ability_num] : 'Unknown';
                  
                  // Only show the nickname if it's actually a nickname, not just a truncated species name
                  const isTruncatedMatch = realName.toLowerCase().startsWith(mon.nickname.toLowerCase()) && mon.nickname.length >= 10;
                  const hasNickname = mon.nickname && mon.nickname.toLowerCase() !== realName.toLowerCase() && !isTruncatedMatch;

                  return (
                    <div key={i} className={`pokemon-card ${mon.hp === 0 ? 'fainted' : ''}`}>
                    <div className="mon-info">
                      <span className="mon-name">
                        {hasNickname ? (
                          <>{mon.nickname} <span style={{ opacity: 0.6, fontSize: '0.9em' }}>({realName})</span></>
                        ) : realName}{' '}
                        <span className="mon-ability" style={{ fontSize: '0.8rem', opacity: 0.7, fontWeight: 'normal' }}>
                          ({abilityName})
                        </span>
                      </span>
                      <span className="mon-level">Lv. {mon.level}</span>
                    </div>
                    <div className="mon-nature">{mon.nature} Nature{NATURE_EFFECTS[mon.nature]}</div>
                    <div className="hp-bar-container">
                      <div className="hp-bar-fill" style={{ width: `${(mon.hp / mon.maxHp) * 100}%` }}></div>
                    </div>
                    <div className="hp-text">{mon.hp} / {mon.maxHp} HP</div>
                    {mon.ivs && (
                      <div className="iv-grid" style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 16px', fontSize: '0.85rem', marginTop: '8px', opacity: 0.8 }}>
                        <span style={{ color: mon.ivs.hp > 24 ? '#4ade80' : mon.ivs.hp < 8 ? '#f87171' : 'inherit', fontWeight: mon.ivs.hp > 24 ? '600' : 'normal' }}>HP: {mon.ivs.hp}</span>
                        <span style={{ color: mon.ivs.atk > 24 ? '#4ade80' : mon.ivs.atk < 8 ? '#f87171' : 'inherit', fontWeight: mon.ivs.atk > 24 ? '600' : 'normal' }}>ATK: {mon.ivs.atk}</span>
                        <span style={{ color: mon.ivs.def > 24 ? '#4ade80' : mon.ivs.def < 8 ? '#f87171' : 'inherit', fontWeight: mon.ivs.def > 24 ? '600' : 'normal' }}>DEF: {mon.ivs.def}</span>
                        <span style={{ color: mon.ivs.spa > 24 ? '#4ade80' : mon.ivs.spa < 8 ? '#f87171' : 'inherit', fontWeight: mon.ivs.spa > 24 ? '600' : 'normal' }}>SPA: {mon.ivs.spa}</span>
                        <span style={{ color: mon.ivs.spd > 24 ? '#4ade80' : mon.ivs.spd < 8 ? '#f87171' : 'inherit', fontWeight: mon.ivs.spd > 24 ? '600' : 'normal' }}>SPD: {mon.ivs.spd}</span>
                        <span style={{ color: mon.ivs.spe > 24 ? '#4ade80' : mon.ivs.spe < 8 ? '#f87171' : 'inherit', fontWeight: mon.ivs.spe > 24 ? '600' : 'normal' }}>SPE: {mon.ivs.spe}</span>
                      </div>
                    )}
                  </div>
                  );
                })}
              </div>
            </div>
          )}

          {box1.length > 0 && (
            <div className="party-section">
              <h2>Box 1</h2>
              <div className="party-grid">
                {box1.map((mon, i) => {
                  const speciesData = resolveMetadata(mon.speciesId, mon.nickname);
                  const realName = mon.speciesId === 412 ? "Egg" : (speciesData?.name || `ID ${mon.speciesId}`);
                  const abilityName = speciesData?.abilities ? speciesData.abilities[mon.ability_num] : 'Unknown';
                  
                  const isTruncatedMatch = realName.toLowerCase().startsWith(mon.nickname.toLowerCase()) && mon.nickname.length >= 10;
                  const hasNickname = mon.nickname && mon.nickname.toLowerCase() !== realName.toLowerCase() && !isTruncatedMatch;

                  return (
                    <div key={i} className="pokemon-card">
                    <div className="mon-info">
                      <span className="mon-name">
                        {hasNickname ? (
                          <>{mon.nickname} <span style={{ opacity: 0.6, fontSize: '0.9em' }}>({realName})</span></>
                        ) : realName}{' '}
                        <span className="mon-ability" style={{ fontSize: '0.8rem', opacity: 0.7, fontWeight: 'normal' }}>
                          ({abilityName})
                        </span>
                      </span>
                    </div>
                    <div className="mon-nature">{mon.nature} Nature{NATURE_EFFECTS[mon.nature]}</div>
                    {mon.ivs && (
                      <div className="iv-grid" style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 16px', fontSize: '0.85rem', marginTop: '8px', opacity: 0.8 }}>
                        <span style={{ color: mon.ivs.hp > 24 ? '#4ade80' : mon.ivs.hp < 8 ? '#f87171' : 'inherit', fontWeight: mon.ivs.hp > 24 ? '600' : 'normal' }}>HP: {mon.ivs.hp}</span>
                        <span style={{ color: mon.ivs.atk > 24 ? '#4ade80' : mon.ivs.atk < 8 ? '#f87171' : 'inherit', fontWeight: mon.ivs.atk > 24 ? '600' : 'normal' }}>ATK: {mon.ivs.atk}</span>
                        <span style={{ color: mon.ivs.def > 24 ? '#4ade80' : mon.ivs.def < 8 ? '#f87171' : 'inherit', fontWeight: mon.ivs.def > 24 ? '600' : 'normal' }}>DEF: {mon.ivs.def}</span>
                        <span style={{ color: mon.ivs.spa > 24 ? '#4ade80' : mon.ivs.spa < 8 ? '#f87171' : 'inherit', fontWeight: mon.ivs.spa > 24 ? '600' : 'normal' }}>SPA: {mon.ivs.spa}</span>
                        <span style={{ color: mon.ivs.spd > 24 ? '#4ade80' : mon.ivs.spd < 8 ? '#f87171' : 'inherit', fontWeight: mon.ivs.spd > 24 ? '600' : 'normal' }}>SPD: {mon.ivs.spd}</span>
                        <span style={{ color: mon.ivs.spe > 24 ? '#4ade80' : mon.ivs.spe < 8 ? '#f87171' : 'inherit', fontWeight: mon.ivs.spe > 24 ? '600' : 'normal' }}>SPE: {mon.ivs.spe}</span>
                      </div>
                    )}
                  </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </main>
      <Footer />
    </>
  );
};

export default SaveChecker;