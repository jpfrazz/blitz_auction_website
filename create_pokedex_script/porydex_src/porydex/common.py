import operator
import pathlib
import re

PICKLE_PATH = pathlib.Path('./.pickled')

def build_expansion_enums(expansion: pathlib.Path) -> dict[str, int]:
    """
    Dynamically parse enum constants from the expansion's header files.
    GCC preprocessing doesn't resolve enum values to integers — only #define macros.
    Builds a name→value lookup used as a fallback in extract_int().
    """
    headers_to_scan = [
        expansion / 'include/constants/pokemon.h',
        expansion / 'include/constants/abilities.h',
        expansion / 'include/constants/species.h',
        expansion / 'include/constants/moves.h',
        expansion / 'include/constants/item.h',
    ]

    # Pass 1: resolve all integer-valued entries per-enum, collect deferred symbolic refs
    result: dict[str, int] = {}
    deferred: list[tuple[str, str]] = []  # (name, raw_value_str) for symbolic refs

    for header in headers_to_scan:
        if not header.exists():
            continue
        try:
            text = header.read_text(encoding='utf-8', errors='replace')
        except Exception:
            continue

        for enum_body in re.findall(r'enum\b[^{]*\{([^}]+)\}', text, re.DOTALL):
            # Strip line comments BEFORE splitting by comma so commas in comments
            # don't corrupt the split (e.g. "// ...species, like regional forms.")
            enum_body = re.sub(r'//[^\n]*', '', enum_body)
            counter = 0  # reset per enum body
            for entry in enum_body.split(','):
                entry = entry.strip()
                if not entry:
                    continue
                if '=' in entry:
                    name, _, raw_val = entry.partition('=')
                    name = name.strip()
                    raw_val = raw_val.strip()
                    if not re.match(r'^[A-Za-z_][A-Za-z0-9_]*$', name):
                        continue
                    try:
                        counter = int(raw_val, 0)
                        result[name] = counter
                        counter += 1
                    except ValueError:
                        deferred.append((name, raw_val))
                        # don't advance counter — we'll fix it in pass 2
                else:
                    name = entry.strip()
                    if re.match(r'^[A-Za-z_][A-Za-z0-9_]*$', name):
                        result[name] = counter
                        counter += 1

    # Pass 2: resolve deferred symbolic references (e.g. FOO = BAR or FOO = BAR + 1)
    for name, raw_val in deferred:
        ref = raw_val.strip()
        if ref in result:
            result[name] = result[ref]
        else:
            add_match = re.match(r'^([A-Za-z_][A-Za-z0-9_]*)\s*\+\s*(\d+)$', ref)
            if add_match and add_match.group(1) in result:
                result[name] = result[add_match.group(1)] + int(add_match.group(2))
            # else: skip — still unresolvable

    return result

PREPROCESS_LIBC = [
    r'-E',
    r'-Ifake_libc_include',
    r'-D__attribute__(x)=', # these are irrelevant to preprocessing, and it doesn't know how to parse them anyways
]

EXPANSION_INCLUDES = [
    r'include',
    r'gflib',
]

GLOBAL_PREPROC_INTELLISENSE = [
    r'-D__INTELLISENSE__',
    r'-include', r'global.h',
]

GLOBAL_PREPROC = [
    r'-D__INTELLISENSE__',
    r'-include', r'global.h',
    r'-U__INTELLISENSE__',
    # ADDITIONAL_EFFECTS expands to a compound literal array, which pycparser can't parse.
    # Porydex doesn't use additionalEffects data, so stub it out to a null pointer.
    r'-DADDITIONAL_EFFECTS(...)=0',
]

CONFIG_INCLUDES = [
    r'-include', r'config/battle.h',
    r'-include', r'config/item.h',
    r'-include', r'config/pokemon.h',
    r'-include', r'config/species_enabled.h',
]

# Lookup table for enum constants that GCC doesn't resolve during preprocessing.
# Only enum values (not #define macros) need to be listed here.
# Populated lazily when porydex.config is first loaded.
EXPANSION_ENUMS: dict[str, int] = {
    # Type enum (include/constants/pokemon.h) — hardcoded as a baseline
    # in case config isn't loaded yet; the dynamic scan below will override.
    'TYPE_NONE': 0, 'TYPE_NORMAL': 1, 'TYPE_FIGHTING': 2, 'TYPE_FLYING': 3,
    'TYPE_POISON': 4, 'TYPE_GROUND': 5, 'TYPE_ROCK': 6, 'TYPE_BUG': 7,
    'TYPE_GHOST': 8, 'TYPE_STEEL': 9, 'TYPE_MYSTERY': 10, 'TYPE_FIRE': 11,
    'TYPE_WATER': 12, 'TYPE_GRASS': 13, 'TYPE_ELECTRIC': 14, 'TYPE_PSYCHIC': 15,
    'TYPE_ICE': 16, 'TYPE_DRAGON': 17, 'TYPE_DARK': 18, 'TYPE_FAIRY': 19,
    'TYPE_STELLAR': 20,
    # DamageCategory enum
    'DAMAGE_CATEGORY_PHYSICAL': 0, 'DAMAGE_CATEGORY_SPECIAL': 1, 'DAMAGE_CATEGORY_STATUS': 2,
    # GrowthRate enum
    'GROWTH_MEDIUM_FAST': 0, 'GROWTH_ERRATIC': 1, 'GROWTH_FLUCTUATING': 2,
    'GROWTH_MEDIUM_SLOW': 3, 'GROWTH_FAST': 4, 'GROWTH_SLOW': 5,
    # BodyColor enum
    'BODY_COLOR_RED': 0, 'BODY_COLOR_BLUE': 1, 'BODY_COLOR_YELLOW': 2,
    'BODY_COLOR_GREEN': 3, 'BODY_COLOR_BLACK': 4, 'BODY_COLOR_BROWN': 5,
    'BODY_COLOR_PURPLE': 6, 'BODY_COLOR_GRAY': 7, 'BODY_COLOR_WHITE': 8,
    'BODY_COLOR_PINK': 9,
}

def refresh_expansion_enums(expansion: pathlib.Path) -> None:
    """Call once after config is loaded to populate EXPANSION_ENUMS from the game source."""
    EXPANSION_ENUMS.update(build_expansion_enums(expansion))

COMMON_CPP_ARGS = [
    r'-DTRUE=1',
    r'-DFALSE=0',
    r'-Du8=char',
    r'-DGEN_1=1',
    r'-DGEN_2=2',
    r'-DGEN_3=3',
    r'-DGEN_4=4',
    r'-DGEN_5=5',
    r'-DGEN_6=6',
    r'-DGEN_7=7',
    r'-DGEN_8=8',
    r'-DGEN_9=9',
]

BINARY_BOOL_OPS = {
    '==': operator.eq,
    '>': operator.gt,
    '>=': operator.ge,
    '<=': operator.le,
    '<': operator.lt,
    '!=': operator.ne,
    '+': operator.add,
    '-': operator.sub,
    '*': operator.mul,
    '/': operator.itruediv,
    '||': lambda a, b: int(bool(a) or bool(b)),
    '&&': lambda a, b: int(bool(a) and bool(b)),
}

SPLIT_CHARS = re.compile(r"[\W_-]+")

def name_key(name: str) -> str:
    return ''.join(SPLIT_CHARS.split(name.replace('é', 'e'))).lower()

