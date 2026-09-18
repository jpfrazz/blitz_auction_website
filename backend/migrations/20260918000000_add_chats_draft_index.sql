-- Chat reads filter by draft_id and order by created_at. Without an index
-- every read of a draft's chat history is a scan of the whole table.
CREATE INDEX IF NOT EXISTS idx_chats_draft_id_created_at ON chats (draft_id, created_at);