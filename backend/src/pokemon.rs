use std::{collections::HashMap,sync::OnceLock};

use serde::{Deserialize, Serialize};
use sqlx::{PgPool, prelude::FromRow};

type PokemonData = HashMap<String, HashMap<u32, Pokemon>>;
static POKEMON_DATA: OnceLock<PokemonData> = OnceLock::new();

pub async fn init_pokemon_data(pool: &PgPool) {
    let query =
        r#"
        SELECT * FROM pokemon
        "#;
}

#[derive(Clone, Debug, Serialize, Deserialize, FromRow)]
pub struct Pokemon {
    pub pokedex_id: u32,
    pub name: String,
    pub form: Option<String>,
    pub type1: PokemonType,
    pub type2: Option<PokemonType>,
    pub stats: PokemonStats,
    pub key_moves: Vec<(PokemonMove, u8)>,
    pub description: String,
}

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

#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
pub struct PokemonStats {
    pub hp: u8,
    pub atk: u8,
    pub def: u8,
    pub spa: u8,
    pub spd: u8,
    pub spe: u8,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PokemonMove {
    pub name: String,
    pub power: u8,
    pub accuracy: u8,
    pub pp: u8,
    pub effect: String,
    pub effect_chance: u8,
}
