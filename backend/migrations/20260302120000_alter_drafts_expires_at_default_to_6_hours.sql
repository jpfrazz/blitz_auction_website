-- Change expires_at default on drafts without dropping the column
ALTER TABLE drafts
ALTER COLUMN expires_at SET DEFAULT (NOW() + INTERVAL '6 hours');
