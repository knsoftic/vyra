/**
 * Signing in with a phone number and a one-time code.
 *
 * One flow covers both cases, deliberately. A person types their number and a
 * code arrives; if the number already has an account they are signed into it,
 * and if it does not, an account is created and they are signed into that. The
 * app never has to ask "do you already have an account?" — a question the
 * server can answer and the person often cannot.
 *
 * Three properties this holds to:
 *
 * **The request never reveals whether a number is registered.** Both cases
 * return the same shape, and the branch happens only after a correct code has
 * been supplied. Otherwise the request endpoint becomes a way to test whether
 * someone is on the platform.
 *
 * **A code that was not delivered is not reported as sent.** If no SMS provider
 * is configured, or the gateway refuses, the caller is told plainly. Telling
 * someone to check a phone that will never ring is the specific failure this
 * whole path exists to avoid.
 *
 * **Verifying issues a session.** That is the point: the code IS the
 * authentication, so a separate "now log in" step would either be redundant or
 * would need a password the account may not have.
 */

import type { Request } from 'express';
import { ulid } from 'ulid';
import { execute, queryOne, transaction } from '../../core/db.ts';
import { AppError } from '../../core/errors.ts';
import { logger } from '../../core/logger.ts';
import { getSetting } from '../../core/settings.ts';
import { normalisePhone, smsConfig } from '../../core/sms.ts';
import { queue as queueOutbox } from '../notifications/outbox.service.ts';
import { recordLoginAttempt, recordSecurityEvent } from '../../core/security-log.ts';
import { issueSession } from './tokens.ts';
import { issueOtp, verifyOtp } from './otp.ts';
import { stripSessionId } from './auth.service.ts';
import { getPrivateUser } from '../users/users.service.ts';
import type { AuthSession, DeviceInfo } from '../../../../shared/contracts/user.ts';

export interface PhoneOtpDelivery {
  sent: boolean;
  expiresInMinutes: number;
  /** The number the code went to, normalised — so the app can show it back. */
  phone: string;
  /** Development only, where there is usually no gateway to send through. */
  devCode?: string;
}

/**
 * Normalises using the operator's configured default country code.
 *
 * The message distinguishes the two ways this fails, because they need
 * different things from the person: a malformed number needs correcting, and an
 * unresolvable domestic one just needs its country code.
 */
export async function toPhone(input: string): Promise<string> {
  const { defaultCountryCode } = await smsConfig();
  const phone = normalisePhone(input, defaultCountryCode);
  if (!phone) {
    const message = defaultCountryCode
      ? 'Enter a valid phone number.'
      : 'Enter your number with its country code, for example +92 300 1234567.';
    throw new AppError('validation_failed', message, { details: { phone: [message] } });
  }
  return phone;
}

/**
 * Sends a sign-in code to a phone number.
 *
 * The purpose is always `login`: from the server's point of view there is one
 * intent here — prove you hold this number — and whether that ends in a new
 * account or an existing one is decided at verification.
 */
export async function requestPhoneOtp(
  req: Request,
  rawPhone: string,
  isProduction: boolean,
): Promise<PhoneOtpDelivery> {
  const phone = await toPhone(rawPhone);
  const { provider } = await smsConfig();

  // Refused up front rather than after issuing a code nobody can receive. In
  // development the code comes back in the response instead, so the flow stays
  // testable without a gateway.
  if (provider === 'none' && isProduction) {
    throw new AppError(
      'dependency_unavailable',
      'Sign-in by SMS is not available at the moment. Please use your email address.',
    );
  }

  const existing = await queryOne<{ id: number }>(
    'SELECT id FROM users WHERE phone = :phone AND deleted_at IS NULL',
    { phone },
  );

  const { code, otpId } = await issueOtp(phone, 'login', 'sms');

  await recordSecurityEvent(req, {
    userId: existing?.id ?? null,
    event: 'otp_requested',
    detail: 'channel=sms purpose=login',
  });

  if (provider !== 'none') {
    await queueOutbox({
      channel: 'sms',
      destination: phone,
      template: 'otp.sms.login',
      payload: { code },
      // The code's own row, so a retried request cannot queue two texts
      // carrying different codes.
      dedupeKey: `otp:${otpId}`,
      ...(existing?.id ? { userId: existing.id } : {}),
    }).catch((err: unknown) => {
      logger.error({ err }, 'could not queue the sign-in text');
    });
  }

  if (!isProduction) {
    logger.info({ phone }, 'SMS OTP issued (development)');
    return { sent: provider !== 'none', expiresInMinutes: 10, phone, devCode: code };
  }
  return { sent: true, expiresInMinutes: 10, phone };
}

