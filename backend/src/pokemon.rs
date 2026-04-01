use std::sync::{Arc, OnceLock, RwLock};
use axum::http::StatusCode;
use strum::{Display, EnumString};

use serde::{Deserialize, Serialize};
use sqlx::{PgPool, prelude::FromRow, types::Json};

use crate::{AppError, draft::ExcludedPokemon};

static POKEMON_DATA: OnceLock<RwLock<Vec<Arc<Pokemon>>>> = OnceLock::new();

pub async fn read_pokemon_data_from_db(pool: &PgPool) -> Result<Vec<Arc<Pokemon>>, AppError> {
    let pokemon_list = sqlx::query!(
        r#"
        SELECT
            p.*,
            COALESCE(
                (
                    SELECT json_agg(
                        json_build_object(
                            'pokedex_id', km.pokedex_id,
                            'form', km.form,
                            'move_name', km.move_name,
                            'learn_method', km.learn_method,
                            'species', km.species
                        )
                    )
                    FROM key_moves km
                    WHERE (km.pokedex_id, km.form) =
                        (p.pokedex_id, p.form)
                ),
                '[]'::json
            ) as "key_moves!: Json<Vec<KeyMoveRow>>"
        FROM pokemon p
        "#,
    )
    .map(|row| Pokemon {
        pokedex_id: u32::try_from(row.pokedex_id).unwrap_or_else(|_| {
            panic!(
                "Pokemon {} {} has invalid pokedex_id: {}",
                row.name,
                row.form.clone().unwrap_or_default(),
                row.pokedex_id
            )
        }),
        name: row.name.clone(),
        form: row.form.clone(),
        stage: row
            .stage
            .parse()
            .unwrap_or_else(|e| panic!("stage not valid: {}, {}", row.stage, row.pokedex_id)),
        type1: row
            .type1
            .parse()
            .unwrap_or_else(|_e| match row.type1.as_str() {
                "???" => PokemonType::Egg,
                _ => panic!("pokemon_type not valid, {}", row.type1),
            }),
        type2: row.type2.map(|t| t.parse().unwrap()),
        ability1: row.ability1,
        ability2: row.ability2,
        hidden_ability: row.hidden_ability,
        stats: PokemonStats {
            hp: u8::try_from(row.hp).unwrap_or_else(|_| {
                panic!(
                    "Pokemon {} {} has invalid hp: {}",
                    row.name,
                    row.form.clone().unwrap_or_default(),
                    row.hp
                )
            }),
            attack: u8::try_from(row.attack).unwrap_or_else(|_| {
                panic!(
                    "Pokemon {} {} has invalid attack: {}",
                    row.name,
                    row.form.clone().unwrap_or_default(),
                    row.attack
                )
            }),
            defense: u8::try_from(row.defense).unwrap_or_else(|_| {
                panic!(
                    "Pokemon {} {} has invalid defense: {}",
                    row.name,
                    row.form.clone().unwrap_or_default(),
                    row.defense
                )
            }),
            sp_attack: u8::try_from(row.sp_attack).unwrap_or_else(|_| {
                panic!(
                    "Pokemon {} {} has invalid sp_attack: {}",
                    row.name,
                    row.form.clone().unwrap_or_default(),
                    row.sp_attack
                )
            }),
            sp_defense: u8::try_from(row.sp_defense).unwrap_or_else(|_| {
                panic!(
                    "Pokemon {} {} has invalid sp_defense: {}",
                    row.name,
                    row.form.clone().unwrap_or_default(),
                    row.sp_defense
                )
            }),
            speed: u8::try_from(row.speed).unwrap_or_else(|_| {
                panic!(
                    "Pokemon {} {} has invalid speed: {}",
                    row.name,
                    row.form.clone().unwrap_or_default(),
                    row.speed
                )
            }),
        },
        key_moves: row.key_moves,
        description: row.description,
        evolves_from_id: row.evolves_from_id,
        evolves_from_form: row.evolves_from_form,
        evolution_method: row.evolution_method,
        obtain_method: row.obtain_method,
    })
    .fetch_all(pool)
    .await
    .map_err(|e| (
        StatusCode::INTERNAL_SERVER_ERROR,
        format!("failed to read pokemon data from db: {}", e)
    ))?;

    Ok(pokemon_list.into_iter().map(|p| Arc::new(p)).collect())
}

pub async fn reload_pokemon_data(pool: &PgPool) -> Result<(), AppError> {
    let pokemon_vec = read_pokemon_data_from_db(pool).await?;
    let Some(rw_lock) = POKEMON_DATA.get() else {
        return Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("pokemon data is not initialized")
        ));
    };

    let mut vec = rw_lock.write().map_err(|e| (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("couldn't get write lock on pokemon vec, {}", e)
    ))?;

    *vec = pokemon_vec;

    Ok(())
}

pub async fn init_pokemon_data(pool: &PgPool) -> Result<(), AppError> {
    let pokemon_vec = read_pokemon_data_from_db(pool).await?;

    let rw_lock = RwLock::new(pokemon_vec);

    POKEMON_DATA
        .set(rw_lock)
        .expect("POKEMON_DATA already initialized");
    Ok(())
}

pub fn get_pokemon_data(excluded_pokemon: &Vec<ExcludedPokemon>) -> Option<Vec<Arc<Pokemon>>> {
    let cache = POKEMON_DATA.get().expect("POKEMON_DATA not initialized");
    let Ok(pokemon_vec) = cache.read() else {
        return None;
    };

    Some(
        pokemon_vec
            .iter()
            .filter(|p| {
                !excluded_pokemon
                    .iter()
                    .any(|e| e.pokedex_id == p.pokedex_id && e.form == p.form)
            })
            .map(|p| p.clone())
            .collect(),
    )
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Pokemon {
    pub pokedex_id: u32,
    pub name: String,
    pub form: Option<String>,
    pub stage: PokemonStage,
    pub type1: PokemonType,
    pub type2: Option<PokemonType>,
    pub ability1: String,
    pub ability2: Option<String>,
    pub hidden_ability: Option<String>,
    pub stats: PokemonStats,
    pub key_moves: Json<Vec<KeyMoveRow>>,
    pub description: Option<String>,
    pub evolves_from_id: Option<i32>,
    pub evolves_from_form: Option<String>,
    pub evolution_method: Option<String>,
    pub obtain_method: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct KeyMoveRow {
    pub pokedex_id: i32,
    pub form: Option<String>,
    pub move_name: String,
    pub learn_method: String,
    pub species: Option<String>,
}

#[derive(EnumString, Display, Clone, Copy, Debug, Serialize, Deserialize)]
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
    Egg,
}

#[derive(EnumString, Display, Clone, Copy, Debug, Serialize, Deserialize, PartialEq)]
pub enum PokemonStage {
    base,
    evo,
    mega,
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
