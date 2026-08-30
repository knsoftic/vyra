-- 023_campaign_delivery.sql
--
-- Phase 11: what per-impression charging needs that migration 006 did not
-- already provide.
--
-- 006 had already given `campaigns` an `idempotency_key`, its unique key and a
-- delivery index, so this adds only the delivery ledger.
--
-- `campaign_impressions` is what makes charging honest. Billing per impression
-- needs a record of which impressions were charged for, or a replayed signal
-- bills the advertiser twice for showing one person one video. The unique key on
-- (campaign_id, user_id, impression_id) is the whole defence.
--
-- Nothing here removes or narrows a column.

CREATE TABLE IF NOT EXISTS campaign_impressions (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  campaign_id   BIGINT UNSIGNED NOT NULL,
  user_id       BIGINT UNSIGNED NOT NULL,
  -- The feed's own impression id. Carrying it here is what lets a replayed
  -- signal be recognised as the same delivery rather than a new one.
  impression_id VARCHAR(128)    NOT NULL,
  charged_coins DECIMAL(12,4)   NOT NULL DEFAULT 0,
  -- Set when the viewer actually watched, which is a different event from being
  -- shown the video and is charged separately for view objectives.
  viewed_at     DATETIME(3)     NULL DEFAULT NULL,
  clicked_at    DATETIME(3)     NULL DEFAULT NULL,
  created_at    DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_campaign_impression (campaign_id, user_id, impression_id),
  KEY idx_campaign_impressions_campaign (campaign_id, created_at),
  CONSTRAINT fk_campaign_impressions_campaign
    FOREIGN KEY (campaign_id) REFERENCES campaigns (id) ON DELETE CASCADE,
  CONSTRAINT fk_campaign_impressions_user
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Daily spend is capped per campaign, so it has to be queryable per day.
ALTER TABLE campaign_analytics
  ADD INDEX idx_campaign_analytics_day (campaign_id, bucket_hour);
