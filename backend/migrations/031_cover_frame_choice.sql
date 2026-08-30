-- 031 — Letting someone choose their own cover frame
--
-- The poster has always been taken automatically, at a quarter of the way in
-- and never later than one second: a reasonable guess, because videos very
-- often open on black. But it was only ever a guess, and the Cover screen in
-- the app let people pick a frame that then went nowhere — `coverTimeMs` was
-- accepted by the publish route, typed on the way through, and never stored.
--
-- One nullable column. NULL keeps exactly the behaviour every existing video
-- already has, so nothing published before this changes.

ALTER TABLE videos
  -- Milliseconds into the finished video. NULL means "choose one for me".
  ADD COLUMN cover_time_ms INT UNSIGNED NULL AFTER duration_sec;
