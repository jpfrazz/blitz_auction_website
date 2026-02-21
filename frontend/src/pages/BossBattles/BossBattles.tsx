import React, { useState, useEffect, useMemo } from 'react';
import Header from '../../shared/components/Header';
import Footer from '../../shared/components/Footer';
import './BossBattles.scss';

const gymLeaders = [
  'VIOLA', 'ROXANNE', 'BRAWLY', 'WATTSON',
  'FLANNERY', 'NORMAN', 'WINONA', 'TATE AND LIZA', 'JUAN AND WALLACE'
];

const e4Members = [
  'SIDNEY', 'SPENSER', 'PHOEBE', 'LUCY', 'GLACIA', 'TUCKER', 'DRAKE', 'BRANDON'
];

const trainerTypeColors: Record<string, string> = {
  'VIOLA': '#9ACD32',     // Bug
  'ROXANNE': '#B8A038',   // Rock
  'BRAWLY': '#C03028',    // Fighting
  'WATTSON': '#F8D030',   // Electric
  'FLANNERY': '#F08030',  // Fire
  'NORMAN': '#A8A875',    // Normal
  'WINONA': '#A890F0',    // Flying
  'TATE&LIZA': '#705898', // Psychic
  'JUAN': '#6890F0',      // Water
  'JUAN&WALCE': '#6890F0', // Water
  'SIDNEY': '#705848',    // Dark
  'PHOEBE': '#705898',    // Ghost
  'GLACIA': '#98D8D8',    // Ice
  'DRAKE': '#7038F8',     // Dragon
  'STEVEN': '#B8B8D0',    // Steel
  'SPENSER': '#78C850',   // Grass
  'LUCY': '#A040A0',      // Poison
  'TUCKER': '#EE99AC',    // Fairy
  'BRANDON': '#E0C068',   // Ground
  'WALLY': '#3CB371',     // Wally Green
};

interface PokemonData {
  name: string;
  item: string;
  imageUrl: string;
  details: React.ReactNode[];
}

interface TrainerData {
  id: string;
  displayName: string;
  trainerKey: string;
  stage: string;
  color?: string;
  infoLines: (string | React.ReactNode)[];
  pokemon: PokemonData[];
}

