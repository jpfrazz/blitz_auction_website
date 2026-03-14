use sqlx::PgPool;
use tokio::sync::mpsc;

use crate::users::{DiscordUser, GuestUser, User};

pub struct DbWriter {
    actor_sender: mpsc::Sender<DbCommand>
}

struct Actor {
    draft_id: String,
    pool: PgPool,
    command_recv: mpsc::Receiver<DbCommand>
}

enum DbCommand {

}

impl DbWriter {
    pub async fn write_bid(auction_id: String, bid_value: u32, user: User) {
    }
}

impl Actor {
    pub async fn run(mut self) {
        loop {
            if let Some(cmd) = self.command_recv.recv().await {
                match cmd {}
            } else {
                break;
            }
        }
    }
    
    async fn write_bid(&self, auction_id: String, bid_value: u32, user: User) -> bool {
        let Ok(mut tx) = self.pool.begin().await else {
            return false;
        };
        let user_id = match user {
            User::DiscordUser(ref user) => Some(user.user_id.clone()),
            User::GuestUser(_) => None,
        };
        let guest_id = match user {
            User::DiscordUser(_) => None,
            User::GuestUser(ref user) => Some(user.user_id.clone()),
        };
        let auction_id = auction_id.parse::<i64>().expect("auction should parse to i64");


        let Ok(_) = sqlx::query!(
            r#"
                UPDATE auctions
                SET
                    winning_bid = $1,
                    winning_user_id = $2,
                    winning_guest_id = $3
                WHERE auction_id = $4
                    AND winning_bid < $1
                    AND (winning_user_id != $2 OR winning_guest_id != $3)
            "#,
            bid_value as i32,
            user_id,
            guest_id,
            auction_id)
            .execute(&mut *tx)
            .await else {
                let _ = tx.rollback().await;
                return false;
            };

        let Ok(_) = sqlx::query!(
            r#"
                INSERT INTO bids (
                    auction_id, user_id, guest_id, value
                )
                VALUES ($1, $2, $3, $4)
            "#,
            auction_id,
            user_id,
            guest_id,
            bid_value as i32)
            .execute(&mut *tx)
            .await else {
                let _ = tx.rollback().await;
                return false;
            };

        tx.commit().await.is_ok()
    }
}
