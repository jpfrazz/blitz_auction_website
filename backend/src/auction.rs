use chrono::{DateTime, Utc};
use sqlx::{Postgres, Transaction};
use strum::Display;

use serde::{Deserialize, Serialize};
use std::{pin::Pin, sync::Arc};
use tokio::{
    sync::{OnceCell, RwLock, mpsc, oneshot},
    time::{Duration, Instant, Sleep},
};

use crate::{draft::Draft, get_expiry_time_from_instant, messages::ClientBidRequest, pokemon::Pokemon, users::User};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AuctionResponse {
    pub auction_id: String,
    pub draft_id: String,
    pub state: AuctionState,
    pub pokemon: Pokemon,
    pub highest_bid: u32,
    pub highest_bidder: String,
    pub expires_at: Option<DateTime<Utc>>,
    pub server_timestamp: DateTime<Utc>,
}

#[derive(Debug)]
pub struct Auction {
    pub auction_id: String,
    pub draft: Arc<Draft>,
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
    fn new(
        draft: Arc<Draft>,
        auction_id: String,
        pokemon: Arc<Pokemon>,
    ) -> Auction {
        Auction {
            auction_id,
            draft,
            pokemon,
            actor_sender: OnceCell::new(),
        }
    }

    pub async fn build(
        draft: Arc<Draft>,
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
            draft.draft_id,
            draft_order as i32,
        )
        .fetch_one(&mut **tx)
        .await?
        .auction_id;

        Ok(Auction::new(
            draft,
            auction_id.to_string(),
            pokemon,
        ))
    }

    pub async fn get(&self) -> Result<AuctionResponse, String> {
        if let Some(sender) = self.actor_sender.get() {
            let (os_sender, os_receiver) = oneshot::channel();
            let cmd = AuctionCommand::Get(os_sender);
            sender
                .send(cmd)
                .await
                .map_err(|e| format!("couldn't process get, {}", e))?;
            os_receiver
                .await
                .map_err(|e| format!("failed to listen for auction actor, {e}"))
        } else {
            Ok(AuctionResponse::from(self))
        }
    }

    pub async fn start(self: Arc<Self>, length: u32) -> Result<(), String> {
        let (actor_sender, actor_receiver) = mpsc::channel(1_000);
        if self.actor_sender.set(actor_sender).is_ok() {
            let auction = self.clone();
            let draft = self.draft.clone();
            let pokemon = self.pokemon.clone();
            tokio::spawn(async move {
                let mut actor = AuctionActor::new(
                    auction,
                    length,
                    actor_receiver,
                );
                actor.run().await
            });
            Ok(())
        } else {
            Err(format!("auction has already started"))
        }
    }

    pub async fn bid(&self, bid_request: ClientBidRequest) -> Result<(), String> {
        if let Some(sender) = self.actor_sender.get() {
            let (response_sender, response_receiver) = oneshot::channel();
            let cmd = AuctionCommand::Bid{response_sender, bid_request};
            sender
                .send(cmd)
                .await
                .map_err(|e| format!("couldn't process bid, {}", e))?;
            response_receiver
                .await
                .map_err(|e| format!("failed to listen for auction actor, {e}"))?
        } else {
            Err(format!("auction is not running"))
        }
    }

    pub async fn resume(&self) -> Result<(), String> {
        if let Some(sender) = self.actor_sender.get() {
            let (os_sender, os_receiver) = oneshot::channel();
            let cmd = AuctionCommand::Resume(os_sender);
            sender
                .send(cmd)
                .await
                .map_err(|e| format!("couldn't process resume, {}", e))?;
            os_receiver
                .await
                .map_err(|e| format!("failed to listen for auction actor, {e}"))?
        } else {
            Err(format!("auction is not running"))
        }
    }

    pub async fn pause(&self) -> Result<(), String> {
        if let Some(sender) = self.actor_sender.get() {
            let (os_sender, os_receiver) = oneshot::channel();
            let cmd = AuctionCommand::Pause(os_sender);
            sender
                .send(cmd)
                .await
                .map_err(|e| format!("couldn't process pause, {}", e))?;
            os_receiver
                .await
                .map_err(|e| format!("failed to listen for auction actor, {e}"))?
        } else {
            Err(format!("auction is not running"))
        }
    }
}

impl From<&Auction> for AuctionResponse {
    fn from(value: &Auction) -> Self {
        AuctionResponse {
            auction_id: value.auction_id.clone(),
            draft_id: value.draft.draft_id.clone(),
            state: AuctionState::PENDING,
            pokemon: value.pokemon.as_ref().clone(),
            highest_bid: 0,
            highest_bidder: format!(""),
            expires_at: None,
            server_timestamp: Utc::now(),
        }
    }
}

struct AuctionActor {
    auction: Arc<Auction>,
    state: AuctionState,
    length: u32,
    highest_bid: u32,
    highest_bidder: String,
    expires_at: Option<Instant>,
    receiver: mpsc::Receiver<AuctionCommand>,
}

