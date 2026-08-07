-- Test seed: attach a Hall of Fame team to jeansmm's winning team (team_id 3864)
-- so the Admin Hall of Fame UI can be verified without waiting for a live capture.
UPDATE teams
SET hall_of_fame_team = '[
    {"name":"Ribombee","icon":"ribombee"},
    {"name":"Luxray","icon":"luxray"},
    {"name":"Feraligatr","icon":"feraligatr"},
    {"name":"Chesnaught","icon":"chesnaught"},
    {"name":"Arcanine","icon":"arcanine"},
    {"name":"Perrserker","icon":"perrserker"}
]'::jsonb
WHERE team_id = 3864;
