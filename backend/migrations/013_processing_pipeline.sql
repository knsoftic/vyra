-- 013 — Media processing pipeline
--
-- The pipeline is a sequence of stages (probe, render, transcode, package,
-- thumbnails, audio, quality). Each stage records its own outcome, which is what
-- makes the whole thing idempotent and resumable: a worker killed halfway
-- through picks up at the first stage that is not yet `complete`, and a stage
-- that already ran is never repeated.
--
-- The unique key on (video_id, stage) is the mechanism. Two workers cannot both
-- claim the same stage of the same video.

CREATE TABLE processing_stages (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  video_id     BIGINT UNSIGNED NOT NULL,
  stage        ENUM('probe','render','transcode','package','thumbnails','audio','quality','publish')
               NOT NULL,
  status       ENUM('pending','running','complete','failed','skipped') NOT NULL DEFAULT 'pending',
  attempts     TINYINT UNSIGNED NOT NULL DEFAULT 0,
  -- Whatever the stage produced: a storage key, a probe result, a score.
  output       LONGTEXT        NULL,
  error        VARCHAR(1000)   NULL,
  started_at   DATETIME(3)     NULL,
  finished_at  DATETIME(3)     NULL,
  created_at   DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at   DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  -- One row per stage per video: the idempotency guarantee.
  UNIQUE KEY uq_stage_per_video (video_id, stage),
  -- The worker's "what is left to do" query
  KEY idx_stage_status (status, video_id),
  CONSTRAINT fk_stage_video FOREIGN KEY (video_id) REFERENCES videos (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Technical facts about the source, read once by `probe` and reused by every
-- later stage so nothing has to re-open the file to learn its dimensions.
CREATE TABLE video_probes (
  video_id       BIGINT UNSIGNED NOT NULL,
  container      VARCHAR(40)     NULL,
  video_codec    VARCHAR(40)     NULL,
  audio_codec    VARCHAR(40)     NULL,
  width          INT UNSIGNED    NULL,
  height         INT UNSIGNED    NULL,
  fps            DECIMAL(6,3)    NULL,
  duration_sec   DECIMAL(10,3)   NULL,
  bitrate_kbps   INT UNSIGNED    NULL,
  audio_channels TINYINT UNSIGNED NULL,
  audio_sample_rate INT UNSIGNED NULL,
  has_audio      TINYINT(1)      NOT NULL DEFAULT 0,
  rotation       SMALLINT        NOT NULL DEFAULT 0,
  size_bytes     BIGINT UNSIGNED NULL,
  raw            LONGTEXT        NULL,
  created_at     DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at     DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (video_id),
  CONSTRAINT fk_probe_video FOREIGN KEY (video_id) REFERENCES videos (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Which rendition heights were actually produced, so playback knows what exists
-- without listing storage.
ALTER TABLE videos
  ADD COLUMN processing_status ENUM('pending','processing','complete','failed') NOT NULL DEFAULT 'pending',
  ADD COLUMN hls_key VARCHAR(500) NULL,
  ADD COLUMN poster_key VARCHAR(500) NULL,
  ADD COLUMN width INT UNSIGNED NULL,
  ADD COLUMN height INT UNSIGNED NULL;
