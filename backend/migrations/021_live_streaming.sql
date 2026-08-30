-- 021_live_streaming.sql
--
-- Phase 9 additions to the live schema from migration 004.
--
-- `live_streams` had everywhere to record what happened during a broadcast but
-- nowhere to record how the broadcaster authenticates to the ingest server. A
-- stream key is a credential, so it is stored hashed — the plaintext is returned
-- once, when the stream is created, and never again.
--
-- Nothing here removes or narrows a column.

ALTER TABLE live_streams
  ADD COLUMN stream_key_hash CHAR(64) NULL DEFAULT NULL AFTER thumbnail_key;

ALTER TABLE live_streams
  ADD COLUMN ingest_url VARCHAR(500) NULL DEFAULT NULL AFTER stream_key_hash;

-- A key is good for one broadcast. An expiry means a leaked one stops working
-- rather than granting the ability to impersonate a creator indefinitely.
ALTER TABLE live_streams
  ADD COLUMN key_expires_at DATETIME(3) NULL DEFAULT NULL AFTER ingest_url;

-- The category was a free-text string, so a live stream could not be discovered
-- through the same taxonomy as everything else. The FK makes it the same list
-- the admin panel edits.
ALTER TABLE live_streams
  ADD COLUMN category_id BIGINT UNSIGNED NULL DEFAULT NULL AFTER category;

ALTER TABLE live_streams
  ADD CONSTRAINT fk_live_category FOREIGN KEY (category_id)
    REFERENCES categories (id) ON DELETE SET NULL;

-- Finding the live streams is the most frequent query the discovery screens make.
ALTER TABLE live_streams
  ADD INDEX idx_live_status_started (status, started_at);

-- Likes on a live stream are taps, and there are many per viewer. Storing one
-- row per tap would be the largest table in the product for the least valuable
-- data, so the counter stays denormalised — but the per-viewer total is kept so
-- a client cannot claim an arbitrary number, and so the count is attributable
-- rather than a figure the server was simply told.
CREATE TABLE IF NOT EXISTS live_likes (
  stream_id  BIGINT UNSIGNED NOT NULL,
  user_id    BIGINT UNSIGNED NOT NULL,
  count      INT UNSIGNED    NOT NULL DEFAULT 0,
  updated_at DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (stream_id, user_id),
  CONSTRAINT fk_live_likes_stream FOREIGN KEY (stream_id) REFERENCES live_streams (id) ON DELETE CASCADE,
  CONSTRAINT fk_live_likes_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- A gift writes two ledger rows — the sender's debit and the recipient's credit.
-- `wallet_ledger.idempotency_key` is globally unique, so the two rows cannot
-- share one key; the transaction records the caller's key so a retry can be
-- recognised whichever row it is matched against.
ALTER TABLE gift_transactions
  ADD COLUMN idempotency_key VARCHAR(64) NULL DEFAULT NULL AFTER recipient_ledger_id;

ALTER TABLE gift_transactions
  ADD UNIQUE KEY uq_gift_idempotency (sender_id, idempotency_key);