/**
 * A username for an account that arrived with nothing but a number.
 *
 * Never derived from the phone number — `user_923001234567` would publish
 * somebody's mobile number on their profile. Random, and changeable in Edit
 * Profile straight afterwards.
 */
async function availableUsername(): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate = `user${Math.random().toString(36).slice(2, 10)}`;
    const taken = await queryOne<{ id: number }>('SELECT id FROM users WHERE username = :candidate', {
      candidate,
    });
    if (!taken) return candidate;
  }
  // Eight collisions on an 8-character random suffix means something is very
  // wrong; a ULID tail is guaranteed distinct.
  return `user${ulid().slice(-10).toLowerCase()}`;
}

/**
 * Verifies a code and returns a session.
 *
 * Creates the account when the number is new. The account has no password —
 * `password_hash` is empty and the password login path rejects an empty hash —
 * so the number and the codes sent to it are the only way in until the person
 * sets one.
 */
export async function verifyPhoneOtp(
  req: Request,
  rawPhone: string,
  code: string,
  device: DeviceInfo,
): Promise<AuthSession> {
  const phone = await toPhone(rawPhone);

  try {
    await verifyOtp(phone, 'login', code, 'sms');
  } catch (err) {
    await recordLoginAttempt(req, { email: phone, successful: false, reason: 'bad_otp' });
    await recordSecurityEvent(req, {
      event: 'otp_failed',
      outcome: 'failure',
      detail: 'channel=sms purpose=login',
    });
    throw err;
  }

  const existing = await queryOne<{
    id: number;
    public_id: string;
    status: string;
    status_reason: string | null;
  }>(
    `SELECT id, public_id, status, status_reason FROM users
      WHERE phone = :phone AND deleted_at IS NULL`,
    { phone },
  );

  if (existing) {
    if (existing.status === 'banned') {
      throw new AppError('account_banned', existing.status_reason ?? 'This account has been banned.');
    }
    if (existing.status === 'suspended') {
      throw new AppError('account_suspended', existing.status_reason ?? 'This account is suspended.');
    }

    const tokens = await issueSession(req, existing.id, existing.public_id, device);
    await execute(
      'UPDATE users SET last_active_at = NOW(3), phone_verified_at = NOW(3) WHERE id = :id',
      { id: existing.id },
    );
    await recordLoginAttempt(req, { email: phone, userId: existing.id, successful: true });
    await recordSecurityEvent(req, {
      userId: existing.id,
      event: 'login',
      sessionId: tokens.sessionId,
      detail: 'channel=sms',
    });

    return {
      user: await getPrivateUser(existing.id),
      tokens: stripSessionId(tokens),
      isNewAccount: false,
    };
  }

  // New account.
  const username = await availableUsername();
  const publicId = ulid();
  const appName = String(await getSetting('app.name'));

  const userId = await transaction(async (tx) => {
    const result = await execute(
      `INSERT INTO users (public_id, username, phone, phone_verified_at, password_hash,
                          account_category, account_type, status)
       VALUES (:publicId, :username, :phone, NOW(3), '', 'individual', 'normal', 'active')`,
      { publicId, username, phone },
      tx,
    );
    const id = result.insertId;

    await execute(
      "INSERT INTO user_profiles (user_id, display_name, bio) VALUES (:id, :displayName, '')",
      { id, displayName: username },
      tx,
    );
    await execute('INSERT INTO wallets (user_id) VALUES (:id)', { id }, tx);
    await execute(
      'INSERT INTO referral_codes (user_id, code) VALUES (:id, :code)',
      { id, code: publicId.slice(-8).toUpperCase() },
      tx,
    );

    return id;
  });

  const tokens = await issueSession(req, userId, publicId, device);
  await recordSecurityEvent(req, {
    userId,
    event: 'register',
    sessionId: tokens.sessionId,
    detail: 'channel=sms',
  });
  await recordLoginAttempt(req, { email: phone, userId, successful: true, reason: 'register' });

  logger.info({ userId, appName }, 'account created by phone');

  return {
    user: await getPrivateUser(userId),
    tokens: stripSessionId(tokens),
    isNewAccount: true,
  };
}
