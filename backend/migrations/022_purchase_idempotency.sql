-- 022_purchase_idempotency.sql
--
-- A coin purchase request carried no idempotency key of its own, so its route
-- had to fail closed when the cache was unavailable — meaning nobody could buy
-- coins whenever Redis was down. The reasoning at the time was that a purchase
-- request writes no ledger row until it is approved, so there was nothing to
-- match a retry against.
--
-- That is a reason to add the column, not a reason to refuse the request.
-- ADR-032 says a correctness guarantee belongs in the database; this brings
-- purchases in line with gifts and withdrawals.
--
-- Nullable so existing rows stay valid, and unique per (user, key) because two
-- different people may legitimately generate the same client key.

ALTER TABLE coin_purchase_requests
  ADD COLUMN idempotency_key VARCHAR(64) NULL DEFAULT NULL AFTER ledger_id;

ALTER TABLE coin_purchase_requests
  ADD UNIQUE KEY uq_purchase_idempotency (user_id, idempotency_key);
