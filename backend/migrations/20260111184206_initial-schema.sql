CREATE TABLE users (
    user_id UUID NOT NULL PRIMARY KEY,
    user_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE pokemon (
    pokedex_id INT NOT NULL,
    name TEXT NOT NULL,
    patch_version TEXT NOT NULL,
    form TEXT, /* most pokemon will not be a regional_variant */
    type1 TEXT NOT NULL,
    type2 TEXT,
    ability1 TEXT NOT NULL,
    ability2 TEXT,
    hidden_ability TEXT,
    evolution_method TEXT,
    mega TEXT,
    hp INT NOT NULL,
    attack INT NOT NULL,
    defense INT NOT NULL,
    sp_attack INT NOT NULL,
    sp_defense INT NOT NULL,
    speed INT NOT NULL

    PRIMARY KEY (pokedex_id, form, patch_version)
);

CREATE TABLE drafts (
    draft_id TEXT NOT NULL PRIMARY KEY,
    starting_money INT NOT NULL DEFAULT 20000,
    num_teams INT NOT NULL DEFAULT 8,
    status TEXT NOT NULL DEFAULT 'PENDING',
    patch_version TEXT NOT NULL,
    pokemon_drafted INT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
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
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX auction_order
ON auctions (draft_id, draft_order);

CREATE TABLE teams (
    user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    draft_id TEXT NOT NULL REFERENCES drafts(draft_id) ON DELETE CASCADE,
    money_remaining INT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (user_id, draft_id)
);

CREATE TABLE bids (
    bid_id BIGSERIAL NOT NULL PRIMARY KEY,
    auction_id BIGINT NOT NULL REFERENCES auctions(auction_id),
    user_id UUID NOT NULL REFERENCES users(user_id),
    value INT NOT NULL,
    accepted BOOLEAN NOT NULL,
    winning BOOLEAN NOT NULL,
    updated_at TIMESTAMPTZ
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION update_updated_at()
    RETURNS TRIGGER AS $$
    BEGIN
        NEW.updated_at = now();
        RETURN NEW;\
    END;
    $$ language 'plpgsql';

CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE PROCEDURE update_updated_at();

CREATE TRIGGER update_drafts_updated_at
    BEFORE UPDATE ON drafts
    FOR EACH ROW EXECUTE PROCEDURE update_updated_at();

CREATE TRIGGER update_auctions_updated_at
    BEFORE UPDATE ON auctions
    FOR EACH ROW EXECUTE PROCEDURE update_updated_at();

CREATE TRIGGER update_teams_updated_at
    BEFORE UPDATE ON teams
    FOR EACH ROW EXECUTE PROCEDURE update_updated_at();

CREATE TRIGGER update_bids_updated_at
    BEFORE UPDATE ON bids
    FOR EACH ROW EXECUTE PROCEDURE update_updated_at();
