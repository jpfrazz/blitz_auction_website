CREATE TABLE profile_avatars (
    user_id TEXT PRIMARY KEY,
    data BYTEA NOT NULL,
    content_type TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);