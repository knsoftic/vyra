-- 016 — Link admin accounts to their user account
--
-- `requireAdmin` resolved an admin by matching `admin_users.id` against
-- `users.id`. Those are two independent auto-increment sequences, so the match
-- was coincidental: an ordinary user whose id happened to equal an admin row's
-- id would have been granted that admin's permissions.
--
-- The link is now explicit. `user_id` is nullable so existing rows stay valid,
-- and unique so one user account cannot map to two admin identities.

ALTER TABLE admin_users
  ADD COLUMN user_id BIGINT UNSIGNED NULL,
  ADD UNIQUE KEY uq_admin_user (user_id),
  ADD CONSTRAINT fk_admin_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT;
