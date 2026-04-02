use axum::http::StatusCode;
use chrono::{DateTime, Utc};
use strum::Display;

use serde::{Deserialize, Serialize};
use std::{pin::Pin, sync::Arc};
use tokio::{
    sync::{OnceCell, broadcast, mpsc, oneshot},
    time::{Duration, Instant, Sleep},
};
use uuid::Uuid;

use crate::{
    AppError,
    draft::Draft,
    get_expiry_time_from_instant,
    messages::ServerMessage,
    pokemon::{self, Pokemon},
    users::User,
};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AuctionResponse {
    pub auction_id: i64,
    pub draft_id: Uuid,
    pub state: AuctionState,
    pub pokemon: Pokemon,
    pub highest_bid: u32,
    pub highest_bidder: Option<User>,
    pub expires_at: Option<DateTime<Utc>>,
    pub current_server_time: DateTime<Utc>,
}

#[derive(Debug)]
pub struct Auction {
    pub auction_id: i64,
    pub draft_id: Uuid,
    pub pokemon: Arc<Pokemon>,
    actor_sender: OnceCell<mpsc::Sender<AuctionCommand>>,
}

#[derive(Clone, Debug, Display, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuctionState {
    PENDING,
    OPEN,
    CLOSED,
    PAUSED(u32),
}

impl Auction {
    pub fn new(draft_id: Uuid, auction_id: i64, pokemon: Arc<Pokemon>) -> Auction {
        Auction {
            auction_id,
            draft_id,
            pokemon,
            actor_sender: OnceCell::new(),
        }
    }

    pub async fn get(&self) -> Result<AuctionResponse, AppError> {
        if let Some(sender) = self.actor_sender.get() {
            let (os_sender, os_receiver) = oneshot::channel();
            let cmd = AuctionCommand::Get(os_sender);
            sender.send(cmd).await.map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("couldn't process get, {}", e),
                )
            })?;
            os_receiver.await.map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("couldn't process get, {}", e),
                )
            })
        } else {
            Ok(AuctionResponse::from(self))
        }
    }

    pub async fn start(&self, draft: Arc<Draft>, length: u32) -> Result<(), AppError> {
        let (actor_sender, actor_receiver) = mpsc::channel(1_000);
        if self.actor_sender.set(actor_sender).is_ok() {
            let auction_id = self.auction_id.clone();
            let pokemon = self.pokemon.clone();
            let draft = draft;
            let broadcast_tx = draft.broadcast_tx.clone();
            tokio::spawn(async move {
                let actor = AuctionActor::new(
                    auction_id,
                    draft,
                    length,
                    pokemon,
                    actor_receiver,
                    broadcast_tx,
                );
                actor.run().await
            });
            Ok(())
        } else {
            Err((
                StatusCode::PRECONDITION_FAILED,
                format!("auction has already started"),
            ))
        }
    }

    pub async fn bid(&self, bid_value: u32, user: User) -> Result<(), AppError> {
        if let Some(sender) = self.actor_sender.get() {
            let (response_sender, response_receiver) = oneshot::channel();
            let cmd = AuctionCommand::Bid {
                response_sender,
                bid_value,
                user,
            };
            sender.send(cmd).await.map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("couldn't process bid, {}", e),
                )
            })?;
            response_receiver.await.map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("couldn't process bid, {}", e),
                )
            })?
        } else {
            Err((
                StatusCode::PRECONDITION_FAILED,
                format!("auction is not running"),
            ))
        }
    }

    pub async fn resume(&self) -> Result<(), AppError> {
        if let Some(sender) = self.actor_sender.get() {
            let (os_sender, os_receiver) = oneshot::channel();
            let cmd = AuctionCommand::Resume(os_sender);
            sender.send(cmd).await.map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("couldn't process resume, {}", e),
                )
            })?;
            os_receiver.await.map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("couldn't process resume, {}", e),
                )
            })?
        } else {
            Err((
                StatusCode::PRECONDITION_FAILED,
                format!("auction is not running"),
            ))
        }
    }

    pub async fn pause(&self) -> Result<u32, AppError> {
        if let Some(sender) = self.actor_sender.get() {
            let (os_sender, os_receiver) = oneshot::channel();
            let cmd = AuctionCommand::Pause(os_sender);
            sender.send(cmd).await.map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("couldn't process pause, {}", e),
                )
            })?;
            os_receiver.await.map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("couldn't process pause, {}", e),
                )
            })?
        } else {
            Err((
                StatusCode::PRECONDITION_FAILED,
                format!("auction is not running"),
            ))
        }
    }
}

