/**
 * Runtime configuration (ADR-015).
 *
 * Every business rule the owner asked to be tunable — monetization thresholds,
 * coin rates, task rewards, withdrawal minimums, the new-creator exploration
 * rate — is stored in `system_settings` and read through here. Changing one is
 * an admin action, not a deploy.
 *
 * Reads hit Redis; a miss falls through to MySQL and repopulates. Writes update
 * MySQL and then delete the cache key, so the next read is guaranteed fresh
 * rather than waiting for a TTL to lapse.
 */

import { pool, query, type Db } from './db.ts';
import { keys } from './redis.ts';
import { cache } from './cache.ts';
import { logger } from './logger.ts';
import { DEFAULT_NEW_CREATOR_EXPLORATION_RATE } from '../../../shared/contracts/feed.ts';

const CACHE_TTL_SECONDS = 300;

/**
 * Fallbacks used only when a key has never been written. They mirror the
 * defaults documented in PROJECT_MASTER_LOG.md; the database is authoritative
 * the moment an admin saves anything.
 */
export const SETTING_DEFAULTS = {
  'monetization.enabled': true,
  'monetization.min_withdrawal': 50,
  'monetization.payout_currency': 'USD',
  'monetization.reward_to_coin_rate': 1,
  'monetization.coin_to_payout_rate': 0.01,
  'monetization.gift_platform_share': 0.5,
  'monetization.gift_clearing_days': 7,
  'monetization.withdrawals_open': true,
  'tasks.reset_hour_utc': 0,
  'referral.reward_coins': 100,
  'referral.qualification_rule': 'Referred user must post their first video.',
  'feed.new_creator_exploration_rate': DEFAULT_NEW_CREATOR_EXPLORATION_RATE,
  'feed.per_creator_cap': 0.2,
  'coins.rates': { USD: 100, PKR: 0.35, INR: 0.4 },

  // Advertising. Every one of these is a lever an operator pulls without a
  // deploy: what delivery costs, what a campaign must spend to run, and how
  // much of a feed may be promoted.
  'ads.cost_per_impression': 0.05,
  'ads.cost_per_view': 0.2,
  'ads.min_budget_coins': 100,
  /** Share of a feed page that may be promoted. 0.15 = at most 3 in 20. */
  'ads.feed_density': 0.15,
  /** Never show the same campaign to one person more than this per day. */
  'ads.frequency_cap_per_day': 4,
  'ads.enabled': true,

  'upload.max_duration_sec': 600,
  'upload.max_size_mb': 500,

  // Email delivery. Editable from the admin panel so pointing the platform at
  // Gmail (or any SMTP provider) never needs a deploy. The password is
  // write-only through the API; the admin routes mask it on the way out.
  'email.smtp_host': '',
  'email.smtp_port': 587,
  'email.smtp_user': '',
  'email.smtp_pass': '',
  'email.from': '',

  /*
   * SMS delivery, for one-time codes.
   *
   * Provider-agnostic on purpose. `sms.provider` picks the shape of the
   * request, not a business relationship:
   *
   *   'none'    no SMS is sent; codes go to the log in development and the
   *             platform refuses to claim it texted anyone
   *   'http'    a generic gateway — most regional providers are a GET or POST
   *             with the number and the text as parameters, which is what
   *             `sms.http_url` and `sms.http_body` describe
   *   'twilio'  Twilio's REST API; account SID in `sms.api_key`, auth token in
   *             `sms.api_secret`
   *
   * The credentials are write-only through the API, exactly like the SMTP
   * password.
   */
  'sms.provider': 'none',
  'sms.api_key': '',
  'sms.api_secret': '',
  /** The number or alphanumeric sender ID the message comes from. */
  'sms.sender_id': '',
  /** Generic gateway only: the endpoint. */
  'sms.http_url': '',
  'sms.http_method': 'POST',
  /**
   * Generic gateway only: the request body or query string, with `{to}`,
   * `{text}`, `{key}`, `{secret}` and `{sender}` substituted in. JSON is sent
   * as JSON; anything else is sent form-encoded.
   */
  'sms.http_body': '',
  /** Default country code for numbers typed without one, e.g. 92 for Pakistan. */
  'sms.default_country_code': '',

  // Shown in the app's About screen and enforced on sign-in.
  'app.name': 'Vyra',
  'app.min_supported_version': '1.0.0',
  'app.privacy_policy_url': 'https://example.com/privacy',
  'app.terms_url': 'https://example.com/terms',
  'app.guidelines_url': 'https://example.com/guidelines',
} as const;

