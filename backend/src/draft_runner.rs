use dashmap::DashMap;
use futures_util::StreamExt;
use sqlx::PgPool;
use tokio::{sync::{mpsc, oneshot, RwLock}, task};
use tokio_util::time::{DelayQueue, delay_queue};
use uuid::Uuid;
use std::{
    collections::HashMap,
    sync::Arc,
};

use crate::{
    auction::Auction,
    draft::Draft,
};

struct BidStruct {
    auction_id: u32,
    user_id: Uuid,
    amount: u32,
    result_tx: oneshot::Sender<BidResult>,
}
enum Command {
    Start {
        draft_id: u32,
        time: u32,
    },
    Stop(u32),
}

enum BidResult {
    ACCEPTED,
    DENIED(String),
}

pub struct DraftRunner {
    cmd_tx: mpsc::Sender<Command>,
}

impl DraftRunner {

    pub fn new(drafts: Arc<DashMap<String, Arc<RwLock<Draft>>>>) -> DraftRunner {
        let (tx, rx) = mpsc::channel::<Command>(1_000);

        task::spawn(async move {
            Self::runner(rx, drafts).await
        });

        Self {
            cmd_tx: tx,
        }
    }

    // runs auction manager forever
    async fn runner(mut rx: mpsc::Receiver<Command>, drafts: Arc<DashMap<String, Arc<RwLock<Draft>>>>) {
        let mut timer_queue: DelayQueue<String> = DelayQueue::new();

        loop {
            tokio::select! {
                Some(cmd) = rx.recv() => {
                    Self::handle_command(cmd, drafts.clone(), &mut timer_queue);
                },
                Some(auction_key) = timer_queue.next() => {
                    Self::handle_expiration(auction_key.into_inner(), drafts.clone(), &mut timer_queue);
                },
            }
        }
    }

    fn handle_command(cmd: Command, drafts: Arc<DashMap<String, Arc<RwLock<Draft>>>>,  queue: &mut DelayQueue<String>){
        match cmd {
            Command::Start { draft_id, time }  => {
                todo!()
            }
            Command::Stop(draft_id) => {
                todo!()
            }
        }
    }

    fn handle_expiration(draft_id: String, drafts: Arc<DashMap<String, Arc<RwLock<Draft>>>>,  queue: &mut DelayQueue<String>) {
        todo!()
    }

    pub async fn bid() -> Result<(), String> {
        todo!()
    }

    pub async fn register_draft() -> Result<(), String> {
        todo!()
    }
}
