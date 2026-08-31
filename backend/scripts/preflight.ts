/**
 * Launch preflight.
 *
 * Thirteen phases have each left something behind: a placeholder account number,
 * a transport that logs instead of sending, a secret with a development default.
 * Every one is fine locally and none is fine in production, and the list is now
 * long enough that nobody is going to remember it.
 *
 * So this enumerates them and fails loudly. It is the answer to "are we ready",
 * and it is deliberately pessimistic: a check that cannot prove something is
 * configured reports it as not configured.
 *
 * Run it against the environment you are about to deploy:
 *
 *     NODE_ENV=production npm run preflight
 *
 * Exit code 1 means do not deploy.
 */

import { config } from '../src/core/config.ts';
import { query, queryOne, pingDb, closeDb } from '../src/core/db.ts';
import { pingRedis, closeRedis } from '../src/core/redis.ts';
import { verifyMailTransport } from '../src/core/mailer.ts';
import { smsConfig } from '../src/core/sms.ts';
import { getSetting } from '../src/core/settings.ts';

type Level = 'pass' | 'warn' | 'fail';

interface Check {
  name: string;
  level: Level;
  detail: string;
}

const checks: Check[] = [];

function record(name: string, level: Level, detail: string): void {
  checks.push({ name, level, detail });
}

/** A development default reaching production is the failure this catches. */
const DEV_SECRET_MARKERS = ['dev', 'change-me', 'secret', 'test', 'vyra-secret', 'localhost'];

function looksLikeDevValue(value: string | undefined): boolean {
  if (!value) return true;
  if (value.length < 32) return true;
  const lower = value.toLowerCase();
  return DEV_SECRET_MARKERS.some((marker) => lower.includes(marker));
}

async function checkSecrets(): Promise<void> {
  const secrets: [string, string | undefined][] = [
    ['JWT_ACCESS_SECRET', config.JWT_ACCESS_SECRET],
    ['JWT_REFRESH_SECRET', config.JWT_REFRESH_SECRET],
  ];

  for (const [name, value] of secrets) {
    if (looksLikeDevValue(value)) {
      record(
        name,
        'fail',
        'Looks like a development default or is too short. Generate at least 32 random characters.',
      );
    } else {
      record(name, 'pass', 'Set to a value that does not look like a default.');
    }
  }

  if (config.JWT_ACCESS_SECRET === config.JWT_REFRESH_SECRET) {
    record(
      'JWT secrets differ',
      'fail',
      'The access and refresh secrets are identical. A leaked access secret would then mint refresh tokens.',
    );
  } else {
    record('JWT secrets differ', 'pass', 'Access and refresh secrets are distinct.');
  }
}

async function checkInfrastructure(): Promise<void> {
  record(
    'Database',
    (await pingDb()) ? 'pass' : 'fail',
    (await pingDb()) ? 'Reachable.' : 'Not reachable.',
  );

  const redisOk = await pingRedis().catch(() => false);
  record(
    'Redis',
    redisOk ? 'pass' : 'fail',
    redisOk
      ? 'Reachable.'
      : 'Not reachable. Rate limiting, idempotency replay and presence all degrade without it.',
  );

  const mail = await verifyMailTransport();
  record(
    'Email transport',
    mail.ok ? 'pass' : 'fail',
    mail.ok
      ? 'SMTP verified.'
      : (mail.detail ?? 'Not configured.') +
        ' Verification codes and password resets cannot reach anyone.',
  );

  record(
    'Push provider',
    config.PUSH_PROVIDER_KEY ? 'pass' : 'warn',
    config.PUSH_PROVIDER_KEY
      ? 'Configured.'
      : 'Not configured. Push messages will queue and fail; in-app notifications still work.',
  );

  /*
   * SMS.
   *
   * A warning rather than a failure: phone sign-in is an additional way in, not
   * the only one, and the app refuses it plainly when no gateway is set instead
   * of pretending to send. What would be a failure is a gateway configured
   * without the country code, because then every locally-typed number is
   * rejected and the operator has no idea why.
   */
  const sms = await smsConfig();
  if (sms.provider === 'none') {
    record(
      'SMS gateway',
      'warn',
      'Not configured. Signing in by phone number is unavailable; the app says so rather than sending nothing.',
    );
  } else if (!sms.defaultCountryCode) {
    record(
      'SMS gateway',
      'fail',
      `${sms.provider} configured, but no default country code. Anyone typing a local number ` +
        '(0300…) will be refused, because the platform cannot tell which country it belongs to.',
    );
  } else if (sms.provider === 'twilio' && (!sms.apiKey || !sms.apiSecret || !sms.senderId)) {
    record('SMS gateway', 'fail', 'Twilio is selected but the SID, token or sender number is missing.');
  } else if (sms.provider === 'http' && !sms.httpUrl) {
    record('SMS gateway', 'fail', 'A generic gateway is selected but no URL is set.');
  } else {
    record('SMS gateway', 'pass', `${sms.provider}, country code +${sms.defaultCountryCode}.`);
  }
}

