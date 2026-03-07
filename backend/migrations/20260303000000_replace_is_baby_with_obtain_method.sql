-- Migration: Replace is_baby with obtain_method
BEGIN;
ALTER TABLE pokemon DROP COLUMN is_baby;
ALTER TABLE pokemon ADD COLUMN obtain_method TEXT;
COMMIT;