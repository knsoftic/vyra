/**
 * Sending SMS.
 *
 * The same rule the mailer follows: a transport that reports success without
 * delivering is how "we texted you a code" becomes untrue. There is no silent
 * mode here. When no provider is configured, `send` returns `delivered: false`
 * and says why, and the caller is expected to surface that rather than tell
 * someone to check a phone that will never ring.
 *
 * Provider-agnostic by design. Regional SMS gateways vary enormously in shape,
 * and hard-coding one would mean a deploy every time the operator changes
 * supplier — so the request is described in settings instead:
 *
 *   `http`    a URL, a method, and a body template with `{to}`, `{text}`,
 *             `{key}`, `{secret}` and `{sender}` placeholders. Covers nearly
 *             every gateway that is "call this URL with the number and the
 *             message".
 *   `twilio`  the REST API, since it is common enough to be worth building in.
 *
 * Everything is read from settings on each send rather than cached at boot, so
 * changing the gateway in the admin panel takes effect immediately.
 */

import { config } from './config.ts';
import { logger } from './logger.ts';
import { getSetting } from './settings.ts';

export type SmsProvider = 'none' | 'http' | 'twilio';

export interface SmsMessage {
  /** E.164 without the plus, e.g. `923001234567`. */
  to: string;
  text: string;
}

export interface SmsResult {
  delivered: boolean;
  provider: SmsProvider;
  /** Present when delivery did not happen — shown to operators, never to users. */
  reason?: string;
}

/** How long to wait on a gateway before giving up. */
const TIMEOUT_MS = 10_000;

/**
 * Normalises a typed number to digits only, with a country code.
 *
 * A person typing their own number writes it the way they say it — `0300 123
 * 4567` — and a gateway needs `923001234567`. The leading zero is a domestic
 * trunk prefix and is dropped when a country code is supplied, which is the
 * single most common reason an OTP silently goes nowhere.
 *
 * **A domestic number with no configured country code is refused, not stored.**
 * The account is keyed on this string, so `03001234567` and `923001234567`
 * being treated as different numbers means one person ends up with two
 * accounts depending on how they happened to type it — which is exactly what
 * happened the first time this was tested. When the operator has not set
 * `sms.default_country_code`, a number without an international prefix is
 * genuinely ambiguous, and guessing is worse than asking.
 */
export function normalisePhone(input: string, defaultCountryCode = ''): string | null {
  const trimmed = input.trim();
  const hasPlus = trimmed.startsWith('+');
  let digits = trimmed.replace(/\D/g, '');

  if (!digits) return null;

  if (!hasPlus) {
    const cc = defaultCountryCode.replace(/\D/g, '');
    if (!cc) {
      // Nothing to resolve it against. A leading zero, or anything short
      // enough to be a domestic number, cannot be identified.
      if (digits.startsWith('0') || digits.length < 11) return null;
    } else if (digits.startsWith('0')) {
      digits = cc + digits.replace(/^0+/, '');
    } else if (!digits.startsWith(cc)) {
      digits = cc + digits;
    }
  }

  // A number that still carries a trunk prefix was never resolved.
  if (digits.startsWith('0')) return null;

  // Shortest usable international numbers are around 8 digits; longest is 15
  // by the E.164 standard. Outside that it is not a phone number.
  if (digits.length < 8 || digits.length > 15) return null;
  return digits;
}

export interface ResolvedSmsConfig {
  provider: SmsProvider;
  apiKey: string;
  apiSecret: string;
  senderId: string;
  httpUrl: string;
  httpMethod: string;
  httpBody: string;
  defaultCountryCode: string;
}

