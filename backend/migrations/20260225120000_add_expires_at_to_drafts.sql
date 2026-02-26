-- Add expires_at column to drafts table
ALTER TABLE drafts
ADD COLUMN expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '1 day');
