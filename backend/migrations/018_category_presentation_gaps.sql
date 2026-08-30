-- 018_category_presentation_gaps.sql
--
-- Migration 017 styled categories by slug and guessed three of them wrong:
-- the seeded taxonomy uses `cars`, `entertainment` and `pets`, not the
-- `vehicles`/`animals` names 017 assumed. Those three fell through to the
-- neutral placeholder, which is the fallback working as intended but still the
-- wrong icon on the screen.
--
-- Guarded on the placeholder rather than on NULL, so a category an administrator
-- has since styled deliberately is not overwritten.

UPDATE categories SET icon = 'car-sport-outline', color = '#6C8CFF' WHERE slug = 'cars'          AND icon = 'grid-outline';
UPDATE categories SET icon = 'film-outline',      color = '#FF6FB1' WHERE slug = 'entertainment' AND icon = 'grid-outline';
UPDATE categories SET icon = 'paw-outline',       color = '#F5A05A' WHERE slug = 'pets'          AND icon = 'grid-outline';
