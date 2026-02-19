from __future__ import annotations

import csv
from pathlib import Path
from typing import (
    Any,
    Dict,
    Iterable,
    Iterator,
    Mapping,
    Optional,
    TypedDict,
)

from typing import Optional
import psycopg
from psycopg import Connection


# ---------- Types ----------

class CsvRow(TypedDict):
    dex_number: str
    name: str
    form: str
    evolves_from_id: str
    evolves_from_form: str
    type1: str
    type2: str
    stage: str
    ability1: str
    ability2: str
    hidden_ability: str
    hp: str
    attack: str
    defense: str
    sp_attack: str
    sp_defense: str
    speed: str
    evolution_method: str
    mega: str
    is_baby: str


class DbRow(TypedDict):
    pokedex_id: int
    name: str
    patch_version: str
    form: str
    stage: str
    description: Optional[str]
    type1: str
    type2: Optional[str]
    ability1: str
    ability2: Optional[str]
    hidden_ability: Optional[str]
    evolves_from_id: Optional[int]
    evolves_from_form: Optional[str]
    evolution_method: Optional[str]
    mega: Optional[str]
    is_baby: bool
    hp: int
    attack: int
    defense: int
    sp_attack: int
    sp_defense: int
    speed: int


Rows = Iterable[DbRow]


# ---------- CSV ----------

def read_csv(path: Path) -> Iterator[CsvRow]:
    with path.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            yield row  # type: ignore[return-value]


# ---------- Transform ----------

def to_int(value: str) -> int:
    if value == '':
        return 0
    return int(value.strip())

def to_optional_str(value: str) -> Optional[str]:
    value = value.strip()
    return value if value else None


def to_bool(value: Optional[str], default: bool = False) -> bool:
    """
    Convert a CSV value to boolean.

    Accepts strings like 'true', '1', 'yes', 'y' (case insensitive)
    Returns `default` if the value is empty or None.
    """
    if value is None:
        return default
    value_str = value.strip().lower()
    if not value_str:
        return default
    return value_str in {"true", "1", "yes", "y"}


def transform_row(
    row: CsvRow,
    *,
    patch_version: str,
) -> DbRow:
    return DbRow(
        pokedex_id=to_int(row["dex_number"]),
        name=row["name"].strip(),
        patch_version=patch_version,
        form=row["form"].strip(),
        stage=row["stage"].strip(),
        description=None,
        type1=row["type1"].strip(),
        type2=to_optional_str(row["type2"]),
        ability1=row["ability1"].strip(),
        ability2=to_optional_str(row["ability2"]),
        hidden_ability=to_optional_str(row["hidden_ability"]),
        evolves_from_id=to_int(row["evolves_from_id"]) if row["evolves_from_id"] else None,
        evolves_from_form=to_optional_str(row["evolves_from_form"]),
        evolution_method=to_optional_str(row["evolution_method"]),
        mega=to_optional_str(row["mega"]),
        is_baby=to_bool(row["is_baby"]),
        hp=to_int(row["hp"]),
        attack=to_int(row["attack"]),
        defense=to_int(row["defense"]),
        sp_attack=to_int(row["sp_attack"]),
        sp_defense=to_int(row["sp_defense"]),
        speed=to_int(row["speed"]),
    )

# ---------- SQL ----------

INSERT_SQL = """
INSERT INTO pokemon (
    pokedex_id,
    name,
    patch_version,
    form,
    stage,
    description,
    type1,
    type2,
    ability1,
    ability2,
    hidden_ability,
    evolves_from_id,
    evolves_from_form,
    evolution_method,
    mega,
    is_baby,
    hp,
    attack,
    defense,
    sp_attack,
    sp_defense,
    speed
)
VALUES (
    %(pokedex_id)s,
    %(name)s,
    %(patch_version)s,
    %(form)s,
    %(stage)s,
    %(description)s,
    %(type1)s,
    %(type2)s,
    %(ability1)s,
    %(ability2)s,
    %(hidden_ability)s,
    %(evolves_from_id)s,
    %(evolves_from_form)s,
    %(evolution_method)s,
    %(mega)s,
    %(is_baby)s,
    %(hp)s,
    %(attack)s,
    %(defense)s,
    %(sp_attack)s,
    %(sp_defense)s,
    %(speed)s
)
ON CONFLICT (pokedex_id, form, patch_version)
DO NOTHING;
"""


# ---------- Loader ----------

def insert_rows(
    conn: Connection[Any],
    rows: Rows,
) -> None:
    with conn.cursor() as cur:
        cur.executemany(INSERT_SQL, rows)
    conn.commit()


def reset_database(dsn: str) -> None:
    """Truncates the pokemon table to clear old data."""
    with psycopg.connect(dsn) as conn:
        with conn.cursor() as cur:
            print("Resetting database...")
            cur.execute("TRUNCATE TABLE pokemon RESTART IDENTITY CASCADE;")
        conn.commit()
    print("Database reset complete.")


def load_csv(
    *,
    csv_path: Path,
    dsn: str,
    patch_version: str,
) -> None:
    transformed_rows = (
        transform_row(row, patch_version=patch_version)
        for row in read_csv(csv_path)
    )

    with psycopg.connect(dsn) as conn:
        insert_rows(conn, transformed_rows)


# ---------- Entry ----------

if __name__ == "__main__":
    dsn = "postgresql://postgres:password@localhost:5432/auction_db"
    reset_database(dsn)
    load_csv(
        csv_path=Path("pokemon-8.2.csv"),
        dsn=dsn,
        patch_version="8.2",
    )
