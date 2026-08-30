-- 001 — Identity, sessions and the social graph
--
-- Conventions used throughout the schema:
--   • BIGINT UNSIGNED surrogate key for joins; ULID `public_id` for anything exposed
--     in a URL or API, so ids are not enumerable.
--   • created_at / updated_at on every table; deleted_at on every user-owned table.
--     Deletion is always soft (ADR-012) — nothing user-owned is ever hard deleted.
--   • Foreign keys never CASCADE onto user content. Removing a parent must not
--     silently erase a child row.
--   • utf8mb4_unicode_ci throughout.

CREATE TABLE users (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id         CHAR(26)        NOT NULL,
  username          VARCHAR(30)     NOT NULL,
  email             VARCHAR(191)    NOT NULL,
  email_verified_at DATETIME(3)     NULL,
  password_hash     VARCHAR(255)    NOT NULL,
  account_category  ENUM('individual','business') NOT NULL DEFAULT 'individual',
  account_type      VARCHAR(32)     NOT NULL DEFAULT 'normal',
  verification_tier ENUM('none','individual','creator','business') NOT NULL DEFAULT 'none',
  status            ENUM('active','suspended','banned','frozen') NOT NULL DEFAULT 'active',
  status_reason     VARCHAR(500)    NULL,
  country_code      CHAR(2)         NULL,
  language          VARCHAR(10)     NOT NULL DEFAULT 'en',
  last_active_at    DATETIME(3)     NULL,
  created_at        DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at        DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at        DATETIME(3)     NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_public_id (public_id),
  UNIQUE KEY uq_users_username (username),
  UNIQUE KEY uq_users_email (email),
  KEY idx_users_status (status),
  KEY idx_users_country (country_code),
  -- "creators active in the last N days", used by admin and the exploration pool
  KEY idx_users_last_active (last_active_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE user_profiles (
  user_id         BIGINT UNSIGNED NOT NULL,
  display_name    VARCHAR(60)     NOT NULL DEFAULT '',
  bio             VARCHAR(500)    NOT NULL DEFAULT '',
  avatar_url      VARCHAR(500)    NULL,
  links           JSON            NULL,
  is_private      TINYINT(1)      NOT NULL DEFAULT 0,
  -- Denormalised counters. Source of truth is the underlying tables; these are
  -- maintained by workers so profile reads never aggregate.
  follower_count  BIGINT UNSIGNED NOT NULL DEFAULT 0,
  following_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  video_count     BIGINT UNSIGNED NOT NULL DEFAULT 0,
  like_count      BIGINT UNSIGNED NOT NULL DEFAULT 0,
  created_at      DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at      DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at      DATETIME(3)     NULL,
  PRIMARY KEY (user_id),
  KEY idx_profiles_followers (follower_count),
  CONSTRAINT fk_profiles_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE business_profiles (
  user_id          BIGINT UNSIGNED NOT NULL,
  business_category VARCHAR(80)    NULL,
  website          VARCHAR(255)    NULL,
  contact_email    VARCHAR(191)    NULL,
  contact_phone    VARCHAR(40)     NULL,
  cta_label        VARCHAR(40)     NULL,
  cta_url          VARCHAR(500)    NULL,
  created_at       DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at       DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at       DATETIME(3)     NULL,
  PRIMARY KEY (user_id),
  CONSTRAINT fk_business_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE user_devices (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id       BIGINT UNSIGNED NOT NULL,
  device_id     VARCHAR(128)    NOT NULL,
  platform      ENUM('ios','android','web') NOT NULL,
  push_token    VARCHAR(255)    NULL,
  app_version   VARCHAR(20)     NULL,
  last_seen_at  DATETIME(3)     NULL,
  created_at    DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at    DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at    DATETIME(3)     NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_device (user_id, device_id),
  KEY idx_devices_push (push_token),
  CONSTRAINT fk_devices_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Refresh-token families. Reuse of a rotated token revokes the whole family.
CREATE TABLE user_sessions (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id           BIGINT UNSIGNED NOT NULL,
  device_id         BIGINT UNSIGNED NULL,
  family_id         CHAR(26)        NOT NULL,
  refresh_token_hash CHAR(64)       NOT NULL,
  ip                VARBINARY(16)   NULL,
  user_agent        VARCHAR(255)    NULL,
  expires_at        DATETIME(3)     NOT NULL,
  revoked_at        DATETIME(3)     NULL,
  revoked_reason    VARCHAR(120)    NULL,
  created_at        DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at        DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at        DATETIME(3)     NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_refresh_hash (refresh_token_hash),
  KEY idx_sessions_user (user_id, revoked_at),
  KEY idx_sessions_family (family_id),
  KEY idx_sessions_expiry (expires_at),
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT fk_sessions_device FOREIGN KEY (device_id) REFERENCES user_devices (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- OTP codes are single-use, short-lived and rate limited. The code itself is hashed.
CREATE TABLE otp_codes (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  email       VARCHAR(191)    NOT NULL,
  purpose     ENUM('signup','reset','login','email_change') NOT NULL,
  code_hash   CHAR(64)        NOT NULL,
  attempts    TINYINT UNSIGNED NOT NULL DEFAULT 0,
  consumed_at DATETIME(3)     NULL,
  expires_at  DATETIME(3)     NOT NULL,
  created_at  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_otp_lookup (email, purpose, consumed_at),
  KEY idx_otp_expiry (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE login_attempts (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  email       VARCHAR(191)    NULL,
  user_id     BIGINT UNSIGNED NULL,
  ip          VARBINARY(16)   NULL,
  successful  TINYINT(1)      NOT NULL DEFAULT 0,
  reason      VARCHAR(80)     NULL,
  created_at  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_attempts_email (email, created_at),
  KEY idx_attempts_ip (ip, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Social graph ──

CREATE TABLE follows (
  follower_id BIGINT UNSIGNED NOT NULL,
  followee_id BIGINT UNSIGNED NOT NULL,
  created_at  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  deleted_at  DATETIME(3)     NULL,
  PRIMARY KEY (follower_id, followee_id),
  -- "who follows X", used when fanning a new video to the priority audience
  KEY idx_follows_followee (followee_id, created_at),
  CONSTRAINT fk_follows_follower FOREIGN KEY (follower_id) REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT fk_follows_followee FOREIGN KEY (followee_id) REFERENCES users (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE blocks (
  blocker_id BIGINT UNSIGNED NOT NULL,
  blocked_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  deleted_at DATETIME(3)     NULL,
  PRIMARY KEY (blocker_id, blocked_id),
  KEY idx_blocks_blocked (blocked_id),
  CONSTRAINT fk_blocks_blocker FOREIGN KEY (blocker_id) REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT fk_blocks_blocked FOREIGN KEY (blocked_id) REFERENCES users (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
