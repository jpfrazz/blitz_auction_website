-- Add columns for manually-entered race results per team.
-- race_placement: the overall placement the player finished the race in (1st, 2nd, ...).
-- race_wipe_trainer: an optional manually-entered trainer a player wiped to,
-- used when no wipe data was auto-recorded from the save.
ALTER TABLE teams ADD COLUMN race_placement INT;
ALTER TABLE teams ADD COLUMN race_wipe_trainer TEXT;