export type SettingKey = keyof typeof SETTING_DEFAULTS;

interface SettingRow extends Record<string, unknown> {
  setting_key: string;
  value: unknown;
}

let memo: Record<string, unknown> | null = null;

async function loadAll(): Promise<Record<string, unknown>> {
  const cached = await cache.getJson<Record<string, unknown>>(keys.settings());
  if (cached) return cached;

  const rows = await query<SettingRow>(
    "SELECT setting_key, value FROM system_settings WHERE scope = 'global'",
  ).catch((err) => {
    logger.error({ err }, 'failed to load settings; falling back to defaults');
    return [] as SettingRow[];
  });

  const map: Record<string, unknown> = { ...SETTING_DEFAULTS };
  for (const row of rows) {
    // The column is LONGTEXT, and on MariaDB mysql2 does NOT parse it — the
    // stored `JSON.stringify(value)` comes back as its raw text. Left unparsed,
    // a stored string read back with literal quotes, and a stored `false` read
    // back as the TRUTHY string "false" — an operator switching something off
    // would not have switched it off. So parse here, and tolerate any legacy
    // row that was written as plain text.
    let value = row.value;
    if (typeof value === 'string') {
      try {
        value = JSON.parse(value);
      } catch {
        // A raw string written before values were JSON-encoded; keep as-is.
      }
    }
    map[row.setting_key] = value;
  }

  await cache.setJson(keys.settings(), map, CACHE_TTL_SECONDS);
  return map;
}

/**
 * Widens a default's literal type to what the setting can actually hold.
 *
 * `SETTING_DEFAULTS` is `as const`, so `'monetization.enabled': true` gives the
 * literal type `true` — and `getSetting(...) === false` then fails to compile as
 * a comparison with no overlap. But every one of these is admin-editable at
 * runtime: the whole point of the table is that the value changes. Typing a
 * boolean setting as `true` describes the default, not the setting, and pushes
 * callers into casts around a check that was correct.
 */
type Widen<T> = T extends boolean
  ? boolean
  : T extends number
    ? number
    : T extends string
      ? string
      : T;

export type SettingValue<K extends SettingKey> = Widen<(typeof SETTING_DEFAULTS)[K]>;

/** Reads one setting, typed against what its default allows. */
export async function getSetting<K extends SettingKey>(key: K): Promise<SettingValue<K>> {
  memo ??= await loadAll();
  const value = memo[key];
  return (value === undefined ? SETTING_DEFAULTS[key] : value) as SettingValue<K>;
}

export async function getSettings(): Promise<Record<string, unknown>> {
  memo ??= await loadAll();
  return { ...memo };
}

/**
 * Writes a setting and invalidates every cache layer. `adminId` is recorded so
 * the audit trail can answer "who changed the withdrawal minimum".
 */
export async function setSetting(
  key: string,
  value: unknown,
  adminId: number | null,
  db: Db = pool,
): Promise<void> {
  await db.query(
    `INSERT INTO system_settings (setting_key, value, scope, updated_by)
     VALUES (:key, :value, 'global', :adminId)
     ON DUPLICATE KEY UPDATE value = VALUES(value), updated_by = VALUES(updated_by)`,
    { key, value: JSON.stringify(value), adminId },
  );
  await invalidateSettings();
}

export async function invalidateSettings(): Promise<void> {
  memo = null;
  await cache.del(keys.settings());
}

/** Test seam — lets a test drive behaviour without touching Redis or MySQL. */
export function __setMemoForTesting(values: Record<string, unknown> | null): void {
  memo = values;
}
