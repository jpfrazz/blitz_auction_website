use std::{fmt::format, sync::Arc};

use axum::http::StatusCode;
use sqlx::PgPool;
use sqlx::Row;
use tokio::sync::{mpsc, oneshot};
use uuid::Uuid;

use crate::{
    AppError,
    auction::{AuctionResponse, AuctionState},
    draft::{DraftSettings, DraftState},
    messages::ClientBidRequest,
    pokemon::{Pokemon, PokemonStage},
    users::{DiscordUser, GuestUser, User},
};

pub struct DbWriter {
    actor_sender: mpsc::Sender<DbCommand>,
    pool: PgPool,
}

struct Actor {
    draft_id: Uuid,
    pool: PgPool,
    command_recv: mpsc::Receiver<DbCommand>,
    starting_money: u32,
}

enum DbCommand {
    CreateDraft {
        response_sender: oneshot::Sender<Result<Vec<(i64, Arc<Pokemon>)>, AppError>>,
        host: User,
        settings: DraftSettings,
        pokemon: Vec<Arc<Pokemon>>,
    },
    StartDraft(oneshot::Sender<Result<(), AppError>>),
    FinishDraft,
    StartAuction(i64),
    PauseAuction {
        response_sender: oneshot::Sender<Result<(), AppError>>,
        auction_id: i64,
        time_remaining: u32,
    },
    ResumeAuction {
        response_sender: oneshot::Sender<Result<(), AppError>>,
        auction_id: i64,
    },
    WriteBid {
        auction_id: i64,
        bid_value: u32,
        user: User,
    },
    JoinDraft {
        response_sender: oneshot::Sender<Result<(), AppError>>,
        user: User,
    },
    KickDraft {
        response_sender: oneshot::Sender<Result<(), AppError>>,
        user: User,
    },
    ResolveAuction {
        response_sender: oneshot::Sender<Result<(), AppError>>,
        auction_id: i64,
    },
    UpdateDraftSettings {
        response_sender: oneshot::Sender<Result<Vec<i64>, AppError>>,
        num_teams: u32,
        remove_team_ids: Vec<String>,
        new_auctions: Vec<(Arc<Pokemon>, i32)>,
        truncate_auctions: Option<u32>,
    },
    /// 1v1 drafts: insert a single result row (pick/ban/leftover).
    WriteOneVOneAction {
        pokedex_id: u32,
        form: Option<String>,
        draft_order: i32,
        action: String,
        user: Option<User>,
    },
    /// 1v1 drafts: increment a player's picked-pokemon count.
    IncrementOneVOnePick {
        user: User,
    },
}

impl DbWriter {
    pub fn new(pool: PgPool, draft_id: Uuid, starting_money: u32) -> Self {
        let (actor_sender, actor_receiver) = mpsc::channel(1_000);
        let actor_pool = pool.clone();
        tokio::spawn(async move {
            let actor = Actor::new(actor_pool, draft_id, actor_receiver, starting_money);
            actor.run().await;
        });
        Self { actor_sender, pool }
    }

