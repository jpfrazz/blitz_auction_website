CREATE TABLE user_avatars (
    user_id TEXT NOT NULL PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
    data BYTEA NOT NULL,
    content_type TEXT NOT NULL,
    avatar_hash TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER update_user_avatars_updated_at
    BEFORE UPDATE ON user_avatars
    FOR EACH ROW EXECUTE PROCEDURE update_updated_at();