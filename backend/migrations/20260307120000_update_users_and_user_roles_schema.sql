ALTER TABLE users
    DROP COLUMN role_hash;

ALTER TABLE user_roles
    DROP CONSTRAINT user_roles_pkey;

ALTER TABLE user_roles
    RENAME COLUMN role TO role_id;

ALTER TABLE user_roles
    ADD COLUMN role_name TEXT NOT NULL;

ALTER TABLE user_roles
    ADD PRIMARY KEY (user_id, role_id);
