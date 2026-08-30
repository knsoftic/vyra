-- 019_message_hiding_and_calls.sql
--
-- Phase 8 additions to the messaging schema laid down in migration 004.
--
-- `hidden_at` on a receipt is how "delete for me" works. Deleting the message
-- row would remove it for everybody, and a separate hidden-messages table would
-- be a second place to ask the same question — the receipt row already exists
-- per (message, recipient), which is exactly the grain this needs.
--
-- Nothing here removes or narrows a column.

ALTER TABLE message_receipts
  ADD COLUMN hidden_at DATETIME(3) NULL DEFAULT NULL AFTER seen_at;

-- The sender has no receipt row of their own (a receipt against yourself would
-- make every message read the instant it was sent), so hiding your own message
-- needs a row that can exist without one. The composite primary key already
-- permits it; this index makes the per-user lookup in the history query cheap.
ALTER TABLE message_receipts
  ADD INDEX idx_receipts_user_hidden (user_id, hidden_at);

-- Typing indicators and presence are ephemeral and live in Redis. Calls are not:
-- a call history has to survive a restart, and the signalling needs somewhere to
-- record which peer answered.
ALTER TABLE call_participants
  ADD COLUMN is_muted TINYINT(1) NOT NULL DEFAULT 0 AFTER outcome;

ALTER TABLE call_participants
  ADD COLUMN camera_on TINYINT(1) NOT NULL DEFAULT 1 AFTER is_muted;

-- Ringing calls are polled by the callee's device, and expired ones are swept.
ALTER TABLE calls
  ADD INDEX idx_calls_status_created (status, created_at);
