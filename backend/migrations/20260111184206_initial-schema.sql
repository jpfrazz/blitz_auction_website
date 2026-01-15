CREATE TABLE users (
    user_id UUID NOT NULL PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE pokemon (
    pokemon_id BIGSERIAL NOT NULL PRIMARY KEY,
    pokedex_id INT NOT NULL,
    name TEXT NOT NULL,
    patch_version TEXT NOT NULL,
    regional_variant TEXT, /* most pokemon will not be a regional_variant */
    base_stats JSONB NOT NULL
);

CREATE TABLE drafts (
    draft_id TEXT NOT NULL PRIMARY KEY,
    starting_money INT NOT NULL DEFAULT 20000,
    num_players INT NOT NULL DEFAULT 8,
    status TEXT NOT NULL DEFAULT 'PENDING',
    patch_version TEXT NOT NULL,
    pokemon_drafted INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE auctions (
    auction_id BIGSERIAL NOT NULL PRIMARY KEY,
    pokemon_id INT NOT NULL REFERENCES pokemon(pokemon_id),
    patch_version TEXT NOT NULL,
    draft_id TEXT NOT NULL REFERENCES drafts(draft_id) ON DELETE CASCADE,
    draft_order INT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING',
    winning_bid INT,
    drafted_by UUID REFERENCES users(user_id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE players (
    user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    draft_id TEXT NOT NULL REFERENCES drafts(draft_id) ON DELETE CASCADE,
    money_remaining INT NOT NULL,
    is_connected BOOL NOT NULL DEFAULT false,

    PRIMARY KEY (user_id, draft_id)
);

CREATE TABLE bids (
    bid_id BIGSERIAL NOT NULL PRIMARY KEY,
    auction_id BIGSERIAL NOT NULL REFERENCES auctions(auction_id),
    user_id UUID NOT NULL REFERENCES users(user_id),
    bid_value INT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX auction_order
ON auctions (draft_id, draft_order);
