-- 015 — Recommendation engine
--
-- `ranking_weights`, `video_embeddings`, `video_stats_hourly`, `experiments` and
-- `videos.distribution_level` already exist from 003. This adds what progressive
-- distribution and model rollback need on top.

-- Every promotion or demotion between distribution levels, with the numbers that
-- justified it. Progressive distribution decides who sees a video, so "why did
-- this video stop being shown" has to be answerable months later.
CREATE TABLE distribution_events (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  video_id     BIGINT UNSIGNED NOT NULL,
  from_level   TINYINT UNSIGNED NOT NULL,
  to_level     TINYINT UNSIGNED NOT NULL,
  reason       ENUM('promoted','demoted','held','seeded','suppressed','manual') NOT NULL,
  -- The metrics as they stood at the moment of the decision.
  impressions  BIGINT UNSIGNED NOT NULL DEFAULT 0,
  views        BIGINT UNSIGNED NOT NULL DEFAULT 0,
  completion_rate DECIMAL(6,4) NOT NULL DEFAULT 0,
  engagement_rate DECIMAL(6,4) NOT NULL DEFAULT 0,
  quick_skip_rate DECIMAL(6,4) NOT NULL DEFAULT 0,
  detail       JSON            NULL,
  admin_id     BIGINT UNSIGNED NULL,
  created_at   DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_dist_video (video_id, created_at),
  KEY idx_dist_reason (reason, created_at),
  CONSTRAINT fk_dist_video FOREIGN KEY (video_id) REFERENCES videos (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Ranking model versions, so a bad model can be rolled back from the panel
-- rather than by a deploy.
CREATE TABLE ranking_models (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  version      VARCHAR(20)     NOT NULL,
  approach     ENUM('rules','content_collaborative','learning_to_rank','two_tower','sequence')
               NOT NULL DEFAULT 'rules',
  status       ENUM('draft','shadow','active','rolled_back','retired') NOT NULL DEFAULT 'draft',
  -- Frozen weights for this version, so activating it restores exactly what was tested.
  config       LONGTEXT        NULL,
  notes        VARCHAR(500)    NULL,
  activated_at DATETIME(3)     NULL,
  retired_at   DATETIME(3)     NULL,
  created_by   BIGINT UNSIGNED NULL,
  created_at   DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at   DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_model_version (version),
  KEY idx_model_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Which videos a user has already been shown.
--
-- `impressions` records every delivery for analytics and is range-partitioned by
-- day, which makes "has this user seen this video" an expensive question. This
-- is the narrow answer to that one question: one row per user/video pair,
-- primary-keyed for a direct lookup, and cheap to sweep.
CREATE TABLE feed_seen (
  user_id    BIGINT UNSIGNED NOT NULL,
  video_id   BIGINT UNSIGNED NOT NULL,
  seen_count SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  last_seen_at DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (user_id, video_id),
  KEY idx_seen_sweep (last_seen_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Rolling performance per video, maintained by the distribution job so the
-- promotion decision does not re-aggregate hourly stats on every pass.
CREATE TABLE video_performance (
  video_id        BIGINT UNSIGNED NOT NULL,
  impressions     BIGINT UNSIGNED NOT NULL DEFAULT 0,
  views           BIGINT UNSIGNED NOT NULL DEFAULT 0,
  completions     BIGINT UNSIGNED NOT NULL DEFAULT 0,
  quick_skips     BIGINT UNSIGNED NOT NULL DEFAULT 0,
  engagements     BIGINT UNSIGNED NOT NULL DEFAULT 0,
  completion_rate DECIMAL(6,4)    NOT NULL DEFAULT 0,
  engagement_rate DECIMAL(6,4)    NOT NULL DEFAULT 0,
  quick_skip_rate DECIMAL(6,4)    NOT NULL DEFAULT 0,
  -- 0–100, recomputed with the metrics.
  fyp_score       TINYINT UNSIGNED NOT NULL DEFAULT 0,
  evaluated_at    DATETIME(3)     NULL,
  updated_at      DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (video_id),
  -- The distribution job's queue: least recently evaluated first.
  KEY idx_perf_evaluated (evaluated_at),
  KEY idx_perf_score (fyp_score),
  CONSTRAINT fk_perf_video FOREIGN KEY (video_id) REFERENCES videos (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
