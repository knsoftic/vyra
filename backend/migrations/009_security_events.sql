-- 009 — Security event log
--
-- Every authentication-relevant action lands here: sign-in, sign-out, token
-- refresh, refresh-token reuse, password change, session revocation, account
-- type change. Append-only, and there is no delete path in the codebase.
--
-- Separate from `login_attempts` (which only records sign-in outcomes for
-- lockout counting) and from `audit_logs` (which records admin actions). This
-- table is about what happened to a *user's* account, and the user can see it.

CREATE TABLE security_events (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id     BIGINT UNSIGNED NULL,
  event       VARCHAR(48)     NOT NULL,
  outcome     ENUM('success','failure','blocked') NOT NULL DEFAULT 'success',
  -- Free-form context. Never contains a password, OTP code or token.
  detail      VARCHAR(500)    NULL,
  session_id  BIGINT UNSIGNED NULL,
  ip          VARBINARY(16)   NULL,
  user_agent  VARCHAR(255)    NULL,
  created_at  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  -- "show me my account activity", newest first
  KEY idx_security_user (user_id, created_at),
  -- "find every refresh-token reuse in the last hour"
  KEY idx_security_event (event, created_at),
  CONSTRAINT fk_security_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Usernames are claimed permanently, so a released one cannot be re-registered
-- by someone impersonating the previous owner.
CREATE TABLE username_history (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id     BIGINT UNSIGNED NOT NULL,
  username    VARCHAR(30)     NOT NULL,
  released_at DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_username_history_user (user_id),
  KEY idx_username_history_name (username),
  CONSTRAINT fk_uh_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
