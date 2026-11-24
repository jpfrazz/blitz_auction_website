-- Stage 2 of consolidating team placements onto teams.placement.
--
-- `race_placement` was added later for manually entered race results and has
-- drifted from `placement`: some readers use one column and some use the
-- other, and the two can disagree. Bring them into agreement now, then keep
-- them in sync until stage 3 can drop `race_placement` entirely.
-- `race_wipe_trainer` is genuinely separate data and is untouched here.

-- When both columns exist and disagree, the Race Results value is the one
-- users were shown, so it wins.
UPDATE teams
SET placement = race_placement
WHERE race_placement IS NOT NULL
  AND (placement IS NULL OR placement <> race_placement);

-- Results submitted through the older flow only wrote `placement`. Mirror
-- those so readers that still use `race_placement` see the same value.
UPDATE teams
SET race_placement = placement
WHERE placement IS NOT NULL
  AND race_placement IS NULL;

-- Temporary guard for the transition: whichever column a statement changes
-- is mirrored to the other. NULL is mirrored too, so clearing a result clears
-- both columns instead of letting the mirror resurrect an old value. If a
-- statement changes both columns to different values, race_placement wins,
-- matching the pre-consolidation UI behaviour.
CREATE OR REPLACE FUNCTION sync_team_placement_columns() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.race_placement IS NOT NULL THEN
            NEW.placement := NEW.race_placement;
        ELSIF NEW.placement IS NOT NULL THEN
            NEW.race_placement := NEW.placement;
        END IF;
    ELSIF NEW.race_placement IS DISTINCT FROM OLD.race_placement THEN
        NEW.placement := NEW.race_placement;
    ELSIF NEW.placement IS DISTINCT FROM OLD.placement THEN
        NEW.race_placement := NEW.placement;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS teams_sync_placement_columns ON teams;
CREATE TRIGGER teams_sync_placement_columns
    BEFORE INSERT OR UPDATE ON teams
    FOR EACH ROW
    EXECUTE FUNCTION sync_team_placement_columns();
