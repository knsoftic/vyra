-- 012 — Catalogue kinds
--
-- The enum shipped in 002 predates the Phase 4 contract: it carries `text_style`
-- but has no `font` or `transition`. Adding values to an enum is additive and
-- keeps every existing row valid.
--
-- `text_style` is retained rather than removed. Dropping an enum value would
-- invalidate any row already using it, and this project does not destroy data to
-- tidy a type.
ALTER TABLE creative_assets
  MODIFY COLUMN kind ENUM('filter','effect','sticker_pack','text_style','font','transition') NOT NULL;
