-- 011 — Resumable uploads, render jobs and edit lists
--
-- Uploads are chunked so a large video survives a network change or an app
-- restart. The session records what has arrived; a resuming client asks which
-- chunks are missing and sends only those.
--
-- Rendering is a queue rather than a request: transcoding takes far longer than
-- an HTTP request should, and a publish must not be lost because a phone
-- backgrounded itself.

CREATE TABLE upload_sessions (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id     CHAR(26)        NOT NULL,
  user_id       BIGINT UNSIGNED NOT NULL,
  kind          ENUM('video','image','audio') NOT NULL DEFAULT 'video',
  filename      VARCHAR(255)    NOT NULL,
  content_type  VARCHAR(100)    NOT NULL,
  size_bytes    BIGINT UNSIGNED NOT NULL,
  duration_ms   BIGINT UNSIGNED NULL,
  chunk_size    INT UNSIGNED    NOT NULL,
  total_chunks  INT UNSIGNED    NOT NULL,
  -- Where the assembled file lands once every chunk has arrived.
  storage_key   VARCHAR(500)    NOT NULL,
  checksum      CHAR(64)        NULL,
  status        ENUM('pending','uploading','complete','aborted','expired') NOT NULL DEFAULT 'pending',
  -- Abandoned sessions are swept by a job; the row is kept for accounting.
  expires_at    DATETIME(3)     NOT NULL,
  completed_at  DATETIME(3)     NULL,
  created_at    DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at    DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at    DATETIME(3)     NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_upload_public_id (public_id),
  -- "my in-flight uploads", and the sweeper's "what has expired"
  KEY idx_upload_user (user_id, status, created_at),
  KEY idx_upload_expiry (status, expires_at),
  CONSTRAINT fk_upload_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- One row per chunk actually stored. The unique key makes a re-sent chunk a
-- no-op rather than a duplicate, which is what allows a blind retry after a
-- dropped connection.
CREATE TABLE upload_chunks (
  session_id  BIGINT UNSIGNED NOT NULL,
  chunk_index INT UNSIGNED    NOT NULL,
  size_bytes  INT UNSIGNED    NOT NULL,
  checksum    CHAR(64)        NULL,
  created_at  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (session_id, chunk_index),
  CONSTRAINT fk_chunk_session FOREIGN KEY (session_id) REFERENCES upload_sessions (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE render_jobs (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id     CHAR(26)        NOT NULL,
  user_id       BIGINT UNSIGNED NOT NULL,
  video_id      BIGINT UNSIGNED NULL,
  -- The complete edit list this render was built from, so a failed job can be
  -- retried and a finished video can be re-rendered at a different quality.
  edit_list     LONGTEXT        NOT NULL,
  status        ENUM('queued','rendering','complete','failed','cancelled') NOT NULL DEFAULT 'queued',
  progress      TINYINT UNSIGNED NOT NULL DEFAULT 0,
  attempts      TINYINT UNSIGNED NOT NULL DEFAULT 0,
  -- The generated filter graph, kept for debugging a bad render.
  filter_graph  TEXT            NULL,
  output_key    VARCHAR(500)    NULL,
  error         VARCHAR(1000)   NULL,
  started_at    DATETIME(3)     NULL,
  finished_at   DATETIME(3)     NULL,
  created_at    DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at    DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_render_public_id (public_id),
  -- The worker's claim query: oldest queued job first
  KEY idx_render_queue (status, created_at),
  KEY idx_render_user (user_id, created_at),
  KEY idx_render_video (video_id),
  CONSTRAINT fk_render_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT fk_render_video FOREIGN KEY (video_id) REFERENCES videos (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- The edit list that produced a published video. Kept so the video can be
-- re-rendered later without the original device.
ALTER TABLE videos
  ADD COLUMN edit_list LONGTEXT NULL,
  ADD COLUMN render_status ENUM('none','queued','rendering','complete','failed')
      NOT NULL DEFAULT 'none';

-- A user's saved music. Separate from usage_count, which is platform-wide.
CREATE TABLE music_favourites (
  user_id    BIGINT UNSIGNED NOT NULL,
  track_id   BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (user_id, track_id),
  KEY idx_music_fav_track (track_id),
  CONSTRAINT fk_mf_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT fk_mf_track FOREIGN KEY (track_id) REFERENCES music_tracks (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
