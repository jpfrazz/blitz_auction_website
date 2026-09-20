#!/usr/bin/env python3
"""
Emerald Blitz - Comprehensive Pokédex Updater
==============================================
Runs the full pipeline:
  1. Generates required build-artifact headers from the ROM source
  2. Extracts data from the ROM source via porydex
  3. Copies the generated data files into the ComprehensiveDex folder
  4. Wholly erases Gmax, "-[Type]", "-Totem" and Pikachu costume forme species
     (e.g. all Gigantamax formes, every Arceus/Silvally type forme,
     Calyrex-Ice, Kommo-o-Totem, Pikachu-Rock-Star, Pikachu-Starter, etc.)
  5. Applies obtainable tiers from pokemon.csv
  6. Applies correct evolution methods from pokemon.csv (including Guru / Oracle items)
  7. Applies egg moves from egg_moves.h

Usage:
    python update_pokedex.py

After it completes, rebuild the Docker frontend:
    docker compose up -d --build --force-recreate --no-deps frontend
"""

import csv
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

# Fix Windows console encoding
if sys.stdout.encoding and sys.stdout.encoding.lower() != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')

# ══════════════════════════════════════════════════════════════════════════════
#  CONFIGURATION  ─ only EMERALD_BLITZ_REPO and GCC_BIN may need editing
# ══════════════════════════════════════════════════════════════════════════════

# Root of your cloned EmeraldBlitz ROM source repo
    EMERALD_BLITZ_REPO = Path(r"C:\Users\willi\Desktop\EmeraldBlitz")

# Path to GCC (from MSYS2 MinGW64)
    GCC_BIN = Path(r"C:\Users\willi\Desktop\gcc\mingw64\bin")

# Paths derived from this script's location – do not edit
_SCRIPT_DIR   = Path(__file__).resolve().parent
PORYDEX_DIR   = _SCRIPT_DIR / "porydex_src"
_REPO_ROOT    = _SCRIPT_DIR.parent
POKEMON_CSV   = _REPO_ROOT / "add_pokemon_script" / "pokemon.csv"
DEX_DATA_DIR  = _REPO_ROOT / "frontend" / "public" / "ComprehensiveDex" / "data"

# ══════════════════════════════════════════════════════════════════════════════
#  HELPERS
# ══════════════════════════════════════════════════════════════════════════════

def step(msg: str):
    print(f"\n{'─'*60}\n  {msg}\n{'─'*60}")

