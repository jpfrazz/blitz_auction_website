-- Recalculate gym leader version numbers including forfeit/wipe losses.
--
-- The forfeit button now stamps the version (the gym leader fight number) on
-- new losses, but entries recorded before that fix have version = NULL, so a
-- wipe such as "Viola 3" was displayed as just "Viola". This backfills those
-- rows and brings every boss_battle_history row in line with how the save
-- handler recomputes versions: a sequential gym leader battle index in game
-- time order, counting wins and losses alike.

-- Gym leader trainer IDs (including Viola)
-- 265: Roxanne, 855: Viola, 266: Brawly, 267: Wattson, 268: Flannery,
-- 269: Norman, 270: Winona, 271: Tate & Liza, 272: Juan & Wallace

CREATE OR REPLACE FUNCTION fix_gym_leader_loss_versions()
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
            ORDER BY hours ASC, minutes ASC, seconds ASC, created_at ASC
        LOOP
            IF battle_record.trainer_id IN (265, 855, 266, 267, 268, 269, 270, 271, 272) THEN
                boss_index := boss_index + 1;
                UPDATE boss_battle_history
                SET version = boss_index
                WHERE id = battle_record.id;
            ELSE
                UPDATE boss_battle_history
                SET version = NULL
                WHERE id = battle_record.id;
            END IF;
        END LOOP;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

SELECT fix_gym_leader_loss_versions();

DROP FUNCTION fix_gym_leader_loss_versions();
