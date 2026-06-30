-- Create table to store boss battle history for each player in each draft
CREATE TABLE boss_battle_history (
    id BIGSERIAL PRIMARY KEY,
    team_id BIGINT NOT NULL REFERENCES teams(team_id) ON DELETE CASCADE,
    draft_id UUID NOT NULL REFERENCES drafts(draft_id) ON DELETE CASCADE,
    trainer_id INT NOT NULL,
    version INT,
    hours INT NOT NULL,
    minutes INT NOT NULL,
    seconds INT NOT NULL,
    is_loss BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Add indexes for efficient queries
CREATE INDEX idx_boss_battle_history_team_id ON boss_battle_history(team_id);
CREATE INDEX idx_boss_battle_history_draft_id ON boss_battle_history(draft_id);
CREATE INDEX idx_boss_battle_history_team_draft ON boss_battle_history(team_id, draft_id);
