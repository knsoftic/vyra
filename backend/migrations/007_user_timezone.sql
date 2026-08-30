-- Additive change used to prove a migration preserves existing rows.
ALTER TABLE users ADD COLUMN timezone VARCHAR(64) NOT NULL DEFAULT 'UTC';
