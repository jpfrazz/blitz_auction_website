CREATE TABLE users (
    user_id TEXT NOT NULL PRIMARY KEY,
    user_name TEXT NOT NULL,
    discriminator TEXT NOT NULL,
    global_name TEXT,
    avatar TEXT,
    role_hash TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE user_roles (
    user_id TEXT NOT NULL REFERENCES users(user_id),
    role TEXT NOT NULL,
    PRIMARY KEY (user_id, role)
);

CREATE TABLE guests (
    user_id TEXT NOT NULL PRIMARY KEY,
    user_name TEXT NOT NULL,
    discord_user_id TEXT REFERENCES users(user_id),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE pokemon (
    pokedex_id INT NOT NULL,
    name TEXT NOT NULL,
    patch_version TEXT NOT NULL,
    form TEXT NOT NULL DEFAULT '',
    stage TEXT NOT NULL,
    description TEXT,
    type1 TEXT NOT NULL,
    type2 TEXT,
    ability1 TEXT NOT NULL,
    ability2 TEXT,
    hidden_ability TEXT,
    evolution_method TEXT,
    evolves_from_id INT,
    evolves_from_form TEXT,
    mega TEXT,
    is_baby BOOLEAN NOT NULL DEFAULT FALSE,
    hp INT NOT NULL,
    attack INT NOT NULL,
    defense INT NOT NULL,
    sp_attack INT NOT NULL,
    sp_defense INT NOT NULL,
    speed INT NOT NULL,

    PRIMARY KEY (pokedex_id, form, patch_version),
    FOREIGN KEY (evolves_from_id, evolves_from_form, patch_version)
        REFERENCES pokemon(pokedex_id, form, patch_version)
);

CREATE TABLE moves (
    move_name TEXT NOT NULL PRIMARY KEY,
    move_description TEXT,
    move_type TEXT NOT NULL,
    move_category TEXT NOT NULL,
    power INT NOT NULL,
    accuracy INT NOT NULL,
    pp INT NOT NULL,
    effect TEXT NOT NULL,
    probability INT
);

CREATE TABLE key_moves (
    pokedex_id INT NOT NULL,
    form TEXT NOT NULL DEFAULT '',
    patch_version TEXT NOT NULL,
    move_name TEXT NOT NULL REFERENCES moves(move_name),
    learn_method TEXT NOT NULL,

    FOREIGN KEY (pokedex_id, form, patch_version)
        REFERENCES pokemon(pokedex_id, form, patch_version)
        ON DELETE CASCADE
);

CREATE TABLE drafts (
    draft_id TEXT NOT NULL PRIMARY KEY,
    host_user_id TEXT REFERENCES users(user_id),
    host_guest_id TEXT REFERENCES guests(user_id),
    starting_money INT NOT NULL DEFAULT 20000,
    num_teams INT NOT NULL DEFAULT 8,
    status TEXT NOT NULL DEFAULT 'PENDING',
    patch_version TEXT NOT NULL,
    pokemon_drafted INT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()

    CONSTRAINT at_least_one_host_id CHECK (
        host_user_id IS NOT NULL OR host_guest_id IS NOT NULL
    )
);

CREATE TABLE auctions (
    auction_id BIGSERIAL NOT NULL PRIMARY KEY,
    pokedex_id INT NOT NULL,
    form TEXT NOT NULL,
    patch_version TEXT NOT NULL,
    draft_id TEXT NOT NULL REFERENCES drafts(draft_id) ON DELETE CASCADE,
    draft_order INT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING',
    winning_bid INT,
    winning_user_id TEXT REFERENCES users(user_id),
    winning_guest_id TEXT REFERENCES guests(user_id),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    FOREIGN KEY (pokedex_id, form, patch_version)
        REFERENCES pokemon(pokedex_id, form, patch_version),

    CONSTRAINT at_least_one_winner CHECK (
        winning_bid IS NULL OR (winning_user_id IS NOT NULL OR winning_guest_id IS NOT NULL)
    )
);

CREATE UNIQUE INDEX auction_order
    ON auctions (draft_id, draft_order);

CREATE TABLE teams (
    team_id BIGSERIAL NOT NULL PRIMARY KEY,
    user_id TEXT REFERENCES users(user_id) ON DELETE CASCADE,
    guest_id TEXT REFERENCES guests(user_id) ON DELETE CASCADE,
    draft_id TEXT NOT NULL REFERENCES drafts(draft_id) ON DELETE CASCADE,
    money_remaining INT NOT NULL,
    pokemon_drafted INT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT at_least_one_acct_id CHECK (
        user_id IS NOT NULL OR guest_id IS NOT NULL
    )
);

CREATE TABLE bids (
    bid_id BIGSERIAL NOT NULL PRIMARY KEY,
    auction_id BIGINT NOT NULL REFERENCES auctions(auction_id),
    user_id TEXT REFERENCES users(user_id),
    guest_id TEXT REFERENCES guests(user_id),
    value INT NOT NULL,
    accepted BOOLEAN NOT NULL,
    winning BOOLEAN NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()

    CONSTRAINT at_least_one_acct_id CHECK (
        user_id IS NOT NULL OR guest_id IS NOT NULL
    )
);

CREATE OR REPLACE FUNCTION update_updated_at()
    RETURNS TRIGGER AS $$
    BEGIN
        NEW.updated_at = now();
        RETURN NEW;
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

CREATE TRIGGER update_guests_updated_at
    BEFORE UPDATE ON guests
    FOR EACH ROW EXECUTE PROCEDURE update_updated_at();
