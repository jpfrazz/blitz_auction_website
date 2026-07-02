-- Remove exact duplicate boss battle entries
-- This removes duplicates where trainer_id, hours, minutes, seconds, is_loss, and team_id are identical
-- Keeps the latest entry (highest id) for each unique combination to maintain time order

DELETE FROM boss_battle_history
WHERE id NOT IN (
    SELECT MAX(id)
    FROM boss_battle_history
    GROUP BY team_id, trainer_id, hours, minutes, seconds, is_loss
);
