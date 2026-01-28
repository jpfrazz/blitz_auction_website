use sqlx::{Postgres, Transaction};
use strum::Display;

use serde::{Deserialize, Serialize};
use tokio::time::Instant;
use uuid::Uuid;

use crate::pokemon::Pokemon;

#[derive(Clone, Debug, Serialize)]
pub struct Auction {
    pub auction_id: i64,
    pub draft_id: String,
    pub draft_order: u32,
    pub status: AuctionState,
    pub pokemon: &'static Pokemon,
    pub highest_bid: u32,
    pub highest_bidder: Option<Uuid>,
    #[serde(skip)]
    pub expires_at: Option<Instant>,
}

#[derive(Clone, Debug, Display, Serialize, Deserialize)]
pub enum AuctionState {
    PENDING,
    BIDDING,
    CLOSED,
}

impl Auction {
    fn new(
        draft_id: String,
        draft_order: u32,
        auction_id: i64,
        pokemon: &'static Pokemon,
    ) -> Auction {
        Auction {
            auction_id,
            draft_id,
            draft_order,
            status: AuctionState::PENDING,
            pokemon,
            highest_bid: 0,
            highest_bidder: None,
            expires_at: None,
        }
    }

    pub async fn build(
        draft_id: String,
        draft_order: u32,
        pokemon: &'static Pokemon,
        tx: &mut Transaction<'_, Postgres>,
    ) -> Result<Auction, sqlx::Error> {
        let auction_id = sqlx::query!(
            r#"
            INSERT INTO auctions
            (pokedex_id, form, patch_version, draft_id, draft_order)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING auction_id
            "#,
            pokemon.pokedex_id as i32,
            pokemon.form,
            pokemon.patch_version,
            draft_id,
            draft_order as i32,
        )
        .fetch_one(&mut **tx)
        .await?
        .auction_id;

        Ok(Auction::new(draft_id, draft_order, auction_id, pokemon))
    }

    pub async fn resolve(&self, tx: &mut Transaction<'_, Postgres>) -> Result<(), sqlx::Error> {
        let _res = sqlx::query!(
            r#"
            UPDATE auctions
            SET (status, winning_bid, drafted_by) = ($1, $2, $3)
            WHERE auction_id = $4
            "#,
            &AuctionState::CLOSED.to_string(),
            self.highest_bid as i32,
            self.highest_bidder,
            self.auction_id,
        )
        .execute(&mut **tx)
        .await?;

        let _res = sqlx::query!(
            r#"
            UPDATE teams
            SET money_remaining = money_remaining - $1
            WHERE user_id = $2 AND draft_id = $3
            "#,
            self.highest_bid as i32,
            self.highest_bidder,
            self.draft_id,
        )
        .execute(&mut **tx)
        .await?;

        Ok(())
    }
}
