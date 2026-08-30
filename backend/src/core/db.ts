/**
 * MySQL access.
 *
 * Everything that moves money goes through `transaction()`. It is the only way
 * to get a connection that can write to `wallets` and `wallet_ledger`, which
 * makes "balance and ledger updated together or not at all" a property of the
 * code path rather than a convention people have to remember.
 */

import mysql from 'mysql2/promise';
import { config } from './config.ts';
import { logger } from './logger.ts';
import { withTimeout } from './timeout.ts';

/**
 * Whether an error is a unique-key collision.
 *
 * The database rejecting a duplicate is the only trustworthy signal that a row
 * already existed. `affectedRows` is not: mysql2's prepared-statement path
 * reports a matched row for a no-op `ON DUPLICATE KEY UPDATE`, so an insert
 * that changed nothing is indistinguishable from one that inserted.
 */
export function isDuplicateKey(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === 'ER_DUP_ENTRY';
}

export const pool = mysql.createPool({
  host: config.DB_HOST,
  port: config.DB_PORT,
  user: config.DB_USER,
  password: config.DB_PASSWORD,
  database: config.DB_NAME,
  connectionLimit: config.DB_POOL_SIZE,
  waitForConnections: true,
  queueLimit: 0,
  charset: 'utf8mb4_unicode_ci',
  /**
   * How to read a DATETIME.
   *
   * MySQL's DATETIME carries no zone: it stores the wall-clock value that was
   * written. Everything here is written with `CURRENT_TIMESTAMP(3)`, which uses
   * the server's session time zone — `SYSTEM` by default, so local time.
   *
   * This said `'Z'`, which told mysql2 to read those local wall-clock values as
   * though they were UTC. Every timestamp the API returned was therefore shifted
   * by the machine's UTC offset — five hours into the *future* on a UTC+5 host,
   * which made "2 minutes ago" render as "just now" and every session look like
   * it had been used seconds ago.
   *
   * `'local'` reads them the way they were written, which makes existing rows
   * correct as well as new ones. Storing UTC instead would be the better
   * long-term shape, but it needs the stored values migrated by the offset in
   * every table at once; interpreting them correctly does not.
   */
  timezone: 'local',
  // Money is DECIMAL. Returning it as a JS float would introduce rounding error,
  // so it comes back as a string and is parsed deliberately where needed.
  decimalNumbers: false,
  supportBigNumbers: true,
  bigNumberStrings: false,
  namedPlaceholders: true,
});

/**
 * Force strict mode on every connection.
 *
 * XAMPP's MariaDB ships with a permissive `sql_mode`, which silently coerces bad
 * data instead of rejecting it: an invalid ENUM becomes '', an over-long string
 * is truncated, an out-of-range number is clamped. That turns a bug that should
 * surface immediately as a failed insert into corrupted rows discovered much
 * later — and it caught us once already, writing six catalogue rows with an
 * empty `kind`.
 *
 * Setting it per connection rather than relying on server configuration means
 * the guarantee travels with the application, whatever host it runs against.
 */
const STRICT_SQL_MODE = [
  'STRICT_TRANS_TABLES',
  'NO_ZERO_IN_DATE',
  'NO_ZERO_DATE',
  'ERROR_FOR_DIVISION_BY_ZERO',
  'NO_ENGINE_SUBSTITUTION',
].join(',');

pool.on('connection', (conn) => {
  // Even on a promise pool this event hands over the raw callback-style
  // connection, whose `query` returns a Query object rather than a promise.
  // Awaiting it throws, which would break every connection the pool opens — so
  // the callback form is the correct one here.
  const raw = conn as unknown as {
    query: (sql: string, cb: (err: unknown) => void) => unknown;
  };
  raw.query(`SET SESSION sql_mode = '${STRICT_SQL_MODE}'`, (err) => {
    if (err) logger.error({ err }, 'could not set strict sql_mode on a new connection');
  });
});

export type Db = mysql.Pool | mysql.PoolConnection;

/**
 * Row types are plain objects here rather than mysql2's `RowDataPacket`.
 * `RowDataPacket` carries a `constructor: { name: 'RowDataPacket' }` member, so
 * using it as a generic constraint forces every caller to declare that field on
 * its own interfaces. The cast is confined to these four helpers instead.
 */
export type Row = Record<string, unknown>;

type Params = Record<string, unknown> | unknown[];

export async function query<T extends object = Row>(
  sql: string,
  params?: Params,
  db: Db = pool,
): Promise<T[]> {
  const [rows] = await db.query<mysql.RowDataPacket[]>(sql, params as never);
  return rows as unknown as T[];
}

export async function queryOne<T extends object = Row>(
  sql: string,
  params?: Params,
  db: Db = pool,
): Promise<T | undefined> {
  const rows = await query<T>(sql, params, db);
  return rows[0];
}

export async function execute(
  sql: string,
  params?: Params,
  db: Db = pool,
): Promise<mysql.ResultSetHeader> {
  const [result] = await db.query<mysql.ResultSetHeader>(sql, params as never);
  return result;
}

/**
 * Runs `fn` inside a transaction, committing on return and rolling back on throw.
 * The connection is always released, including when the rollback itself fails.
 */
export async function transaction<T>(fn: (tx: mysql.PoolConnection) => Promise<T>): Promise<T> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    try {
      await conn.rollback();
    } catch (rollbackErr) {
      // The original error is what the caller needs; surface the rollback failure
      // separately rather than letting it mask the cause.
      logger.error({ err: rollbackErr }, 'rollback failed');
    }
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Locks a row for the duration of the transaction. Required before reading a
 * balance you are about to change: without it two concurrent gift sends both read
 * the same balance and the second overdraws.
 */
export async function selectForUpdate<T extends object = Row>(
  tx: mysql.PoolConnection,
  sql: string,
  params?: Record<string, unknown> | unknown[],
): Promise<T | undefined> {
  const rows = await query<T>(`${sql} FOR UPDATE`, params, tx);
  return rows[0];
}

/**
 * Bounded liveness check. A readiness probe must answer fast: without the
 * timeout a connection stuck in TCP retry makes /ready hang until the caller
 * gives up, which reads as "no response" rather than "not ready".
 */
export async function pingDb(timeoutMs = 2000): Promise<boolean> {
  try {
    await withTimeout(pool.query('SELECT 1'), timeoutMs, 'database ping');
    return true;
  } catch (err) {
    logger.error({ err }, 'database ping failed');
    return false;
  }
}

export async function closeDb(): Promise<void> {
  await pool.end();
}