    /// Exposes the underlying pool for read-only queries that don't go through
    /// the write actor (e.g. computing average prices for a 1v1 pool).
    pub fn pool(&self) -> &PgPool {
        &self.pool
    }
    pub async fn create_draft(
        &self,
        host: User,
        settings: DraftSettings,
        pokemon: Vec<Arc<Pokemon>>,
    ) -> Result<Vec<(i64, Arc<Pokemon>)>, AppError> {
        let (response_sender, response_receiver) = oneshot::channel();
        let cmd = DbCommand::CreateDraft {
            response_sender,
            host,
            settings,
            pokemon,
        };
        self.actor_sender.send(cmd).await.map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to send create_draft command. {}", e),
            )
        })?;
        response_receiver.await.map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("couldn't wait for create command to finish, {}", e),
            )
        })?
    }

    pub async fn start_draft(&self) -> Result<(), AppError> {
        let (response_sender, response_receiver) = oneshot::channel();
        let cmd = DbCommand::StartDraft(response_sender);
        let _ = self.actor_sender.send(cmd).await.map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("couldn't send draft start command to actor, {}", e),
            )
        })?;

        response_receiver.await.map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to wait for draft start response, {}", e),
            )
        })?
    }

    pub async fn finish_draft(&self) -> Result<(), AppError> {
        let cmd = DbCommand::FinishDraft;
        let _ = self.actor_sender.send(cmd).await.map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("couldn't send draft finish command to actor, {}", e),
            )
        })?;
        Ok(())
    }
    pub async fn join_draft(&self, user: User) -> Result<(), AppError> {
        let (response_sender, response_receiver) = oneshot::channel();
        let cmd = DbCommand::JoinDraft {
            response_sender,
            user,
        };
        let _ = self.actor_sender.send(cmd).await.map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("couldn't send draft join command to actor, {}", e),
            )
        })?;
        response_receiver.await.map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to wait for draft join response, {}", e),
            )
        })?
    }

    pub async fn kick_draft(&self, user: User) -> Result<(), AppError> {
        let (response_sender, response_receiver) = oneshot::channel();
        let cmd = DbCommand::KickDraft {
            response_sender,
            user,
        };
        let _ = self.actor_sender.send(cmd).await.map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("couldn't send draft kick command to actor, {}", e),
            )
        })?;
        response_receiver.await.map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to wait for draft kick response, {}", e),
            )
        })?
    }

    pub async fn start_auction(&self, auction_id: i64) -> Result<(), AppError> {
        let cmd = DbCommand::StartAuction(auction_id);
        let _ = self.actor_sender.send(cmd).await.map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("couldn't send auction start command to actor, {}", e),
            )
        })?;
        Ok(())
    }

    pub async fn resume_auction(&self, auction_id: i64) -> Result<(), AppError> {
        let (response_sender, response_receiver) = oneshot::channel();
        let cmd = DbCommand::ResumeAuction {
            response_sender,
            auction_id,
        };
        let _ = self.actor_sender.send(cmd).await.map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("couldn't send auction resume command to actor, {}", e),
            )
        })?;
        response_receiver.await.map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to wait for auction resume response, {}", e),
            )
        })?
    }

    pub async fn resolve_auction(&self, auction_id: i64) -> Result<(), AppError> {
        let (response_sender, response_receiver) = oneshot::channel();
        let cmd = DbCommand::ResolveAuction {
            response_sender,
            auction_id,
        };
        let _ = self.actor_sender.send(cmd).await.map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("couldn't send auction resolve command to actor, {}", e),
            )
        })?;
        response_receiver.await.map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to wait for auction resolve response, {}", e),
            )
        })?
    }

    pub async fn pause_auction(
        &self,
        auction_id: i64,
        time_remaining: u32,
    ) -> Result<(), AppError> {
        let (response_sender, response_receiver) = oneshot::channel();
        let cmd = DbCommand::PauseAuction {
            response_sender,
            auction_id,
            time_remaining,
        };
        let _ = self.actor_sender.send(cmd).await.map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("couldn't send auction pause command to actor, {}", e),
            )
        })?;
        response_receiver.await.map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to wait for auction pause response, {}", e),
            )
        })?
    }

    pub async fn write_bid(&self, auction_id: i64, bid_value: u32, user: User) {
        let cmd = DbCommand::WriteBid {
            auction_id,
            bid_value,
            user,
        };
        let _ = self.actor_sender.send(cmd).await;
    }

    pub async fn update_draft_settings(
        &self,
        num_teams: u32,
        remove_team_ids: Vec<String>,
        new_auctions: Vec<(Arc<Pokemon>, i32)>,
        truncate_auctions: Option<u32>,
    ) -> Result<Vec<i64>, AppError> {
        let (response_sender, response_receiver) = oneshot::channel();
        let cmd = DbCommand::UpdateDraftSettings {
            response_sender,
            num_teams,
            remove_team_ids,
            new_auctions,
            truncate_auctions,
        };
        self.actor_sender.send(cmd).await.map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to send update draft settings command, {}", e),
            )
        })?;
        response_receiver.await.map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to wait for response, {}", e),
            )
        })?
    }

    /// 1v1 drafts: persist a single pick/ban/leftover row.
    pub async fn write_one_v_one_action(
        &self,
        pokedex_id: u32,
        form: Option<String>,
        draft_order: i32,
        action: &str,
        user: Option<User>,
    ) {
        let cmd = DbCommand::WriteOneVOneAction {
            pokedex_id,
            form,
            draft_order,
            action: action.to_string(),
            user,
        };
        let _ = self.actor_sender.send(cmd).await;
    }

    /// 1v1 drafts: increment a team's pokemon_drafted counter after a pick.
    pub async fn increment_one_v_one_pick(&self, user: User) {
        let cmd = DbCommand::IncrementOneVOnePick { user };
        let _ = self.actor_sender.send(cmd).await;
    }
}

