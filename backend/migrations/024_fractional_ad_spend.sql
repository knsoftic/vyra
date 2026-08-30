-- 024_fractional_ad_spend.sql
--
-- Ad spend has to be fractional.
--
-- `campaigns.spent_coins` and `campaign_analytics.spent_coins` were BIGINT, but
-- one impression costs a fraction of a coin — 0.05 by default. Every charge
-- rounded to zero, so a campaign delivered indefinitely and its advertiser was
-- never billed. `spent_coins` stayed at 0 while impressions accumulated, which
-- also meant the budget exhaustion check never fired.
--
-- Budgets stay whole coins: an advertiser commits a round number. Only the
-- accumulated spend needs the precision, so only those two columns widen.
--
-- BIGINT to DECIMAL(16,4) is a widening — every value representable before is
-- representable after, and no row loses data.

ALTER TABLE campaigns
  MODIFY COLUMN spent_coins DECIMAL(16,4) NOT NULL DEFAULT 0;

ALTER TABLE campaign_analytics
  MODIFY COLUMN spent_coins DECIMAL(16,4) NOT NULL DEFAULT 0;