const BossBattles = () => {
  const [gymsText, setGymsText] = useState<string>('');
  const [selectedStage, setSelectedStage] = useState<string>('');
  const [selectedTrainer, setSelectedTrainer] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/gyms.txt')
      .then(res => {
        if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
        return res.text();
      })
      .then(text => {
        if (text.trim().startsWith('<!DOCTYPE html>') || text.trim().startsWith('<html')) {
          throw new Error('gyms.txt not found (returned HTML). Please ensure gyms.txt is in the public folder.');
        }
        setGymsText(text);
        setLoading(false);
      })
      .catch(err => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  const parsedTrainers = useMemo(() => {
    if (!gymsText) return [];
    const sections = gymsText.split('=== TRAINER_').slice(1);
    const trainers: TrainerData[] = [];

    sections.forEach((section, index) => {
      const lines = section.split('\n');
      let trainerIdLine = lines[0].trim().replace(/_/g, ' ').replace(/===/g, '').trim();
      
      if (trainerIdLine.startsWith('JUAN')) {
        trainerIdLine = trainerIdLine.replace('JUAN', 'Juan and Wallace');
      } else {
        trainerIdLine = trainerIdLine.split(' ').map(word => {
          if (/^[A-Z&]+$/.test(word)) {
            if (word.toLowerCase() === 'and') return 'and';
            return word.charAt(0) + word.slice(1).toLowerCase();
          }
          return word;
        }).join(' ');
      }

      const nameLine = lines.find(line => line.trim().startsWith('Name:'));
      let trainerKey = '';
      let stage = '';
      let color = undefined;

      if (nameLine) {
        const rawName = nameLine.split(':')[1].trim();
        trainerKey = rawName.replace(/ & /g, '&').toUpperCase();
        
        // Color logic
        if (trainerTypeColors[trainerKey]) {
          color = trainerTypeColors[trainerKey];
        }

        // Stage logic
        const trainerIdUpper = lines[0].trim().replace(/_/g, ' ').replace(/===/g, '').trim().toUpperCase();
        const match = trainerIdUpper.match(/^(.*?)(?:\s+(\d+))?$/);
        
        if (match) {
          const baseName = match[1];
          if (gymLeaders.includes(baseName)) {
             stage = match[2] ? `gym-${match[2]}` : 'gym';
          } else if (e4Members.includes(trainerKey)) {
            stage = 'e4';
          } else if (['ARCHIE', 'MAXIE'].includes(trainerKey)) {
            stage = 'gym-8';
          } else if (trainerKey === 'STEVEN' || trainerKey === 'WALLY') {
            stage = 'champion';
          }
        }
      }

      const pokemonList: PokemonData[] = [];
      const infoLines: (string | React.ReactNode)[] = [];
      let currentPokemon: Partial<PokemonData> | null = null;
      const prefixesToIgnore = ['Class:', 'Pic:', 'Gender:', 'Music:', 'Double Battle:', 'IVs:', 'Nature:', 'AI:', 'Mugshot:'];
      const nonPokemonPrefixes = ['Name:', 'Items:', 'Level:', 'Ability:', '-'];

      for (const line of lines.slice(1)) {
        const trimmedLine = line.trim();
        if (trimmedLine === '' || trimmedLine.startsWith('Name:') || prefixesToIgnore.some(p => trimmedLine.startsWith(p))) {
          if (trimmedLine === '' && currentPokemon) {
            pokemonList.push(currentPokemon as PokemonData);
            currentPokemon = null;
          }
          continue;
        }

        const isPokemonLine = trimmedLine.length > 0 && !nonPokemonPrefixes.some(p => trimmedLine.startsWith(p));

        if (isPokemonLine) {
          if (currentPokemon) pokemonList.push(currentPokemon as PokemonData);
          
          const [pokemonNamePart, itemPart] = trimmedLine.split('@');
          const pokemonName = pokemonNamePart.trim();
          const imageName = pokemonName.toLowerCase()
            .replace(/ /g, '-')
            .replace(/[.'’]/g, '')
            .replace(/♀/g, '-f')
            .replace(/♂/g, '-m')
            .replace(/-hisui$/, '-hisuian')
            .replace(/-galar$/, '-galarian')
            .replace(/-alola$/, '-alolan');
          
          currentPokemon = {
            name: pokemonName,
            item: itemPart ? itemPart.trim() : '',
            imageUrl: `https://img.pokemondb.net/sprites/home/normal/${imageName}.png`,
            details: []
          };
        } else if (currentPokemon) {
          if (trimmedLine.startsWith('-')) {
            const moveName = trimmedLine.substring(1).trim();
            const moveUrlName = moveName.toLowerCase().replace(/ /g, '-');
            currentPokemon.details?.push(
              <div key={moveName}>- <a href={`https://pokemondb.net/move/${moveUrlName}`} target="_blank" rel="noopener noreferrer" className="move-link">{moveName}</a></div>
            );
          } else if (trimmedLine.startsWith('Ability:')) {
            const abilityName = trimmedLine.split(':')[1].trim();
            const abilityUrlName = abilityName.toLowerCase().replace(/ /g, '-');
            currentPokemon.details?.push(
              <div key={abilityName}>Ability: <a href={`https://pokemondb.net/ability/${abilityUrlName}`} target="_blank" rel="noopener noreferrer" className="move-link">{abilityName}</a></div>
            );
          } else {
            currentPokemon.details?.push(<div key={trimmedLine}>{trimmedLine}</div>);
          }
        } else {
          infoLines.push(trimmedLine);
        }
      }
      if (currentPokemon) pokemonList.push(currentPokemon as PokemonData);

      const trainerIdUpper = lines[0].trim().replace(/_/g, ' ').replace(/===/g, '').trim().toUpperCase();
      const match = trainerIdUpper.match(/^(.*?)(?:\s+(\d+))?$/);
      if (match) {
        const baseName = match[1];
        const gymNum = match[2];
        if (baseName.includes('JUAN')) {
          infoLines.push(
            <span>In Blitz, when Tatsugiri becomes a Commander, he disappears inside the mouth of his ally, raising their Attack, SpAtk, and Speed, but preventing them from landing critical hits.</span>
          );
          if (['6', '7', '8'].includes(gymNum)) {
            infoLines.push(
              <span style={{ fontWeight: 'bold' }}>Heads Up! Tatsugiri can command Dondozo <i>and</i> Whiscash!</span>
            );
          }
        }
      }

      trainers.push({
        id: `trainer-${index}`,
        displayName: trainerIdLine,
        trainerKey,
        stage,
        color,
        infoLines,
        pokemon: pokemonList
      });
    });

    return trainers;
  }, [gymsText]);

  const filteredTrainers = useMemo(() => {
    return parsedTrainers.filter(trainer => {
      if (selectedStage && trainer.stage !== selectedStage) return false;
      
      if (selectedTrainer) {
        const match = selectedTrainer.match(/^(.*?)(?:\s+(\d+))?$/);
        const name = match ? match[1].trim() : selectedTrainer;
        const number = match && match[2] ? Number(match[2]) : null;

        const normalizedTrainerName = name.replace(/\sand\s/gi, ' AND ').toUpperCase();
        
        if (trainer.trainerKey !== normalizedTrainerName) return false;
        if (number !== null && trainer.stage !== `gym-${number}`) return false;
      }
      return true;
    });
  }, [parsedTrainers, selectedStage, selectedTrainer]);

  const trainerOptions = useMemo(() => {
    if (!selectedStage) return [];
    
    if (selectedStage.includes('gym')) {
      const gymMatch = selectedStage.match(/^gym-(\d+)$/);
      const gymNumber = gymMatch ? gymMatch[1] : '';
      
      const options = gymLeaders.map(leader => ({
        value: `${leader} ${gymNumber}`,
        label: `${leader} ${gymNumber}`
      }));

      if (gymNumber === '8') {
        options.push({ value: 'ARCHIE', label: 'ARCHIE' });
        options.push({ value: 'MAXIE', label: 'MAXIE' });
      }
      return options;
    } else if (selectedStage === 'e4') {
      return e4Members.map(member => ({ value: member, label: member }));
    } else if (selectedStage === 'champion') {
      return [
        { value: 'STEVEN', label: 'Steven' },
        { value: 'WALLY', label: 'Wally' }
      ];
    }
    return [];
  }, [selectedStage]);

  return (
    <>
      <Header />
      <main className="boss-battles-page" style={{ padding: '7.5rem 16px 0' }}>
        <h1 className="page-title">Boss Battles</h1>
        
        <div className="controls-container">
          <div className="control-group">
            <label htmlFor="boss-slot-select">Stage:</label>
            <select 
              id="boss-slot-select" 
              value={selectedStage} 
              onChange={(e) => {
                setSelectedStage(e.target.value);
                setSelectedTrainer('');
              }}
            >
              <option value="">-- Select Stage --</option>
              {[1, 2, 3, 4, 5, 6, 7, 8].map(num => (
                <option key={num} value={`gym-${num}`}>Gym {num}</option>
              ))}
              <option value="e4">Elite Four</option>
              <option value="champion">Champion</option>
            </select>
          </div>

          <div className="control-group">
            <label htmlFor="trainer-select">Trainer:</label>
            <select 
              id="trainer-select" 
              value={selectedTrainer} 
              onChange={(e) => setSelectedTrainer(e.target.value)}
              disabled={!selectedStage}
            >
              <option value="">-- Select Trainer --</option>
              {trainerOptions.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
        </div>

        {loading && <div>Loading boss data...</div>}
        {error && <div style={{color: 'red'}}>Error: {error}</div>}

        {!loading && !error && filteredTrainers.length === 0 && (
          <div style={{ textAlign: 'center', marginTop: '2rem' }}>No trainers found. Please check gyms.txt format.</div>
        )}

        <div className="trainers-list">
          {filteredTrainers.map(trainer => (
            <div 
              key={trainer.id} 
              className="trainer-section"
              style={{ borderBottomColor: trainer.color || '#444' }}
            >
              <h2>{trainer.displayName}</h2>
              {trainer.infoLines.length > 0 && (
                <div className="trainer-info-container">
                  {trainer.infoLines.map((line, i) => (
                    <div key={i} style={{ marginBottom: i < trainer.infoLines.length - 1 ? '0.5rem' : 0 }}>{line}</div>
                  ))}
                </div>
              )}
              
              <div className="pokemon-row">
                {trainer.pokemon.map((poke, i) => (
                  <div key={i} className="pokemon-card">
                    <img src={poke.imageUrl} alt={poke.name} title={poke.name} style={{ width: '90px', height: '90px' }} />
                    <span>{poke.item || '\u00A0'}</span>
                    <div className="pokemon-name">{poke.name}</div>
                    {poke.details}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </main>
      <Footer />
    </>
  );
};

export default BossBattles;