impl Actor {
    pub fn new(
        pool: PgPool,
        draft_id: Uuid,
        command_recv: mpsc::Receiver<DbCommand>,
        starting_money: u32,
    ) -> Self {
        Self {
            pool,
            draft_id,
            command_recv,
            starting_money,
        }
    }

    pub async fn run(mut self) {
        loop {
            if let Some(cmd) = self.command_recv.recv().await {
                match cmd {
                    DbCommand::CreateDraft {
                        response_sender,
                        host,
                        settings,
                        pokemon,
                    } => {
                        let res = self.create_draft(host, settings, pokemon).await;
                        let _ = response_sender.send(res);
                    }
                    DbCommand::StartDraft(response_sender) => {
                        let res = self.start_draft().await;
                        let _ = response_sender.send(res);
                    }
                    DbCommand::FinishDraft => {
                        self.finish_draft().await;
                    }
                    DbCommand::StartAuction(auction_id) => {
                        self.start_auction(auction_id).await;
                    }
                    DbCommand::ResolveAuction {
                        response_sender,
                        auction_id,
                    } => {
                        let res = self.resolve_auction(auction_id).await;
                        let _ = response_sender.send(res);
                    }
                    DbCommand::WriteBid {
                        auction_id,
                        bid_value,
                        user,
                    } => {
                        self.write_bid(auction_id, bid_value, user).await;
                    }
                    DbCommand::ResumeAuction {
                        response_sender,
                        auction_id,
                    } => {
                        let res = self.resume_auction(auction_id).await;
                        let _ = response_sender.send(res);
                    }
                    DbCommand::PauseAuction {
                        response_sender,
                        auction_id,
                        time_remaining,
                    } => {
                        let res = self.pause_auction(auction_id, time_remaining).await;
                        let _ = response_sender.send(res);
                    }
                    DbCommand::JoinDraft {
                        response_sender,
                        user,
                    } => {
                        let res = self.join_draft(user).await;
                        let _ = response_sender.send(res);
                    }
                    DbCommand::KickDraft {
                        response_sender,
                        user,
                    } => {
                        let res = self.kick_draft(user).await;
                        let _ = response_sender.send(res);
                    }
                    DbCommand::UpdateDraftSettings {
                        response_sender,
                        num_teams,
                        remove_team_ids,
                        new_auctions,
                        truncate_auctions,
                    } => {
                        let res = self
                            .update_draft_settings(
                                num_teams,
                                remove_team_ids,
                                new_auctions,
                                truncate_auctions,
                            )
                            .await;
                        let _ = response_sender.send(res);
                    }
                    DbCommand::WriteOneVOneAction {
                        pokedex_id,
                        form,
                        draft_order,
                        action,
                        user,
                    } => {
                        self.write_one_v_one_action(pokedex_id, form, draft_order, &action, user)
                            .await;
                    }
                    DbCommand::IncrementOneVOnePick { user } => {
                        self.increment_one_v_one_pick(user).await;
                    }
                }
            } else {
                break;
            }
        }
    }

