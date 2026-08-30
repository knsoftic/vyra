/**
 * Authentication flows.
 *
 * A recurring theme in this file: responses do not reveal whether an account
 * exists. Registration with a taken email, a password reset for an unknown
 * address, and a login with a wrong password all behave the same way from the
 * outside. Enumeration is how attackers build target lists before credential
 * stuffing, and the convenience of a precise error is not worth it.
 */

import type { Request } from 'express';
import { ulid } from 'ulid';
import { execute, queryOne, transaction } from '../../core/db.ts';
import { AppError } from '../../core/errors.ts';
import { logger } from '../../core/logger.ts';
import { recordLoginAttempt, recordSecurityEvent } from '../../core/security-log.ts';
import { getSetting } from '../../core/settings.ts';
import { hashPassword, verifyPassword, needsRehash, assertPasswordAcceptable } from './password.ts';
import { issueOtp, verifyOtp } from './otp.ts';
import { queue as queueOutbox } from '../notifications/outbox.service.ts';
import { issueSession, revokeAllSessions, revokeSession, rotateSession } from './tokens.ts';
import { checkUsername } from '../users/username.ts';
import { getPrivateUser } from '../users/users.service.ts';
import type {
  AuthSession,
  AuthTokens,
  DeviceInfo,
  OtpPurpose,
} from '../../../../shared/contracts/user.ts';

/** Sign-in lockout: too many failures against one email pauses that email. */
const MAX_FAILED_LOGINS = 8;
const LOCKOUT_WINDOW_MINUTES = 15;

const normaliseEmail = (email: string): string => email.trim().toLowerCase();

interface UserAuthRow {
  id: number;
  public_id: string;
  username: string;
  email: string;
  password_hash: string;
  status: 'active' | 'suspended' | 'banned' | 'frozen';
  status_reason: string | null;
  email_verified_at: Date | null;
}

async function findByEmail(email: string): Promise<UserAuthRow | undefined> {
  return queryOne<UserAuthRow>(
    `SELECT id, public_id, username, email, password_hash, status, status_reason, email_verified_at
       FROM users WHERE email = :email AND deleted_at IS NULL`,
    { email },
  );
}

async function isLockedOut(email: string): Promise<boolean> {
  const row = await queryOne<{ c: number }>(
    `SELECT COUNT(*) AS c FROM login_attempts
      WHERE email = :email AND successful = 0
        AND created_at > (NOW(3) - INTERVAL :mins MINUTE)`,
    { email, mins: LOCKOUT_WINDOW_MINUTES },
  );
  return Number(row?.c ?? 0) >= MAX_FAILED_LOGINS;
}

function assertUsable(user: UserAuthRow): void {
  if (user.status === 'banned') {
    throw new AppError('account_banned', user.status_reason ?? 'This account has been banned.');
  }
  if (user.status === 'suspended') {
    throw new AppError(
      'account_suspended',
      user.status_reason ?? 'This account is currently suspended.',
    );
  }
}

// ── Registration ──

export interface RegisterInput {
  email: string;
  password: string;
  username: string;
  displayName?: string;
  birthdate: string;
  referralCode?: string;
  device: DeviceInfo;
}

/**
 * Creates the account and immediately signs it in.
 *
 * Email verification is a separate OTP step rather than a gate on sign-in: an
 * unverified account can browse, but verification is required before anything
 * that touches money. Blocking the first session on an email round trip loses
 * users to nothing more than a slow mail server.
 */
