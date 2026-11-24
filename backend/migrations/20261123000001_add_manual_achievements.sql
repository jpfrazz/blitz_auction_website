-- Manual achievement grants/revokes applied by the site owner on player profiles.
-- `earned = true` grants an achievement; `earned = false` hides one that would
-- otherwise be calculated automatically.
CREATE TABLE IF NOT EXISTS manual_achievements (
    user_id TEXT NOT NULL,
    achievement_id TEXT NOT NULL,
    earned BOOLEAN NOT NULL,
    updated_by TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, achievement_id)
);

CREATE INDEX IF NOT EXISTS idx_manual_achievements_user_id
    ON manual_achievements (user_id);
