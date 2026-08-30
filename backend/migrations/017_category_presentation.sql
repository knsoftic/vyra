-- 017_category_presentation.sql
--
-- Categories carried a name and a slug but no icon or colour, so every client
-- had to invent its own presentation for them. That is exactly the kind of
-- hard-coded mapping that stops categories being admin-editable: adding one in
-- the admin panel would produce a category the app could not draw.
--
-- The values below are defaults, not overwrites. Every statement is guarded by
-- `IS NULL`, so a category an administrator has already styled keeps its
-- styling, and re-running this migration changes nothing.

UPDATE categories SET icon = 'sparkles-outline',        color = '#7C5CFF' WHERE slug = 'ai'            AND icon IS NULL;
UPDATE categories SET icon = 'hardware-chip-outline',   color = '#2FB6FF' WHERE slug = 'technology'    AND icon IS NULL;
UPDATE categories SET icon = 'game-controller-outline', color = '#FF5C8A' WHERE slug = 'gaming'        AND icon IS NULL;
UPDATE categories SET icon = 'briefcase-outline',       color = '#F0A030' WHERE slug = 'business'      AND icon IS NULL;
UPDATE categories SET icon = 'school-outline',          color = '#3DDC97' WHERE slug = 'education'     AND icon IS NULL;
UPDATE categories SET icon = 'football-outline',        color = '#37C978' WHERE slug = 'sports'        AND icon IS NULL;
UPDATE categories SET icon = 'musical-notes-outline',   color = '#FF6B6B' WHERE slug = 'music'         AND icon IS NULL;
UPDATE categories SET icon = 'happy-outline',           color = '#FFC93C' WHERE slug = 'comedy'        AND icon IS NULL;
UPDATE categories SET icon = 'shirt-outline',           color = '#E86AB0' WHERE slug = 'fashion'       AND icon IS NULL;
UPDATE categories SET icon = 'restaurant-outline',      color = '#FF8A47' WHERE slug = 'food'          AND icon IS NULL;
UPDATE categories SET icon = 'airplane-outline',        color = '#40C4E0' WHERE slug = 'travel'        AND icon IS NULL;
UPDATE categories SET icon = 'barbell-outline',         color = '#5BD16B' WHERE slug = 'fitness'       AND icon IS NULL;
UPDATE categories SET icon = 'color-palette-outline',   color = '#B07CFF' WHERE slug = 'art'           AND icon IS NULL;
UPDATE categories SET icon = 'paw-outline',             color = '#F5A05A' WHERE slug = 'animals'       AND icon IS NULL;
UPDATE categories SET icon = 'car-sport-outline',       color = '#6C8CFF' WHERE slug = 'vehicles'      AND icon IS NULL;
UPDATE categories SET icon = 'newspaper-outline',       color = '#9AA3B2' WHERE slug = 'news'          AND icon IS NULL;
UPDATE categories SET icon = 'heart-outline',           color = '#FF7396' WHERE slug = 'lifestyle'     AND icon IS NULL;
UPDATE categories SET icon = 'flask-outline',           color = '#4FD1C5' WHERE slug = 'science'       AND icon IS NULL;
UPDATE categories SET icon = 'brush-outline',           color = '#C084FC' WHERE slug = 'beauty'        AND icon IS NULL;
UPDATE categories SET icon = 'home-outline',            color = '#8FD14F' WHERE slug = 'diy'           AND icon IS NULL;

-- Anything an administrator adds later still renders: a neutral default so a
-- new category is never invisible while it waits to be styled.
UPDATE categories
   SET icon = 'grid-outline', color = '#8A94A6'
 WHERE icon IS NULL AND is_enabled = 1;
