/**
 * One-time codes.
 *
 * Six digits, single use, ten-minute expiry, five attempts.
 *
 * Three properties matter here:
 *  - The code is stored hashed, so a database read does not hand over live codes.
 *  - Comparison is constant-time, so response timing does not leak digits.
 *  - The plaintext code is returned only to the caller that generated it (to be
 *    handed to the mailer) and is never logged, never persisted, and never
 *    included in an API response.
 */

import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { execute, query, queryOne } from '../../core/db.ts';
import { AppError } from '../../core/errors.ts';
import type { OtpPurpose } from '../../../../shared/contracts/user.ts';

export const OTP_LENGTH = 6;
export const OTP_TTL_MINUTES = 10;
export const OTP_MAX_ATTEMPTS = 5;
/** A new code cannot be requested more often than this, per email and purpose. */
export const OTP_RESEND_COOLDOWN_SECONDS = 60;

const hashCode = (code: string): string => createHash('sha256').update(code).digest('hex');

/** Cryptographically uniform; `Math.random()` is not acceptable for a credential. */
function generateCode(): string {
  let code = '';
  for (let i = 0; i < OTP_LENGTH; i += 1) code += String(randomInt(0, 10));
  return code;
}

interface OtpRow {
  id: number;
  code_hash: string;
  attempts: number;
  expires_at: Date;
  consumed_at: Date | null;
}

/**
 * Issues a code and returns the plaintext for delivery.
 *
 * Any unconsumed code for the same email and purpose is consumed first, so a
 * user who requests twice cannot leave an older code valid.
 */
export async function issueOtp(
  email: string,
  purpose: OtpPurpose,
): Promise<{ code: string; expiresAt: Date; otpId: number }> {
  const recent = await queryOne<{ c: number }>(
    `SELECT COUNT(*) AS c FROM otp_codes
      WHERE email = :email AND purpose = :purpose
        AND created_at > (NOW(3) - INTERVAL :cooldown SECOND)`,
    { email, purpose, cooldown: OTP_RESEND_COOLDOWN_SECONDS },
  );
  if (recent && Number(recent.c) > 0) {
    throw new AppError('rate_limited', 'A code was just sent. Please wait before requesting another.', {
      retryAfter: OTP_RESEND_COOLDOWN_SECONDS,
    });
  }

  await execute(
    `UPDATE otp_codes SET consumed_at = NOW(3)
      WHERE email = :email AND purpose = :purpose AND consumed_at IS NULL`,
    { email, purpose },
  );

  const code = generateCode();
  const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60_000);

  const result = await execute(
    `INSERT INTO otp_codes (email, purpose, code_hash, expires_at)
     VALUES (:email, :purpose, :codeHash, :expiresAt)`,
    { email, purpose, codeHash: hashCode(code), expiresAt },
  );

  // The row id identifies this code, so the email that carries it can dedupe on
  // it: a retried request cannot deliver two emails with different codes.
  return { code, expiresAt, otpId: result.insertId };
}

/**
 * Verifies and consumes a code.
 *
 * Returns nothing on success and throws on failure. The error message is the
 * same whether the code was wrong, expired or never existed — distinguishing
 * them tells an attacker which emails have a pending code.
 */
export async function verifyOtp(email: string, purpose: OtpPurpose, code: string): Promise<void> {
  const rows = await query<OtpRow>(
    `SELECT id, code_hash, attempts, expires_at, consumed_at
       FROM otp_codes
      WHERE email = :email AND purpose = :purpose AND consumed_at IS NULL
      ORDER BY id DESC LIMIT 1`,
    { email, purpose },
  );
  const row = rows[0];

  const invalid = new AppError('bad_request', 'That code is not valid or has expired.');

  if (!row) {
    // Spend comparable work even with no row, so "no pending code" and "wrong
    // code" are not distinguishable by response time.
    timingSafeCompare(hashCode(code), hashCode('000000'));
    throw invalid;
  }

  if (row.attempts >= OTP_MAX_ATTEMPTS) {
    await execute('UPDATE otp_codes SET consumed_at = NOW(3) WHERE id = :id', { id: row.id });
    throw new AppError('rate_limited', 'Too many incorrect attempts. Request a new code.');
  }

  if (new Date(row.expires_at).getTime() < Date.now()) {
    await execute('UPDATE otp_codes SET consumed_at = NOW(3) WHERE id = :id', { id: row.id });
    throw invalid;
  }

  if (!timingSafeCompare(row.code_hash, hashCode(code))) {
    await execute('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = :id', { id: row.id });
    throw invalid;
  }

  await execute('UPDATE otp_codes SET consumed_at = NOW(3) WHERE id = :id', { id: row.id });
}

function timingSafeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
