-- 025_notifications_and_delivery.sql
--
-- Phase 13: notification preferences, and an outbox for everything that leaves
-- the platform.
--
-- **Preferences** were a screen with no storage behind them — the toggles saved
-- nowhere and nothing consulted them. A preference nobody honours is worse than
-- no preference, because the user believes they have turned something off.
--
-- **The outbox** is the pattern that makes delivery survivable. An email or push
-- is written in the same transaction as the thing that caused it, then drained
-- by a worker. Three consequences, each of which is the point:
--
--   - A crash between "the follow happened" and "the email was sent" loses
--     neither: the row is committed with the follow.
--   - A dead mail server never fails the user's request. It fails the drain,
--     which retries.
--   - Anything undeliverable is *visible* — a row with a failure and an attempt
--     count — rather than an exception swallowed in a `.catch()`.
--
-- Nothing here removes or narrows a column.

CREATE TABLE IF NOT EXISTS notification_preferences (
  user_id     BIGINT UNSIGNED NOT NULL,
  -- Matches `notifications.kind`, plus 'marketing' which has no notification
  -- row of its own but must still be refusable.
  kind        VARCHAR(30)     NOT NULL,
  in_app      TINYINT(1)      NOT NULL DEFAULT 1,
  push        TINYINT(1)      NOT NULL DEFAULT 1,
  email       TINYINT(1)      NOT NULL DEFAULT 0,
  updated_at  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (user_id, kind),
  CONSTRAINT fk_notif_prefs_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Quiet hours are per account rather than per kind: "not between 11pm and 7am"
-- is a statement about the person, not about likes.
ALTER TABLE user_profiles
  ADD COLUMN quiet_hours_start TINYINT UNSIGNED NULL DEFAULT NULL;

ALTER TABLE user_profiles
  ADD COLUMN quiet_hours_end TINYINT UNSIGNED NULL DEFAULT NULL;

CREATE TABLE IF NOT EXISTS outbox (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id     CHAR(26)        NOT NULL,
  channel       ENUM('email','push')  NOT NULL,
  -- The recipient as the channel understands it: an address, or a push token.
  -- Kept on the row so a drain does not have to re-resolve a user who may have
  -- changed their address since.
  destination   VARCHAR(500)    NOT NULL,
  user_id       BIGINT UNSIGNED NULL,
  template      VARCHAR(60)     NOT NULL,
  subject       VARCHAR(200)    NULL,
  -- Template variables. Deliberately not the rendered body: rendering at send
  -- time means a template fix reaches queued messages.
  payload       LONGTEXT        NOT NULL CHECK (json_valid(payload)),
  status        ENUM('pending','sending','sent','failed','abandoned') NOT NULL DEFAULT 'pending',
  attempts      TINYINT UNSIGNED NOT NULL DEFAULT 0,
  last_error    VARCHAR(500)    NULL,
  -- Set when a retry should not happen before a given time, so a failing
  -- provider is backed off rather than hammered.
  next_attempt_at DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  sent_at       DATETIME(3)     NULL,
  -- One message per logical event. A retried signup does not send two emails.
  dedupe_key    VARCHAR(128)    NULL,
  created_at    DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_outbox_public_id (public_id),
  UNIQUE KEY uq_outbox_dedupe (dedupe_key),
  KEY idx_outbox_drain (status, next_attempt_at),
  KEY idx_outbox_user (user_id, created_at),
  CONSTRAINT fk_outbox_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Notifications are read newest-first per user, and the unread badge counts
-- them, so both need the index.
ALTER TABLE notifications
  ADD INDEX idx_notifications_user_read (user_id, read_at, created_at);
