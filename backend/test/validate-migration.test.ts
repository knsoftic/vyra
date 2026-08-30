// The permanent rule this project runs on: updates must never destroy user data.
// validate-migration.ts is the only thing standing between a careless migration
// and a wiped production table, so it gets tested like the safety device it is.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateMigration, splitStatements, USER_DATA_TABLES } from '../scripts/validate-migration.ts';

const rules = (sql: string) => validateMigration(sql).map((v) => v.rule);

test('rejects DROP TABLE', () => {
  assert.deepEqual(rules('DROP TABLE videos;'), ['no-drop-table']);
  assert.deepEqual(rules('DROP TABLE IF EXISTS `users`;'), ['no-drop-table']);
});

test('rejects TRUNCATE', () => {
  assert.deepEqual(rules('TRUNCATE TABLE wallets;'), ['no-truncate']);
  assert.deepEqual(rules('TRUNCATE wallets;'), ['no-truncate']);
});

test('rejects DROP DATABASE', () => {
  assert.deepEqual(rules('DROP DATABASE vyra;'), ['no-drop-database']);
});

test('rejects unbounded DELETE and UPDATE', () => {
  assert.deepEqual(rules('DELETE FROM users;'), ['no-unbounded-delete']);
  assert.deepEqual(rules('UPDATE wallets SET coin_balance = 0;'), ['no-unbounded-update']);
});

test('allows bounded DELETE and UPDATE', () => {
  assert.deepEqual(rules("DELETE FROM otp_codes WHERE expires_at < NOW();"), []);
  assert.deepEqual(rules("UPDATE wallets SET is_frozen = 1 WHERE user_id = 5;"), []);
});

test('rejects dropping a column from a user-data table', () => {
  assert.deepEqual(rules('ALTER TABLE users DROP COLUMN email;'), ['no-drop-column-on-user-table']);
});

test('allows dropping an index, which loses no data', () => {
  assert.deepEqual(rules('ALTER TABLE users DROP INDEX idx_users_email;'), []);
  assert.deepEqual(rules('ALTER TABLE users DROP FOREIGN KEY fk_users_role;'), []);
});

test('rejects NOT NULL without a default on an existing table', () => {
  assert.deepEqual(
    rules('ALTER TABLE videos ADD COLUMN region VARCHAR(8) NOT NULL;'),
    ['not-null-without-default'],
  );
});

test('allows NOT NULL when a default is supplied', () => {
  assert.deepEqual(rules("ALTER TABLE videos ADD COLUMN region VARCHAR(8) NOT NULL DEFAULT 'US';"), []);
});

test('rejects renaming a column on a user-data table', () => {
  assert.deepEqual(
    rules('ALTER TABLE users RENAME COLUMN username TO handle;'),
    ['no-rename-on-user-table'],
  );
});

// Regression: the original pattern ended in `\b`, which can never match after a
// type closing in ')'. VARCHAR(20) and CHAR(10) narrowing passed silently.
test('flags type narrowing even when the type ends in a paren', () => {
  assert.deepEqual(rules('ALTER TABLE users MODIFY COLUMN bio VARCHAR(20);'), ['review-type-narrowing']);
  assert.deepEqual(rules('ALTER TABLE users MODIFY COLUMN code CHAR(4);'), ['review-type-narrowing']);
  assert.deepEqual(rules('ALTER TABLE users MODIFY COLUMN age TINYINT;'), ['review-type-narrowing']);
});

test('does not flag widening a type', () => {
  assert.deepEqual(rules('ALTER TABLE users MODIFY COLUMN bio TEXT;'), []);
  assert.deepEqual(rules('ALTER TABLE users MODIFY COLUMN age BIGINT;'), []);
  assert.deepEqual(rules('ALTER TABLE users MODIFY COLUMN score INTEGER;'), []);
});

test('CREATE TABLE and ADD COLUMN with a default are clean', () => {
  assert.deepEqual(rules('CREATE TABLE foo (id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, PRIMARY KEY (id));'), []);
});

test('splitStatements ignores semicolons inside strings and comments', () => {
  const sql = `
    -- a comment; with a semicolon
    INSERT INTO t (a) VALUES ('x;y');
    SELECT 1;
  `;
  assert.equal(splitStatements(sql).length, 2);
});

test('every shipped migration passes', () => {
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql'));
  assert.ok(files.length > 0, 'expected migrations to exist');
  for (const file of files) {
    const violations = validateMigration(readFileSync(path.join(dir, file), 'utf8'));
    assert.deepEqual(violations, [], `${file} produced violations`);
  }
});

test('the protected-table list covers the balances and the ledger', () => {
  for (const t of ['users', 'videos', 'wallets', 'wallet_ledger', 'messages', 'payments']) {
    assert.ok(USER_DATA_TABLES.has(t), `${t} must be protected`);
  }
});

// ── Comment and string handling ──
//
// These exist because the normaliser used to apply comment-stripping and
// string-blanking as independent passes, so a `#` inside a string literal was
// read as a comment and swallowed the rest of the line. That merged statements
// (a false alarm) and, worse, could hide a destructive statement completely.

test('a # inside a string literal is not a comment', () => {
  const sql = "UPDATE categories SET color = '#7C5CFF' WHERE slug = 'ai';";
  assert.deepEqual(validateMigration(sql), [], 'a colour value is not a comment');
});

test('a statement after a string containing # is still checked', () => {
  const sql = "INSERT INTO categories (slug, color) VALUES ('ai', '#FFF'); DROP TABLE users;";
  const violations = validateMigration(sql);
  assert.ok(
    violations.some((v) => v.rule === 'no-drop-table'),
    'the DROP must not be hidden by the # in the preceding string',
  );
});

test('a semicolon inside a string does not split the statement', () => {
  const sql = "UPDATE users SET bio = 'hello; world' WHERE id = 1;";
  assert.deepEqual(validateMigration(sql), []);
});

test('a real line comment is still stripped', () => {
  const sql = '-- DROP TABLE users;\nSELECT 1;';
  assert.deepEqual(validateMigration(sql), [], 'a commented-out DROP is not a DROP');
});

test('a # line comment is still stripped', () => {
  const sql = '# DELETE FROM users\nSELECT 1;';
  assert.deepEqual(validateMigration(sql), []);
});

test('a block comment is still stripped', () => {
  const sql = '/* DROP TABLE users; */ SELECT 1;';
  assert.deepEqual(validateMigration(sql), []);
});

test('an escaped quote does not end the string early', () => {
  // Without correct escape handling the scanner would leave the string early and
  // read `DROP TABLE users` as code.
  const sql = "UPDATE users SET bio = 'it\\'s fine, DROP TABLE users' WHERE id = 1;";
  assert.deepEqual(validateMigration(sql), []);
});

test('a doubled quote does not end the string early', () => {
  const sql = "UPDATE users SET bio = 'it''s fine, DROP TABLE users' WHERE id = 1;";
  assert.deepEqual(validateMigration(sql), []);
});

test('backtick identifiers still match the table rules', () => {
  const violations = validateMigration('DROP TABLE `users`;');
  assert.ok(violations.some((v) => v.rule === 'no-drop-table'));
});
