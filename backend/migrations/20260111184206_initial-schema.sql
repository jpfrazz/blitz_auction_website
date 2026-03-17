CREATE TABLE users (
    user_id TEXT NOT NULL PRIMARY KEY,
    user_name TEXT NOT NULL,
    discriminator TEXT NOT NULL,
    global_name TEXT,
    avatar TEXT,
    role_hash TEXT NOT NULL,
    wins INT NOT NULL DEFAULT 0,
    losses INT NOT NULL DEFAULT 0,
    mmr INT NOT NULL DEFAULT 1500,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE user_roles (
    user_id TEXT NOT NULL REFERENCES users(user_id),
    role_id TEXT NOT NULL,
    role_name TEXT NOT NULL,
    PRIMARY KEY (user_id, role_id)
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
    form TEXT NOT NULL DEFAULT '',
    stage TEXT NOT NULL DEFAULT 'Base',
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
    obtain_method TEXT,
    hp INT NOT NULL,
    attack INT NOT NULL,
    defense INT NOT NULL,
    sp_attack INT NOT NULL,
    sp_defense INT NOT NULL,
    speed INT NOT NULL,

    PRIMARY KEY (pokedex_id, form),
    FOREIGN KEY (evolves_from_id, evolves_from_form)
        REFERENCES pokemon(pokedex_id, form)
);

CREATE TABLE moves (
    name VARCHAR(255) PRIMARY KEY,
    description TEXT,
    effect VARCHAR(255),
    power INT DEFAULT 0,
    type VARCHAR(50),
    accuracy INT DEFAULT 100,
    pp INT,
    category VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE key_moves (
    pokedex_id INT NOT NULL,
    form TEXT NOT NULL DEFAULT '',
    move_name TEXT NOT NULL REFERENCES moves(name),
    learn_method TEXT NOT NULL,
    species TEXT,

    FOREIGN KEY (pokedex_id, form)
        REFERENCES pokemon(pokedex_id, form)
        ON DELETE CASCADE
);

CREATE TABLE drafts (
    draft_id UUID NOT NULL PRIMARY KEY,
    draft_name TEXT NOT NULL DEFAULT '',
    password TEXT,
    host_user_id TEXT REFERENCES users(user_id),
    host_guest_id TEXT REFERENCES guests(user_id),
    ranked BOOLEAN NOT NULL,
    starting_money INT NOT NULL DEFAULT 20000,
    num_teams INT NOT NULL DEFAULT 8,
    state TEXT NOT NULL DEFAULT 'PENDING',
    pokemon_drafted INT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT exactly_one_host_id CHECK (
        num_nonnulls(host_guest_id, host_user_id) = 1
    )
);

CREATE INDEX idx_drafts_id_sorted ON drafts (draft_id);

CREATE TABLE auctions (
    auction_id BIGSERIAL NOT NULL PRIMARY KEY,
    pokedex_id INT NOT NULL,
    form TEXT NOT NULL,
    draft_id UUID NOT NULL REFERENCES drafts(draft_id) ON DELETE CASCADE,
    draft_order INT NOT NULL,
    state TEXT NOT NULL DEFAULT 'PENDING',
    paused_time_remaining INT,
    winning_bid INT,
    winning_user_id TEXT REFERENCES users(user_id),
    winning_guest_id TEXT REFERENCES guests(user_id),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    FOREIGN KEY (pokedex_id, form)
        REFERENCES pokemon(pokedex_id, form),

    CONSTRAINT paused_time_if_paused CHECK (
        (state != 'PAUSED' AND paused_time_remaining IS NULL)
        OR (state = 'PAUSED' AND paused_time_remaining IS NOT NULL)
    ),

    CONSTRAINT exactly_one_winner CHECK (
        winning_bid IS NULL OR (num_nonnulls(winning_guest_id, winning_user_id) = 1)
    )
);

CREATE UNIQUE INDEX auction_order
    ON auctions (draft_id, draft_order);

CREATE TABLE teams (
    team_id BIGSERIAL NOT NULL PRIMARY KEY,
    user_id TEXT REFERENCES users(user_id) ON DELETE CASCADE,
    guest_id TEXT REFERENCES guests(user_id) ON DELETE CASCADE,
    draft_id UUID NOT NULL REFERENCES drafts(draft_id) ON DELETE CASCADE,
    money_remaining INT NOT NULL,
    pokemon_drafted INT NOT NULL DEFAULT 0,
    placement INT,
    post_match_mmr INT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT not_xor_placement_mmr CHECK (
        num_nonnulls(placement, post_match_mmr) != 1
    ),
    CONSTRAINT exactly_one_acct_id CHECK (
        num_nonnulls(user_id, guest_id) = 1
    )
);

CREATE TABLE bids (
    bid_id BIGSERIAL NOT NULL PRIMARY KEY,
    auction_id BIGINT NOT NULL REFERENCES auctions(auction_id),
    user_id TEXT REFERENCES users(user_id),
    guest_id TEXT REFERENCES guests(user_id),
    value INT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()

    CONSTRAINT exactly_one_acct_id CHECK (
        num_nonnulls(user_id, guest_id) = 1
    )
);

CREATE TABLE chats (
    chat_id BIGSERIAL NOT NULL PRIMARY KEY,
    draft_id UUID NOT NULL REFERENCES drafts(draft_id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    message TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
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