export async function register(req: Request, input: RegisterInput): Promise<AuthSession> {
  const email = normaliseEmail(input.email);
  const username = input.username.trim().toLowerCase();

  assertPasswordAcceptable(input.password, email);

  const availability = await checkUsername(username);
  if (!availability.available) {
    const message =
      availability.reason === 'reserved'
        ? 'That username is reserved.'
        : availability.reason === 'previously_used'
          ? 'That username is no longer available.'
          : availability.reason === 'invalid'
            ? 'Usernames are 3–30 characters, using letters, numbers, dots and underscores.'
            : 'That username is already taken.';
    throw new AppError('validation_failed', message, { details: { username: [message] } });
  }

  // Age gate. Checked server-side because the client cannot be trusted with it.
  const birth = new Date(input.birthdate);
  if (Number.isNaN(birth.getTime())) {
    throw new AppError('validation_failed', 'Enter a valid date of birth.', {
      details: { birthdate: ['Enter a valid date of birth.'] },
    });
  }
  const ageMs = Date.now() - birth.getTime();
  const age = ageMs / (365.25 * 86400_000);
  if (age < 13) {
    throw new AppError('forbidden', 'You must be at least 13 years old to create an account.');
  }

  const existing = await findByEmail(email);
  if (existing) {
    // Do not confirm that the address is registered. The person who owns the
    // address learns about it by email; a stranger probing the API learns nothing.
    await recordSecurityEvent(req, {
      userId: existing.id,
      event: 'register',
      outcome: 'blocked',
      detail: 'Registration attempted with an address that already has an account.',
    });
    throw new AppError(
      'conflict',
      'That email cannot be used to register. If you already have an account, try signing in or resetting your password.',
    );
  }

  const passwordHash = await hashPassword(input.password);
  const publicId = ulid();

  const userId = await transaction(async (tx) => {
    const result = await execute(
      `INSERT INTO users (public_id, username, email, password_hash, account_category, account_type, status)
       VALUES (:publicId, :username, :email, :passwordHash, 'individual', 'normal', 'active')`,
      { publicId, username, email, passwordHash },
      tx,
    );
    const id = result.insertId;

    await execute(
      `INSERT INTO user_profiles (user_id, display_name, bio)
       VALUES (:id, :displayName, '')`,
      { id, displayName: (input.displayName ?? username).slice(0, 60) },
      tx,
    );

    // The wallet exists from day one so every later money path can assume it.
    await execute('INSERT INTO wallets (user_id) VALUES (:id)', { id }, tx);

    await execute(
      'INSERT INTO referral_codes (user_id, code) VALUES (:id, :code)',
      { id, code: publicId.slice(-8).toUpperCase() },
      tx,
    );

    return id;
  });

  if (input.referralCode) {
    await attachReferral(userId, input.referralCode, req).catch((err: unknown) => {
      // A bad referral code must not fail the registration.
      logger.warn({ err, userId }, 'referral attach failed');
    });
  }

  const tokens = await issueSession(req, userId, publicId, input.device);
  await recordSecurityEvent(req, {
    userId,
    event: 'register',
    sessionId: tokens.sessionId,
  });
  await recordLoginAttempt(req, { email, userId, successful: true, reason: 'register' });

  const user = await getPrivateUser(userId);
  return { user, tokens: stripSessionId(tokens), isNewAccount: true };
}

/** Records who referred this account. The reward is credited later, on qualification. */
async function attachReferral(userId: number, code: string, req: Request): Promise<void> {
  const referrer = await queryOne<{ user_id: number }>(
    'SELECT user_id FROM referral_codes WHERE code = :code',
    { code: code.trim().toUpperCase() },
  );
  if (!referrer || referrer.user_id === userId) return;

  const rewardCoins = await getSetting('referral.reward_coins');
  await execute(
    `INSERT IGNORE INTO referrals (referrer_id, referred_id, code, reward_coins, signup_ip, signup_device)
     VALUES (:referrerId, :referredId, :code, :rewardCoins, :ip, :device)`,
    {
      referrerId: referrer.user_id,
      referredId: userId,
      code: code.trim().toUpperCase(),
      rewardCoins,
      ip: null,
      device: req.header('user-agent')?.slice(0, 128) ?? null,
    },
  );
}

// ── Sign in ──

