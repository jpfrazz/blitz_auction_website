CREATE TYPE versions AS ENUM (
    '1.0.0'
)

CREATE TABLE drafts (
    id TEXT PRIMARY KEY,
    starting_money INT NOT NULL DEFAULT 20000,
    status TEXT NOT NULL DEFAULT 'PENDING',
    patch_version TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)

CREATE TABLE auctions (
    id INT NOT NULL REFERENCES pokemon(id),
    patch_version TEXT NOT NULL,
    draft_id TEXT NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'PENDING',
    winning_bid INT,
    winner UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (id, draft_id)
)

CREATE TABLE pokemon (
    id INT NOT NULL,
    patch_version versions NOT NULL,
    name TEXT NOT NULL,
    base_stats JSONB NOT NULL,

    PRIMARY KEY (id, patch_version)
)

CREATE TABLE users (
    id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
)

CREATE TABLE players (
    id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE
    draft_id TEXT NOT NULL REFERENCES drafts(id) ON DELETE CASCADE
    money_remaining INT NOT NULL,
    is_connected BOOL NOT NULL DEFAULT false
)

