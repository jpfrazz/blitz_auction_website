-- Stage 3: teams.placement is now the single source of truth for a team's
-- finishing position. Remove the temporary sync guard from stage 2 and the
-- duplicate column it was keeping in step.
DROP TRIGGER IF EXISTS teams_sync_placement_columns ON teams;
DROP FUNCTION IF EXISTS sync_team_placement_columns();
ALTER TABLE teams DROP COLUMN IF EXISTS race_placement;
