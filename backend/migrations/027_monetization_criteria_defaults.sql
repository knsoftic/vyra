-- 027 — The monetization requirements an account is actually measured against
--
-- `monetization_criteria` has existed since migration 005 and has never held a
-- single row. The admin panel could add criteria and the app showed a progress
-- ring, but with nothing in the table there was no question to answer: an empty
-- requirement list means either everybody qualifies or nobody does, and which
-- of those it meant depended on code that was never written.
--
-- These six are the defaults. Every one of them is measured from rows the
-- platform already records — followers, published videos, views and watch time
-- in the last 30 days, account age, a verified email, and no restriction in
-- force. Nothing here is self-reported, and nothing is estimated.
--
-- The values are starting points, not policy. All of them are editable in
-- Admin → Monetization → Criteria & Creators, including whether each one is
-- enforced at all, which is what the owner asked for: thresholds must be
-- tunable without a deploy.
--
-- INSERT IGNORE, keyed on `criterion_key`: running this against a database
-- where an operator has already added their own criteria changes nothing they
-- set, and re-running it changes nothing at all.

INSERT IGNORE INTO monetization_criteria
  (criterion_key, label, metric, required, unit, is_boolean, is_enabled, sort_order)
VALUES
  ('followers_1000',   '1,000 followers',              'followers',         1000,  'followers', 0, 1, 10),
  ('videos_3',         '3 published videos',           'videos_published',  3,     'videos',    0, 1, 20),
  ('views_10k_30d',    '10,000 views in 30 days',      'views_30d',         10000, 'views',     0, 1, 30),
  ('watch_600m_30d',   '600 minutes watched in 30 days', 'watch_minutes_30d', 600, 'minutes',   0, 1, 40),
  ('account_age_30',   'Account at least 30 days old', 'account_age_days',  30,    'days',      0, 1, 50),
  -- Booleans: `required` is 1 and the metric answers 0 or 1. Kept as ordinary
  -- rows so an operator can switch them off like any other requirement.
  ('email_verified',   'Email address verified',       'email_verified',    1,     NULL,        1, 1, 60),
  ('no_restriction',   'No restriction in force',      'no_active_restriction', 1, NULL,        1, 1, 70);
