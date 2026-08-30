-- 004 — Chat, groups, communities, calls and live streaming

CREATE TABLE chats (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id   CHAR(26)        NOT NULL,
  kind        ENUM('private','group','community') NOT NULL,
  title       VARCHAR(120)    NULL,
  avatar_url  VARCHAR(500)    NULL,
  description VARCHAR(500)    NULL,
  owner_id    BIGINT UNSIGNED NULL,
  pinned_message_id BIGINT UNSIGNED NULL,
  last_message_at DATETIME(3) NULL,
  member_count INT UNSIGNED   NOT NULL DEFAULT 0,
  created_at  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at  DATETIME(3)     NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_chats_public_id (public_id),
  KEY idx_chats_kind (kind),
  CONSTRAINT fk_chats_owner FOREIGN KEY (owner_id) REFERENCES users (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE chat_participants (
  chat_id       BIGINT UNSIGNED NOT NULL,
  user_id       BIGINT UNSIGNED NOT NULL,
  role          ENUM('owner','admin','moderator','member') NOT NULL DEFAULT 'member',
  is_muted      TINYINT(1)      NOT NULL DEFAULT 0,
  last_read_message_id BIGINT UNSIGNED NULL,
  unread_count  INT UNSIGNED    NOT NULL DEFAULT 0,
  joined_at     DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  left_at       DATETIME(3)     NULL,
  deleted_at    DATETIME(3)     NULL,
  PRIMARY KEY (chat_id, user_id),
  -- Chat list: this user's conversations, most recent first
  KEY idx_participants_user (user_id, left_at),
  CONSTRAINT fk_cp_chat FOREIGN KEY (chat_id) REFERENCES chats (id) ON DELETE RESTRICT,
  CONSTRAINT fk_cp_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE messages (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id     CHAR(26)        NOT NULL,
  chat_id       BIGINT UNSIGNED NOT NULL,
  sender_id     BIGINT UNSIGNED NOT NULL,
  kind          ENUM('text','image','video','document','voice','shared_video','system') NOT NULL DEFAULT 'text',
  body          VARCHAR(4000)   NULL,
  media_key     VARCHAR(500)    NULL,
  file_name     VARCHAR(255)    NULL,
  file_size     BIGINT UNSIGNED NULL,
  duration_sec  INT UNSIGNED    NULL,
  reply_to_id   BIGINT UNSIGNED NULL,
  shared_video_id BIGINT UNSIGNED NULL,
  -- Soft delete distinguishes "hidden from me" vs "removed for everyone"
  deleted_for_all_at DATETIME(3) NULL,
  created_at    DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at    DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at    DATETIME(3)     NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_messages_public_id (public_id),
  -- Message history: cursor pagination within a conversation
  KEY idx_messages_chat (chat_id, id),
  KEY idx_messages_sender (sender_id),
  CONSTRAINT fk_messages_chat FOREIGN KEY (chat_id) REFERENCES chats (id) ON DELETE RESTRICT,
  CONSTRAINT fk_messages_sender FOREIGN KEY (sender_id) REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT fk_messages_reply FOREIGN KEY (reply_to_id) REFERENCES messages (id) ON DELETE SET NULL,
  CONSTRAINT fk_messages_video FOREIGN KEY (shared_video_id) REFERENCES videos (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE chats
  ADD CONSTRAINT fk_chats_pinned FOREIGN KEY (pinned_message_id) REFERENCES messages (id) ON DELETE SET NULL;

CREATE TABLE message_receipts (
  message_id   BIGINT UNSIGNED NOT NULL,
  user_id      BIGINT UNSIGNED NOT NULL,
  delivered_at DATETIME(3)     NULL,
  seen_at      DATETIME(3)     NULL,
  PRIMARY KEY (message_id, user_id),
  KEY idx_receipts_user (user_id),
  CONSTRAINT fk_receipts_message FOREIGN KEY (message_id) REFERENCES messages (id) ON DELETE RESTRICT,
  CONSTRAINT fk_receipts_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Communities ──
--
-- Ordinary members never receive the roster (ADR-014). That is enforced in the
-- service layer, but the schema keeps the member table separate from the chat so
-- a community listing query never accidentally joins it.

CREATE TABLE communities (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id     CHAR(26)        NOT NULL,
  chat_id       BIGINT UNSIGNED NOT NULL,
  name          VARCHAR(120)    NOT NULL,
  logo_url      VARCHAR(500)    NULL,
  banner_url    VARCHAR(500)    NULL,
  description   VARCHAR(1000)   NOT NULL DEFAULT '',
  rules         JSON            NULL,
  is_private    TINYINT(1)      NOT NULL DEFAULT 0,
  owner_id      BIGINT UNSIGNED NOT NULL,
  member_count  BIGINT UNSIGNED NOT NULL DEFAULT 0,
  announcement  VARCHAR(1000)   NULL,
  -- Default permissions for a plain member
  can_post      TINYINT(1)      NOT NULL DEFAULT 1,
  can_comment   TINYINT(1)      NOT NULL DEFAULT 1,
  can_send_media TINYINT(1)     NOT NULL DEFAULT 1,
  can_send_links TINYINT(1)     NOT NULL DEFAULT 0,
  can_invite    TINYINT(1)      NOT NULL DEFAULT 1,
  status        ENUM('active','suspended') NOT NULL DEFAULT 'active',
  created_at    DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at    DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at    DATETIME(3)     NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_communities_public_id (public_id),
  UNIQUE KEY uq_communities_chat (chat_id),
  KEY idx_communities_owner (owner_id),
  CONSTRAINT fk_communities_chat FOREIGN KEY (chat_id) REFERENCES chats (id) ON DELETE RESTRICT,
  CONSTRAINT fk_communities_owner FOREIGN KEY (owner_id) REFERENCES users (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE community_members (
  community_id BIGINT UNSIGNED NOT NULL,
  user_id      BIGINT UNSIGNED NOT NULL,
  role         ENUM('owner','admin','moderator','member') NOT NULL DEFAULT 'member',
  is_banned    TINYINT(1)      NOT NULL DEFAULT 0,
  is_muted     TINYINT(1)      NOT NULL DEFAULT 0,
  joined_at    DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  left_at      DATETIME(3)     NULL,
  deleted_at   DATETIME(3)     NULL,
  PRIMARY KEY (community_id, user_id),
  KEY idx_cm_user (user_id),
  KEY idx_cm_staff (community_id, role),
  CONSTRAINT fk_cm_community FOREIGN KEY (community_id) REFERENCES communities (id) ON DELETE RESTRICT,
  CONSTRAINT fk_cm_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE community_join_requests (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  community_id BIGINT UNSIGNED NOT NULL,
  user_id      BIGINT UNSIGNED NOT NULL,
  message      VARCHAR(500)    NULL,
  status       ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  decided_by   BIGINT UNSIGNED NULL,
  decided_at   DATETIME(3)     NULL,
  created_at   DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  deleted_at   DATETIME(3)     NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_join_request (community_id, user_id),
  KEY idx_join_pending (community_id, status, created_at),
  CONSTRAINT fk_cjr_community FOREIGN KEY (community_id) REFERENCES communities (id) ON DELETE RESTRICT,
  CONSTRAINT fk_cjr_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Calls ──

CREATE TABLE calls (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id    CHAR(26)        NOT NULL,
  chat_id      BIGINT UNSIGNED NULL,
  initiator_id BIGINT UNSIGNED NOT NULL,
  kind         ENUM('voice','video') NOT NULL,
  is_group     TINYINT(1)      NOT NULL DEFAULT 0,
  status       ENUM('ringing','active','ended','missed','declined','failed') NOT NULL DEFAULT 'ringing',
  started_at   DATETIME(3)     NULL,
  ended_at     DATETIME(3)     NULL,
  duration_sec INT UNSIGNED    NOT NULL DEFAULT 0,
  created_at   DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  deleted_at   DATETIME(3)     NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_calls_public_id (public_id),
  KEY idx_calls_initiator (initiator_id, created_at),
  CONSTRAINT fk_calls_initiator FOREIGN KEY (initiator_id) REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT fk_calls_chat FOREIGN KEY (chat_id) REFERENCES chats (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE call_participants (
  call_id   BIGINT UNSIGNED NOT NULL,
  user_id   BIGINT UNSIGNED NOT NULL,
  joined_at DATETIME(3)     NULL,
  left_at   DATETIME(3)     NULL,
  outcome   ENUM('joined','missed','declined') NOT NULL DEFAULT 'missed',
  PRIMARY KEY (call_id, user_id),
  KEY idx_call_participants_user (user_id),
  CONSTRAINT fk_cpart_call FOREIGN KEY (call_id) REFERENCES calls (id) ON DELETE RESTRICT,
  CONSTRAINT fk_cpart_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Live streaming ──

CREATE TABLE live_streams (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id     CHAR(26)        NOT NULL,
  host_id       BIGINT UNSIGNED NOT NULL,
  title         VARCHAR(200)    NOT NULL,
  category      VARCHAR(60)     NULL,
  thumbnail_key VARCHAR(500)    NULL,
  status        ENUM('scheduled','live','ended','stopped_by_admin') NOT NULL DEFAULT 'scheduled',
  allow_comments TINYINT(1)     NOT NULL DEFAULT 1,
  allow_gifts   TINYINT(1)      NOT NULL DEFAULT 1,
  allow_guests  TINYINT(1)      NOT NULL DEFAULT 1,
  viewer_count  INT UNSIGNED    NOT NULL DEFAULT 0,
  peak_viewers  INT UNSIGNED    NOT NULL DEFAULT 0,
  like_count    BIGINT UNSIGNED NOT NULL DEFAULT 0,
  gift_coins    BIGINT UNSIGNED NOT NULL DEFAULT 0,
  started_at    DATETIME(3)     NULL,
  ended_at      DATETIME(3)     NULL,
  ended_reason  VARCHAR(200)    NULL,
  created_at    DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at    DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at    DATETIME(3)     NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_live_public_id (public_id),
  -- Live list: currently live streams by category, busiest first
  KEY idx_live_active (status, category, viewer_count),
  KEY idx_live_host (host_id, created_at),
  CONSTRAINT fk_live_host FOREIGN KEY (host_id) REFERENCES users (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE live_viewers (
  stream_id BIGINT UNSIGNED NOT NULL,
  user_id   BIGINT UNSIGNED NOT NULL,
  joined_at DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  left_at   DATETIME(3)     NULL,
  is_banned TINYINT(1)      NOT NULL DEFAULT 0,
  is_guest  TINYINT(1)      NOT NULL DEFAULT 0,
  PRIMARY KEY (stream_id, user_id),
  KEY idx_live_viewers_user (user_id),
  CONSTRAINT fk_lv_stream FOREIGN KEY (stream_id) REFERENCES live_streams (id) ON DELETE RESTRICT,
  CONSTRAINT fk_lv_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE live_comments (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  stream_id  BIGINT UNSIGNED NOT NULL,
  user_id    BIGINT UNSIGNED NOT NULL,
  body       VARCHAR(500)    NOT NULL,
  kind       ENUM('comment','join','gift','follow','system') NOT NULL DEFAULT 'comment',
  created_at DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  deleted_at DATETIME(3)     NULL,
  PRIMARY KEY (id),
  KEY idx_live_comments_stream (stream_id, id),
  CONSTRAINT fk_lc_stream FOREIGN KEY (stream_id) REFERENCES live_streams (id) ON DELETE RESTRICT,
  CONSTRAINT fk_lc_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
