DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pokemon WHERE pokedex_id IN (948, 949)
    ) THEN
        RAISE NOTICE 'No legacy Shroodle/Grafaiai rows found; skipping cleanup';
        RETURN;
    END IF;

    IF EXISTS (
        SELECT 1 FROM pokemon
        WHERE (pokedex_id = 948 AND name <> 'Shroodle')
           OR (pokedex_id = 949 AND name <> 'Grafaiai')
    ) THEN
        RAISE EXCEPTION 'Unexpected names found at legacy Pokedex IDs 948/949';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pokemon
        WHERE pokedex_id = 944 AND form = '' AND name = 'Shroodle'
    ) OR NOT EXISTS (
        SELECT 1 FROM pokemon
        WHERE pokedex_id = 945 AND form = '' AND name = 'Grafaiai'
    ) THEN
        RAISE NOTICE 'Corrected Shroodle/Grafaiai rows are absent; skipping cleanup';
        RETURN;
    END IF;

    IF EXISTS (
        SELECT 1
        FROM pokemon old
        LEFT JOIN pokemon current
          ON current.pokedex_id = CASE old.pokedex_id
                WHEN 948 THEN 944
                WHEN 949 THEN 945
             END
         AND current.form = old.form
        WHERE old.pokedex_id IN (948, 949)
          AND current.pokedex_id IS NULL
    ) THEN
        RAISE EXCEPTION 'A legacy form has no matching corrected destination form';
    END IF;

    UPDATE pokemon
    SET evolves_from_id = CASE evolves_from_id
        WHEN 948 THEN 944
        WHEN 949 THEN 945
    END
    WHERE evolves_from_id IN (948, 949);

    UPDATE auctions
    SET pokedex_id = CASE pokedex_id
        WHEN 948 THEN 944
        WHEN 949 THEN 945
    END
    WHERE pokedex_id IN (948, 949);

    INSERT INTO key_moves (
        pokedex_id, form, move_name, learn_method, species, display_order
    )
    SELECT CASE pokedex_id
               WHEN 948 THEN 944
               WHEN 949 THEN 945
           END,
           form, move_name, learn_method, species, display_order
    FROM key_moves
    WHERE pokedex_id IN (948, 949)
    ON CONFLICT (pokedex_id, form, move_name, species) DO NOTHING;

    DELETE FROM key_moves WHERE pokedex_id IN (948, 949);
    DELETE FROM pokemon WHERE pokedex_id IN (948, 949);

    IF EXISTS (SELECT 1 FROM pokemon WHERE pokedex_id IN (948, 949))
       OR EXISTS (SELECT 1 FROM auctions WHERE pokedex_id IN (948, 949))
       OR EXISTS (SELECT 1 FROM key_moves WHERE pokedex_id IN (948, 949))
       OR EXISTS (SELECT 1 FROM pokemon WHERE evolves_from_id IN (948, 949)) THEN
        RAISE EXCEPTION 'Legacy Pokedex references remain after cleanup';
    END IF;
END;
$$;