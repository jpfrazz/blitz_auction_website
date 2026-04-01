use std::fmt::format;

use axum::http::StatusCode;
use serde::Deserialize;
use sqlx::PgPool;

use crate::{AppError, pokemon};

#[derive(Deserialize, Debug)]
pub struct PokemonCsvRecord {
    #[serde(rename = "dex_number")]
    pub pokedex_id: i32,
    pub name: String,
    pub form: Option<String>,
    pub evolves_from_id: Option<i32>,
    pub evolves_from_form: Option<String>,
    pub type1: String,
    pub type2: Option<String>,
    pub stage: Option<String>,
    pub ability1: String,
    pub ability2: Option<String>,
    pub hidden_ability: Option<String>,
    pub hp: i32,
    pub attack: i32,
    pub defense: i32,
    pub sp_attack: i32,
    pub sp_defense: i32,
    pub speed: i32,
    pub evolution_method: Option<String>,
    pub mega: Option<String>,
    pub obtain_method: Option<String>,
    pub description: Option<String>,
}

#[derive(Deserialize, Debug)]
pub struct KeyMoveCsvRecord {
    pub pokedex_id: i32,
    pub pokemon_name: Option<String>,
    pub form: Option<String>,
    pub move_name: String,
    pub learn_method: Option<String>,
    pub species: Option<String>,
}

pub async fn update_pokemon_data(
    pool: PgPool,
    pokemon_data: Vec<PokemonCsvRecord>,
) -> Result<(), AppError> {
    let mut tx = pool.begin().await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("failed to begin db transaction: {}", e),
        )
    })?;

    let mut csv_ids: Vec<i32> = Vec::new();
    let mut csv_forms: Vec<String> = Vec::new();

    // updates db from the csv
    for pokemon in pokemon_data.iter() {
        csv_ids.push(pokemon.pokedex_id);
        csv_forms.push(pokemon.form.clone().unwrap_or_default());

        let _ = sqlx::query!(
            r#"
                INSERT INTO pokemon (
                    pokedex_id, name, form, stage, description, type1, type2,
                    ability1, ability2, hidden_ability, evolution_method, evolves_from_id,
                    evolves_from_form, mega, obtain_method, hp, attack, defense,
                    sp_attack, sp_defense, speed
                )
                VALUES (
                    $1, $2, $3, $4, $5, $6, $7,
                    $8, $9, $10, $11, $12,
                    $13, $14, $15, $16, $17, $18,
                    $19, $20, $21
                )
                ON CONFLICT (pokedex_id, form) DO UPDATE SET
                    name = EXCLUDED.name,
                    stage = EXCLUDED.stage,
                    description = EXCLUDED.description,
                    type1 = EXCLUDED.type1,
                    type2 = EXCLUDED.type2,
                    ability1 = EXCLUDED.ability1,
                    ability2 = EXCLUDED.ability2,
                    hidden_ability = EXCLUDED.hidden_ability,
                    evolution_method = EXCLUDED.evolution_method,
                    evolves_from_id = EXCLUDED.evolves_from_id,
                    evolves_from_form = EXCLUDED.evolves_from_form,
                    mega = EXCLUDED.mega,
                    obtain_method = EXCLUDED.obtain_method,
                    hp = EXCLUDED.hp,
                    attack = EXCLUDED.attack,
                    defense = EXCLUDED.defense,
                    sp_attack = EXCLUDED.sp_attack,
                    sp_defense = EXCLUDED.sp_defense,
                    speed = EXCLUDED.speed
            "#,
            pokemon.pokedex_id,
            pokemon.name,
            pokemon.form.clone().unwrap_or_default(),
            pokemon.stage,
            pokemon.description,
            pokemon.type1,
            pokemon.type2,
            pokemon.ability1,
            pokemon.ability2,
            pokemon.hidden_ability,
            pokemon.evolution_method,
            pokemon.evolves_from_id,
            pokemon.evolves_from_form,
            pokemon.mega,
            pokemon.obtain_method,
            pokemon.hp,
            pokemon.attack,
            pokemon.defense,
            pokemon.sp_attack,
            pokemon.sp_defense,
            pokemon.speed
        )
        .execute(&mut *tx)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to update pokemon in db, {}", e),
            )
        })?;
    }

    if !pokemon_data.is_empty() {
        let _ = sqlx::query!(
            r#"
            UPDATE pokemon
            SET obtain_method = 'Vaulted'
            WHERE (pokedex_id, form) NOT IN (
                SELECT * FROM UNNEST($1::int[], $2::text[])
            )
            "#,
            &csv_ids[..],
            &csv_forms[..])
        .execute(&mut *tx)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to update vaulted pokemon in db, {}", e),
            )
        })?;
    }

    tx.commit().await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("failed to commit transaction for pokemon update, {}", e),
        )
    })?;

    pokemon::reload_pokemon_data(&pool).await
}

pub async fn update_pokemon_key_moves_data(
    pool: PgPool,
    key_move_data: Vec<KeyMoveCsvRecord>,
) -> Result<(), AppError> {
    let mut tx = pool.begin().await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("failed to begin db transaction: {}", e),
        )
    })?;

    let mut csv_ids: Vec<i32> = Vec::new();
    let mut csv_forms: Vec<String> = Vec::new();
    let mut csv_moves: Vec<String> = Vec::new();

    for key_move in key_move_data.iter() {
        csv_ids.push(key_move.pokedex_id);
        csv_forms.push(key_move.form.clone().unwrap_or_default());
        csv_moves.push(key_move.move_name.clone());

        let _ = sqlx::query!(
            r#"
            INSERT INTO key_moves (pokedex_id, form, move_name, learn_method, species)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (pokedex_id, form, move_name) DO UPDATE SET
                learn_method = EXCLUDED.learn_method,
                species = EXCLUDED.species
            "#,
            key_move.pokedex_id,
            key_move.form.clone().unwrap_or_default(),
            key_move.move_name,
            key_move.learn_method.clone().unwrap_or_default(),
            key_move.species
        )
        .execute(&mut *tx)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to update key moves in db, {}", e),
            )
        })?;
    }

    if !key_move_data.is_empty() {
        let _ = sqlx::query(
            r#"
                DELETE FROM key_moves
                WHERE NOT EXISTS (
                    SELECT 1 
                    FROM UNNEST($1::int[], $2::text[], $3::text[]) AS uploaded(u_id, u_form, u_move)
                    WHERE key_moves.pokedex_id = uploaded.u_id 
                      AND key_moves.form = uploaded.u_form
                      AND key_moves.move_name = uploaded.u_move
                )
                "#,
        )
        .bind(&csv_ids)
        .bind(&csv_forms)
        .bind(&csv_moves)
        .execute(&mut *tx)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to delete key moves in db, {}", e),
            )
        })?;
    }

    tx.commit().await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("failed to commit transaction for pokemon update, {}", e),
        )
    })?;

    pokemon::reload_pokemon_data(&pool).await
}
