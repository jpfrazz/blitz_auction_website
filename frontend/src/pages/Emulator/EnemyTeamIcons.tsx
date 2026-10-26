import React from 'react';
import { getIconName } from '../../utils/speciesUtils';

export interface EnemyMon {
  species_id: number;
  nickname?: string;
  hp: number;
  max_hp: number;
}

interface Props {
  enemyParty: EnemyMon[];
  variant: 'sidebar' | 'overlay' | 'spectate';
  resolveMetadata: (speciesId: number, nickname?: string) => any;
}

const hpTone = (mon: EnemyMon): { pct: number; tone: 'green' | 'yellow' | 'red' | 'grey' } => {
  if (mon.hp <= 0) return { pct: 1, tone: 'grey' };
  const pct = mon.max_hp > 0 ? Math.max(0, Math.min(1, mon.hp / mon.max_hp)) : 0;
  return { pct, tone: pct > 0.5 ? 'green' : pct > 0.2 ? 'yellow' : 'red' };
};

const EnemyTeamIcons: React.FC<Props> = ({ enemyParty, variant, resolveMetadata }) => {
  if (enemyParty.length === 0) return null;
  return (
    <div className={`${variant}-mon-icons enemy-team`} title="Opposing team">
      {enemyParty.map((mon, i) => {
        const meta = resolveMetadata(mon.species_id, mon.nickname);
        const name = meta?.name || `ID ${mon.species_id}`;
        const fainted = mon.hp <= 0;
        const { pct, tone } = hpTone(mon);
        return (
          <span key={i} className={`mini-icon-wrapper ${variant} has-hp-bar`}>
            <img
              src={`/MiniIcons/${getIconName(name, mon.species_id)}.png`}
              alt={name}
              title={name}
              className={`${variant}-mini-icon ${fainted ? 'fainted' : ''}`}
              style={fainted ? { filter: 'grayscale(100%)', opacity: 0.6 } : {}}
              onError={(e) => { (e.target as HTMLImageElement).src = '/MiniIcons/question.png'; }}
            />
            <span className={`mini-hp-bar ${tone}`}>
              <span className="mini-hp-fill" style={{ width: `${pct * 100}%` }} />
            </span>
          </span>
        );
      })}
    </div>
  );
};

export default EnemyTeamIcons;
