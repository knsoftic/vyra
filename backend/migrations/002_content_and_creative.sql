-- 002 — Videos, drafts, sounds and the admin-managed creative catalogue

CREATE TABLE categories (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  slug        VARCHAR(60)     NOT NULL,
  name        VARCHAR(80)     NOT NULL,
  icon        VARCHAR(60)     NULL,
  color       CHAR(7)         NULL,
  parent_id   BIGINT UNSIGNED NULL,
  sort_order  INT UNSIGNED    NOT NULL DEFAULT 0,
  is_enabled  TINYINT(1)      NOT NULL DEFAULT 1,
  created_at  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_categories_slug (slug),
  KEY idx_categories_parent (parent_id),
  CONSTRAINT fk_categories_parent FOREIGN KEY (parent_id) REFERENCES categories (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE hashtags (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tag           VARCHAR(80)     NOT NULL,
  status        ENUM('normal','official','sponsored','restricted','blocked') NOT NULL DEFAULT 'normal',
  is_featured   TINYINT(1)      NOT NULL DEFAULT 0,
  video_count   BIGINT UNSIGNED NOT NULL DEFAULT 0,
  view_count    BIGINT UNSIGNED NOT NULL DEFAULT 0,
  created_at    DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at    DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_hashtags_tag (tag),
  KEY idx_hashtags_trending (status, view_count)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE music_tracks (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id     CHAR(26)        NOT NULL,
  title         VARCHAR(191)    NOT NULL,
  artist        VARCHAR(191)    NOT NULL,
  category      VARCHAR(60)     NULL,
  audio_url     VARCHAR(500)    NOT NULL,
  cover_url     VARCHAR(500)    NULL,
  duration_sec  INT UNSIGNED    NOT NULL DEFAULT 0,
  licence_status ENUM('licensed','owned','disputed','expired') NOT NULL DEFAULT 'licensed',
  blocked_regions JSON          NULL,
  is_trending   TINYINT(1)      NOT NULL DEFAULT 0,
  is_enabled    TINYINT(1)      NOT NULL DEFAULT 1,
  usage_count   BIGINT UNSIGNED NOT NULL DEFAULT 0,
  created_at    DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at    DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at    DATETIME(3)     NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_music_public_id (public_id),
  KEY idx_music_browse (is_enabled, category, usage_count)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- A "sound" is what a video attaches to: either a library track or the video's
-- own original audio. Keeping it separate lets "use this sound" work for both.
CREATE TABLE sounds (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id      CHAR(26)        NOT NULL,
  music_track_id BIGINT UNSIGNED NULL,
  origin_video_id BIGINT UNSIGNED NULL,
  title          VARCHAR(191)    NOT NULL,
  artist         VARCHAR(191)    NOT NULL,
  is_original    TINYINT(1)      NOT NULL DEFAULT 0,
  usage_count    BIGINT UNSIGNED NOT NULL DEFAULT 0,
  created_at     DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at     DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at     DATETIME(3)     NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_sounds_public_id (public_id),
  KEY idx_sounds_track (music_track_id),
  CONSTRAINT fk_sounds_track FOREIGN KEY (music_track_id) REFERENCES music_tracks (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE videos (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id       CHAR(26)        NOT NULL,
  user_id         BIGINT UNSIGNED NOT NULL,
  sound_id        BIGINT UNSIGNED NULL,
  category_id     BIGINT UNSIGNED NULL,
  caption         VARCHAR(2200)   NOT NULL DEFAULT '',
  duration_sec    DECIMAL(8,2)    NOT NULL DEFAULT 0,
  privacy         ENUM('public','followers','friends','private') NOT NULL DEFAULT 'public',
  status          ENUM('uploading','processing','published','restricted','removed','failed') NOT NULL DEFAULT 'uploading',
  -- Interaction settings the creator controls
  allow_comments  TINYINT(1)      NOT NULL DEFAULT 1,
  allow_share     TINYINT(1)      NOT NULL DEFAULT 1,
  allow_download  TINYINT(1)      NOT NULL DEFAULT 1,
  allow_remix     TINYINT(1)      NOT NULL DEFAULT 1,
  allow_duet      TINYINT(1)      NOT NULL DEFAULT 1,
  location_name   VARCHAR(120)    NULL,
  -- Denormalised counters, maintained by workers from the event tables
  view_count      BIGINT UNSIGNED NOT NULL DEFAULT 0,
  like_count      BIGINT UNSIGNED NOT NULL DEFAULT 0,
  comment_count   BIGINT UNSIGNED NOT NULL DEFAULT 0,
  share_count     BIGINT UNSIGNED NOT NULL DEFAULT 0,
  save_count      BIGINT UNSIGNED NOT NULL DEFAULT 0,
  -- Distribution ladder L1–L5 (PHASE_07)
  distribution_level TINYINT UNSIGNED NOT NULL DEFAULT 1,
  is_trending     TINYINT(1)      NOT NULL DEFAULT 0,
  is_featured     TINYINT(1)      NOT NULL DEFAULT 0,
  published_at    DATETIME(3)     NULL,
  created_at      DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at      DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at      DATETIME(3)     NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_videos_public_id (public_id),
  -- Profile grid: a creator's published videos, newest first
  KEY idx_videos_user (user_id, status, published_at),
  -- Candidate generation: fresh public videos by category
  KEY idx_videos_candidates (status, privacy, category_id, published_at),
  KEY idx_videos_trending (is_trending, view_count),
  KEY idx_videos_sound (sound_id),
  KEY idx_videos_processing (status, created_at),
  CONSTRAINT fk_videos_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT fk_videos_sound FOREIGN KEY (sound_id) REFERENCES sounds (id) ON DELETE SET NULL,
  CONSTRAINT fk_videos_category FOREIGN KEY (category_id) REFERENCES categories (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE sounds
  ADD CONSTRAINT fk_sounds_origin FOREIGN KEY (origin_video_id) REFERENCES videos (id) ON DELETE SET NULL;

-- Renditions and thumbnails produced by the transcode pipeline.
CREATE TABLE video_assets (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  video_id     BIGINT UNSIGNED NOT NULL,
  kind         ENUM('original','rendition','thumbnail','cover','hls_manifest','audio','waveform') NOT NULL,
  storage_key  VARCHAR(500)    NOT NULL,
  width        INT UNSIGNED    NULL,
  height       INT UNSIGNED    NULL,
  bitrate_kbps INT UNSIGNED    NULL,
  size_bytes   BIGINT UNSIGNED NULL,
  label        VARCHAR(20)     NULL,
  created_at   DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  deleted_at   DATETIME(3)     NULL,
  PRIMARY KEY (id),
  KEY idx_assets_video (video_id, kind),
  CONSTRAINT fk_assets_video FOREIGN KEY (video_id) REFERENCES videos (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE video_hashtags (
  video_id   BIGINT UNSIGNED NOT NULL,
  hashtag_id BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (video_id, hashtag_id),
  KEY idx_video_hashtags_tag (hashtag_id, video_id),
  CONSTRAINT fk_vh_video FOREIGN KEY (video_id) REFERENCES videos (id) ON DELETE RESTRICT,
  CONSTRAINT fk_vh_hashtag FOREIGN KEY (hashtag_id) REFERENCES hashtags (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE video_mentions (
  video_id BIGINT UNSIGNED NOT NULL,
  user_id  BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (video_id, user_id),
  KEY idx_mentions_user (user_id),
  CONSTRAINT fk_vm_video FOREIGN KEY (video_id) REFERENCES videos (id) ON DELETE RESTRICT,
  CONSTRAINT fk_vm_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Drafts are user data and survive app updates (PHASE_04). The edit decision list
-- is stored as JSON so the server render matches what the device previewed.
CREATE TABLE video_drafts (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id    CHAR(26)        NOT NULL,
  user_id      BIGINT UNSIGNED NOT NULL,
  caption      VARCHAR(2200)   NOT NULL DEFAULT '',
  edit_list    JSON            NULL,
  clip_count   INT UNSIGNED    NOT NULL DEFAULT 0,
  duration_sec DECIMAL(8,2)    NOT NULL DEFAULT 0,
  cover_key    VARCHAR(500)    NULL,
  created_at   DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at   DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at   DATETIME(3)     NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_drafts_public_id (public_id),
  KEY idx_drafts_user (user_id, updated_at),
  CONSTRAINT fk_drafts_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Admin-managed creative catalogue (changes without an app release) ──

CREATE TABLE creative_assets (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  kind        ENUM('filter','effect','sticker_pack','text_style') NOT NULL,
  slug        VARCHAR(60)     NOT NULL,
  name        VARCHAR(80)     NOT NULL,
  category    VARCHAR(40)     NULL,
  -- Shader parameters / pack contents, shape depends on `kind`
  params      JSON            NULL,
  sort_order  INT UNSIGNED    NOT NULL DEFAULT 0,
  is_enabled  TINYINT(1)      NOT NULL DEFAULT 1,
  is_trending TINYINT(1)      NOT NULL DEFAULT 0,
  is_new      TINYINT(1)      NOT NULL DEFAULT 0,
  is_premium  TINYINT(1)      NOT NULL DEFAULT 0,
  usage_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  created_at  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_creative_slug (kind, slug),
  KEY idx_creative_browse (kind, is_enabled, sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
