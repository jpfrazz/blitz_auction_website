-- Recalculate gym leader version numbers after deduplication
-- This ensures version numbers are sequential without gaps after duplicate removal

-- Gym leader trainer IDs (including Viola)
-- 265: Roxanne, 855: Viola, 266: Brawly, 267: Wattson, 268: Flannery, 269: Norman, 270: Winona, 271: Tate & Liza, 272: Juan & Wallace

-- Create a temporary function to update version numbers
CREATE OR REPLACE FUNCTION recalculate_gym_leader_versions()
RETURNS VOID AS $$
DECLARE
    team_record RECORD;
    battle_record RECORD;
    boss_index INT;
BEGIN
    -- For each unique team/draft combination
    FOR team_record IN 
        SELECT DISTINCT team_id, draft_id 
        FROM boss_battle_history 
        ORDER BY team_id, draft_id
    LOOP
        boss_index := 0;
        
        -- Update each boss battle for this team/draft in order
        FOR battle_record IN
            SELECT id, trainer_id
            FROM boss_battle_history
            WHERE team_id = team_record.team_id 
              AND draft_id = team_record.draft_id
            ORDER BY created_at ASC
        LOOP
            -- Check if this is a gym leader
            IF battle_record.trainer_id IN (265, 855, 266, 267, 268, 269, 270, 271, 272) THEN
                boss_index := boss_index + 1;
                
                -- Update the version field
                UPDATE boss_battle_history
                SET version = boss_index
                WHERE id = battle_record.id;
            ELSE
                -- Clear version for non-gym leaders
                UPDATE boss_battle_history
                SET version = NULL
                WHERE id = battle_record.id;
            END IF;
        END LOOP;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Run the function
SELECT recalculate_gym_leader_versions();

-- Clean up the function
DROP FUNCTION recalculate_gym_leader_versions();