export async function login(
  req: Request,
  input: { email: string; password: string; device: DeviceInfo },
): Promise<AuthSession> {
  const email = normaliseEmail(input.email);

  if (await isLockedOut(email)) {
    await recordSecurityEvent(req, {
      event: 'login_failed',
      outcome: 'blocked',
      detail: 'Too many failed sign-in attempts.',
    });
    throw new AppError('rate_limited', 'Too many failed attempts. Try again in a few minutes.', {
      retryAfter: LOCKOUT_WINDOW_MINUTES * 60,
    });
  }

  const user = await findByEmail(email);

  // Identical response and comparable work whether or not the account exists.
  const invalid = new AppError('unauthenticated', 'Email or password is incorrect.');
  if (!user) {
    await verifyPassword(
      '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHR2YWx1ZXg$0000000000000000000000000000000000000000000',
      input.password,
    );
    await recordLoginAttempt(req, { email, successful: false, reason: 'no_such_account' });
    throw invalid;
  }

  const passwordOk = await verifyPassword(user.password_hash, input.password);
  if (!passwordOk) {
    await recordLoginAttempt(req, {
      email,
      userId: user.id,
      successful: false,
      reason: 'bad_password',
    });
    await recordSecurityEvent(req, { userId: user.id, event: 'login_failed', outcome: 'failure' });
    throw invalid;
  }

  assertUsable(user);

  // Transparently upgrade a hash written under weaker parameters.
  if (needsRehash(user.password_hash)) {
    const rehashed = await hashPassword(input.password);
    await execute('UPDATE users SET password_hash = :hash WHERE id = :id', {
      hash: rehashed,
      id: user.id,
    });
  }

  const tokens = await issueSession(req, user.id, user.public_id, input.device);
  await execute('UPDATE users SET last_active_at = NOW(3) WHERE id = :id', { id: user.id });
  await recordLoginAttempt(req, { email, userId: user.id, successful: true });
  await recordSecurityEvent(req, { userId: user.id, event: 'login', sessionId: tokens.sessionId });

  const profile = await getPrivateUser(user.id);
  return { user: profile, tokens: stripSessionId(tokens), isNewAccount: false };
}

export async function refresh(req: Request, refreshToken: string): Promise<AuthTokens> {
  const rotated = await rotateSession(req, refreshToken);
  await recordSecurityEvent(req, {
    userId: rotated.userId,
    event: 'token_refresh',
    sessionId: rotated.sessionId,
  });
  return stripSessionId(rotated);
}

export async function logout(req: Request, userId: number, sessionId: number): Promise<void> {
  await revokeSession(sessionId, userId, 'logout');
  await recordSecurityEvent(req, { userId, event: 'logout', sessionId });
}

export async function logoutAll(req: Request, userId: number): Promise<{ revoked: number }> {
  const revoked = await revokeAllSessions(userId, 'logout_all');
  await recordSecurityEvent(req, {
    userId,
    event: 'logout_all',
    detail: `${revoked} session(s) ended.`,
  });
  return { revoked };
}

// ── One-time codes ──

export interface OtpDelivery {
  /** Always true — the response never reveals whether the address exists. */
  sent: true;
  expiresInMinutes: number;
  /** Development only, so the flow is testable without a mail server. */
  devCode?: string;
}

export async function requestOtp(
  req: Request,
  email: string,
  purpose: OtpPurpose,
  isProduction: boolean,
): Promise<OtpDelivery> {
  const normalised = normaliseEmail(email);
  const user = await findByEmail(normalised);

  // For reset and login the address must exist, but saying so would enumerate
  // accounts. Return the same shape and simply send nothing.
  const shouldSend = purpose === 'signup' ? true : user !== undefined;

  if (!shouldSend) {
    await recordSecurityEvent(req, {
      event: 'otp_requested',
      outcome: 'blocked',
      detail: `Code requested for an address with no account (${purpose}).`,
    });
    return { sent: true, expiresInMinutes: 10 };
  }

  const { code, otpId } = await issueOtp(normalised, purpose);
  await recordSecurityEvent(req, {
    userId: user?.id ?? null,
    event: 'otp_requested',
    detail: `purpose=${purpose}`,
  });

  /**
   * Queue the code for delivery.
   *
   * Written to the outbox rather than sent inline, so a slow or dead mail
   * server delays the email and not the request — someone asking for a code
   * should not wait on SMTP, and a provider outage should not make the flow
   * look broken.
   *
   * The dedupe key is the code's own row, so a retried request cannot send two
   * emails carrying different codes.
   */
  await queueOutbox({
    channel: 'email',
    destination: normalised,
    template: `otp.${purpose}`,
    payload: { code, purpose },
    dedupeKey: `otp:${otpId}`,
    ...(user?.id ? { userId: user.id } : {}),
  }).catch((err: unknown) => {
    // A failure to queue must not tell the caller whether the address exists,
    // so it is logged and the response is unchanged.
    logger.error({ err, purpose }, 'could not queue the verification email');
  });

  // In development the code also comes back in the response, because there is
  // usually no mail server and a flow nobody can complete is a flow nobody can
  // test. Never in production, where the email is the only channel.
  if (!isProduction) {
    logger.info({ email: normalised, purpose }, 'OTP issued (development)');
    return { sent: true, expiresInMinutes: 10, devCode: code };
  }
  return { sent: true, expiresInMinutes: 10 };
}

