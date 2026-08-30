-- 020_message_client_id.sql
--
-- Durable send idempotency.
--
-- `sendMessage` deduplicated retries through a Redis key. That works only while
-- Redis is reachable: with it down, a client retrying after a dropped
-- connection posts the same message twice and the recipient sees two bubbles.
-- Redis is a cache on this path, and a correctness guarantee must not rest on a
-- cache — the same reasoning that put a unique `idempotency_key` on
-- `wallet_ledger` in ADR-020.
--
-- The column is nullable so existing rows stay valid, and the unique key is on
-- (sender_id, client_id): two different people may legitimately generate the
-- same client id, and MySQL treats NULLs as distinct so historic rows do not
-- collide with each other.

ALTER TABLE messages
  ADD COLUMN client_id VARCHAR(64) NULL DEFAULT NULL AFTER public_id;

ALTER TABLE messages
  ADD UNIQUE KEY uq_messages_sender_client (sender_id, client_id);