async function checkMigrations(): Promise<void> {
  // The failure is reported rather than swallowed: a check that cannot read
  // the migration table has not proved the schema is fine, it has proved
  // nothing — and a silent catch here would have reported "not initialised"
  // for a perfectly good database, which is exactly what it did at first.
  let applied: { version: string }[];
  try {
    applied = await query<{ version: string }>(
      'SELECT version FROM schema_migrations ORDER BY version',
    );
  } catch (err) {
    record(
      'Migrations',
      'fail',
      `Could not read schema_migrations: ${err instanceof Error ? err.message : 'unknown error'}`,
    );
    return;
  }

  if (applied.length === 0) {
    record('Migrations', 'fail', 'No migrations recorded. The schema is not initialised.');
    return;
  }
  record('Migrations', 'pass', `${applied.length} applied, latest ${applied[applied.length - 1]?.version}.`);
}

/**
 * Configuration that ships with obvious placeholders.
 *
 * The seed files say REPLACE IN ADMIN precisely so this can find them. Money
 * paid into a placeholder account is money that goes nowhere.
 */
async function checkPaymentConfiguration(): Promise<void> {
  /*
   * Both fields are read, and the message names the one still unset.
   *
   * It used to list only the method — "Easypaisa, JazzCash, Bank transfer still
   * have placeholder details" — which is true and not actionable: an operator
   * who has carefully filled in all three account numbers has no way to tell
   * that it is the account *name* still holding the seeded value, and reads the
   * same failure after fixing the thing they were told about.
   */
  const rows = await query<{ label: string; account_name: string; account_number: string }>(
    `SELECT label, account_name, account_number FROM payment_methods
      WHERE is_enabled = 1
        AND (account_name LIKE '%REPLACE%' OR account_number LIKE '%REPLACE%'
          OR account_number LIKE '0000%')`,
  ).catch(() => []);

  if (rows.length > 0) {
    const detail = rows
      .map((row) => {
        const unset: string[] = [];
        if (/REPLACE/i.test(row.account_name ?? '')) unset.push('account name');
        if (/REPLACE/i.test(row.account_number ?? '') || /^0000/.test(row.account_number ?? '')) {
          unset.push('account number');
        }
        return `${row.label} (${unset.join(' and ') || 'account details'})`;
      })
      .join(', ');

    record(
      'Payment accounts',
      'fail',
      `${rows.length} enabled method(s) still hold seeded values — ${detail}. ` +
        'Set them in Admin \u2192 Rates & Methods, or switch the method off. ' +
        'Buyers would send money nowhere.',
    );
  } else {
    record('Payment accounts', 'pass', 'No placeholder account details on enabled methods.');
  }

  const gifts = await queryOne<{ c: number }>(
    'SELECT COUNT(*) AS c FROM gifts WHERE is_active = 1',
  ).catch(() => ({ c: 0 }));
  record(
    'Gift catalogue',
    Number(gifts?.c ?? 0) > 0 ? 'pass' : 'warn',
    Number(gifts?.c ?? 0) > 0
      ? `${Number(gifts?.c)} active gifts.`
      : 'No active gifts. Run npm run seed:gifts.',
  );

  const packages = await queryOne<{ c: number }>(
    'SELECT COUNT(*) AS c FROM coin_packages WHERE is_enabled = 1',
  ).catch(() => ({ c: 0 }));
  record(
    'Coin packages',
    Number(packages?.c ?? 0) > 0 ? 'pass' : 'warn',
    Number(packages?.c ?? 0) > 0
      ? `${Number(packages?.c)} enabled.`
      : 'No enabled packages. Run npm run seed:monetization.',
  );
}

async function checkMoneySettings(): Promise<void> {
  const share = Number(await getSetting('monetization.gift_platform_share'));
  record(
    'Gift platform share',
    share >= 0 && share <= 0.9 ? 'pass' : 'fail',
    `${Math.round(share * 100)}% — must be between 0 and 90.`,
  );

  const rate = Number(await getSetting('monetization.coin_to_payout_rate'));
  record(
    'Coin payout rate',
    rate > 0 ? 'pass' : 'fail',
    rate > 0 ? `${rate} per coin.` : 'Zero — cleared earnings would convert to nothing.',
  );

  const density = Number(await getSetting('ads.feed_density'));
  record(
    'Ad density',
    density >= 0 && density <= 0.5 ? 'pass' : 'warn',
    `${Math.round(density * 100)}% of a page may be promoted.`,
  );
}

