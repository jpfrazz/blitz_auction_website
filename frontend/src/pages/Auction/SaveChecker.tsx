import React, { useState } from 'react';
import Header from '../../shared/components/Header';
import Footer from '../../shared/components/Footer';
import './SaveChecker.scss';

const SECTION_SIZE = 4096;
const NUM_SECTIONS = 14;
const SLOT_SIZE = SECTION_SIZE * NUM_SECTIONS;
const FOOTER_OFFSET = 0xFF4;
const SIGNATURE = 0x08012025;

// Section boundaries
const SECTION_DATA_SIZE = 3968; // 0xF80 bytes
const ENCRYPTION_KEY_OFFSET = 0xAC; // In SaveBlock2 (Section 0)
const MONEY_OFFSET = 0x4F0; // Money is at 0x4F0 in Section 1
const VAR_BADGE_COUNT_OFFSET = 0x76A;
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

const SPECIES_NAMES: { [key: number]: string } = {};

interface Pokemon {
  nickname: string;
  level: number;
  hp: number;
  maxHp: number;
  speciesId: number;
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
  const [money, setMoney] = useState<number | null>(null);
  const [badgeCount, setBadgeCount] = useState<number | null>(null);
  const [isBadge8Get, setIsBadge8Get] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

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
      else if (b >= 0xBB && b <= 0xD4) result += String.fromCharCode(b - 0xBB + 65); // A-Z
      else if (b >= 0xD5 && b <= 0xEE) result += String.fromCharCode(b - 0xD5 + 97); // a-z
      else if (b >= 0xA1 && b <= 0xAA) result += String.fromCharCode(b - 0xA1 + 48); // 0-9
      else result += "?";
    }
    return result.trim();
  };

  const parseSaveData = (data: Uint8Array) => {
    const view = new DataView(data.buffer);

    const getSlotSections = (slotOffset: number) => {
      const sectionOffsets: Record<number, number> = {};
      let validCount = 0;
      let maxSeq = 0;

      for (let i = 0; i < 32; i++) { // Emerald Blitz may use more than 14 sections
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

    console.log(`Sections found: ${Object.keys(sectionOffsets).join(", ")}`);

    if (s0 === undefined || s1 === undefined) {
      throw new Error('Required save sections (0 and 1) not found.');
    }

    // Get Encryption Key from SaveBlock2 (Section 0)
    const encryptionKey = view.getUint32(s0 + ENCRYPTION_KEY_OFFSET, true);

    // Trainer Name is at start of Section 0
    setTrainerName(decodeString(data.slice(s0, s0 + 8)));

    // Money is XOR encrypted with the key
    const rawMoney = view.getUint32(s1 + MONEY_OFFSET, true);
    const decryptedMoney = (rawMoney ^ encryptionKey) >>> 0;

    // Extract Party
    const partyCount = Math.min(data[s1 + PARTY_COUNT_OFFSET], 6);
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
      const encryptedSpecies = view.getUint16(growthOffset, true);
      const speciesId = (encryptedSpecies ^ (key & 0xFFFF)) & 0xFFFF;

      // 2. Get IVs from Miscellaneous Block
      const miscIdx = order.indexOf('M');
      const miscOffset = pStart + 32 + (miscIdx * SUBSTRUCTURE_SIZE);
      const decryptedMisc = (view.getUint32(miscOffset + 4, true) ^ key) >>> 0;
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
      const nickname = decodeString(data.slice(pStart + 8, pStart + 18));

      if (speciesId > 0) {
        extractedParty.push({
          nickname: nickname || (speciesId === 412 ? "Egg" : `Species ${speciesId}`),
          level,
          hp,
          maxHp,
          speciesId,
          nature: NATURES[personality % 25],
          ivs
        });
      }
    }

    setParty(extractedParty);
    setMoney(decryptedMoney);

    // 4. Extract Badge Count Variable from Section 2
    if (sectionOffsets[2] !== undefined) {
      const s2 = sectionOffsets[2];
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
              {isBadge8Get !== null && (
                <div className="stat-item">
                  <span className="stat-label">Badge 8 Defeated</span>
                  <span className="stat-value">{isBadge8Get ? "Yes" : "No"}</span>
                </div>
              )}
            </div>
            </div>
          )}

          {party.length > 0 && (
            <div className="party-section">
              <h2>Current Party</h2>
              <div className="party-grid">
                {party.map((mon, i) => (
                  <div key={i} className={`pokemon-card ${mon.hp === 0 ? 'fainted' : ''}`}>
                    <div className="mon-info">
                      <span className="mon-name">{mon.nickname} </span>
                      <span className="mon-level">Lv. {mon.level}</span>
                    </div>
                    <div className="mon-nature">{mon.nature} Nature</div>
                    <div className="hp-bar-container">
                      <div className="hp-bar-fill" style={{ width: `${(mon.hp / mon.maxHp) * 100}%` }}></div>
                    </div>
                    <div className="hp-text">{mon.hp} / {mon.maxHp} HP</div>
                    <div className="iv-grid" style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 16px', fontSize: '0.85rem', marginTop: '8px', opacity: 0.8 }}>
                      <span>HP: {mon.ivs.hp}</span>
                      <span>ATK: {mon.ivs.atk}</span>
                      <span>DEF: {mon.ivs.def}</span>
                      <span>SPA: {mon.ivs.spa}</span>
                      <span>SPD: {mon.ivs.spd}</span>
                      <span>SPE: {mon.ivs.spe}</span>
                    </div>
                  </div>
                ))}
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