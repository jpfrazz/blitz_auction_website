BEGIN;

    -- drop fk constraints from tables
    ALTER TABLE pokemon DROP CONSTRAINT pokemon_evolves_from_id_evolves_from_form_fkey;
    ALTER TABLE key_moves DROP CONSTRAINT key_moves_pokedex_id_form_fkey;
    ALTER TABLE auctions DROP CONSTRAINT auctions_pokedex_id_form_fkey;

    -- drop pk
    ALTER TABLE pokemon DROP CONSTRAINT pokemon_pkey;

    -- add pk for uniqueness
    ALTER TABLE pokemon ADD COLUMN internal_id SERIAL PRIMARY KEY;
    ALTER TABLE key_moves ADD COLUMN internal_id SERIAL PRIMARY KEY;

    -- drop DEFAULT and NOT NULL constraint
    ALTER TABLE pokemon ALTER COLUMN form DROP DEFAULT;
    ALTER TABLE pokemon ALTER COLUMN form DROP NOT NULL;

    ALTER TABLE key_moves ALTER COLUMN form DROP DEFAULT;
    ALTER TABLE key_moves ALTER COLUMN form DROP NOT NULL;

    -- set '' forms to NULL
    UPDATE pokemon SET form = NULL WHERE form = '';
    UPDATE pokemon SET evolves_from_form = NULL WHERE evolves_from_form = '';
    UPDATE key_moves SET form = NULL WHERE form = '';

    -- add unique constraints with NULLS NOT DISTINCT
    ALTER TABLE pokemon ADD CONSTRAINT pokemon_dex_form_unique 
        UNIQUE NULLS NOT DISTINCT (pokedex_id, form);

    ALTER TABLE key_moves ADD CONSTRAINT key_moves_dex_form_move_unique 
        UNIQUE NULLS NOT DISTINCT (pokedex_id, form, move_name);

    -- add fk constraints to other tables
    ALTER TABLE pokemon ADD CONSTRAINT pokemon_evolution_fkey
        FOREIGN KEY (evolves_from_id, evolves_from_form)
        REFERENCES pokemon(pokedex_id, form)
        ON UPDATE CASCADE;

    ALTER TABLE key_moves ADD CONSTRAINT key_moves_pokemon_fkey
        FOREIGN KEY (pokedex_id, form)
        REFERENCES pokemon(pokedex_id, form)
        ON UPDATE CASCADE ON DELETE CASCADE;

    ALTER TABLE auctions ADD CONSTRAINT auctions_pokemon_fkey
        FOREIGN KEY (pokedex_id, form)
        REFERENCES pokemon(pokedex_id, form)
        ON UPDATE CASCADE;

COMMIT;