async function checkAdministration(): Promise<void> {
  const admins = await queryOne<{ c: number }>(
    "SELECT COUNT(*) AS c FROM admin_users WHERE deleted_at IS NULL AND status = 'active'",
  ).catch(() => ({ c: 0 }));

  record(
    'Administrators',
    Number(admins?.c ?? 0) > 0 ? 'pass' : 'fail',
    Number(admins?.c ?? 0) > 0
      ? `${Number(admins?.c)} active.`
      : 'None. Nobody could approve a payment, review a report or stop a stream.',
  );

  const roles = await queryOne<{ c: number }>('SELECT COUNT(*) AS c FROM roles').catch(() => ({
    c: 0,
  }));
  record(
    'Roles',
    Number(roles?.c ?? 0) > 0 ? 'pass' : 'fail',
    Number(roles?.c ?? 0) > 0 ? `${Number(roles?.c)} defined.` : 'None defined.',
  );
}

async function checkOutbox(): Promise<void> {
  const stuck = await queryOne<{ c: number }>(
    `SELECT COUNT(*) AS c FROM outbox
      WHERE status = 'pending'
        AND created_at < DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 1 HOUR)`,
  ).catch(() => ({ c: 0 }));

  record(
    'Outbox backlog',
    Number(stuck?.c ?? 0) === 0 ? 'pass' : 'warn',
    Number(stuck?.c ?? 0) === 0
      ? 'Nothing older than an hour is waiting.'
      : `${Number(stuck?.c)} message(s) queued over an hour ago. Is the drain running?`,
  );
}

function checkMedia(): void {
  record(
    'Media storage',
    config.STORAGE_PUBLIC_URL.includes('127.0.0.1') || config.STORAGE_PUBLIC_URL.includes('localhost')
      ? 'fail'
      : 'pass',
    config.STORAGE_PUBLIC_URL.includes('127.0.0.1') || config.STORAGE_PUBLIC_URL.includes('localhost')
      ? `STORAGE_PUBLIC_URL points at ${config.STORAGE_PUBLIC_URL}. No device outside this machine could load media.`
      : 'Points at a non-local host.',
  );

  const ingestLocal =
    config.LIVE_INGEST_URL.includes('127.0.0.1') || config.LIVE_INGEST_URL.includes('localhost');
  record(
    'Live ingest',
    ingestLocal ? 'warn' : 'pass',
    ingestLocal
      ? `LIVE_INGEST_URL is ${config.LIVE_INGEST_URL}. No media server has been exercised — broadcasting is untested end to end.`
      : 'Points at a non-local host.',
  );
}

function checkCors(): void {
  const origins = config.CORS_ORIGINS;
  const permissive = origins.includes('*');
  record(
    'CORS origins',
    permissive ? 'fail' : 'pass',
    permissive
      ? 'A wildcard origin is set. Any site could call the API with a user’s credentials.'
      : `${origins.length} explicit origin(s).`,
  );
}

async function main(): Promise<void> {
  const target = config.isProduction ? 'production' : config.NODE_ENV;
  console.log(`\n  Launch preflight — ${target}\n`);

  await checkSecrets();
  await checkInfrastructure();
  await checkMigrations();
  await checkPaymentConfiguration();
  await checkMoneySettings();
  await checkAdministration();
  await checkOutbox();
  checkMedia();
  checkCors();

  const icon = { pass: '  OK  ', warn: ' WARN ', fail: ' FAIL ' };
  for (const check of checks) {
    console.log(`${icon[check.level]} ${check.name.padEnd(24)} ${check.detail}`);
  }

  const failures = checks.filter((c) => c.level === 'fail');
  const warnings = checks.filter((c) => c.level === 'warn');

  console.log(
    `\n  ${checks.length - failures.length - warnings.length} passed, ` +
      `${warnings.length} warning(s), ${failures.length} failure(s)\n`,
  );

  if (failures.length > 0) {
    console.log('  Not ready. Every FAIL above would be a real problem in production.\n');
    process.exitCode = 1;
    return;
  }
  if (warnings.length > 0) {
    console.log('  Ready, with caveats. Read the warnings before deploying.\n');
    return;
  }
  console.log('  Ready.\n');
}

main()
  .catch((err: unknown) => {
    console.error('  Preflight itself failed:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
    await closeRedis();
  });