impl From<&Auction> for AuctionResponse {
    fn from(value: &Auction) -> Self {
        AuctionResponse {
            auction_id: value.auction_id,
            draft_id: value.draft_id.clone(),
            state: AuctionState::PENDING,
            pokemon: (*value.pokemon).clone(),
            highest_bid: 0,
            highest_bidder: None,
            expires_at: None,
            current_server_time: Utc::now(),
        }
    }
}

struct AuctionActor {
    auction_id: i64,
    draft: Arc<Draft>,
    state: AuctionState,
    length: u32,
    pokemon: Arc<Pokemon>,
    highest_bid: u32,
    highest_bidder: Option<User>,
    expires_at: Option<Instant>,
    receiver: mpsc::Receiver<AuctionCommand>,
    broadcast_tx: broadcast::Sender<ServerMessage>,
}

enum AuctionCommand {
    Bid {
        response_sender: oneshot::Sender<AuctionCommandResponse>,
        bid_value: u32,
        user: User,
    },
    Resume(oneshot::Sender<AuctionCommandResponse>),
    Pause(oneshot::Sender<Result<u32, AppError>>),
    Get(oneshot::Sender<AuctionResponse>),
}

type AuctionCommandResponse = Result<(), AppError>;

impl AuctionActor {
    pub fn new(
        auction_id: i64,
        draft: Arc<Draft>,
        length: u32,
        pokemon: Arc<Pokemon>,
        receiver: mpsc::Receiver<AuctionCommand>,
        broadcast_tx: broadcast::Sender<ServerMessage>,
    ) -> Self {
        Self {
            auction_id,
            draft,
            state: AuctionState::PENDING,
            length,
            pokemon,
            highest_bid: 0,
            highest_bidder: None,
            receiver,
            broadcast_tx,
            expires_at: None,
        }
    }

    fn get(&self) -> AuctionResponse {
        AuctionResponse::from(self)
    }

    pub async fn run(mut self) {
        self.state = AuctionState::OPEN;

        let msg = AuctionResponse::from(&self);
        let _ = self.broadcast_tx.send(ServerMessage::AuctionUpdate(msg));
        // do not start the timer until the bid is > 0
        while self.highest_bid == 0 {
            if let Some(cmd) = self.receiver.recv().await {
                match cmd {
                    AuctionCommand::Bid {
                        response_sender,
                        bid_value,
                        user,
                    } => {
                        self.first_bid(bid_value, user, response_sender).await;
                    }
                    AuctionCommand::Get(response_sender) => {
                        let response = self.get();
                        let _ = response_sender.send(response);
                    }
                    AuctionCommand::Resume(sender) => {
                        let _ = sender.send(Err((
                            StatusCode::PRECONDITION_FAILED,
                            format!("auction doesn't start until the first bid"),
                        )));
                    }
                    AuctionCommand::Pause(sender) => {
                        let _ = sender.send(Err((
                            StatusCode::PRECONDITION_FAILED,
                            format!("auction doesn't start until the first bid"),
                        )));
                    }
                }
            }
        }

        self.expires_at = Some(Instant::now() + Duration::from_secs(self.length as u64));
        let auction_timer = tokio::time::sleep_until(self.expires_at.unwrap());
        tokio::pin!(auction_timer);
        let msg = AuctionResponse::from(&self);
        let _ = self.broadcast_tx.send(ServerMessage::AuctionUpdate(msg));

        loop {
            tokio::select! {
                Some(cmd) = self.receiver.recv() => self.handle_cmd(cmd, auction_timer.as_mut()).await,
                _ = &mut auction_timer => {
                    if let AuctionState::PAUSED(_) = self.state {
                        continue;
                    }
                    self.resolve_auction().await;
                    break;
                },
            }
        }

        println!("auction {} actor resolved", self.auction_id);
    }

