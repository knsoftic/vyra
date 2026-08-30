/**
 * Password hashing — Argon2id.
 *
 * Argon2id is memory-hard, which is what makes GPU cracking expensive. The
 * parameters below are the OWASP baseline; raising memoryCost is the lever if
 * hardware improves. Changing them does not invalidate existing hashes — the
 * cost parameters are encoded in the hash string, so old passwords keep
 * verifying and are re-hashed on next successful sign-in.
 */

import argon2 from 'argon2';
import { AppError } from '../../core/errors.ts';

const OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
};

export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 128;

/**
 * A short, explicit blocklist of the passwords credential-stuffing tools try
 * first. Not a substitute for rate limiting — it removes the cheapest wins.
 */
const OBVIOUS_PASSWORDS = new Set([
  'password', 'password1', 'password123', '12345678', '123456789', '1234567890',
  'qwerty123', 'iloveyou', 'admin123', 'welcome1', 'abc12345', 'letmein1',
  'password!', 'passw0rd', 'qwertyuiop', '11111111', '00000000',
]);

export function assertPasswordAcceptable(password: string, email?: string): void {
  const details: Record<string, string[]> = {};
  const problems: string[] = [];

  if (password.length < MIN_PASSWORD_LENGTH) {
    problems.push(`Must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    problems.push(`Must be at most ${MAX_PASSWORD_LENGTH} characters.`);
  }
  if (OBVIOUS_PASSWORDS.has(password.toLowerCase())) {
    problems.push('This password is too common. Choose something less predictable.');
  }
  // A password that contains the local part of the email is trivially guessable.
  const localPart = email?.split('@')[0]?.toLowerCase();
  if (localPart && localPart.length >= 3 && password.toLowerCase().includes(localPart)) {
    problems.push('Password must not contain your email address.');
  }

  if (problems.length > 0) {
    details.password = problems;
    throw new AppError('validation_failed', 'That password cannot be used.', { details });
  }
}

export const hashPassword = (password: string): Promise<string> => argon2.hash(password, OPTIONS);

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    // A malformed stored hash must read as "wrong password", not as a crash.
    return false;
  }
}

/** True when the stored hash used weaker parameters than the current policy. */
export function needsRehash(hash: string): boolean {
  try {
    return argon2.needsRehash(hash, OPTIONS);
  } catch {
    return true;
  }
}
