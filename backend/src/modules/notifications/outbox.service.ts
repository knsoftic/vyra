/**
 * Draining the outbox.
 *
 * Everything leaving the platform goes through here: verification codes, password
 * resets, notification emails, push messages.
 *
 * **A row is claimed before it is sent.** The claim is a conditional update from
 * `pending` to `sending`, so two workers cannot send the same message twice —
 * which for a password reset would mean two valid links in someone's inbox.
 *
 * **A failure is recorded, backed off, and retried.** After a bounded number of
 * attempts the row is `abandoned` rather than retried for ever, and it stays
 * visible. Something undeliverable should be findable, not silently gone.
 *
 * **The body is rendered at send time**, from the template and the stored
 * variables. A template correction therefore reaches messages already queued.
 */

import { query, execute, isDuplicateKey } from '../../core/db.ts';
import { logger } from '../../core/logger.ts';
import { sendMail, transportKind } from '../../core/mailer.ts';
import { config } from '../../core/config.ts';

/** Beyond this a message is not going to be delivered by trying again. */
const MAX_ATTEMPTS = 5;
/** Doubling backoff, in seconds, so a failing provider is not hammered. */
const BACKOFF_BASE_SECONDS = 30;

interface OutboxRow {
  id: number;
  public_id: string;
  channel: 'email' | 'push';
  destination: string;
  template: string;
  subject: string | null;
  payload: string;
  attempts: number;
}

export interface RenderedMessage {
  subject: string;
  text: string;
}

/**
 * The templates.
 *
 * Plain text, deliberately. An HTML email that renders differently in six
 * clients is a support burden, and every message here is short and functional —
 * a code, a link, a one-line notice.
 */
const TEMPLATES: Record<string, (vars: Record<string, unknown>) => RenderedMessage> = {
  'otp.signup': (v) => ({
    subject: 'Your Vyra verification code',
    text:
      `Your verification code is ${String(v.code)}.\n\n` +
      'It expires in 10 minutes and can be used once.\n\n' +
      'If you did not ask for this, you can ignore this email — nobody can use the code without it.',
  }),

  'otp.login': (v) => ({
    subject: 'Your Vyra sign-in code',
    text:
      `Your sign-in code is ${String(v.code)}.\n\n` +
      'It expires in 10 minutes and can be used once.\n\n' +
      'If this was not you, someone has your email address but not your password. ' +
      'You do not need to do anything, but changing your password is a reasonable precaution.',
  }),

  'otp.reset': (v) => ({
    subject: 'Reset your Vyra password',
    text:
      `Your password reset code is ${String(v.code)}.\n\n` +
      'It expires in 10 minutes and can be used once.\n\n' +
      'If you did not ask to reset your password, ignore this email. Your password has not changed.',
  }),

  'otp.email_change': (v) => ({
    subject: 'Confirm your new email address',
    text:
      `Your confirmation code is ${String(v.code)}.\n\n` +
      'It expires in 10 minutes and can be used once.',
  }),

  'verification.decided': (v) => ({
    subject:
      v.decision === 'approved'
        ? 'Your Vyra verification was approved'
        : 'An update on your Vyra verification',
    text: String(v.note ?? 'Your verification request has been reviewed.'),
  }),

  'moderation.action': (v) => ({
    subject: 'An update about your Vyra account',
    text: String(v.body ?? 'There has been a change to your account.'),
  }),

  'support.reply': (v) => ({
    subject: `Re: ${String(v.subject ?? 'your support ticket')}`,
    text: String(v.body ?? 'Support has replied to your ticket.'),
  }),

  'notification.generic': (v) => ({
    subject: String(v.subject ?? 'Vyra'),
    text: String(v.body ?? ''),
  }),
};

function render(template: string, payload: string): RenderedMessage {
  let vars: Record<string, unknown> = {};
  try {
    vars = JSON.parse(payload) as Record<string, unknown>;
  } catch {
    vars = {};
  }

  const build = TEMPLATES[template] ?? TEMPLATES['notification.generic']!;
  return build(vars);
}

export interface DrainResult {
  sent: number;
  failed: number;
  abandoned: number;
  /** What actually carried the messages, so a caller can report it honestly. */
  transport: string;
}

/**
 * Sends everything due.
 *
 * Run on a schedule, or on demand. Safe to run concurrently: each row is claimed
 * before it is touched.
 */
