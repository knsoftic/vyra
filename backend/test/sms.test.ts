/**
 * Phone number normalisation.
 *
 * The account is keyed on the string this produces, so two spellings of one
 * number that normalise differently means one person with two accounts. That
 * happened the first time the phone sign-in flow was tested: `03219876543` and
 * `+923219876543` created separate accounts, because with no country code
 * configured the first one was stored as typed.
 *
 * These pin both halves of the fix — the formats that must converge, and the
 * refusal that stops an ambiguous number being stored at all.
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';

// `normalisePhone` is pure, but it lives beside the gateway config, so
// importing it opens the pool and the Redis client. Both are closed at the end
// or the process hangs until the runner times the file out.
const { normalisePhone } = await import('../src/core/sms.ts');
const { pool } = await import('../src/core/db.ts');
const { closeRedis } = await import('../src/core/redis.ts');

after(async () => {
  await pool.end();
  await closeRedis();
});

test('every way a person writes their own number reaches one string', () => {
  const expected = '923001234567';
  for (const written of [
    '+92 300 1234567',
    '+92-300-1234567',
    '(+92) 300 1234567',
    '923001234567',
    '0300 1234567',
    '03001234567',
    '  0300-123-4567  ',
  ]) {
    assert.equal(normalisePhone(written, '92'), expected, `${written} should normalise`);
  }
});

test('a domestic number with no country code configured is refused, not guessed', () => {
  // This is the duplicate-account bug. Without a country code there is no way
  // to know which country `03001234567` belongs to, and storing it as typed
  // makes it a different account from the same person's international form.
  assert.equal(normalisePhone('03001234567', ''), null);
  assert.equal(normalisePhone('0300 123 4567', ''), null);

  // An international number needs no help and is still accepted.
  assert.equal(normalisePhone('+923001234567', ''), '923001234567');
  assert.equal(normalisePhone('923001234567', ''), '923001234567');
});

test('a trunk prefix never survives normalisation', () => {
  // A stored number beginning with 0 is not dialable internationally and would
  // never match the same person's other spelling.
  for (const cc of ['', '92', '44']) {
    const out = normalisePhone('03001234567', cc);
    assert.ok(out === null || !out.startsWith('0'), `cc=${cc} produced ${out}`);
  }
});

test('a number already carrying its country code is not given a second one', () => {
  assert.equal(normalisePhone('923001234567', '92'), '923001234567');
  assert.equal(normalisePhone('+923001234567', '92'), '923001234567');
});

test('what is not a phone number is refused', () => {
  for (const junk of ['', '   ', 'abcdefgh', '123', '+1', '9'.repeat(20)]) {
    assert.equal(normalisePhone(junk, '92'), null, `${junk} should be refused`);
  }
});

test('letters and punctuation are stripped rather than rejected outright', () => {
  // People paste numbers with all sorts in them; the digits are what matter.
  assert.equal(normalisePhone('+92 (300) 123-4567', ''), '923001234567');
});
