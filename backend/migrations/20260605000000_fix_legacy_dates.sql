-- Repair migration to fix inverted month/day values in legacy data
BEGIN;

UPDATE legacy_pokemon_costs
SET date = make_timestamp(
    EXTRACT(YEAR FROM date)::int,
    EXTRACT(DAY FROM date)::int,   -- Swapping Month and Day
    EXTRACT(MONTH FROM date)::int, -- Swapping Month and Day
    EXTRACT(HOUR FROM date)::int,
    EXTRACT(MINUTE FROM date)::int,
    EXTRACT(SECOND FROM date)
)
WHERE date IN (
  '2026-10-01 02:05:12', -- Intended to be Jan 10th
  '2026-05-02 23:31:59', -- Intended to be Feb 5th
  '2026-07-02 03:48:39', -- Intended to be Feb 7th
  '2026-08-02 01:48:01'  -- Intended to be Feb 8th
);

COMMIT;