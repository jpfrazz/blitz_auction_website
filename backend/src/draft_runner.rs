use dashmap::DashMap;
use futures_util::StreamExt;
use std::sync::Arc;
use tokio::{
    sync::{RwLock, mpsc, oneshot},
    task,
    time::Instant,
};
use tokio_util::time::DelayQueue;
use uuid::Uuid;

use crate::draft::Draft;

struct BidStruct {
    auction_id: u32,
    user_id: Uuid,
    amount: u32,
    result_tx: oneshot::Sender<BidResult>,
}
enum Command {
    Start {
        draft_id: String,
        expires_at: Instant,
    },
    Stop(u32),
}

enum BidResult {
    ACCEPTED,
    DENIED(String),
}

#[derive(Clone, Debug)]
pub struct DraftRunner {
    cmd_tx: mpsc::Sender<Command>,
}

impl DraftRunner {
    pub fn new(drafts: Arc<DashMap<String, Arc<RwLock<Draft>>>>) -> DraftRunner {
        let (tx, rx) = mpsc::channel::<Command>(1_000);

        task::spawn(async move { Self::runner(rx, drafts).await });

        Self { cmd_tx: tx }
    }

    // runs auction manager forever
    async fn runner(
        mut rx: mpsc::Receiver<Command>,
        drafts: Arc<DashMap<String, Arc<RwLock<Draft>>>>,
    ) {
        let mut timer_queue: DelayQueue<String> = DelayQueue::new();

        loop {
            tokio::select! {
                Some(cmd) = rx.recv() => {
                    Self::handle_command(cmd, drafts.clone(), &mut timer_queue);
                },
                Some(auction_key) = timer_queue.next() => {
                    Self::handle_expiration(auction_key.into_inner(), drafts.clone(), &mut timer_queue).await;
                },
            }
        }
    }

    fn handle_command(
        cmd: Command,
        drafts: Arc<DashMap<String, Arc<RwLock<Draft>>>>,
        queue: &mut DelayQueue<String>,
    ) {
        match cmd {
            Command::Start {
                draft_id,
                expires_at,
            } => {
                todo!()
            }
            Command::Stop(draft_id) => {
                todo!()
            }
        }
    }

    async fn handle_expiration(
        draft_id: String,
        drafts: Arc<DashMap<String, Arc<RwLock<Draft>>>>,
        queue: &mut DelayQueue<String>,
    ) {
        let draft_lock = drafts
            .get(&draft_id)
            .expect("draft removed from drafts before draft runner");
        let mut draft = draft_lock.write().await;
        let current_auction = draft
            .auctions
            .get(draft.current_auction as usize)
            .expect("draft current auction does not exist");
        let expiration = current_auction
            .expires_at
            .expect("auction expiration not set");
        if expiration > Instant::now() {
            // reinsert draft to queue if its expiration time was changed by a handler
            queue.insert_at(draft_id, expiration);
            return;
        }

        let Ok(_) = draft.resolve_auction().await else {
            eprintln!("failed to resolve auction for {}", &draft_id);
            return;
        };
    }

    pub async fn register_draft(
        &self,
        draft_id: String,
        expires_at: Instant,
    ) -> Result<(), String> {
        let _ = self
            .cmd_tx
            .send(Command::Start {
                draft_id: draft_id,
                expires_at,
            })
            .await
            .map_err(|_e| "failed to register draft".to_string());

        Ok(())
    }
}
