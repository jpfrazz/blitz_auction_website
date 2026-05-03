UPDATE key_moves SET species = '' WHERE species IS NULL;
ALTER TABLE key_moves ALTER COLUMN species SET NOT NULL;

-- 2. Drop the old unique constraint
ALTER TABLE key_moves 
DROP CONSTRAINT key_moves_id_form_move_unique;

-- 3. Create the new updated unique constraint
ALTER TABLE key_moves 
ADD CONSTRAINT key_moves_id_form_move_species_unique 
UNIQUE (pokedex_id, form, move_name, species);