export async function confirmOtp(
  req: Request,
  email: string,
  code: string,
  purpose: OtpPurpose,
): Promise<{ verified: true }> {
  const normalised = normaliseEmail(email);
  try {
    await verifyOtp(normalised, purpose, code);
  } catch (err) {
    await recordSecurityEvent(req, {
      event: 'otp_failed',
      outcome: 'failure',
      detail: `purpose=${purpose}`,
    });
    throw err;
  }

  const user = await findByEmail(normalised);
  if (purpose === 'signup' && user) {
    await execute('UPDATE users SET email_verified_at = NOW(3) WHERE id = :id', { id: user.id });
    await recordSecurityEvent(req, { userId: user.id, event: 'email_verified' });
  }

  await recordSecurityEvent(req, {
    userId: user?.id ?? null,
    event: 'otp_verified',
    detail: `purpose=${purpose}`,
  });
  return { verified: true };
}

// ── Password ──

/**
 * Resets a password using a verified OTP, then ends every session.
 *
 * Ending all sessions is the point of a reset: if the account was compromised,
 * leaving the attacker's session live would make the reset pointless.
 */
export async function resetPassword(
  req: Request,
  input: { email: string; code: string; newPassword: string },
): Promise<{ reset: true }> {
  const email = normaliseEmail(input.email);
  assertPasswordAcceptable(input.newPassword, email);

  await verifyOtp(email, 'reset', input.code);

  const user = await findByEmail(email);
  if (!user) {
    // The code verified, so a row existed for this address. Treat a missing user
    // as a generic failure rather than confirming anything.
    throw new AppError('bad_request', 'That code is not valid or has expired.');
  }

  const passwordHash = await hashPassword(input.newPassword);
  await execute('UPDATE users SET password_hash = :hash WHERE id = :id', {
    hash: passwordHash,
    id: user.id,
  });

  const revoked = await revokeAllSessions(user.id, 'password_reset');
  await recordSecurityEvent(req, {
    userId: user.id,
    event: 'password_reset',
    detail: `${revoked} session(s) ended.`,
  });
  return { reset: true };
}

export async function changePassword(
  req: Request,
  userId: number,
  sessionId: number,
  input: { currentPassword: string; newPassword: string },
): Promise<{ changed: true }> {
  const user = await queryOne<UserAuthRow>(
    'SELECT id, email, password_hash FROM users WHERE id = :id AND deleted_at IS NULL',
    { id: userId },
  );
  if (!user) throw new AppError('not_found', 'Account not found.');

  const ok = await verifyPassword(user.password_hash, input.currentPassword);
  if (!ok) {
    await recordSecurityEvent(req, {
      userId,
      event: 'password_changed',
      outcome: 'failure',
      detail: 'Current password did not match.',
    });
    throw new AppError('unauthenticated', 'Your current password is incorrect.');
  }

  assertPasswordAcceptable(input.newPassword, user.email);

  const passwordHash = await hashPassword(input.newPassword);
  await execute('UPDATE users SET password_hash = :hash WHERE id = :id', {
    hash: passwordHash,
    id: userId,
  });

  // Every other device is signed out; the one making the change stays in.
  const revoked = await revokeAllSessions(userId, 'password_changed', sessionId);
  await recordSecurityEvent(req, {
    userId,
    event: 'password_changed',
    sessionId,
    detail: `${revoked} other session(s) ended.`,
  });
  return { changed: true };
}

/** The sessionId is internal bookkeeping and must not reach the client. */
function stripSessionId<T extends AuthTokens & { sessionId?: number }>(tokens: T): AuthTokens {
  return {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresIn: tokens.expiresIn,
  };
}