def to_id(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", s.lower())

# ══════════════════════════════════════════════════════════════════════════════
#  STEP 1 – Generate missing build-artifact headers
# ══════════════════════════════════════════════════════════════════════════════

def generate_headers():
    step("Generating required build-artifact headers")

    repo = EMERALD_BLITZ_REPO
    maps_json = repo / "data" / "maps" / "map_groups.json"

    # ── map_groups.h (include/ and include/constants/) ──────────────────────
    for dest in [repo / "include" / "map_groups.h",
                 repo / "include" / "constants" / "map_groups.h"]:
        if dest.exists():
            print(f"  ✓ {dest.relative_to(repo)} already exists")
            continue

        with open(maps_json, encoding="utf-8") as f:
            data = json.load(f)

        lines = ["#ifndef GUARD_MAP_GROUPS_H", "#define GUARD_MAP_GROUPS_H", ""]
        for group_idx, group_name in enumerate(data["group_order"]):
            for map_idx, map_name in enumerate(data[group_name]):
                lines.append(
                    f"#define MAP_{map_name.upper()} ((({group_idx}) << 8) | {map_idx})"
                )
            lines.append("")
        lines += ["#endif  // GUARD_MAP_GROUPS_H", ""]

        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text("\n".join(lines))
        print(f"  ✓ Generated {dest.relative_to(repo)}")

    # ── constants/region_map_sections.h (stub) ───────────────────────────────
    rms = repo / "include" / "constants" / "region_map_sections.h"
    if not rms.exists():
        rms.write_text(
            "#ifndef GUARD_CONSTANTS_REGION_MAP_SECTIONS_H\n"
            "#define GUARD_CONSTANTS_REGION_MAP_SECTIONS_H\n"
            "#endif\n"
        )
        print(f"  ✓ Generated {rms.relative_to(repo)}")
    else:
        print(f"  ✓ {rms.relative_to(repo)} already exists")

# ══════════════════════════════════════════════════════════════════════════════
#  STEP 2 – Ensure porydex venv exists, then run extraction
# ══════════════════════════════════════════════════════════════════════════════

def ensure_venv() -> Path:
    """Create the porydex_src venv and install deps if not already present."""
    venv_dir = PORYDEX_DIR / ".venv"
    python_exe = venv_dir / "Scripts" / "python.exe"

    if not python_exe.exists():
        step("Setting up porydex venv (first run only)")
        subprocess.run([sys.executable, "-m", "venv", str(venv_dir)], check=True)
        pip = venv_dir / "Scripts" / "pip.exe"
        subprocess.run(
            [str(pip), "install", "pycparser==2.22", "yaspin==3.0.2"],
            check=True,
        )
        print("  ✓ Venv ready")
    return python_exe


def run_porydex():
    step("Running porydex extraction")

    python_exe = ensure_venv()
    gcc_env = {
        **os.environ,
        "PYTHONUTF8": "1",
        "PATH": str(GCC_BIN) + os.pathsep + os.environ.get("PATH", ""),
    }

    # Point porydex at the EmeraldBlitz repo
    subprocess.run(
        [str(python_exe), "porydex.py", "config", "set",
         "--expansion", str(EMERALD_BLITZ_REPO)],
        cwd=PORYDEX_DIR,
        env=gcc_env,
        check=True,
    )

    result = subprocess.run(
        [str(python_exe), "porydex.py", "extract", "--reload"],
        cwd=PORYDEX_DIR,
        env=gcc_env,
    )
    if result.returncode != 0:
        sys.exit("ERROR: porydex extraction failed.")

    print("  ✓ Extraction complete")

# ══════════════════════════════════════════════════════════════════════════════
#  STEP 3 – Copy data files into ComprehensiveDex
# ══════════════════════════════════════════════════════════════════════════════

def copy_data():
    step("Copying generated data files to ComprehensiveDex")

    source = PORYDEX_DIR / "site" / "data"
    DEX_DATA_DIR.mkdir(parents=True, exist_ok=True)

    for f in source.glob("*.js"):
        shutil.copy2(f, DEX_DATA_DIR / f.name)
        print(f"  ✓ {f.name}")

    # Clear the porydex site/data directory so stale data never lingers
    for f in source.glob("*.js"):
        f.unlink()
    print("  ✓ Cleared porydex site/data cache")

# ══════════════════════════════════════════════════════════════════════════════
#  STEP 4 – Wholly erase Gmax / -[Type] forme species
# ══════════════════════════════════════════════════════════════════════════════

# Any species whose display name ends in "Gmax" (e.g. "Venusaur-Gmax") is wholly
# removed from the dex.
_GMAX_NAME_RE = re.compile(r"Gmax$", re.IGNORECASE)

# Any species whose display name ends in "-Totem" (e.g. "Kommo-o-Totem",
# "Raticate-Alola-Totem") is also wholly removed from the dex, mirroring the
# Gmax erasure.
_TOTEM_NAME_RE = re.compile(r"-Totem$", re.IGNORECASE)

# Any Pikachu costume forme (e.g. "Pikachu-Rock-Star", "Pikachu-Belle",
# "Pikachu-Original", "Pikachu-Partner", "Pikachu-Starter") is wholly removed,
# keeping only plain "Pikachu" in the dex.
_PIKACHU_FORM_NAME_RE = re.compile(r"^Pikachu-", re.IGNORECASE)

# Any species whose display name ends in "-<Type>" is also wholly removed. The
# leading "-" is deliberate: it hits formes like "Arceus-Fire" and
# "Silvally-Ground" without ever matching ordinary Pokémon such as Clefairy,
# Blipbug or Regirock (their names contain a type name but not the "-" suffix).
_TYPE_FORM_SUFFIXES = [
    "Normal", "Fire", "Water", "Electric", "Grass", "Ice", "Fighting",
    "Poison", "Ground", "Flying", "Psychic", "Bug", "Rock", "Ghost",
    "Dragon", "Dark", "Steel", "Fairy",
]
_TYPE_FORM_NAME_RE = re.compile(
    "-(?:" + "|".join(_TYPE_FORM_SUFFIXES) + ")$",
    re.IGNORECASE,
)


def remove_hidden_species(data: dict) -> set[str]:
    step("Wholly erasing Gmax / -[Type] / -Totem / Pikachu-forme species")

    removed: set[str] = set()
    removed_names: set[str] = set()
    for key, v in data.items():
        name = v.get("name", "")
        if (_GMAX_NAME_RE.search(name) or _TYPE_FORM_NAME_RE.search(name)
                or _TOTEM_NAME_RE.search(name) or _PIKACHU_FORM_NAME_RE.search(name)):
            removed.add(key)
            removed_names.add(name)

    for key in removed:
        del data[key]

    # Prune references in surviving species to the erased ones, so no page
    # links to a now-missing entry.
    pruned = 0
    list_fields = ("otherFormes", "cosmeticFormes", "evos")
    for v in data.values():
        for field in list_fields:
            if field not in v:
                continue
            kept = [entry for entry in v[field]
                    if entry not in removed_names and to_id(entry) not in removed]
            if kept:
                if len(kept) != len(v[field]):
                    v[field] = kept
                    pruned += 1
            else:
                del v[field]
                pruned += 1
        prevo = v.get("prevo")
        if prevo and (prevo in removed_names or to_id(prevo) in removed):
            del v["prevo"]
            pruned += 1

    print(f"  ✓ Wholly removed {len(removed)} species")
    if removed:
        print("  ✓ Removed: " + ", ".join(sorted(removed_names)))
    if pruned:
        print(f"  ✓ Pruned {pruned} stale reference(s) in surviving species")
    return removed

# ══════════════════════════════════════════════════════════════════════════════
#  STEP 5 – Apply obtainable tiers from pokemon.csv
# ══════════════════════════════════════════════════════════════════════════════

def apply_obtainable(data: dict) -> int:
    step("Applying obtainable tiers from pokemon.csv")

    # Build (num, to_id(forme)) → key index
    num_forme_index: dict[tuple, str] = {}
    for key, v in data.items():
        num = v.get("num")
        forme = v.get("forme", "")
        if num is not None:
            num_forme_index[(num, to_id(forme))] = key

    def get_key(dex_num, form, prev_form=""):
        norm = re.sub(r"\s+", "-", form)
        k = num_forme_index.get((dex_num, to_id(norm)))
        if not k and prev_form and form:
            k = num_forme_index.get((dex_num, to_id(prev_form + "-" + norm)))
        if not k:
            k = num_forme_index.get((dex_num, ""))
        return k

    obtainable: set[str] = set()

    with open(POKEMON_CSV, encoding="utf-8") as f:
        for row in csv.DictReader(f):
            dex_str = row["dex_number"].strip()
            if not dex_str.isdigit() or int(dex_str) > 10000:
                continue
            dex_num = int(dex_str)
            form      = row["form"].strip()
            prev_form = row.get("evolves_from_form", "").strip()
            key = get_key(dex_num, form, prev_form)
            if key:
                obtainable.add(key)

    updated = 0
    for key, v in data.items():
        v["tier"] = "obtainable" if key in obtainable else "not-in-game"
        if key in obtainable:
            updated += 1

    print(f"  ✓ {updated} marked obtainable, {len(data) - updated} marked not-in-game")
    return updated

# ══════════════════════════════════════════════════════════════════════════════
#  STEP 6 – Apply evolution methods from pokemon.csv
# ══════════════════════════════════════════════════════════════════════════════

_STONES = [
    "Fire Stone", "Water Stone", "Thunder Stone", "Leaf Stone", "Moon Stone",
    "Sun Stone", "Shiny Stone", "Dusk Stone", "Dawn Stone", "Ice Stone",
]

def parse_evo(method: str) -> dict | None:
    """Convert a pokemon.csv evolution_method string to species.js evo fields."""
    method = method.strip()
    if not method:
        return None

    is_guru   = bool(re.search(r"\bGuru\b",   method))
    is_oracle = bool(re.search(r"\bOracle\b", method))

    # ── Level-based ──────────────────────────────────────────────────────────
    m = re.match(r"Level\s+(\d+)", method, re.I)
    if m:
        level = int(m.group(1))
        low   = method.lower()

        if is_oracle:
            return {"evoType": "useItem",  "evoItem": "Energy Oracle",
                    "evoCondition": f"or at level {level}"}
        if is_guru:
            return {"evoType": "useItem",  "evoItem": "Energy Guru",
                    "evoCondition": f"or at level {level}"}

        evo: dict = {"evoType": "levelUp", "evoLevel": level}
        if "at night" in low:
            evo["evoCondition"] = "at night"
        elif "at day" in low:
            evo["evoCondition"] = "during the day"
        return evo

    # ── Evolution stones ─────────────────────────────────────────────────────
    for stone in _STONES:
        if stone.lower() in method.lower():
            return {"evoType": "useItem", "evoItem": stone}

    # ── Trade / linking cord ─────────────────────────────────────────────────
    if "Linking Cord" in method:
        return {"evoType": "trade"}
    if "Dragon Scale" in method:
        return {"evoType": "trade", "evoItem": "Dragon Scale"}

    # ── Other held items ─────────────────────────────────────────────────────
    if "King's Rock" in method:
        return {"evoType": "useItem", "evoItem": "King's Rock"}
    if "Metal Coat" in method:
        return {"evoType": "useItem", "evoItem": "Metal Coat"}

    # ── Move-based ───────────────────────────────────────────────────────────
    if "Ancient Power" in method:
        return {"evoType": "levelMove", "evoMove": "Ancient Power"}

    # ── Mega stones (end in "-ite") ───────────────────────────────────────────
    if re.match(r"^[A-Z][A-Za-z]+ite$", method):
        return {"evoType": "useItem", "evoItem": method}

    # ── Special / form-change ────────────────────────────────────────────────
    return {"evoType": "other", "evoCondition": method}


def _apply_evo_fields(entry: dict, parsed: dict):
    """Write parsed evo fields onto a species.js entry, cleaning up stale fields."""
    entry["evoType"] = parsed["evoType"]

    for field in ("evoLevel", "evoItem", "evoMove", "evoCondition"):
        val = parsed.get(field)
        if val is not None:
            entry[field] = val
        elif field in entry:
            del entry[field]


def apply_evo_methods(data: dict) -> int:
    step("Applying evolution methods from pokemon.csv (including Guru / Oracle)")

    num_forme_index: dict[tuple, str] = {}
    for key, v in data.items():
        num = v.get("num")
        forme = v.get("forme", "")
        if num is not None:
            num_forme_index[(num, to_id(forme))] = key

    def get_key(dex_num, form, prev_form=""):
        norm = re.sub(r"\s+", "-", form)
        k = num_forme_index.get((dex_num, to_id(norm)))
        if not k and prev_form and form:
            k = num_forme_index.get((dex_num, to_id(prev_form + "-" + norm)))
        if not k:
            k = num_forme_index.get((dex_num, ""))
        return k

    updated = 0

    with open(POKEMON_CSV, encoding="utf-8") as f:
        for row in csv.DictReader(f):
            dex_str = row["dex_number"].strip()
            if not dex_str.isdigit() or int(dex_str) > 10000:
                continue
            if row["stage"] != "evo":
                continue

            dex_num   = int(dex_str)
            form      = row["form"].strip()
            prev_form = row.get("evolves_from_form", "").strip()
            evo_str   = row["evolution_method"].strip()

            key = get_key(dex_num, form, prev_form)
            if not key or key not in data:
                continue

            parsed = parse_evo(evo_str)
            if parsed is None:
                continue

            _apply_evo_fields(data[key], parsed)
            updated += 1

    print(f"  ✓ Updated evo data for {updated} Pokémon")
    return updated

# ══════════════════════════════════════════════════════════════════════════════
#  STEP 7 – Apply egg moves from egg_moves.h
# ══════════════════════════════════════════════════════════════════════════════

def apply_egg_moves(learnsets: dict, species_data: dict) -> int:
    step("Applying egg moves from egg_moves.h")

    egg_moves_file = EMERALD_BLITZ_REPO / "src" / "data" / "pokemon" / "egg_moves.h"
    if not egg_moves_file.exists():
        print("  ! egg_moves.h not found, skipping")
        return 0

    content = egg_moves_file.read_text(encoding="utf-8", errors="replace")
    content = re.sub(r"//[^\n]*", "", content)  # strip line comments

    EGG_MOVE_SUFFIX = "eggmovelearnset"
    species_keys = set(species_data.keys())

    # ── Step A: apply moves directly from egg_moves.h ────────────────────────
    direct = 0
    for m in re.finditer(
        r"static const u16 (s\w+EggMoveLearnset)\s*\[\]\s*=\s*\{([^}]+)\}",
        content, re.DOTALL
    ):
        array_id = to_id(m.group(1))
        if not array_id.startswith("s") or not array_id.endswith(EGG_MOVE_SUFFIX):
            continue
        species_key = array_id[1 : -len(EGG_MOVE_SUFFIX)]
        if species_key not in species_keys:
            continue

        moves = [
            to_id(mm.group(1))
            for mm in re.finditer(r"MOVE_([A-Z0-9_]+)", m.group(2))
            if mm.group(1) != "UNAVAILABLE"
        ]
        if not moves:
            continue

        entry = learnsets.setdefault(species_key, {})
        learnset = entry.setdefault("learnset", {})
        for move in moves:
            sources = learnset.setdefault(move, [])
            if "E" not in sources:
                sources.append("E")
        direct += 1

    # ── Step B: propagate egg moves to all evolutions in the family ───────────
    # Build prevo_name → species_key lookup (prevo field stores display name)
    prevo_to_key: dict[str, list[str]] = {}
    for key, v in species_data.items():
        prevo = v.get("prevo")
        if prevo:
            prevo_key = to_id(prevo)
            prevo_to_key.setdefault(prevo_key, []).append(key)

    def get_family_egg_moves(key: str) -> set[str]:
        """Collect all egg moves from this species and all its prevos."""
        moves: set[str] = set()
        visited: set[str] = set()
        cur = key
        while cur and cur not in visited:
            visited.add(cur)
            ls = learnsets.get(cur, {}).get("learnset", {})
            for move, sources in ls.items():
                if "E" in sources:
                    moves.add(move)
            # Walk up the prevo chain
            prevo_name = species_data.get(cur, {}).get("prevo")
            cur = to_id(prevo_name) if prevo_name else None
        return moves

    # Propagate: any species whose prevo (or ancestor) has egg moves gets them too
    propagated = 0
    # Repeat until stable (handles chains: base → mid → final)
    changed = True
    while changed:
        changed = False
        for key in species_keys:
            family_moves = get_family_egg_moves(key)
            if not family_moves:
                continue
            entry = learnsets.setdefault(key, {})
            learnset = entry.setdefault("learnset", {})
            for move in family_moves:
                sources = learnset.setdefault(move, [])
                if "E" not in sources:
                    sources.append("E")
                    changed = True
                    propagated += 1

    print(f"  ✓ Applied egg moves to {direct} base species, "
          f"propagated {propagated} move entries to evolutions")
    return direct

def main():
    print("\n" + "="*60)
    print("  Emerald Blitz - Comprehensive Pokedex Updater")
    print("="*60)

    # Validate config
    for label, path in [("EmeraldBlitz repo", EMERALD_BLITZ_REPO),
                         ("porydex dir",       PORYDEX_DIR),
                         ("GCC bin",           GCC_BIN),
                         ("pokemon.csv",       POKEMON_CSV)]:
        if not path.exists():
            sys.exit(f"ERROR: {label} not found at:\n  {path}\nEdit the CONFIG section at the top of this script.")

    generate_headers()
    run_porydex()
    copy_data()

    # Load species.js for post-processing
    species_path = DEX_DATA_DIR / "species.js"
    js_prefix = "exports.BattlePokedex = "
    with open(species_path, encoding="utf-8") as f:
        content = f.read()
    species_data = json.loads(content[len(js_prefix):].rstrip().rstrip(";"))

    removed_keys = remove_hidden_species(species_data)

    apply_obtainable(species_data)
    apply_evo_methods(species_data)

    # Write back species.js
    with open(species_path, "w", encoding="utf-8") as f:
        f.write(js_prefix + json.dumps(species_data, separators=(",", ":")) + ";")

    # Load learnsets.js, apply egg moves, write back
    learnsets_path = DEX_DATA_DIR / "learnsets.js"
    ls_prefix = "exports.BattleLearnsets = "
    with open(learnsets_path, encoding="utf-8") as f:
        ls_content = f.read()
    learnsets_data = json.loads(ls_content[len(ls_prefix):].rstrip().rstrip(";"))

    # Drop learnset entries for wholly erased species
    for key in removed_keys:
        learnsets_data.pop(key, None)

    apply_egg_moves(learnsets_data, species_data)

    with open(learnsets_path, "w", encoding="utf-8") as f:
        f.write(ls_prefix + json.dumps(learnsets_data, separators=(",", ":")) + ";")

    print("\n" + "="*60)
    print("  All done! Rebuild the frontend to deploy:")
    print()
    print("  docker compose up -d --build --force-recreate \\")
    print("              --no-deps frontend")
    print("="*60 + "\n")


if __name__ == "__main__":
    main()
