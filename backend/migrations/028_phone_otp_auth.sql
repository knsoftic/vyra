-- 028 — Signing in with a phone number and a one-time code
--
-- The OTP table has existed since migration 001 and is keyed by email, because
-- email was the only identity the platform had. Adding SMS codes means codes
-- have to be addressed to something that is not an email address.
--
-- Rather than a second OTP table, `email` becomes `identifier` and gains a
-- `channel` beside it. One code table, one expiry rule, one attempt counter —
-- two tables would be two places for "how many attempts are left" to drift
-- apart, and that is a security property, not a detail.
--
-- Nothing existing changes meaning: every current row is an email code, and the
-- backfill marks it as one.

-- ── Users can now have a phone number ──

ALTER TABLE users
  -- Digits only, with a country code, no plus: the shape a gateway wants.
  -- Nullable, because email accounts are not going anywhere.
  ADD COLUMN phone VARCHAR(20) NULL AFTER email,
  ADD COLUMN phone_verified_at DATETIME(3) NULL AFTER phone;

-- One account per number, but any number of accounts without one. MySQL and
-- MariaDB both allow repeated NULLs in a unique index, which is exactly the
-- behaviour needed here.
CREATE UNIQUE INDEX uq_users_phone ON users (phone);

-- ── OTP codes are addressed to an identifier, not an email ──

ALTER TABLE otp_codes
  CHANGE COLUMN email identifier VARCHAR(191) NOT NULL,
  ADD COLUMN channel ENUM('email','sms') NOT NULL DEFAULT 'email' AFTER identifier;

-- The lookup index has to cover the channel too: the same string could in
-- principle be issued a code on both channels, and they are different codes.
ALTER TABLE otp_codes
  DROP INDEX idx_otp_lookup,
  ADD INDEX idx_otp_lookup (identifier, channel, purpose, consumed_at);

-- Every code that already exists was sent by email; the column default already
-- says so, and this makes it explicit rather than implied.
UPDATE otp_codes SET channel = 'email' WHERE channel IS NULL OR channel = '';

-- ── Login attempts are recorded against whatever was typed ──
--
-- The throttle counts failures per identity. With phone sign-in that identity
-- is sometimes a number, so the column widens to hold either.

ALTER TABLE login_attempts
  CHANGE COLUMN email identifier VARCHAR(191) NULL;
