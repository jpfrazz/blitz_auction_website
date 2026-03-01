use sqlx::{Postgres, Transaction};
use strum::Display;

use serde::{Deserialize, Serialize};
use tokio::time::Instant;
use std::sync::Arc;

use crate::{pokemon::Pokemon, users::User};

#[derive(Clone, Debug, Serialize)]
pub struct Auction {
    pub auction_id: String,
    pub draft_id: String,
    pub draft_order: u32,
    pub status: AuctionState,
    pub pokemon: Arc<Pokemon>,
    pub highest_bid: u32,
    pub highest_bidder: Option<User>,
    #[serde(skip)]
    pub expires_at: Option<Instant>,
}

#[derive(Clone, Debug, Display, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuctionState {
    PENDING,
    OPEN,
    CLOSED,
}

impl Auction {
    fn new(
        draft_id: String,
        draft_order: u32,
        auction_id: String,
        pokemon: Arc<Pokemon>,
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
        pokemon: Arc<Pokemon>,
        tx: &mut Transaction<'_, Postgres>,
    ) -> Result<Auction, sqlx::Error> {
        let auction_id = sqlx::query!(
            r#"
            INSERT INTO auctions
            (pokedex_id, form, draft_id, draft_order)
            VALUES ($1, $2, $3, $4)
            RETURNING auction_id
            "#,
            pokemon.pokedex_id as i32,
            pokemon.form.clone().unwrap_or_else(|| "".to_string()),
            draft_id,
            draft_order as i32,
        )
        .fetch_one(&mut **tx)
        .await?
        .auction_id;

        Ok(Auction::new(
            draft_id,
            draft_order,
            auction_id.to_string(),
            pokemon,
        ))
    }

    pub async fn resolve(&mut self, tx: &mut Transaction<'_, Postgres>) -> Result<(), sqlx::Error> {
        let winning_user = self
            .highest_bidder
            .as_ref()
            .expect("someone should win auctions");
        let user_field = match winning_user {
            User::DiscordUser(_) => "winning_user_id",
            User::GuestUser(_) => "winning_guest_id",
        };
        let user_id = winning_user.get_user_id_string();
        let winning_bid = self.highest_bid as i32;
        let query_string = format!(
            "
                UPDATE auctions
                SET (status, winning_bid, {}) = ('{}', {}, '{}')
                WHERE auction_id = {}
            ",
            user_field,
            AuctionState::CLOSED.to_string(),
            winning_bid,
            user_id,
            self.auction_id,
        );

        let _res = sqlx::query(&query_string).execute(&mut **tx).await?;

        let user_field = match winning_user {
            User::DiscordUser(_) => "user_id",
            User::GuestUser(_) => "guest_id",
        };

        let query_string = format!(
            "
                UPDATE teams
                SET (money_remaining, pokemon_drafted) = (money_remaining - {}, pokemon_drafted + 1)
                WHERE {} = '{}' AND draft_id = '{}'
            ",
            winning_bid, user_field, user_id, self.draft_id,
        );

        let _res = sqlx::query(&query_string).execute(&mut **tx).await?;

        self.status = AuctionState::CLOSED;

        Ok(())
    }
}