    async fn handle_cmd(&mut self, cmd: AuctionCommand, auction_timer: Pin<&mut Sleep>) {
        match cmd {
            AuctionCommand::Bid {
                response_sender,
                bid_value,
                user,
            } => {
                self.bid(bid_value, user, auction_timer, response_sender)
                    .await
            }
            AuctionCommand::Pause(response_sender) => {
                if self.state == AuctionState::OPEN {
                    let now = Instant::now();
                    let t = self.expires_at.expect("").duration_since(now).as_secs() as u32;
                    self.state = AuctionState::PAUSED(t);
                    let _ = response_sender.send(Ok(t));
                    let msg = AuctionResponse::from(&*self);
                    let _ = self.broadcast_tx.send(ServerMessage::AuctionUpdate(msg));
                } else {
                    let _ = response_sender.send(Err((
                        StatusCode::PRECONDITION_FAILED,
                        format!("auction is not running"),
                    )));
                }
            }
            AuctionCommand::Resume(response_sender) => {
                if let AuctionState::PAUSED(t) = self.state {
                    self.expires_at = Some(Instant::now() + Duration::from_secs(t as u64));
                    self.state = AuctionState::OPEN;
                    auction_timer.reset(self.expires_at.expect(""));
                    let _ = response_sender.send(Ok(()));
                    let msg = AuctionResponse::from(&*self);
                    let _ = self.broadcast_tx.send(ServerMessage::AuctionUpdate(msg));
                } else {
                    let _ = response_sender.send(Err((
                        StatusCode::PRECONDITION_FAILED,
                        format!("auction is not paused"),
                    )));
                }
            }
            AuctionCommand::Get(response_sender) => {
                let response = self.get();
                let _ = response_sender.send(response);
            }
        }
    }

    async fn first_bid(
        &mut self,
        bid_value: u32,
        user: User,
        sender: oneshot::Sender<AuctionCommandResponse>,
    ) {
        let response: AuctionCommandResponse;
        if bid_value <= self.highest_bid {
            response = Err((StatusCode::PRECONDITION_FAILED, format!("bid is too low")));
        } else if Some(&user) == self.highest_bidder.as_ref() {
            response = Err((
                StatusCode::PRECONDITION_FAILED,
                format!("user is already the highest bidder"),
            ));
        } else {
            self.highest_bid = bid_value;
            self.highest_bidder = Some(user);
            response = Ok(());
        }

        let _ = sender.send(response);
    }

    async fn bid(
        &mut self,
        bid_value: u32,
        user: User,
        auction_timer: Pin<&mut Sleep>,
        sender: oneshot::Sender<AuctionCommandResponse>,
    ) {
        let response: AuctionCommandResponse;
        if bid_value <= self.highest_bid {
            response = Err((StatusCode::PRECONDITION_FAILED, format!("bid is too low")));
        } else if Some(&user) == self.highest_bidder.as_ref() {
            response = Err((
                StatusCode::PRECONDITION_FAILED,
                format!("user is already the highest bidder"),
            ));
        } else {
            self.highest_bid = bid_value;
            self.highest_bidder = Some(user);

            self.expires_at = Some(std::cmp::max(
                self.expires_at.expect(""),
                Instant::now() + Duration::from_secs(10),
            ));

            auction_timer.reset(self.expires_at.expect(""));
            response = Ok(());
            let msg = AuctionResponse::from(&*self);
            let _ = self.broadcast_tx.send(ServerMessage::AuctionUpdate(msg));
        }

        let _ = sender.send(response);
    }

    async fn resolve_auction(&mut self) {
        self.state = AuctionState::CLOSED;
        let _ = self
            .draft
            .resolve_auction(AuctionResponse::from(&*self))
            .await;
    }
}

impl From<&AuctionActor> for AuctionResponse {
    fn from(value: &AuctionActor) -> Self {
        let expires_at = value
            .expires_at
            .clone()
            .map(|some| get_expiry_time_from_instant(some));
        Self {
            auction_id: value.auction_id.clone(),
            draft_id: value.draft.draft_id,
            state: value.state.clone(),
            highest_bid: value.highest_bid,
            highest_bidder: value.highest_bidder.clone(),
            pokemon: (*value.pokemon).clone(),
            expires_at: expires_at,
            current_server_time: Utc::now(),
        }
    }
}
