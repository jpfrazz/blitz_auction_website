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
    type: str
    stage: str
    evolves_from: str
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
    description: Optional[str]
    type1: str
    type2: Optional[str]
    ability1: str
    ability2: Optional[str]
    hidden_ability: Optional[str]
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

def parse_types(value: str) -> tuple[str, Optional[str]]:
    """
    Parse a CSV 'type' field into (type1, type2).

    Examples:
        "Dark" -> ("Dark", None)
        "Dark/Fairy" -> ("Dark", "Fairy")
        "Dark / Fairy" -> ("Dark", "Fairy")
    """
    parts = [part.strip() for part in value.split("/") if part.strip()]

    if not parts:
        raise ValueError("Type column cannot be empty")

    type1: str = parts[0]
    type2: Optional[str] = parts[1] if len(parts) > 1 else None

    return type1, type2


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
    default_form: str = "",
) -> DbRow:
    type1, type2 = parse_types(row["type"])

    return DbRow(
        pokedex_id=to_int(row["dex_number"]),
        name=row["name"].strip(),
        patch_version=patch_version,
        form=default_form,
        description=None,
        type1=type1,
        type2=type2,
        ability1=row["ability1"].strip(),
        ability2=to_optional_str(row["ability2"]),
        hidden_ability=to_optional_str(row["hidden_ability"]),
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
    description,
    type1,
    type2,
    ability1,
    ability2,
    hidden_ability,
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
    %(description)s,
    %(type1)s,
    %(type2)s,
    %(ability1)s,
    %(ability2)s,
    %(hidden_ability)s,
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
    load_csv(
        csv_path=Path("pokemon-7.91.csv"),
        dsn="postgresql://postgres:password@localhost:5432/auction_db",
        patch_version="7.9.1",
    )
