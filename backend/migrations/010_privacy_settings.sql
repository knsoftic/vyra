-- 010 — Per-account interaction privacy
--
-- Who may comment, message and duet, and whether downloads are allowed. These
-- are enforced server-side on every relevant route, not just hidden in the UI.
-- Defaults match the permissive behaviour the app already assumes, so existing
-- accounts are unaffected.

ALTER TABLE user_profiles
  ADD COLUMN who_can_comment ENUM('everyone','followers','nobody') NOT NULL DEFAULT 'everyone',
  ADD COLUMN who_can_message ENUM('everyone','followers','nobody') NOT NULL DEFAULT 'everyone',
  ADD COLUMN who_can_duet    ENUM('everyone','followers','nobody') NOT NULL DEFAULT 'everyone',
  ADD COLUMN allow_download  TINYINT(1) NOT NULL DEFAULT 1;