    async fn create_draft(
        &self,
        host: User,
        settings: DraftSettings,
        pokemon: Vec<Arc<Pokemon>>,
    ) -> Result<Vec<(i64, Arc<Pokemon>)>, (StatusCode, String)> {
        if settings.num_auctions as usize > pokemon.len() {
            return Err((
                StatusCode::BAD_REQUEST,
                format!("cannot create draft with more auctions than available pokemon"),
            ));
        }

        let (user_id, guest_id) = host.get_user_and_guest_id();
        let mut auction_ids = vec![];

        let mut tx = self.pool.begin().await.map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to start transaction, {}", e),
            )
        })?;

        let _res = sqlx::query(
            r#"
            INSERT INTO drafts (
                draft_id,
                draft_name,
                password,
                num_teams,
                starting_money,
                ranked,
                host_user_id,
                host_guest_id,
                draft_type
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            "#,
        )
        .bind(self.draft_id)
        .bind(&settings.draft_name)
        .bind(&settings.password)
        .bind(settings.num_teams as i32)
        .bind(settings.starting_money as i32)
        .bind(settings.ranked)
        .bind(user_id)
        .bind(guest_id)
        .bind(&settings.draft_type)
        .execute(&mut *tx)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to create draft in db, {}", e),
            )
        })?;

        // 1v1 drafts create their auction rows at start/finish time, not now.
        if settings.draft_type == "1v1" {
            tx.commit().await.map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("failed to commit 1v1 draft to db, {}", e),
                )
            })?;
            return Ok(vec![]);
        }

        for (i, p) in pokemon
            .iter()
            .filter(|p| p.stage == PokemonStage::base && p.obtain_method == None)
            .enumerate()
        {
            if i >= settings.num_auctions as usize {
                break;
            }

            let auction = sqlx::query!(
                r#"
                    INSERT INTO auctions (
                        pokedex_id, form, draft_order, draft_id
                    ) VALUES ($1, $2, $3, $4)
                    RETURNING auction_id
                "#,
                p.pokedex_id as i32,
                p.form.clone().unwrap_or_default(),
                i as i32,
                self.draft_id.clone()
            )
            .fetch_one(&mut *tx)
            .await
            .map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("failed to create auction in db, {}", e),
                )
            })?;

            auction_ids.push((auction.auction_id, p.clone()));
        }

        let _ = tx.commit().await.map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to commit draft to db, {}", e),
            )
        })?;

        Ok(auction_ids)
    }

    async fn start_draft(&self) -> Result<(), AppError> {
        let _ = sqlx::query!(
            r#"
                UPDATE drafts
                SET state = $1
                WHERE draft_id = $2
            "#,
            DraftState::BIDDING.to_string(),
            self.draft_id
        )
        .execute(&self.pool)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to start draft in db, {}", e),
            )
        })?;
        Ok(())
    }

    async fn finish_draft(&self) -> bool {
        sqlx::query!(
            r#"
                UPDATE drafts
                SET state = $1
                WHERE draft_id = $2
            "#,
            DraftState::COMPLETED.to_string(),
            self.draft_id
        )
        .execute(&self.pool)
        .await
        .is_ok()
    }

    async fn start_auction(&self, auction_id: i64) -> bool {
        sqlx::query!(
            r#"
                UPDATE auctions
                SET state = $1
                WHERE auction_id = $2
            "#,
            AuctionState::OPEN.to_string(),
            auction_id
        )
        .execute(&self.pool)
        .await
        .is_ok()
    }

    async fn resolve_auction(&self, auction_id: i64) -> Result<(), AppError> {
        let mut tx = self.pool.begin().await.map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to start transaction to resolve auction, {}", e),
            )
        })?;

        let row = sqlx::query!(
            r#"
                UPDATE auctions
                SET state = $1
                WHERE auction_id = $2
                RETURNING winning_user_id, winning_guest_id, winning_bid
            "#,
            AuctionState::CLOSED.to_string(),
            auction_id,
        )
        .fetch_one(&mut *tx)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to update auction state in db, {}", e),
            )
        })?;

        let user_id = row.winning_user_id;
        let guest_id = row.winning_guest_id;
        let bid_value = row.winning_bid;

        let _ = sqlx::query!(
            r#"
                UPDATE teams
                SET
                    money_remaining = money_remaining - $3,
                    pokemon_drafted = pokemon_drafted + 1
                WHERE user_id IS NOT DISTINCT FROM $1
                    AND guest_id IS NOT DISTINCT FROM $2
            "#,
            user_id,
            guest_id,
            bid_value,
        )
        .execute(&mut *tx)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to update team money remaining in db, {}", e),
            )
        })?;

        let _ = sqlx::query!(
            r#"
                UPDATE drafts
                SET pokemon_drafted = pokemon_drafted + 1
                WHERE draft_id = $1
            "#,
            self.draft_id
        )
        .execute(&mut *tx)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to update draft pokemon drafter in db, {}", e),
            )
        })?;

        tx.commit().await.map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to commit auction close transaction in db, {}", e),
            )
        })
    }

    async fn write_bid(&self, auction_id: i64, bid_value: u32, user: User) -> bool {
        let Ok(mut tx) = self.pool.begin().await else {
            return false;
        };
        let (user_id, guest_id) = user.get_user_and_guest_id();

        let Ok(_) = sqlx::query!(
            r#"
                UPDATE auctions
                SET
                    winning_bid = $1,
                    winning_user_id = $2,
                    winning_guest_id = $3
                WHERE auction_id = $4
                    AND (
                        winning_bid IS NULL
                        OR winning_bid < $1
                    )
                    AND (
                        winning_user_id IS DISTINCT FROM $2
                        OR winning_guest_id IS DISTINCT FROM $3
                    )
            "#,
            bid_value as i32,
            user_id,
            guest_id,
            auction_id
        )
        .execute(&mut *tx)
        .await
        else {
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
            bid_value as i32
        )
        .execute(&mut *tx)
        .await
        else {
            let _ = tx.rollback().await;
            return false;
        };

        tx.commit().await.is_ok()
    }

    async fn resume_auction(&self, auction_id: i64) -> Result<(), AppError> {
        let _ = sqlx::query!(
            r#"
                UPDATE auctions
                SET state = $1, paused_time_remaining = NULL
                WHERE auction_id = $2
            "#,
            AuctionState::OPEN.to_string(),
            auction_id
        )
        .execute(&self.pool)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to resume auction in db, {}", e),
            )
        })?;
        Ok(())
    }

    async fn pause_auction(&self, auction_id: i64, time_remaining: u32) -> Result<(), AppError> {
        let _ = sqlx::query!(
            r#"
                UPDATE auctions
                SET state = $1, paused_time_remaining = $3
                WHERE auction_id = $2
            "#,
            "PAUSED".to_string(),
            auction_id,
            time_remaining as i32,
        )
        .execute(&self.pool)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to resume auction in db, {}", e),
            )
        })?;
        Ok(())
    }

    async fn join_draft(&self, user: User) -> Result<(), AppError> {
        let (user_id, guest_id) = user.get_user_and_guest_id();
        let _ = sqlx::query!(
            r#"
                INSERT INTO teams (
                    user_id, guest_id, draft_id, money_remaining, pre_match_mmr
                )
                VALUES ($1, $2, $3, $4,
                    (SELECT mmr FROM users WHERE user_id = $1)
                )
            "#,
            user_id,
            guest_id,
            self.draft_id,
            self.starting_money as i32,
        )
        .execute(&self.pool)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to add team to draft in db, {}", e),
            )
        })?;
        Ok(())
    }

    async fn kick_draft(&self, user: User) -> Result<(), AppError> {
        let (user_id, guest_id) = user.get_user_and_guest_id();
        let _ = sqlx::query!(
            r#"
                DELETE FROM teams
                WHERE user_id IS NOT DISTINCT FROM $1
                    AND guest_id IS NOT DISTINCT FROM $2
            "#,
            user_id,
            guest_id,
        )
        .execute(&self.pool)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to kick team from draft in db, {}", e),
            )
        })?;
        Ok(())
    }

    async fn update_draft_settings(
        &self,
        num_teams: u32,
        remove_team_ids: Vec<String>,
        new_auctions: Vec<(Arc<Pokemon>, i32)>,
        truncate_auctions: Option<u32>,
    ) -> Result<Vec<i64>, AppError> {
        let mut tx = self.pool.begin().await.map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to begin transaction: {}", e),
            )
        })?;

        if !remove_team_ids.is_empty() {
            let _ = sqlx::query(
                "DELETE FROM teams WHERE draft_id = $1 AND (user_id = ANY($2) OR guest_id = ANY($2))"
            )
            .bind(self.draft_id)
            .bind(&remove_team_ids)
            .execute(&mut *tx)
            .await
            .map_err(|e| (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to remove teams: {}", e)
            ))?;
        }

        let _ = sqlx::query("UPDATE drafts SET num_teams = $1 WHERE draft_id = $2")
            .bind(num_teams as i32)
            .bind(self.draft_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("failed to update draft settings: {}", e),
                )
            })?;

        if let Some(limit) = truncate_auctions {
            let _ = sqlx::query("DELETE FROM auctions WHERE draft_id = $1 AND draft_order >= $2")
                .bind(self.draft_id)
                .bind(limit as i32)
                .execute(&mut *tx)
                .await
                .map_err(|e| {
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        format!("failed to remove excess auctions: {}", e),
                    )
                })?;
        }

        let mut new_ids = Vec::new();
        for (p, order) in new_auctions {
            let row = sqlx::query(
                "INSERT INTO auctions (pokedex_id, form, draft_order, draft_id) VALUES ($1, $2, $3, $4) RETURNING auction_id"
            )
            .bind(p.pokedex_id as i32)
            .bind(p.form.clone().unwrap_or_default())
            .bind(order)
            .bind(self.draft_id)
            .fetch_one(&mut *tx)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("failed to insert new auction: {}", e)))?;

            let id: i64 = row.try_get("auction_id").map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("failed to get auction_id: {}", e),
                )
            })?;
            new_ids.push(id);
        }

        tx.commit().await.map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to commit transaction: {}", e),
            )
        })?;
        Ok(new_ids)
    }

    async fn write_one_v_one_action(
        &self,
        pokedex_id: u32,
        form: Option<String>,
        draft_order: i32,
        action: &str,
        user: Option<User>,
    ) {
        let (user_id, guest_id) = user.map(|u| u.get_user_and_guest_id()).unwrap_or((None, None));
        let _ = sqlx::query(
            "INSERT INTO auctions (pokedex_id, form, draft_order, draft_id, winning_user_id, winning_guest_id, state, action) VALUES ($1, $2, $3, $4, $5, $6, 'CLOSED', $7)"
        )
        .bind(pokedex_id as i32)
        .bind(form.unwrap_or_default())
        .bind(draft_order)
        .bind(self.draft_id)
        .bind(user_id)
        .bind(guest_id)
        .bind(action)
        .execute(&self.pool)
        .await;
    }

    async fn increment_one_v_one_pick(&self, user: User) {
        let (user_id, guest_id) = user.get_user_and_guest_id();
        let _ = sqlx::query(
            "UPDATE teams SET pokemon_drafted = pokemon_drafted + 1 WHERE user_id IS NOT DISTINCT FROM $1 AND guest_id IS NOT DISTINCT FROM $2 AND draft_id = $3"
        )
        .bind(user_id)
        .bind(guest_id)
        .bind(self.draft_id)
        .execute(&self.pool)
        .await;
    }
}
