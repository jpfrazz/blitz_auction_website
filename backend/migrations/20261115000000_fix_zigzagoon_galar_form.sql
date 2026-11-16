-- Pokedex 263 (Zigzagoon) was imported with the Galarian typing, abilities and
-- moves but without the "Galar" form label. Mystery Dungeon art (and any other
-- form-aware lookup) therefore rendered the regular Hoenn Zigzagoon. Move the
-- row, its key moves and any references onto the Galar form.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pokemon WHERE pokedex_id = 263 AND form = '')
       AND NOT EXISTS (
           SELECT 1
           FROM pokemon
           WHERE pokedex_id = 263
             AND form = ''
             AND name = 'Zigzagoon'
             AND type1 = 'Dark'
             AND type2 = 'Normal'
       ) THEN
        RAISE EXCEPTION 'Pokedex 263 base row does not match the Galarian Zigzagoon data';
    END IF;

    IF EXISTS (SELECT 1 FROM pokemon WHERE pokedex_id = 263 AND form = '')
       AND NOT EXISTS (SELECT 1 FROM pokemon WHERE pokedex_id = 263 AND form = 'Galar') THEN
        INSERT INTO pokemon (
            pokedex_id, name, form, stage, description, type1, type2,
            ability1, ability2, hidden_ability, evolution_method, evolves_from_id,
            evolves_from_form, mega, obtain_method, hp, attack, defense, sp_attack,
            sp_defense, speed
        )
        SELECT
            pokedex_id, name, 'Galar', stage, description, type1, type2,
            ability1, ability2, hidden_ability, evolution_method, evolves_from_id,
            evolves_from_form, mega, obtain_method, hp, attack, defense, sp_attack,
            sp_defense, speed
        FROM pokemon
        WHERE pokedex_id = 263 AND form = '';
    END IF;

        IF NOT EXISTS (SELECT 1 FROM pokemon WHERE pokedex_id = 263 AND form = 'Galar') THEN
                RAISE EXCEPTION 'Neither the Zigzagoon base row nor its Galar form exists';
        END IF;

        -- Create the destination row before changing this self-referencing foreign key.
        UPDATE pokemon
        SET evolves_from_form = 'Galar'
        WHERE evolves_from_id = 263
            AND COALESCE(evolves_from_form, '') = '';

        -- Retain any destination move already present, then move the remaining rows.
        DELETE FROM key_moves old_move
        USING key_moves galar_move
        WHERE old_move.pokedex_id = 263
            AND old_move.form = ''
            AND galar_move.pokedex_id = 263
            AND galar_move.form = 'Galar'
            AND old_move.move_name = galar_move.move_name
            AND old_move.species = galar_move.species;

    UPDATE key_moves
    SET form = 'Galar'
    WHERE pokedex_id = 263 AND form = '';

    UPDATE auctions
    SET form = 'Galar'
    WHERE pokedex_id = 263 AND form = '';

    IF EXISTS (SELECT 1 FROM key_moves WHERE pokedex_id = 263 AND form = '')
       OR EXISTS (SELECT 1 FROM auctions WHERE pokedex_id = 263 AND form = '')
       OR EXISTS (
           SELECT 1 FROM pokemon
           WHERE evolves_from_id = 263 AND COALESCE(evolves_from_form, '') = ''
       ) THEN
        RAISE EXCEPTION 'Zigzagoon references remain on the base form after the Galar move';
    END IF;

    DELETE FROM pokemon WHERE pokedex_id = 263 AND form = '';
END;
$$;