enum AuctionCommand {
    Bid{response_sender: oneshot::Sender<AuctionCommandResponse>, bid_request: ClientBidRequest},
    Resume(oneshot::Sender<AuctionCommandResponse>),
    Pause(oneshot::Sender<AuctionCommandResponse>),
    Get(oneshot::Sender<AuctionResponse>),
}

type AuctionCommandResponse = Result<(), String>;

impl AuctionActor {
    pub fn new(
        auction: Arc<Auction>,
        length: u32,
        receiver: mpsc::Receiver<AuctionCommand>,
    ) -> Self {
        Self {
            auction,
            state: AuctionState::PENDING,
            length,
            highest_bid: 0,
            highest_bidder: "".to_string(),
            receiver,
            expires_at: None,
        }
    }

    fn get(&self) -> AuctionResponse {
        AuctionResponse::from(self)
    }

    pub async fn run(&mut self) {
        self.state = AuctionState::OPEN;

        // do not start the timer until the bid is > 0
        while self.highest_bid == 0 {
            if let Some(cmd) = self.receiver.recv().await {
                match cmd {
                    AuctionCommand::Bid{response_sender, bid_request} => {
                        self.first_bid(bid_request, response_sender);
                    }
                    _ => continue,
                }
            }
        }

        self.expires_at = Some(Instant::now() + Duration::from_secs(self.length as u64));
        let auction_timer = tokio::time::sleep_until(self.expires_at.unwrap());
        tokio::pin!(auction_timer);

        loop {
            tokio::select! {
                Some(cmd) = self.receiver.recv() => self.handle_cmd(cmd, auction_timer.as_mut()).await,
                _ = &mut auction_timer => {
                    self.resolve_auction().await;
                    break;
                },
            }
        }

        println!("auction {} actor resolved", self.auction.auction_id);
    }

    async fn handle_cmd(&mut self, cmd: AuctionCommand, auction_timer: Pin<&mut Sleep>) {
        match cmd {
            AuctionCommand::Bid{response_sender, bid_request} => self.bid(bid_request, auction_timer, response_sender).await,
            AuctionCommand::Pause(response_sender) => {
                if self.state == AuctionState::OPEN {
                    let now = Instant::now();
                    self.state = AuctionState::PAUSED(
                        self.expires_at.expect("").duration_since(now).as_secs() as u32,
                    );
                    let _ = response_sender.send(Ok(()));
                } else {
                    let _ = response_sender.send(Err("auction is not running".to_string()));
                }
            }
            AuctionCommand::Resume(response_sender) => {
                if let AuctionState::PAUSED(t) = self.state {
                    self.expires_at = Some(Instant::now() + Duration::from_secs(t as u64));
                    auction_timer.reset(self.expires_at.expect(""));
                    let _ = response_sender.send(Ok(()));
                }
            }
            AuctionCommand::Get(response_sender) => {
                let response = self.get();
                let _ = response_sender.send(response);
            }
        }
    }

    async fn first_bid(&mut self, bid_request: ClientBidRequest, sender: oneshot::Sender<AuctionCommandResponse>) {
        let response: AuctionCommandResponse;
        if bid_request.value <= self.highest_bid {
            response = Err("bid is too low".to_string());
        } else if bid_request.user_id == self.highest_bidder {
            response = Err("user is already winning this auction".to_string());
        } else {
            self.highest_bid = bid_request.value;
            self.highest_bidder = bid_request.user_id;
            response = Ok(());
        }

        let _ = sender.send(response);
    }

    async fn bid(&mut self, bid_request: ClientBidRequest, auction_timer: Pin<&mut Sleep>, sender: oneshot::Sender<AuctionCommandResponse>) {
        let response: AuctionCommandResponse;
        if bid_request.value <= self.highest_bid {
            response = Err("bid is too low".to_string());
        } else if bid_request.user_id == self.highest_bidder {
            response = Err("user is already winning this auction".to_string());
        } else {
            self.highest_bid = bid_request.value;
            self.highest_bidder = bid_request.user_id;
            response = Ok(());

            self.expires_at = Some(std::cmp::max(
                self.expires_at.expect(""),
                Instant::now() + Duration::from_secs(10),
            ));

            auction_timer.reset(self.expires_at.expect(""));
        }

        let _ = sender.send(response);
    }

    async fn resolve_auction(&mut self) {
        self.state = AuctionState::CLOSED;
        self.auction.draft
            .resolve_auction(AuctionResponse::from(&*self));
    }
}

impl From<&AuctionActor> for AuctionResponse {
    fn from(value: &AuctionActor) -> Self {
        let expires_at = value
            .expires_at
            .clone()
            .map(|some| get_expiry_time_from_instant(some));
        Self {
            auction_id: value.auction.auction_id.clone(),
            draft_id: value.auction.draft.draft_id.clone(),
            state: value.state.clone(),
            highest_bid: value.highest_bid,
            highest_bidder: value.highest_bidder.clone(),
            pokemon: value.auction.pokemon.as_ref().clone(),
            expires_at: expires_at,
            server_timestamp: Utc::now(),
        }
    }
}
