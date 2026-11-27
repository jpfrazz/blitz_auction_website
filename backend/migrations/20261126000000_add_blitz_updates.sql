-- Persistent, append-only feed of recent happenings shown in the home page
-- "Blitz Updates" ticker. Rows survive backend restarts/redeploys because they
-- live in Postgres, unlike the in-memory draft cache.
CREATE TABLE IF NOT EXISTS blitz_updates (
    id BIGSERIAL PRIMARY KEY,
    event_type TEXT NOT NULL,
    subject_key TEXT NOT NULL,
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_blitz_updates_created_at
    ON blitz_updates (created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_blitz_updates_subject_created
    ON blitz_updates (subject_key, created_at DESC);

-- Last known earned-achievement set per user. The first report establishes the
-- baseline; later reports emit events only for achievements that are newly
-- earned, so viewing a profile for the first time doesn't flood the ticker.
CREATE TABLE IF NOT EXISTS achievement_earned_snapshots (
    user_id TEXT PRIMARY KEY,
    earned_ids JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Snapshots used to detect all-time cost ranking moves. Stored server-side so
-- ranking history survives redeploys and doesn't depend on a client's cache.
CREATE TABLE IF NOT EXISTS cost_ranking_snapshots (
    id BIGSERIAL PRIMARY KEY,
    captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    rankings JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cost_ranking_snapshots_captured
    ON cost_ranking_snapshots (captured_at DESC, id DESC);
