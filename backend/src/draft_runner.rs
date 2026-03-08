use dashmap::DashMap;
use futures_util::StreamExt;
use std::{collections::HashMap, sync::Arc};
use tokio::{
    sync::{RwLock, mpsc},
    task,
    time::Instant,
};
use tokio_util::time::{
    DelayQueue,
    delay_queue::{self, Key},
};

use crate::draft::{Draft, DraftState};

enum Command {
    Start {
        draft_id: String,
        expires_at: Instant,
    },
    Stop(String),
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

    // runs draft runner forever
    async fn runner(
        mut rx: mpsc::Receiver<Command>,
        drafts: Arc<DashMap<String, Arc<RwLock<Draft>>>>,
    ) {
        let mut timer_queue: DelayQueue<String> = DelayQueue::new();
        let mut draft_keys: HashMap<String, delay_queue::Key> = HashMap::new();

        loop {
            tokio::select! {
                Some(cmd) = rx.recv() => {
                    Self::handle_command(cmd, &mut timer_queue, &mut draft_keys);
                },
                Some(auction_key) = timer_queue.next() => {
                    Self::handle_expiration(auction_key.into_inner(), drafts.clone(), &mut timer_queue, &mut draft_keys).await;
                },
            }
        }
    }

    fn handle_command(
        cmd: Command,
        queue: &mut DelayQueue<String>,
        draft_keys: &mut HashMap<String, Key>,
    ) {
        match cmd {
            Command::Start {
                draft_id,
                expires_at,
            } => {
                if let Some(old_key) = draft_keys.remove(&draft_id) {
                    queue.remove(&old_key);
                }
                let key = queue.insert_at(draft_id.clone(), expires_at);
                draft_keys.insert(draft_id, key);
            }
            Command::Stop(draft_id) => {
                let Some(key) = draft_keys.remove(&draft_id) else {
                    return;
                };
                queue.remove(&key);
            }
        }
    }

    async fn handle_expiration(
        draft_id: String,
        drafts: Arc<DashMap<String, Arc<RwLock<Draft>>>>,
        queue: &mut DelayQueue<String>,
        draft_keys: &mut HashMap<String, Key>,
    ) {
        draft_keys.remove(&draft_id);
        let draft_lock = drafts
            .get(&draft_id)
            .expect("draft removed from drafts before draft runner");
        let mut draft = draft_lock.write().await;

        if matches!(draft.draft_state, DraftState::PAUSED(_)) {
            return;
        }

        let current_auction = draft
            .auctions
            .get(draft.current_auction as usize)
            .expect("draft current auction does not exist");
        let expiration = current_auction
            .expires_at
            .expect("auction expiration not set");
        if expiration > Instant::now() {
            // reinsert draft to queue if its expiration time was changed by a handler
            let key = queue.insert_at(draft_id.clone(), expiration);
            draft_keys.insert(draft_id, key);
            return;
        }

        if let Err(e) = draft.resolve_auction().await {
            eprintln!("failed to resolve auction for {}: {}", &draft_id, e);
            return;
        };
    }

    pub async fn register_draft(
        &self,
        draft: &mut Draft,
        expires_at: Instant,
    ) -> Result<(), String> {
        draft.auctions[draft.current_auction as usize].expires_at = Some(expires_at.clone());
        let _ = self
            .cmd_tx
            .send(Command::Start {
                draft_id: draft.draft_id.clone(),
                expires_at,
            })
            .await
            .map_err(|_e| "failed to register draft".to_string());

        Ok(())
    }

    pub async fn unregister_draft(&self, draft_id: String) -> Result<(), String> {
        let _ = self
            .cmd_tx
            .send(Command::Stop(draft_id))
            .await
            .map_err(|_e| "failed to unregister draft".to_string())?;

        Ok(())
    }
}
