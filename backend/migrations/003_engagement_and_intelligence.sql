-- 003 — Engagement events and the recommendation intelligence layer
--
-- Volume note: watch_events and impressions are the highest-cardinality tables in
-- the system. They are append-only, written through a queue in batches, and are
-- NEVER queried on the feed-serving path — the feed reads aggregates and Redis
-- (ADR-005). They are partitioned by day so old partitions can be archived
-- without a delete.

CREATE TABLE likes (
  user_id    BIGINT UNSIGNED NOT NULL,
  video_id   BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  deleted_at DATETIME(3)     NULL,
  PRIMARY KEY (user_id, video_id),
  -- "who liked this video" — the priority audience for the creator's next upload
  KEY idx_likes_video (video_id, created_at),
  CONSTRAINT fk_likes_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT fk_likes_video FOREIGN KEY (video_id) REFERENCES videos (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE saves (
  user_id    BIGINT UNSIGNED NOT NULL,
  video_id   BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  deleted_at DATETIME(3)     NULL,
  PRIMARY KEY (user_id, video_id),
  KEY idx_saves_video (video_id),
  CONSTRAINT fk_saves_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT fk_saves_video FOREIGN KEY (video_id) REFERENCES videos (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE shares (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id    BIGINT UNSIGNED NOT NULL,
  video_id   BIGINT UNSIGNED NOT NULL,
  channel    VARCHAR(40)     NULL,
  created_at DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_shares_video (video_id, created_at),
  KEY idx_shares_user (user_id),
  CONSTRAINT fk_shares_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT fk_shares_video FOREIGN KEY (video_id) REFERENCES videos (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE comments (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id   CHAR(26)        NOT NULL,
  video_id    BIGINT UNSIGNED NOT NULL,
  user_id     BIGINT UNSIGNED NOT NULL,
  parent_id   BIGINT UNSIGNED NULL,
  body        VARCHAR(1000)   NOT NULL,
  like_count  INT UNSIGNED    NOT NULL DEFAULT 0,
  reply_count INT UNSIGNED    NOT NULL DEFAULT 0,
  is_pinned   TINYINT(1)      NOT NULL DEFAULT 0,
  status      ENUM('visible','held','hidden','removed') NOT NULL DEFAULT 'visible',
  created_at  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at  DATETIME(3)     NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_comments_public_id (public_id),
  -- Comment sheet: top-level comments for a video, newest or most-liked first
  KEY idx_comments_video (video_id, parent_id, status, created_at),
  KEY idx_comments_user (user_id),
  CONSTRAINT fk_comments_video FOREIGN KEY (video_id) REFERENCES videos (id) ON DELETE RESTRICT,
  CONSTRAINT fk_comments_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT fk_comments_parent FOREIGN KEY (parent_id) REFERENCES comments (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE comment_likes (
  user_id    BIGINT UNSIGNED NOT NULL,
  comment_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  deleted_at DATETIME(3)     NULL,
  PRIMARY KEY (user_id, comment_id),
  KEY idx_comment_likes_comment (comment_id),
  CONSTRAINT fk_cl_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT fk_cl_comment FOREIGN KEY (comment_id) REFERENCES comments (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Behaviour events (PHASE_06) ──

-- One row per completed watch. `completion_rate` is stored rather than derived so
-- rollups do not re-divide, and the length-scaled signals (ADR-009) are flags.
CREATE TABLE watch_events (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id        BIGINT UNSIGNED NOT NULL,
  video_id       BIGINT UNSIGNED NOT NULL,
  creator_id     BIGINT UNSIGNED NOT NULL,
  session_id     CHAR(26)        NOT NULL,
  feed_source    ENUM('for_you','following','trending','category','search','profile','promoted','sound','hashtag') NOT NULL,
  watch_ms       INT UNSIGNED    NOT NULL DEFAULT 0,
  video_ms       INT UNSIGNED    NOT NULL DEFAULT 0,
  completion_rate DECIMAL(5,4)   NOT NULL DEFAULT 0,
  reached_2s     TINYINT(1)      NOT NULL DEFAULT 0,
  reached_20s    TINYINT(1)      NOT NULL DEFAULT 0,
  reached_30s    TINYINT(1)      NOT NULL DEFAULT 0,
  completed      TINYINT(1)      NOT NULL DEFAULT 0,
  rewatched      TINYINT(1)      NOT NULL DEFAULT 0,
  quick_skip     TINYINT(1)      NOT NULL DEFAULT 0,
  -- Client-generated, so a retried batch cannot double-count
  dedupe_key     CHAR(32)        NOT NULL,
  created_at     DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id, created_at),
  UNIQUE KEY uq_watch_dedupe (dedupe_key, created_at),
  KEY idx_watch_user (user_id, created_at),
  KEY idx_watch_video (video_id, created_at),
  KEY idx_watch_creator (creator_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
PARTITION BY RANGE (TO_DAYS(created_at)) (
  PARTITION p_start VALUES LESS THAN (TO_DAYS('2026-09-01')),
  PARTITION p_max   VALUES LESS THAN MAXVALUE
);

CREATE TABLE impressions (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id     BIGINT UNSIGNED NOT NULL,
  video_id    BIGINT UNSIGNED NOT NULL,
  session_id  CHAR(26)        NOT NULL,
  feed_source VARCHAR(20)     NOT NULL,
  rank_position SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  -- What the ranker predicted, kept so offline evaluation can score it later
  predicted_score DECIMAL(8,6) NULL,
  model_version VARCHAR(20)   NULL,
  experiment_id VARCHAR(40)   NULL,
  created_at  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id, created_at),
  KEY idx_impressions_user (user_id, created_at),
  KEY idx_impressions_video (video_id, created_at),
  KEY idx_impressions_experiment (experiment_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
PARTITION BY RANGE (TO_DAYS(created_at)) (
  PARTITION p_start VALUES LESS THAN (TO_DAYS('2026-09-01')),
  PARTITION p_max   VALUES LESS THAN MAXVALUE
);

CREATE TABLE negative_signals (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id    BIGINT UNSIGNED NOT NULL,
  video_id   BIGINT UNSIGNED NULL,
  creator_id BIGINT UNSIGNED NULL,
  category_id BIGINT UNSIGNED NULL,
  kind       ENUM('not_interested','hide_creator','quick_skip','unfollow','report') NOT NULL,
  created_at DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_negative_user (user_id, kind, created_at),
  KEY idx_negative_creator (creator_id),
  CONSTRAINT fk_negative_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Hourly rollup the feed and analytics actually read.
CREATE TABLE video_stats_hourly (
  video_id     BIGINT UNSIGNED NOT NULL,
  bucket_hour  DATETIME        NOT NULL,
  impressions  BIGINT UNSIGNED NOT NULL DEFAULT 0,
  views        BIGINT UNSIGNED NOT NULL DEFAULT 0,
  watch_ms     BIGINT UNSIGNED NOT NULL DEFAULT 0,
  completions  BIGINT UNSIGNED NOT NULL DEFAULT 0,
  rewatches    BIGINT UNSIGNED NOT NULL DEFAULT 0,
  likes        BIGINT UNSIGNED NOT NULL DEFAULT 0,
  comments     BIGINT UNSIGNED NOT NULL DEFAULT 0,
  shares       BIGINT UNSIGNED NOT NULL DEFAULT 0,
  saves        BIGINT UNSIGNED NOT NULL DEFAULT 0,
  quick_skips  BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (video_id, bucket_hour),
  KEY idx_stats_bucket (bucket_hour)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Intelligence (PHASE_05 / PHASE_06 / PHASE_07) ──

-- Decomposed, never a single opaque number (ADR-011).
CREATE TABLE video_quality_scores (
  video_id            BIGINT UNSIGNED NOT NULL,
  overall             TINYINT UNSIGNED NOT NULL DEFAULT 0,
  technical           TINYINT UNSIGNED NOT NULL DEFAULT 0,
  content_relevance   TINYINT UNSIGNED NOT NULL DEFAULT 0,
  thumbnail_quality   TINYINT UNSIGNED NOT NULL DEFAULT 0,
  caption_relevance   TINYINT UNSIGNED NOT NULL DEFAULT 0,
  spam_probability    TINYINT UNSIGNED NOT NULL DEFAULT 0,
  duplicate_probability TINYINT UNSIGNED NOT NULL DEFAULT 0,
  safety_status       ENUM('safe','review','restricted') NOT NULL DEFAULT 'safe',
  detail              JSON            NULL,
  model_version       VARCHAR(20)     NULL,
  scored_at           DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (video_id),
  KEY idx_quality_safety (safety_status),
  KEY idx_quality_spam (spam_probability),
  CONSTRAINT fk_quality_video FOREIGN KEY (video_id) REFERENCES videos (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE video_interest_profiles (
  video_id     BIGINT UNSIGNED NOT NULL,
  topics       JSON            NULL,
  objects      JSON            NULL,
  scene        VARCHAR(60)     NULL,
  language     VARCHAR(10)     NULL,
  spoken_text  TEXT            NULL,
  on_screen_text TEXT          NULL,
  model_version VARCHAR(20)    NULL,
  analysed_at  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (video_id),
  CONSTRAINT fk_vip_video FOREIGN KEY (video_id) REFERENCES videos (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE video_embeddings (
  video_id      BIGINT UNSIGNED NOT NULL,
  model_version VARCHAR(20)     NOT NULL,
  embedding     BLOB            NOT NULL,
  dims          SMALLINT UNSIGNED NOT NULL,
  created_at    DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (video_id, model_version),
  CONSTRAINT fk_embed_video FOREIGN KEY (video_id) REFERENCES videos (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Short and long horizon kept separately, combined at ranking time (PHASE_06).
CREATE TABLE user_interest_profiles (
  user_id    BIGINT UNSIGNED NOT NULL,
  horizon    ENUM('short','long') NOT NULL,
  weights    JSON            NOT NULL,
  updated_at DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (user_id, horizon),
  CONSTRAINT fk_uip_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE creator_affinity (
  user_id     BIGINT UNSIGNED NOT NULL,
  creator_id  BIGINT UNSIGNED NOT NULL,
  score       DECIMAL(6,4)    NOT NULL DEFAULT 0,
  last_signal_at DATETIME(3)  NULL,
  updated_at  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (user_id, creator_id),
  -- Candidate pool: this viewer's strongest creators
  KEY idx_affinity_lookup (user_id, score),
  CONSTRAINT fk_affinity_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT fk_affinity_creator FOREIGN KEY (creator_id) REFERENCES users (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE audience_segments (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  slug       VARCHAR(60)     NOT NULL,
  name       VARCHAR(80)     NOT NULL,
  is_enabled TINYINT(1)      NOT NULL DEFAULT 1,
  created_at DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_segments_slug (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- A user belongs to many segments and is never locked into one (PHASE_06).
CREATE TABLE user_segments (
  user_id    BIGINT UNSIGNED NOT NULL,
  segment_id BIGINT UNSIGNED NOT NULL,
  weight     DECIMAL(5,4)    NOT NULL DEFAULT 0,
  updated_at DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (user_id, segment_id),
  KEY idx_user_segments_segment (segment_id, weight),
  CONSTRAINT fk_us_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT fk_us_segment FOREIGN KEY (segment_id) REFERENCES audience_segments (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Ranking weights live in the database, not code, so admins tune without a deploy (ADR-007).
CREATE TABLE ranking_weights (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  weight_key  VARCHAR(40)     NOT NULL,
  value       DECIMAL(8,4)    NOT NULL,
  min_value   DECIMAL(8,4)    NOT NULL DEFAULT 0,
  max_value   DECIMAL(8,4)    NOT NULL DEFAULT 2,
  updated_by  BIGINT UNSIGNED NULL,
  updated_at  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_weight_key (weight_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE experiments (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  experiment_id VARCHAR(40)    NOT NULL,
  hypothesis   VARCHAR(500)    NOT NULL,
  variants     JSON            NOT NULL,
  traffic_split JSON           NOT NULL,
  primary_metric VARCHAR(60)   NOT NULL,
  guardrails   JSON            NULL,
  status       ENUM('draft','running','stopped','shipped','rolled_back') NOT NULL DEFAULT 'draft',
  started_at   DATETIME(3)     NULL,
  ended_at     DATETIME(3)     NULL,
  result       VARCHAR(500)    NULL,
  created_at   DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at   DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_experiment_id (experiment_id),
  KEY idx_experiments_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Deterministic assignment, persisted so it survives restarts and deploys.
CREATE TABLE experiment_assignments (
  experiment_id VARCHAR(40)     NOT NULL,
  user_id       BIGINT UNSIGNED NOT NULL,
  variant       VARCHAR(40)     NOT NULL,
  assigned_at   DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (experiment_id, user_id),
  KEY idx_assignments_user (user_id),
  CONSTRAINT fk_ea_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
