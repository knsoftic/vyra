/**
 * Sending email.
 *
 * Two transports and no pretending. Which one is active is decided by
 * configuration and is reported by the launch preflight, because "email works"
 * is a claim the operator has to be able to check rather than assume.
 *
 * **SMTP** when a host is configured. Real delivery. The configuration lives in
 * two places with a strict order: the admin panel's settings first (so the
 * operator can point the platform at Gmail or any other provider without a
 * deploy or a server restart), then the `SMTP_*` environment variables as the
 * fallback. A password stored in settings is write-only through the API — the
 * admin routes mask it on the way out.
 *
 * For Gmail specifically: host `smtp.gmail.com`, port `587`, the account's
 * address as the user, and an **App Password** (Google account → Security →
 * 2-Step Verification → App passwords) — a normal Gmail password is refused by
 * Google for SMTP.
 *
 * **Console** otherwise: the message is logged and marked sent. This is what
 * makes development possible without a mail server, and it is also the thing
 * most likely to reach production by accident — so it announces itself loudly
 * on every send, and `preflight` refuses to pass a production configuration
 * that is still using it.
 *
 * There is deliberately no third mode that swallows the message silently. A
 * transport that reports success without delivering is how "we sent you a
 * reset link" becomes untrue.
 */

import { createTransport, type Transporter } from 'nodemailer';
import { config } from './config.ts';
import { logger } from './logger.ts';
import { getSetting } from './settings.ts';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export type MailTransportKind = 'smtp' | 'console';

export interface ResolvedMailConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
  /** Where the configuration came from, so operators can tell which one won. */
  source: 'settings' | 'environment';
}

/**
 * The active SMTP configuration, or null when there is none.
 *
 * Settings win over environment because they are the ones the operator can
 * actually change at runtime; an environment variable is frozen at boot.
 */
export async function resolveMailConfig(): Promise<ResolvedMailConfig | null> {
  const host = String((await getSetting('email.smtp_host')) ?? '').trim();
  if (host) {
    const from = String((await getSetting('email.from')) ?? '').trim();
    const user = String((await getSetting('email.smtp_user')) ?? '').trim();
    return {
      host,
      port: Number(await getSetting('email.smtp_port')) || 587,
      user,
      pass: String((await getSetting('email.smtp_pass')) ?? ''),
      from: from || (user ? `Vyra <${user}>` : config.MAIL_FROM),
      source: 'settings',
    };
  }

  if (config.SMTP_HOST) {
    return {
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      user: config.SMTP_USER ?? '',
      pass: config.SMTP_PASSWORD ?? '',
      from: config.MAIL_FROM,
      source: 'environment',
    };
  }

  return null;
}

export async function transportKind(): Promise<MailTransportKind> {
  return (await resolveMailConfig()) ? 'smtp' : 'console';
}

/**
 * The transporter is cached per configuration, not per process, so an admin
 * changing the SMTP account takes effect on the next send rather than the next
 * restart.
 */
let cached: { signature: string; transporter: Transporter } | null = null;

function smtp(resolved: ResolvedMailConfig): Transporter {
  const signature = `${resolved.host}:${resolved.port}:${resolved.user}:${resolved.pass}`;
  if (cached?.signature !== signature) {
    cached = {
      signature,
      transporter: createTransport({
        host: resolved.host,
        port: resolved.port,
        // 465 is implicit TLS; 587 (Gmail's port) upgrades via STARTTLS.
        secure: resolved.port === 465,
        ...(resolved.user ? { auth: { user: resolved.user, pass: resolved.pass } } : {}),
      }),
    };
  }
  return cached.transporter;
}

/**
 * Sends one message.
 *
 * Throws on failure rather than returning a flag: the caller is the outbox
 * drain, which needs the error to decide whether to retry, and needs the
 * distinction between "sent" and "not sent" to be impossible to ignore.
 */
export async function sendMail(message: MailMessage): Promise<{ transport: MailTransportKind }> {
  const resolved = await resolveMailConfig();

  if (!resolved) {
    logger.warn(
      {
        to: message.to,
        subject: message.subject,
        // The body is logged in full because in development this log *is* the
        // inbox — a verification code nobody can read is a flow nobody can test.
        text: message.text,
      },
      'EMAIL NOT SENT — no SMTP configured. Logged instead.',
    );
    return { transport: 'console' };
  }

  await smtp(resolved).sendMail({
    from: resolved.from,
    to: message.to,
    subject: message.subject,
    text: message.text,
    ...(message.html ? { html: message.html } : {}),
  });
  return { transport: 'smtp' };
}

/**
 * Proves the transport can actually talk to the server.
 *
 * Used by the preflight and by the admin panel's "send test email" button. A
 * configuration that looks complete but has a wrong password fails here, not at
 * 2am when the first user asks for a reset code.
 */
export async function verifyMailTransport(): Promise<{ ok: boolean; detail?: string }> {
  const resolved = await resolveMailConfig();
  if (!resolved) {
    return {
      ok: false,
      detail: 'No SMTP host configured — email is written to the log, not delivered.',
    };
  }
  try {
    await smtp(resolved).verify();
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      detail: `SMTP verify failed (${resolved.source}: ${resolved.host}:${resolved.port}): ${err instanceof Error ? err.message : 'unknown error'}`,
    };
  }
}

/** Closes the pooled connection so one-shot scripts can exit cleanly. */
export function closeMailer(): void {
  cached?.transporter.close();
  cached = null;
}
