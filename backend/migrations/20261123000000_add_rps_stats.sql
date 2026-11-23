-- Rock-paper-scissors pick-order showdowns record one decisive result per
-- draft round. The (draft_id, round) key makes writes idempotent if a round is
-- ever replayed, so retry rounds never inflate a player's record.
CREATE TABLE IF NOT EXISTS rps_results (
    draft_id UUID NOT NULL REFERENCES drafts(draft_id) ON DELETE CASCADE,
    round INT NOT NULL,
    winner_account_id TEXT NOT NULL,
    loser_account_id TEXT NOT NULL,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (draft_id, round)
);

-- Counters are keyed by the raw account id (Discord id or guest id). Profile
-- stats aggregate a Discord account together with its linked guest ids.
CREATE TABLE IF NOT EXISTS rps_stats (
    account_id TEXT NOT NULL PRIMARY KEY,
    wins INT NOT NULL DEFAULT 0,
    losses INT NOT NULL DEFAULT 0
);
