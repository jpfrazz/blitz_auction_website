use std::{collections::HashMap,sync::OnceLock};

use serde::{Deserialize, Serialize};
use sqlx::{PgPool, prelude::FromRow, types::Json, FromRow};
use tokio::sync::RwLock;

type PokemonData = HashMap<String, HashMap<u32, HashMap<Option<String>, Pokemon>>>;
static POKEMON_DATA: OnceLock<RwLock<PokemonData>> = OnceLock::new();

pub async fn init_pokemon_data(pool: &PgPool) -> Result<(), sqlx::Error> {
    let pokemon_list = sqlx::query!(
        r#"
        SELECT
            p.*,
            COALESCE(
                (
                    SELECT json_agg(
                        json_build_object(
                            'move_name', km.move_name,
                            'learn_method', km.learn_method
                        )
                    )
                    FROM key_moves km
                    WHERE (km.pokedex_id, km.form, km.patch_version) =
                        (p.pokedex_id, p.form, p.patch_version)
                ),
                '[]'::json
            ) as "key_moves!: Json<Vec<KeyMoveRow>>"
        FROM pokemon p
        "#,
    )
    .map(|row| Pokemon {
        pokedex_id: u32::try_from(row.pokedex_id).unwrap_or_else(|_| {
            panic!("Pokemon {} {} has invalid pokedex_id: {}", row.name, row.form, row.pokedex_id)
        }),
        name: row.name,
        form: if row.form.is_empty() { None } else { Some(row.form) },
        patch_version: row.patch_version,
        type1: row.type1.into(),
        type2: row.type2.map(|t| t.into()),
        ability1: row.ability1,
        ability2: row.ability2,
        hidden_ability: row.hidden_ability,
        stats: PokemonStats {
            hp: u8::try_from(row.hp).unwrap_or_else(|_| {
                panic!("Pokemon {} {} has invalid hp: {}", row.name, row.form, row.hp)
            }),
            attack: u8::try_from(row.attack).unwrap_or_else(|_| {
                panic!("Pokemon {} {} has invalid attack: {}", row.name, row.form, row.attack)
            }),
            defense: u8::try_from(row.defense).unwrap_or_else(|_| {
                panic!("Pokemon {} {} has invalid defense: {}", row.name, row.form, row.defense)
            }),
            sp_attack: u8::try_from(row.sp_attack).unwrap_or_else(|_| {
                panic!("Pokemon {} {} has invalid sp_attack: {}", row.name, row.form, row.sp_attack)
            }),
            sp_defense: u8::try_from(row.sp_defense).unwrap_or_else(|_| {
                panic!("Pokemon {} {} has invalid sp_defense: {}", row.name, row.form, row.sp_defense)
            }),
            speed: u8::try_from(row.speed).unwrap_or_else(|_| {
                panic!("Pokemon {} {} has invalid speed: {}", row.name, row.form, row.speed)
            }),
        },
        key_moves: row.key_moves,
        description: row.description,

    })
    .fetch_all(pool)
    .await?;

    let cache: PokemonData = HashMap::new();

    for pokemon in pokemon_list{
        cache
            .entry(pokemon.patch_version.clone())
            .or_default()
            .entry(pokemon.pokedex_id)
            .or_default()
            .insert(pokemon.form.clone(), pokemon);
    }

    POKEMON_DATA.set(RwLock::new(cache)).expect("POKEMON_DATA already initialized");
}

pub fn get_pokemon_data(patch_version: &str, excluded_pokemon: &Vec<(i32, String)>) -> Option<Vec<&'static Pokemon>> {
    let cache = POKEMON_DATA.get().expect("POKEMON_DATA not initialized");

    let Some(id_map) = cache.get(&patch_version) else {
        return None()
    };

    id_map.values()
        .flat_map(|form_map| form_map.values())
        .filter(|p| !excluded_pokemon.contains(&(p.pokedex_id, p.form)))
        .collect()
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Pokemon {
    pub pokedex_id: u32,
    pub name: String,
    pub form: Option<String>,
    pub patch_version: String,
    pub type1: PokemonType,
    pub type2: Option<PokemonType>,
    pub ability1: String,
    pub ability2: Option<String>,
    pub hidden_ability: Option<String>,
    pub stats: PokemonStats,
    pub key_moves: Json<Vec<KeyMoveRow>>,
    pub description: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PokemonRow {
    pub pokedex_id: i32,
    pub name: String,
    pub form: Option<String>,
    pub patch_version: String,
    pub type1: PokemonType,
    pub type2: Option<PokemonType>,
    pub ability1: String,
    pub ability2: Option<String>,
    pub hidden_ability: Option<String>,
    pub stats: PokemonStats,
    pub description: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct KeyMoveRow {
    pub pokedex_id: i32,
    pub form: Option<String>,
    pub patch_version: String,
    pub move_name: String,
    pub learn_method: String,
}

// impl TryFrom<(PokemonRow, Vec<KeyMoveRow>)> for Pokemon {
//     type Error = String;
//     fn try_from(pokemon_tuple: (PokemonRow, Vec<KeyMoveRow>)) -> Result<Pokemon, Self::Error> {
//         let (pokemon_row, key_moves) = pokemon_tuple;
//         Ok(Pokemon {
//
//         })
//     }
// }

#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
pub enum PokemonType {
    Normal,
    Fighting,
    Flying,
    Poison,
    Ground,
    Rock,
    Bug,
    Ghost,
    Steel,
    Fire,
    Water,
    Grass,
    Electric,
    Psychic,
    Ice,
    Dragon,
    Dark,
    Fairy,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, FromRow)]
pub struct PokemonStats {
    pub hp: u8,
    pub attack: u8,
    pub defense: u8,
    pub sp_attack: u8,
    pub sp_defense: u8,
    pub speed: u8,
}

#[derive(Clone, Debug, Serialize, Deserialize, FromRow)]
pub struct PokemonMove {
    pub name: String,
    pub power: u8,
    pub accuracy: u8,
    pub pp: u8,
    pub effect: String,
    pub effect_chance: u8,
}
