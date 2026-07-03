Emerald Blitz – Comprehensive Pokédex Updater
=============================================

WHAT IT DOES
────────────
Runs the full pipeline in one command:
  1. Generates the required build-artifact headers from the ROM source
     (map_groups.h, region_map_sections.h) if they are missing.
  2. Extracts moves, abilities, species, and learnset data from the
     ROM source via the porydex tool.
  3. Copies the generated .js data files into:
         frontend/public/ComprehensiveDex/data/
  4. Marks each species as "obtainable" or "not-in-game" based on
     add_pokemon_script/pokemon.csv.
  5. Overwrites the evolution methods for every Pokémon using the
     evolution_method column in pokemon.csv, including the game-specific
     Energy Guru and Energy Oracle items.

USAGE
─────
  python update_pokedex.py

Then rebuild the Docker frontend:
  docker compose up -d --build --force-recreate --no-deps frontend

PREREQUISITES  (all must exist before running)
──────────────
1. Python 3.10 or newer

2. EmeraldBlitz ROM source repo  — cloned at:
       C:/Users/pluto/EmeraldBlitz

3. GCC from MSYS2 MinGW64  — binary at:
       C:/msys64/mingw64/bin/gcc.exe


If any of these paths differ on your machine, edit the CONFIG section
at the top of update_pokedex.py.

WHAT YOU DO NOT NEED TO DO MANUALLY ANYMORE
────────────────────────────────────────────
• Edit species.js to mark Pokémon as obtainable
• Edit species.js to fix evolution methods (friendship, Guru, Oracle, etc.)
• Re-run separate scripts after a ROM update

ROM SOURCE FILES USED
─────────────────────
The script reads the following from the EmeraldBlitz repo (gcc preprocesses
all necessary headers transitively — no manual file copying required):

  src/data/moves_info.h
  src/data/abilities.h
  src/data/pokemon/form_species_tables.h
  src/data/pokemon/species_info.h
  src/data/pokemon/teachable_learnsets.h
  include/constants/pokedex.h
  include/constants/tms_hms.h
  include/  (all headers, transitively via gcc -I)
  gflib/    (all headers, transitively via gcc -I)
  config/   (battle.h, item.h, pokemon.h, species_enabled.h)
  data/maps/map_groups.json  (for generating map_groups.h)
