-- Add support for 1v1 Draft lobbies.
-- drafts.draft_type distinguishes the lobby format. 'auction' is the default
-- (covers both regular and ranked auctions); '1v1' marks a 1v1 snake draft.
ALTER TABLE drafts ADD COLUMN draft_type TEXT NOT NULL DEFAULT 'auction';

-- auctions.action records what happened to a row in a 1v1 draft.
-- NULL for regular auctions. For 1v1 drafts the value is one of
-- 'PICK', 'BAN', or 'LEFTOVER'.
ALTER TABLE auctions ADD COLUMN action TEXT;

CREATE INDEX idx_drafts_draft_type ON drafts (draft_type);
