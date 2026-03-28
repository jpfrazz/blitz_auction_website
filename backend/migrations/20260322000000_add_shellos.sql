-- Migration: Add Shellos and Gastrodon
BEGIN;

INSERT INTO pokemon (pokedex_id, name, form, stage, description, type1, type2, ability1, ability2, hidden_ability, evolves_from_id, evolves_from_form, evolution_method, mega, obtain_method, hp, attack, defense, sp_attack, sp_defense, speed)
VALUES (422, 'Shellos', '', 'base', NULL, 'Water', NULL, 'Sticky Hold', 'Storm Drain', 'Sand Force', NULL, NULL, NULL, NULL, NULL, 76, 48, 48, 57, 62, 34);

INSERT INTO pokemon (pokedex_id, name, form, stage, description, type1, type2, ability1, ability2, hidden_ability, evolves_from_id, evolves_from_form, evolution_method, mega, obtain_method, hp, attack, defense, sp_attack, sp_defense, speed)
VALUES (423, 'Gastrodon', '', 'evo', NULL, 'Water', 'Ground', 'Sticky Hold', 'Storm Drain', 'Sand Force', 422, '', 'Level 30', NULL, NULL, 111, 83, 68, 92, 82, 39);

-- Add moves for the Shellos family
-- These entries link the pokemon to their move pool in the database
INSERT INTO key_moves (pokedex_id, form, move_name, learn_method, species) VALUES
(422, '', 'Water Pulse', '7', ''),
(422, '', 'Mud Bomb', '12', ''),
(422, '', 'Hidden Power', '16', ''),
(422, '', 'Rain Dance', '22', ''),
(422, '', 'Earthquake', 'TM', ''),
(422, '', 'Ice Beam', 'TM', ''),
(422, '', 'Sludge Bomb', 'TM', ''),
(422, '', 'Surf', 'HM', ''),
(422, '', 'Mirror Coat', 'Egg', '');

COMMIT;