export async function smsConfig(): Promise<ResolvedSmsConfig> {
  const [provider, apiKey, apiSecret, senderId, httpUrl, httpMethod, httpBody, cc] =
    await Promise.all([
      getSetting('sms.provider'),
      getSetting('sms.api_key'),
      getSetting('sms.api_secret'),
      getSetting('sms.sender_id'),
      getSetting('sms.http_url'),
      getSetting('sms.http_method'),
      getSetting('sms.http_body'),
      getSetting('sms.default_country_code'),
    ]);

  return {
    provider: (['none', 'http', 'twilio'].includes(String(provider))
      ? String(provider)
      : 'none') as SmsProvider,
    apiKey: String(apiKey ?? ''),
    apiSecret: String(apiSecret ?? ''),
    senderId: String(senderId ?? ''),
    httpUrl: String(httpUrl ?? ''),
    httpMethod: String(httpMethod ?? 'POST').toUpperCase() === 'GET' ? 'GET' : 'POST',
    httpBody: String(httpBody ?? ''),
    defaultCountryCode: String(cc ?? ''),
  };
}

/** Fills `{to}`, `{text}` and the credentials into a gateway's template. */
function fillTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{(to|text|key|secret|sender)\}/g, (_, name: string) =>
    encodeURIComponent(values[name] ?? ''),
  );
}

/**
 * Sends one message.
 *
 * Never throws: a gateway being down must not turn into a 500 on a login
 * attempt. The caller decides what to tell the user.
 */
export async function sendSms(message: SmsMessage): Promise<SmsResult> {
  const cfg = await smsConfig();

  if (cfg.provider === 'none') {
    // Outside production this is how development works, and it is loud about
    // it. In production the preflight refuses to pass this configuration.
    if (!config.isProduction) {
      logger.warn(
        { to: message.to, text: message.text },
        'SMS not configured — code logged instead of sent',
      );
    }
    return { delivered: false, provider: 'none', reason: 'No SMS provider is configured.' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    if (cfg.provider === 'twilio') {
      if (!cfg.apiKey || !cfg.apiSecret || !cfg.senderId) {
        return {
          delivered: false,
          provider: 'twilio',
          reason: 'Twilio needs an account SID, an auth token and a sender number.',
        };
      }

      const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(cfg.apiKey)}/Messages.json`;
      const res = await fetch(url, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          authorization: `Basic ${Buffer.from(`${cfg.apiKey}:${cfg.apiSecret}`).toString('base64')}`,
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          To: `+${message.to}`,
          From: cfg.senderId,
          Body: message.text,
        }).toString(),
      });

      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        return { delivered: false, provider: 'twilio', reason: `Twilio refused: ${res.status} ${detail.slice(0, 200)}` };
      }
      return { delivered: true, provider: 'twilio' };
    }

    // Generic gateway.
    if (!cfg.httpUrl) {
      return { delivered: false, provider: 'http', reason: 'No gateway URL is configured.' };
    }

    const values = {
      to: message.to,
      text: message.text,
      key: cfg.apiKey,
      secret: cfg.apiSecret,
      sender: cfg.senderId,
    };
    const body = fillTemplate(cfg.httpBody, values);
    const url = fillTemplate(cfg.httpUrl, values);

    // A template that parses as JSON is sent as JSON; anything else is treated
    // as a query string, which is what most gateways expect.
    let isJson = false;
    if (body.trim().startsWith('{')) {
      try {
        JSON.parse(decodeURIComponent(body));
        isJson = true;
      } catch {
        isJson = false;
      }
    }

    const res =
      cfg.httpMethod === 'GET'
        ? await fetch(body ? `${url}${url.includes('?') ? '&' : '?'}${body}` : url, {
            method: 'GET',
            signal: controller.signal,
          })
        : await fetch(url, {
            method: 'POST',
            signal: controller.signal,
            headers: {
              'content-type': isJson ? 'application/json' : 'application/x-www-form-urlencoded',
            },
            body: isJson ? decodeURIComponent(body) : body,
          });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      return {
        delivered: false,
        provider: 'http',
        reason: `Gateway refused: ${res.status} ${detail.slice(0, 200)}`,
      };
    }
    return { delivered: true, provider: 'http' };
  } catch (err) {
    const reason = (err as Error).name === 'AbortError' ? 'The gateway did not respond.' : (err as Error).message;
    logger.error({ err, to: message.to }, 'SMS send failed');
    return { delivered: false, provider: cfg.provider, reason };
  } finally {
    clearTimeout(timer);
  }
}
