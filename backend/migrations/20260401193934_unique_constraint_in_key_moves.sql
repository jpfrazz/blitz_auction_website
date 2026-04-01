ALTER TABLE key_moves
ADD CONSTRAINT key_moves_id_form_move_unique
UNIQUE (pokedex_id, form, move_name);
