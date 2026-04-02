BEGIN;

    TRUNCATE TABLE key_moves;

    ALTER TABLE key_moves
    ADD COLUMN display_order INT NOT NULL;

COMMIT;
