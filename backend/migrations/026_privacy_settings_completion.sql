-- 026 — The privacy settings the screen already promised
--
-- Migration 010 stored five settings; the privacy screen lists eleven. The
-- other six were rendered as working switches that saved nothing, which is a
-- worse failure than not offering them: someone who turns off personalised ads
-- has been told it is off.
--
-- Five of the six are added here. The sixth — "use location for Nearby" — is
-- deliberately NOT added, because Nearby does not exist; a switch governing a
-- feature that was never built is the same lie in a different place, and it is
-- removed from the screen instead.
--
-- Every default matches today's behaviour, so no existing account changes when
-- this runs.

ALTER TABLE user_profiles
  -- Whether this account appears in "suggested accounts" for other people.
  ADD COLUMN suggest_account TINYINT(1) NOT NULL DEFAULT 1,

  -- Default for new videos. The per-video setting still wins where it is set;
  -- this is what a video starts from.
  ADD COLUMN allow_remix TINYINT(1) NOT NULL DEFAULT 1,

  -- Who may @mention this account. Same three audiences as the other rules.
  ADD COLUMN who_can_mention ENUM('everyone','followers','nobody') NOT NULL DEFAULT 'everyone',

  -- Whether in-app behaviour may inform ad targeting. Off means campaigns can
  -- still reach this account by country and interest category, never by what
  -- they personally watched.
  ADD COLUMN personalised_ads TINYINT(1) NOT NULL DEFAULT 1,

  -- Whether other people can see that this account is online or recently active.
  ADD COLUMN show_activity_status TINYINT(1) NOT NULL DEFAULT 1;
