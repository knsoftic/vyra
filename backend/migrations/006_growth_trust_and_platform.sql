-- 006 — Promotion and ads, trust and safety, and platform configuration

-- ── Promotion and advertising ──

CREATE TABLE campaigns (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id      CHAR(26)        NOT NULL,
  user_id        BIGINT UNSIGNED NOT NULL,
  video_id       BIGINT UNSIGNED NULL,
  name           VARCHAR(120)    NOT NULL,
  kind           ENUM('promotion','campaign') NOT NULL DEFAULT 'promotion',
  objective      ENUM('awareness','reach','video_views','engagement','followers',
                      'profile_visits','website_traffic','leads','app_promotion') NOT NULL,
  status         ENUM('draft','pending_review','active','paused','completed','rejected') NOT NULL DEFAULT 'draft',
  budget_coins   BIGINT UNSIGNED NOT NULL,
  spent_coins    BIGINT UNSIGNED NOT NULL DEFAULT 0,
  daily_cap_coins BIGINT UNSIGNED NULL,
  duration_days  SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  cta_label      VARCHAR(40)     NULL,
  destination_url VARCHAR(500)   NULL,
  starts_at      DATETIME(3)     NULL,
  ends_at        DATETIME(3)     NULL,
  decided_by     BIGINT UNSIGNED NULL,
  decision_note  VARCHAR(500)    NULL,
  created_at     DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at     DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at     DATETIME(3)     NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_campaigns_public_id (public_id),
  KEY idx_campaigns_user (user_id, created_at),
  -- Delivery: active campaigns with budget left
  KEY idx_campaigns_delivery (status, ends_at),
  KEY idx_campaigns_review (status, created_at),
  CONSTRAINT fk_campaigns_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT fk_campaigns_video FOREIGN KEY (video_id) REFERENCES videos (id) ON DELETE RESTRICT,
  -- Spend can never exceed the budget. Enforced here as well as in the service.
  CONSTRAINT chk_campaign_budget CHECK (spent_coins <= budget_coins)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE campaign_targeting (
  campaign_id BIGINT UNSIGNED NOT NULL,
  mode        ENUM('automatic','custom','broad') NOT NULL DEFAULT 'automatic',
  countries   JSON            NULL,
  cities      JSON            NULL,
  languages   JSON            NULL,
  interests   JSON            NULL,
  categories  JSON            NULL,
  devices     JSON            NULL,
  os          JSON            NULL,
  age_min     TINYINT UNSIGNED NULL,
  age_max     TINYINT UNSIGNED NULL,
  updated_at  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (campaign_id),
  CONSTRAINT fk_targeting_campaign FOREIGN KEY (campaign_id) REFERENCES campaigns (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE campaign_analytics (
  campaign_id   BIGINT UNSIGNED NOT NULL,
  bucket_hour   DATETIME        NOT NULL,
  impressions   BIGINT UNSIGNED NOT NULL DEFAULT 0,
  reach         BIGINT UNSIGNED NOT NULL DEFAULT 0,
  views         BIGINT UNSIGNED NOT NULL DEFAULT 0,
  clicks        BIGINT UNSIGNED NOT NULL DEFAULT 0,
  engagements   BIGINT UNSIGNED NOT NULL DEFAULT 0,
  followers     BIGINT UNSIGNED NOT NULL DEFAULT 0,
  profile_visits BIGINT UNSIGNED NOT NULL DEFAULT 0,
  spent_coins   BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (campaign_id, bucket_hour),
  CONSTRAINT fk_analytics_campaign FOREIGN KEY (campaign_id) REFERENCES campaigns (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE banners (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  title       VARCHAR(120)    NOT NULL,
  subtitle    VARCHAR(255)    NULL,
  image_key   VARCHAR(500)    NULL,
  cta_label   VARCHAR(40)     NULL,
  cta_url     VARCHAR(500)    NULL,
  placement   ENUM('explore_top','home_promo','campaign_banner') NOT NULL,
  status      ENUM('draft','scheduled','live','ended') NOT NULL DEFAULT 'draft',
  starts_at   DATETIME(3)     NULL,
  ends_at     DATETIME(3)     NULL,
  impressions BIGINT UNSIGNED NOT NULL DEFAULT 0,
  clicks      BIGINT UNSIGNED NOT NULL DEFAULT 0,
  created_at  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_banners_live (placement, status, starts_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Trust and safety ──

CREATE TABLE verification_requests (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id    CHAR(26)        NOT NULL,
  user_id      BIGINT UNSIGNED NOT NULL,
  tier         ENUM('individual','creator','business') NOT NULL,
  status       ENUM('pending','reviewing','more_info','approved','rejected') NOT NULL DEFAULT 'pending',
  note         VARCHAR(1000)   NULL,
  decided_by   BIGINT UNSIGNED NULL,
  decided_at   DATETIME(3)     NULL,
  created_at   DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at   DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at   DATETIME(3)     NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_vr_public_id (public_id),
  KEY idx_vr_queue (status, created_at),
  KEY idx_vr_user (user_id),
  CONSTRAINT fk_vr_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Identity documents. Access is restricted to the verification role and audited;
-- the storage key points at a bucket with a short retention policy.
CREATE TABLE verification_documents (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  request_id  BIGINT UNSIGNED NOT NULL,
  kind        VARCHAR(40)     NOT NULL,
  storage_key VARCHAR(500)    NOT NULL,
  created_at  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  deleted_at  DATETIME(3)     NULL,
  PRIMARY KEY (id),
  KEY idx_vdocs_request (request_id),
  CONSTRAINT fk_vdocs_request FOREIGN KEY (request_id) REFERENCES verification_requests (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE reports (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id     CHAR(26)        NOT NULL,
  reporter_id   BIGINT UNSIGNED NULL,
  target_type   ENUM('user','video','comment','live','community','group','message') NOT NULL,
  target_id     BIGINT UNSIGNED NOT NULL,
  reason        VARCHAR(80)     NOT NULL,
  detail        VARCHAR(1000)   NULL,
  severity      ENUM('low','medium','high','critical') NOT NULL DEFAULT 'low',
  status        ENUM('pending','reviewing','actioned','dismissed') NOT NULL DEFAULT 'pending',
  -- Advisory only — AI queues and prioritises, a human decides (PHASE_11)
  ai_flag       VARCHAR(80)     NULL,
  ai_confidence DECIMAL(5,4)    NULL,
  decided_by    BIGINT UNSIGNED NULL,
  decided_at    DATETIME(3)     NULL,
  created_at    DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at    DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at    DATETIME(3)     NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_reports_public_id (public_id),
  -- Moderation queue: pending by severity then age
  KEY idx_reports_queue (status, severity, created_at),
  KEY idx_reports_target (target_type, target_id),
  KEY idx_reports_reporter (reporter_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE moderation_actions (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  report_id   BIGINT UNSIGNED NULL,
  admin_id    BIGINT UNSIGNED NOT NULL,
  target_type VARCHAR(20)     NOT NULL,
  target_id   BIGINT UNSIGNED NOT NULL,
  action      ENUM('no_action','warning','content_removal','restrict_distribution',
                   'temporary_restriction','suspension','permanent_ban','reinstate') NOT NULL,
  reason      VARCHAR(1000)   NOT NULL,
  expires_at  DATETIME(3)     NULL,
  reverted_at DATETIME(3)     NULL,
  created_at  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_mod_target (target_type, target_id, created_at),
  KEY idx_mod_admin (admin_id, created_at),
  CONSTRAINT fk_mod_report FOREIGN KEY (report_id) REFERENCES reports (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE support_tickets (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id   CHAR(26)        NOT NULL,
  user_id     BIGINT UNSIGNED NOT NULL,
  subject     VARCHAR(200)    NOT NULL,
  category    ENUM('account','payment','coins','video','verification','advertisement','technical') NOT NULL,
  priority    ENUM('low','medium','high') NOT NULL DEFAULT 'low',
  status      ENUM('open','in_progress','waiting','resolved','closed') NOT NULL DEFAULT 'open',
  assignee_id BIGINT UNSIGNED NULL,
  created_at  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at  DATETIME(3)     NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_tickets_public_id (public_id),
  KEY idx_tickets_queue (status, priority, created_at),
  KEY idx_tickets_user (user_id),
  CONSTRAINT fk_tickets_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE ticket_messages (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  ticket_id   BIGINT UNSIGNED NOT NULL,
  author_id   BIGINT UNSIGNED NOT NULL,
  is_staff    TINYINT(1)      NOT NULL DEFAULT 0,
  -- Internal notes are never shown to the user
  is_internal TINYINT(1)      NOT NULL DEFAULT 0,
  body        TEXT            NOT NULL,
  created_at  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  deleted_at  DATETIME(3)     NULL,
  PRIMARY KEY (id),
  KEY idx_ticket_messages (ticket_id, created_at),
  CONSTRAINT fk_tm_ticket FOREIGN KEY (ticket_id) REFERENCES support_tickets (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Platform ──

CREATE TABLE admin_users (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id     CHAR(26)        NOT NULL,
  name          VARCHAR(120)    NOT NULL,
  email         VARCHAR(191)    NOT NULL,
  password_hash VARCHAR(255)    NOT NULL,
  role_id       BIGINT UNSIGNED NOT NULL,
  two_factor_secret VARCHAR(255) NULL,
  two_factor_enabled TINYINT(1) NOT NULL DEFAULT 0,
  status        ENUM('active','disabled') NOT NULL DEFAULT 'active',
  last_login_at DATETIME(3)     NULL,
  created_at    DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at    DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at    DATETIME(3)     NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_admin_public_id (public_id),
  UNIQUE KEY uq_admin_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE roles (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  slug        VARCHAR(40)     NOT NULL,
  name        VARCHAR(80)     NOT NULL,
  is_system   TINYINT(1)      NOT NULL DEFAULT 0,
  created_at  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_roles_slug (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE admin_users
  ADD CONSTRAINT fk_admin_role FOREIGN KEY (role_id) REFERENCES roles (id) ON DELETE RESTRICT;

CREATE TABLE role_permissions (
  role_id BIGINT UNSIGNED NOT NULL,
  module  VARCHAR(40)     NOT NULL,
  action  VARCHAR(30)     NOT NULL,
  PRIMARY KEY (role_id, module, action),
  CONSTRAINT fk_rp_role FOREIGN KEY (role_id) REFERENCES roles (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE feature_flags (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  flag_key    VARCHAR(60)     NOT NULL,
  label       VARCHAR(120)    NOT NULL,
  description VARCHAR(500)    NULL,
  is_enabled  TINYINT(1)      NOT NULL DEFAULT 0,
  rollout_percent TINYINT UNSIGNED NOT NULL DEFAULT 0,
  updated_by  BIGINT UNSIGNED NULL,
  created_at  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_flags_key (flag_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Database-backed config, cached in Redis with explicit invalidation on write.
CREATE TABLE system_settings (
  setting_key VARCHAR(80)     NOT NULL,
  value       JSON            NOT NULL,
  scope       VARCHAR(40)     NOT NULL DEFAULT 'global',
  updated_by  BIGINT UNSIGNED NULL,
  updated_at  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (setting_key, scope)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE country_settings (
  code            CHAR(2)      NOT NULL,
  name            VARCHAR(80)  NOT NULL,
  currency        CHAR(4)      NOT NULL DEFAULT 'USD',
  is_enabled      TINYINT(1)   NOT NULL DEFAULT 1,
  ads_enabled     TINYINT(1)   NOT NULL DEFAULT 1,
  business_enabled TINYINT(1)  NOT NULL DEFAULT 1,
  verification_enabled TINYINT(1) NOT NULL DEFAULT 1,
  updated_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE notifications (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id     BIGINT UNSIGNED NOT NULL,
  kind        ENUM('like','comment','follow','mention','gift','system','verification','campaign','task') NOT NULL,
  actor_id    BIGINT UNSIGNED NULL,
  body        VARCHAR(500)    NOT NULL,
  target_type VARCHAR(20)     NULL,
  target_id   BIGINT UNSIGNED NULL,
  read_at     DATETIME(3)     NULL,
  created_at  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  deleted_at  DATETIME(3)     NULL,
  PRIMARY KEY (id),
  -- Inbox: this user's notifications, unread first
  KEY idx_notifications_user (user_id, read_at, created_at),
  CONSTRAINT fk_notif_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE notification_campaigns (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  title       VARCHAR(200)    NOT NULL,
  body        VARCHAR(500)    NOT NULL,
  audience    VARCHAR(60)     NOT NULL,
  status      ENUM('draft','scheduled','sending','sent','cancelled') NOT NULL DEFAULT 'draft',
  scheduled_at DATETIME(3)    NULL,
  sent_count  BIGINT UNSIGNED NOT NULL DEFAULT 0,
  open_count  BIGINT UNSIGNED NOT NULL DEFAULT 0,
  created_by  BIGINT UNSIGNED NULL,
  created_at  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_notif_campaigns (status, scheduled_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Append-only. Never edited, never deleted from the panel (PHASE_11).
CREATE TABLE audit_logs (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  admin_id    BIGINT UNSIGNED NULL,
  admin_name  VARCHAR(120)    NOT NULL,
  role_slug   VARCHAR(40)     NULL,
  module      VARCHAR(40)     NOT NULL,
  action      VARCHAR(80)     NOT NULL,
  target_type VARCHAR(40)     NULL,
  target_id   VARCHAR(64)     NULL,
  old_value   JSON            NULL,
  new_value   JSON            NULL,
  reason      VARCHAR(1000)   NULL,
  ip          VARBINARY(16)   NULL,
  user_agent  VARCHAR(255)    NULL,
  created_at  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_audit_admin (admin_id, created_at),
  KEY idx_audit_module (module, created_at),
  KEY idx_audit_target (target_type, target_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE admin_login_attempts (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  email      VARCHAR(191)    NULL,
  admin_id   BIGINT UNSIGNED NULL,
  ip         VARBINARY(16)   NULL,
  outcome    ENUM('success','failed','blocked') NOT NULL,
  device     VARCHAR(255)    NULL,
  created_at DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_admin_attempts (email, created_at),
  KEY idx_admin_attempts_ip (ip, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
