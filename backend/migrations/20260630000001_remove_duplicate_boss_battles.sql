-- Remove duplicate boss battle entries
-- This removes duplicates where the same trainer_id, hours, minutes, seconds, and is_loss appear multiple times for the same team/draft
-- Keeps the earliest entry (by created_at) and removes later duplicates

DELETE FROM boss_battle_history
WHERE id NOT IN (
    SELECT MIN(id)
    FROM boss_battle_history
    GROUP BY team_id, draft_id, trainer_id, version, hours, minutes, seconds, is_loss
);
