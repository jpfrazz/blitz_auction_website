import React, { useState } from 'react';
import type { PlayerAchievement } from '../achievements';
import './AchievementsPanel.scss';

interface AchievementsPanelProps {
  achievements: PlayerAchievement[];
  canEdit?: boolean;
  savingIds?: Set<string>;
  editError?: string | null;
  onToggleAchievement?: (achievement: PlayerAchievement) => void;
}

const ACHIEVEMENTS_PER_ROW = 6;

const AchievementsPanel: React.FC<AchievementsPanelProps> = ({
  achievements,
  canEdit = false,
  savingIds = new Set(),
  editError = null,
  onToggleAchievement,
}) => {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [adminOpen, setAdminOpen] = useState(false);
  const earned = achievements.filter((achievement) => achievement.earned);

  if (earned.length === 0 && !canEdit) return null;

  const toggle = (id: string) => {
    setExpandedId((current) => (current === id ? null : id));
  };

  const earnedRows: PlayerAchievement[][] = [];
  for (let index = 0; index < earned.length; index += ACHIEVEMENTS_PER_ROW) {
    earnedRows.push(earned.slice(index, index + ACHIEVEMENTS_PER_ROW));
  }

  const adminControl = canEdit ? (
    <div className="player-achievement-admin">
      <button
        type="button"
        className="player-achievement-admin-toggle"
        aria-label="Edit player achievements"
        aria-expanded={adminOpen}
        title="Add or remove achievements"
        onClick={() => setAdminOpen((open) => !open)}
      >
        +
      </button>
      {adminOpen && (
        <div className="player-achievement-admin-menu">
          <div className="player-achievement-admin-heading">Manually set achievements</div>
          {achievements.map((achievement) => {
            const saving = savingIds.has(achievement.id);
            return (
              <button
                key={achievement.id}
                type="button"
                className={`player-achievement-admin-option${achievement.earned ? ' is-earned' : ''}`}
                aria-label={`${achievement.earned ? 'Remove' : 'Add'} ${achievement.name}`}
                disabled={saving || !onToggleAchievement}
                title={achievement.manuallySet ? 'Manually set' : undefined}
                onClick={() => onToggleAchievement?.(achievement)}
              >
                <img src={`/Achievements/${achievement.icon}`} alt="" />
                <span>{achievement.name}</span>
                <span className="player-achievement-admin-action">
                  {saving ? '…' : achievement.earned ? '−' : '+'}
                </span>
              </button>
            );
          })}
          {editError && (
            <div className="player-achievement-admin-error" role="alert">{editError}</div>
          )}
        </div>
      )}
    </div>
  ) : null;

  return (
    <div className="player-achievements" aria-label="Achievements">
      {earnedRows.length === 0 ? (
        <div className="player-achievement-row">{adminControl}</div>
      ) : (
        earnedRows.map((row, rowIndex) => (
          <div className="player-achievement-row" key={row.map((item) => item.id).join('-')}>
            {row.map((achievement) => {
              const expanded = expandedId === achievement.id;
              return (
                <div className="player-achievement" key={achievement.id}>
                  <button
                    type="button"
                    className={`player-achievement-badge${expanded ? ' is-expanded' : ''}`}
                    aria-expanded={expanded}
                    aria-label={achievement.name}
                    title={achievement.name}
                    onClick={() => toggle(achievement.id)}
                  >
                    <img src={`/Achievements/${achievement.icon}`} alt="" />
                    <span className="player-achievement-copy">
                      <span className="player-achievement-name">{achievement.name}</span>
                      <span
                        className={`player-achievement-description${expanded ? ' is-visible' : ''}`}
                        aria-hidden={!expanded}
                      >
                        {achievement.description}
                      </span>
                    </span>
                  </button>
                </div>
              );
            })}
            {rowIndex === earnedRows.length - 1 && adminControl}
          </div>
        ))
      )}
    </div>
  );
};

export default AchievementsPanel;
