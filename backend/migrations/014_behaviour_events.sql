-- 014 — Behaviour events, segments and audience profiles
--
-- `watch_events` and `impressions` already exist from 003. This adds the general
-- event log for everything else in the taxonomy, plus the columns segmentation
-- needs in order to decay rather than lock a user into a category forever.
--
-- Exactly-once delivery works through `(dedupe_key, created_at)`. The partition
-- key has to be part of every unique index on a partitioned table, which is why
-- `created_at` appears — and it is why the server stores the *client's* event
-- timestamp rather than arrival time. A retry then carries an identical key and
-- an identical timestamp, so the duplicate is rejected by the index. Using
-- arrival time would let the same event in twice under retry.

CREATE TABLE behaviour_events (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id      BIGINT UNSIGNED NOT NULL,
  event        VARCHAR(32)     NOT NULL,
  video_id     BIGINT UNSIGNED NULL,
  creator_id   BIGINT UNSIGNED NULL,
  category_id  BIGINT UNSIGNED NULL,
  hashtag_id   BIGINT UNSIGNED NULL,
  session_id   CHAR(26)        NULL,
  feed_source  VARCHAR(20)     NULL,
  -- Free-form, but written through an allowlist so no sensitive field can land
  -- here even if a client sends one (ADR-008).
  detail       JSON            NULL,
  app_version  VARCHAR(20)     NULL,
  device_tier  ENUM('low','mid','high') NULL,
  dedupe_key   CHAR(32)        NOT NULL,
  created_at   DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id, created_at),
  -- The exactly-once guarantee.
  UNIQUE KEY uq_behaviour_dedupe (dedupe_key, created_at),
  -- "what has this user done lately" — interest profile rebuilds
  KEY idx_behaviour_user (user_id, created_at),
  -- "who engaged with this creator" — affinity and priority audience
  KEY idx_behaviour_creator (creator_id, event, created_at),
  KEY idx_behaviour_video (video_id, event, created_at),
  KEY idx_behaviour_event (event, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
PARTITION BY RANGE (TO_DAYS(created_at)) (
  PARTITION p_start VALUES LESS THAN (740225),
  PARTITION p_max   VALUES LESS THAN MAXVALUE
);

-- Segment membership decays without reinforcement, so a user is never locked
-- into a category they engaged with once.
ALTER TABLE user_segments
  ADD COLUMN last_reinforced_at DATETIME(3) NULL,
  ADD COLUMN signal_count INT UNSIGNED NOT NULL DEFAULT 0;

-- Which audience a video actually resonates with, observed rather than declared.
CREATE TABLE video_audience_profiles (
  video_id    BIGINT UNSIGNED NOT NULL,
  segment_id  BIGINT UNSIGNED NOT NULL,
  -- 0..1 share of positive engagement coming from this segment.
  weight      DECIMAL(6,4)    NOT NULL DEFAULT 0,
  sample_size INT UNSIGNED    NOT NULL DEFAULT 0,
  updated_at  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (video_id, segment_id),
  KEY idx_vap_segment (segment_id, weight),
  CONSTRAINT fk_vap_video FOREIGN KEY (video_id) REFERENCES videos (id) ON DELETE RESTRICT,
  CONSTRAINT fk_vap_segment FOREIGN KEY (segment_id) REFERENCES audience_segments (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tracks when each derived profile was last rebuilt, so the worker can process
-- the stalest first instead of rescanning everything.
CREATE TABLE profile_rebuild_queue (
  user_id       BIGINT UNSIGNED NOT NULL,
  reason        VARCHAR(40)     NOT NULL DEFAULT 'signal',
  queued_at     DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  processed_at  DATETIME(3)     NULL,
  PRIMARY KEY (user_id),
  KEY idx_rebuild_pending (processed_at, queued_at),
  CONSTRAINT fk_rebuild_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
