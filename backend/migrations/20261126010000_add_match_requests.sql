-- Home-page "looking for a match" posts. Each user can post once per 20
-- minutes; the proposed time is stored in UTC and formatted in the viewer's
-- timezone by the frontend.
CREATE TABLE IF NOT EXISTS match_requests (
    id BIGSERIAL PRIMARY KEY,
    user_id TEXT NOT NULL,
    user_name TEXT NOT NULL,
    mode TEXT NOT NULL CHECK (mode IN ('1v1', 'Booster', 'Draft')),
    requested_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS match_requests_created_at_idx
    ON match_requests (created_at DESC);

CREATE INDEX IF NOT EXISTS match_requests_user_created_at_idx
    ON match_requests (user_id, created_at DESC);
