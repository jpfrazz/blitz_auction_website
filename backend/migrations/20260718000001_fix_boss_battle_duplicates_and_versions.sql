-- Fix remaining boss battle duplicates and recalculate version numbers.
-- The race condition in the save handler (now fixed with a transaction) caused
-- duplicates to reappear after the previous dedup migration ran.

-- Step 1: Remove duplicates, keeping the earliest record (MIN id)
DELETE FROM boss_battle_history
WHERE id NOT IN (
    SELECT MIN(id)
    FROM boss_battle_history
    GROUP BY team_id, draft_id, trainer_id, hours, minutes, seconds, is_loss
);

-- Step 2: Recalculate gym leader version numbers based on actual game time
-- (not created_at, which was skewed by the race condition)
-- Gym leader trainer IDs: 265 Roxanne, 855 Viola, 266 Brawly, 267 Wattson,
-- 268 Flannery, 269 Norman, 270 Winona, 271 Tate & Liza, 272 Juan & Wallace

CREATE OR REPLACE FUNCTION recalculate_boss_battle_versions()
RETURNS VOID AS $$
DECLARE
    team_record RECORD;
    battle_record RECORD;
    boss_index INT;
BEGIN
    FOR team_record IN
        SELECT DISTINCT team_id, draft_id
        FROM boss_battle_history
        ORDER BY team_id, draft_id
    LOOP
        boss_index := 0;

        FOR battle_record IN
            SELECT id, trainer_id
            FROM boss_battle_history
            WHERE team_id = team_record.team_id
              AND draft_id = team_record.draft_id
              AND is_loss = false
            ORDER BY hours ASC, minutes ASC, seconds ASC, created_at ASC
        LOOP
            IF battle_record.trainer_id IN (265, 855, 266, 267, 268, 269, 270, 271, 272) THEN
                boss_index := boss_index + 1;
                UPDATE boss_battle_history SET version = boss_index WHERE id = battle_record.id;
            ELSE
                UPDATE boss_battle_history SET version = NULL WHERE id = battle_record.id;
            END IF;
        END LOOP;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

SELECT recalculate_boss_battle_versions();
DROP FUNCTION recalculate_boss_battle_versions();