export async function drain(limit = 50): Promise<DrainResult> {
  const result: DrainResult = { sent: 0, failed: 0, abandoned: 0, transport: await transportKind() };

  const due = await query<OutboxRow>(
    `SELECT id, public_id, channel, destination, template, subject, payload, attempts
       FROM outbox
      WHERE status = 'pending'
        AND next_attempt_at <= CURRENT_TIMESTAMP(3)
      ORDER BY created_at
      LIMIT :limit`,
    { limit },
  );

  for (const row of due) {
    // Claim it. A second worker's update matches nothing and it moves on.
    const claimed = await execute(
      "UPDATE outbox SET status = 'sending' WHERE id = :id AND status = 'pending'",
      { id: row.id },
    );
    if (claimed.affectedRows === 0) continue;

    try {
      if (row.channel === 'email') {
        const message = render(row.template, row.payload);
        await sendMail({
          to: row.destination,
          subject: row.subject ?? message.subject,
          text: message.text,
        });
      } else {
        await sendPush(row);
      }

      await execute(
        "UPDATE outbox SET status = 'sent', sent_at = CURRENT_TIMESTAMP(3) WHERE id = :id",
        { id: row.id },
      );
      result.sent += 1;
    } catch (err) {
      const attempts = row.attempts + 1;
      const message = err instanceof Error ? err.message.slice(0, 500) : 'Unknown failure';

      if (attempts >= MAX_ATTEMPTS) {
        // Not retried again, and not deleted. Something undeliverable should be
        // findable — an address that always bounces is worth knowing about.
        await execute(
          `UPDATE outbox SET status = 'abandoned', attempts = :attempts, last_error = :error
            WHERE id = :id`,
          { attempts, error: message, id: row.id },
        );
        result.abandoned += 1;
        logger.error(
          { outboxId: row.public_id, channel: row.channel, attempts, error: message },
          'message abandoned after repeated failures',
        );
      } else {
        const backoff = BACKOFF_BASE_SECONDS * 2 ** (attempts - 1);
        await execute(
          `UPDATE outbox
              SET status = 'pending', attempts = :attempts, last_error = :error,
                  next_attempt_at = DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL :backoff SECOND)
            WHERE id = :id`,
          { attempts, error: message, backoff, id: row.id },
        );
        result.failed += 1;
        logger.warn(
          { outboxId: row.public_id, attempts, backoff, error: message },
          'message failed, will retry',
        );
      }
    }
  }

  return result;
}

/**
 * Push delivery.
 *
 * There is no push provider configured in this build, and rather than pretend
 * otherwise this throws — so the row records a real failure and an operator can
 * see that push is not wired up. Marking it sent would make the outbox lie about
 * every notification the platform never delivered.
 */
async function sendPush(row: OutboxRow): Promise<void> {
  if (!config.PUSH_PROVIDER_KEY) {
    throw new Error('No push provider configured — the message was not delivered.');
  }
  // A real integration replaces this. The shape is deliberately left explicit so
  // whoever adds FCM or APNs has an obvious place for it.
  throw new Error(`Push provider not implemented for ${row.destination.slice(0, 8)}…`);
}

/**
 * Queues one message directly. Used by flows that are not notifications.
 *
 * `queued: false` means this exact message was already waiting — the dedupe key
 * collided and nothing new was written. Callers rely on that answer to decide
 * whether they have just caused an email, so it has to be the truth.
 *
 * It is taken from the database rejecting the insert, not from `affectedRows`.
 * The previous version used `ON DUPLICATE KEY UPDATE id = id` and treated a zero
 * row count as a collision, which is how the CLI behaves but not how mysql2's
 * prepared statements do: they report a matched row either way, so every
 * duplicate was reported as successfully queued.
 */
export async function queue(input: {
  channel: 'email' | 'push';
  destination: string;
  template: string;
  payload: Record<string, unknown>;
  userId?: number;
  subject?: string;
  dedupeKey?: string;
}): Promise<{ queued: boolean }> {
  const { ulid } = await import('ulid');

  try {
    await execute(
      `INSERT INTO outbox
         (public_id, channel, destination, user_id, template, subject, payload, dedupe_key)
       VALUES (:publicId, :channel, :destination, :userId, :template, :subject, :payload, :dedupeKey)`,
      {
        publicId: ulid(),
        channel: input.channel,
        destination: input.destination,
        userId: input.userId ?? null,
        template: input.template,
        subject: input.subject ?? null,
        payload: JSON.stringify(input.payload),
        dedupeKey: input.dedupeKey ?? null,
      },
    );
    return { queued: true };
  } catch (err) {
    // Only a dedupe collision is expected here. Anything else — a bad channel, a
    // destination too long — is a real failure and must not look like a duplicate.
    if (input.dedupeKey && isDuplicateKey(err)) return { queued: false };
    throw err;
  }
}

/** What the outbox looks like right now, for health and the admin panel. */
export async function status(): Promise<{
  pending: number;
  failed: number;
  abandoned: number;
  oldestPendingAgeSeconds: number | null;
  transport: string;
}> {
  const rows = await query<{ status: string; c: number; oldest: Date | null }>(
    `SELECT status, COUNT(*) AS c, MIN(created_at) AS oldest
       FROM outbox
      WHERE status IN ('pending', 'sending', 'abandoned')
      GROUP BY status`,
  );

  const byStatus = new Map(rows.map((r) => [r.status, r]));
  const pending = byStatus.get('pending');

  return {
    pending: Number(pending?.c ?? 0) + Number(byStatus.get('sending')?.c ?? 0),
    // Rows that failed at least once but are still being retried.
    failed: await failedCount(),
    abandoned: Number(byStatus.get('abandoned')?.c ?? 0),
    oldestPendingAgeSeconds: pending?.oldest
      ? Math.floor((Date.now() - new Date(pending.oldest).getTime()) / 1000)
      : null,
    transport: await transportKind(),
  };
}

async function failedCount(): Promise<number> {
  const rows = await query<{ c: number }>(
    "SELECT COUNT(*) AS c FROM outbox WHERE status = 'pending' AND attempts > 0",
  );
  return Number(rows[0]?.c ?? 0);
}

/**
 * Clears delivered messages older than the retention window.
 *
 * A sent verification code has no value after the fact and every day it stays is
 * a day it could be read. Abandoned rows are kept: they are the record of
 * something that did not arrive.
 */
export async function pruneSent(olderThanDays = 7): Promise<{ removed: number }> {
  const result = await execute(
    `DELETE FROM outbox
      WHERE status = 'sent'
        AND sent_at < DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL :days DAY)`,
    { days: olderThanDays },
  );
  return { removed: result.affectedRows };
}
