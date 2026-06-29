import React, { useEffect, useState } from 'react';
import Header from '../../shared/components/Header';
import Footer from '../../shared/components/Footer';
import { parseSaveFile, SavePokemon, SaveBoxPokemon, getTrainerNameById } from '../../utils/parseSaveFile';
import { fetchPokemonList } from '../../shared/api/pokemon';
import './SaveChecker.scss';

const FLAGS_START_OFFSET = 0x63D; // Found via debug scanner
const FLAG_BADGE08_GET = 0x867;

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

const SaveChecker: React.FC = () => {
  const [trainerName, setTrainerName] = useState<string | null>(null);
  const [party, setParty] = useState<SavePokemon[]>([]);
  const [box1, setBox1] = useState<SaveBoxPokemon[]>([]);
  const [money, setMoney] = useState<number | null>(null);
  const [badgeCount, setBadgeCount] = useState<number | null>(null);
  const [mapName, setMapName] = useState<string | null>(null);
  const [isBadge8Get, setIsBadge8Get] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pokemonMetadata, setPokemonMetadata] = useState<Record<string, any>>({});
  const [pokemonById, setPokemonById] = useState<Map<number, any[]>>(new Map());
  const [lastSaveData, setLastSaveData] = useState<Uint8Array | null>(null);
  const [mostRecentLoss, setMostRecentLoss] = useState<{ trainer_id: number; hours: number; minutes: number; seconds: number } | null>(null);
  const [mostRecentLossName, setMostRecentLossName] = useState<string | null>(null);
  const [trainerCardWins, setTrainerCardWins] = useState<{ trainer_id: number; hours: number; minutes: number; seconds: number; is_loss: boolean; version?: number }[]>([]);

  useEffect(() => {
    fetchPokemonList().then((list) => {
      const map: Record<string, any> = {};
      const idMap = new Map<number, any[]>();
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
          const numId = Number(id);
          const existing = idMap.get(numId) || [];
          existing.push(entry);
          idMap.set(numId, existing);
        }
      }
      setPokemonMetadata(map);
      setPokemonById(idMap);
    }).catch(() => {});
  }, []);

  const resolveMetadata = (speciesId: number, nickname: string | undefined) => {
    console.log(`[Debug] Resolving: speciesId=${speciesId}, nickname=${nickname}`);

    // 1. Try direct ID lookup. This is the most reliable method.
    const candidates = pokemonById.get(speciesId);
    let data: any = null;

    if (candidates) {
      const singleCandidate = candidates.length === 1 ? candidates[0] : null;
      const isNameMismatch = singleCandidate && nickname && !singleCandidate.name.toLowerCase().startsWith(nickname.toLowerCase());

      // If the ID lookup fails or is ambiguous, immediately try to find a form-based match
      // using the nickname. This is crucial for Pokémon like Deerling.
      if ((!singleCandidate || isNameMismatch) && nickname) {
        const formMatch = Object.values(pokemonMetadata).find(p => 
          p.name.toLowerCase().startsWith(nickname.toLowerCase()) && Number(p.pokedex_id) === speciesId
        );
        if (formMatch) return formMatch;
      }
      else if (candidates.length > 1 || isNameMismatch) {
        // If multiple candidates or a name mismatch, use the nickname to find the correct form.
        if (nickname) {
          data = candidates.find(p => p.name.toLowerCase().startsWith(nickname.toLowerCase()));
        }
        // If still no match, we can't be sure, so we don't assign data yet.
      } else if (singleCandidate) {
        data = singleCandidate;
      }
    }
    if (data) console.log(`[Debug] Found by ID: ${data.name}`);
    else console.log(`[Debug] Not found by ID, or ID match was ambiguous.`);
    
    if (!data && nickname) {
      let searchName = nickname.toLowerCase();
      // Special handling for Deerling/Sawsbuck, which have no base form in the DB.
      if (searchName === 'deerling') {
        searchName = 'deerling-spring';
      } else if (searchName === 'sawsbuck') {
        searchName = 'sawsbuck-spring';
      }
      data = pokemonMetadata[searchName];
      
      // Try normalized lookup for accented names
      if (!data) {
        console.log(`[Debug] Nickname fallback: trying normalized '${searchName}'`);
        const normalized = searchName.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        data = pokemonMetadata[normalized];
      }

      // Handle forms (e.g. "Deerling" matching "Deerling-Spring") or truncated names
      if (!data) {
        console.log(`[Debug] Nickname fallback: trying startsWith '${searchName}'`);
        data = Object.values(pokemonMetadata).find(p => 
          p.name.toLowerCase().startsWith(searchName)
        );
      }

      if (data) console.log(`[Debug] Found by nickname fallback: ${data.name}`);
      else console.log(`[Debug] Not found by nickname fallback.`);

    }

    // 4. Handle Mega Evolution redirection to treat them as base forms
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
        const saveDataBytes = new Uint8Array(buffer);
        const parsedData = parseSaveFile(saveDataBytes, pokemonMetadata, pokemonById);

        setTrainerName(parsedData.trainer_name);
        setMoney(parsedData.money);
        setBadgeCount(parsedData.badge_count);
        setMapName(parsedData.map_name);
        setParty(parsedData.party);
        setBox1(parsedData.box);
        setLastSaveData(saveDataBytes); // Store for flag checking
        setMostRecentLoss(parsedData.most_recent_loss);
        setMostRecentLossName(parsedData.most_recent_loss_name);
        setTrainerCardWins(parsedData.trainer_card_wins);
        setError(null);

      } catch (err) {
        console.error(err);
        setError("Failed to parse save file. Ensure it is a valid GBA .sav file.");
        setLastSaveData(null);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  // This logic is not yet part of the refactored parseSaveFile, so it remains here.
  // It could be moved if the parser was enhanced to also find section offsets.
  // useEffect(() => {
  //   if (!lastSaveData) return;
  //   // Extract Badge 8 Flag (FLAG_BADGE08_GET)
  //   const flagsStart = s2 + FLAGS_START_OFFSET;
  //   const byteIdx = FLAG_BADGE08_GET >> 3;
  //   const bitMask = 1 << (FLAG_BADGE08_GET & 7);
  //   const badge8Value = (data[flagsStart + byteIdx] & bitMask) !== 0;
  //   setIsBadge8Get(badge8Value);
  // }, [lastSaveData]);

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
            {mostRecentLoss && (
              <div className="stats-summary">
                <div className="stat-item">
                  <span className="stat-label">Last Wipe To</span>
                  <span className="stat-value">{mostRecentLossName || `Trainer ID: ${mostRecentLoss.trainer_id}`}</span>
                </div>
                <div className="stat-item">
                  <span className="stat-label">Battle Time</span>
                  <span className="stat-value">{mostRecentLoss.hours}h {mostRecentLoss.minutes}m {mostRecentLoss.seconds}s</span>
                </div>
              </div>
            )}
            {trainerCardWins.length > 0 && (
              <div className="boss-battle-history">
                <h3>Boss Battle History</h3>
                <div className="battle-history-list">
                  {trainerCardWins.map((win, i) => (
                    <div key={i} className={`battle-history-item ${win.is_loss ? 'loss' : 'win'}`}>
                      <span className="battle-trainer">{getTrainerNameById(win.trainer_id, win.version)}</span>
                      <span className="battle-time">{win.hours}h {win.minutes}m {win.seconds}s</span>
                      <span className="battle-result">{win.is_loss ? 'Loss' : 'Win'}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            </div>
          )}

          {party.length > 0 && (
            <div className="party-section">
              <h2>Current Party</h2>
              <div className="party-grid">
                {party.map((mon, i) => {
                  const speciesData = resolveMetadata(mon.species_id, mon.nickname);                  
                  const realName = (mon.species_id === 412 && mon.nickname?.toLowerCase() === 'egg') ? "Egg" : (speciesData?.name || `ID ${mon.species_id}`);
                  const abilityName = speciesData?.abilities ? speciesData.abilities[mon.ability_num] : 'Unknown';
                  
                  // Only show the nickname if it's actually a nickname, not just a truncated species name
                  const isTruncatedMatch = realName.toLowerCase().startsWith(mon.nickname.toLowerCase()) && mon.nickname.length >= 10;
                  const hasNickname = mon.nickname && mon.nickname.toLowerCase() !== realName.toLowerCase() && !isTruncatedMatch;

                  return (
                    <div key={i} className={`pokemon-card ${mon.hp === 0 ? 'fainted' : ''}`} data-testid={`party-mon-${i}`}>
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
                      <div className="hp-bar-fill" style={{ width: `${(mon.hp / mon.max_hp) * 100}%` }}></div>
                    </div>
                    <div className="hp-text">{mon.hp} / {mon.max_hp} HP</div>
                    {mon.ivs && (
                      <div className="iv-grid" style={{ display: 'flex', justifyContent: 'space-around', width: '100%', marginTop: '8px', opacity: 0.9 }}>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', lineHeight: 1.1 }}>
                          <span style={{ fontSize: '0.8rem', opacity: 0.8 }}>HP</span>
                          <span style={{ fontSize: '.9rem', color: mon.ivs.hp > 24 ? '#4ade80' : mon.ivs.hp < 8 ? '#f87171' : 'inherit', fontWeight: mon.ivs.hp > 24 ? '600' : 'normal' }}>{mon.ivs.hp}</span>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', lineHeight: 1.1 }}>
                          <span style={{ fontSize: '0.8rem', opacity: 0.8 }}>ATK</span>
                          <span style={{ fontSize: '.9rem', color: mon.ivs.atk > 24 ? '#4ade80' : mon.ivs.atk < 8 ? '#f87171' : 'inherit', fontWeight: mon.ivs.atk > 24 ? '600' : 'normal' }}>{mon.ivs.atk}</span>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', lineHeight: 1.1 }}>
                          <span style={{ fontSize: '0.8rem', opacity: 0.8 }}>DEF</span>
                          <span style={{ fontSize: '.9rem', color: mon.ivs.def > 24 ? '#4ade80' : mon.ivs.def < 8 ? '#f87171' : 'inherit', fontWeight: mon.ivs.def > 24 ? '600' : 'normal' }}>{mon.ivs.def}</span>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', lineHeight: 1.1 }}>
                          <span style={{ fontSize: '0.8rem', opacity: 0.8 }}>SPA</span>
                          <span style={{ fontSize: '.9rem', color: mon.ivs.spa > 24 ? '#4ade80' : mon.ivs.spa < 8 ? '#f87171' : 'inherit', fontWeight: mon.ivs.spa > 24 ? '600' : 'normal' }}>{mon.ivs.spa}</span>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', lineHeight: 1.1 }}>
                          <span style={{ fontSize: '0.8rem', opacity: 0.8 }}>SPD</span>
                          <span style={{ fontSize: '.9rem', color: mon.ivs.spd > 24 ? '#4ade80' : mon.ivs.spd < 8 ? '#f87171' : 'inherit', fontWeight: mon.ivs.spd > 24 ? '600' : 'normal' }}>{mon.ivs.spd}</span>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', lineHeight: 1.1 }}>
                          <span style={{ fontSize: '0.8rem', opacity: 0.8 }}>SPE</span>
                          <span style={{ fontSize: '.9rem', color: mon.ivs.spe > 24 ? '#4ade80' : mon.ivs.spe < 8 ? '#f87171' : 'inherit', fontWeight: mon.ivs.spe > 24 ? '600' : 'normal' }}>{mon.ivs.spe}</span>
                        </div>
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
                  const speciesData = resolveMetadata(mon.species_id, mon.nickname);                  
                  const realName = (mon.species_id === 412 && mon.nickname?.toLowerCase() === 'egg') ? "Egg" : (speciesData?.name || `ID ${mon.species_id}`);
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
                      <div className="iv-grid" style={{ display: 'flex', justifyContent: 'space-around', width: '100%', marginTop: '8px', opacity: 0.9 }}>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', lineHeight: 1.1 }}>
                          <span style={{ fontSize: '0.8rem', opacity: 0.8 }}>HP</span>
                          <span style={{ fontSize: '.9rem', color: mon.ivs.hp > 24 ? '#4ade80' : mon.ivs.hp < 8 ? '#f87171' : 'inherit', fontWeight: mon.ivs.hp > 24 ? '600' : 'normal' }}>{mon.ivs.hp}</span>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', lineHeight: 1.1 }}>
                          <span style={{ fontSize: '0.8rem', opacity: 0.8 }}>ATK</span>
                          <span style={{ fontSize: '.9rem', color: mon.ivs.atk > 24 ? '#4ade80' : mon.ivs.atk < 8 ? '#f87171' : 'inherit', fontWeight: mon.ivs.atk > 24 ? '600' : 'normal' }}>{mon.ivs.atk}</span>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', lineHeight: 1.1 }}>
                          <span style={{ fontSize: '0.8rem', opacity: 0.8 }}>DEF</span>
                          <span style={{ fontSize: '.9rem', color: mon.ivs.def > 24 ? '#4ade80' : mon.ivs.def < 8 ? '#f87171' : 'inherit', fontWeight: mon.ivs.def > 24 ? '600' : 'normal' }}>{mon.ivs.def}</span>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', lineHeight: 1.1 }}>
                          <span style={{ fontSize: '0.8rem', opacity: 0.8 }}>SPA</span>
                          <span style={{ fontSize: '.9rem', color: mon.ivs.spa > 24 ? '#4ade80' : mon.ivs.spa < 8 ? '#f87171' : 'inherit', fontWeight: mon.ivs.spa > 24 ? '600' : 'normal' }}>{mon.ivs.spa}</span>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', lineHeight: 1.1 }}>
                          <span style={{ fontSize: '0.8rem', opacity: 0.8 }}>SPD</span>
                          <span style={{ fontSize: '.9rem', color: mon.ivs.spd > 24 ? '#4ade80' : mon.ivs.spd < 8 ? '#f87171' : 'inherit', fontWeight: mon.ivs.spd > 24 ? '600' : 'normal' }}>{mon.ivs.spd}</span>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', lineHeight: 1.1 }}>
                          <span style={{ fontSize: '0.8rem', opacity: 0.8 }}>SPE</span>
                          <span style={{ fontSize: '.9rem', color: mon.ivs.spe > 24 ? '#4ade80' : mon.ivs.spe < 8 ? '#f87171' : 'inherit', fontWeight: mon.ivs.spe > 24 ? '600' : 'normal' }}>{mon.ivs.spe}</span>
                        </div>
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