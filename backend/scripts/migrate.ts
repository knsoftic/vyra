/**
 * Migration runner — versioned, forward-only.
 *
 * Commands:
 *   migrate:status    what has run, what is pending
 *   migrate:validate  parse every pending migration through the safety validator
 *   migrate:up        validate, then apply pending migrations inside a transaction
 *   migrate:verify    compare row counts against the snapshot taken before the last run
 *
 * There is deliberately **no `down` command**. Rollback restores code, not schema —
 * a reverse migration is how data gets destroyed during an incident. Schema always
 * moves forward with a compensating migration.
 */

import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import mysql from 'mysql2/promise';
import { validateMigration, WAIVABLE_RULES, USER_DATA_TABLES } from './validate-migration.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(here, '..', 'migrations');
const SNAPSHOT_FILE = path.join(here, '..', '.migration-snapshot.json');

const config = {
  host: process.env.DB_HOST ?? '127.0.0.1',
  port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USER ?? 'root',
  password: process.env.DB_PASSWORD ?? '',
  database: process.env.DB_NAME ?? 'vyra',
  multipleStatements: true,
};

interface MigrationFile {
  version: string;
  name: string;
  file: string;
  sql: string;
  checksum: string;
}

async function loadMigrations(): Promise<MigrationFile[]> {
  if (!existsSync(MIGRATIONS_DIR)) return [];
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();

  return Promise.all(
    files.map(async (file) => {
      const sql = await readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
      const [version, ...rest] = file.replace(/\.sql$/, '').split('_');
      return {
        version: version ?? file,
        name: rest.join('_') || file,
        file,
        sql,
        checksum: createHash('sha256').update(sql).digest('hex').slice(0, 16),
      };
    }),
  );
}

async function connect() {
  try {
    return await mysql.createConnection(config);
  } catch (error) {
    console.error(`\n  Cannot reach MySQL at ${config.host}:${config.port}`);
    console.error(`  ${(error as Error).message}`);
    console.error(`\n  Start the local stack first:  docker compose up -d mysql redis\n`);
    process.exit(1);
  }
}

async function ensureMigrationsTable(db: mysql.Connection) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version      VARCHAR(32)  NOT NULL PRIMARY KEY,
      name         VARCHAR(191) NOT NULL,
      checksum     CHAR(16)     NOT NULL,
      applied_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      duration_ms  INT UNSIGNED NOT NULL DEFAULT 0
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

async function appliedVersions(db: mysql.Connection) {
  const [rows] = await db.query<mysql.RowDataPacket[]>(
    'SELECT version, checksum FROM schema_migrations ORDER BY version',
  );
  return new Map(rows.map((r) => [r.version as string, r.checksum as string]));
}

/* ─────────────────────────────── validate ─────────────────────────────── */

function runValidation(migrations: MigrationFile[], allowNarrowing: boolean): boolean {
  let failed = false;

  for (const migration of migrations) {
    const violations = validateMigration(migration.sql).filter(
      (v) => !(allowNarrowing && WAIVABLE_RULES.has(v.rule)),
    );

    if (violations.length === 0) {
      console.log(`  ✓ ${migration.file}`);
      continue;
    }

    failed = true;
    console.log(`  ✗ ${migration.file}`);
    for (const violation of violations) {
      console.log(`      [${violation.rule}] ${violation.detail}`);
      console.log(`      → ${violation.statement.slice(0, 120)}`);
    }
  }

  return !failed;
}

/* ──────────────────────────────── commands ────────────────────────────── */

async function status() {
  const migrations = await loadMigrations();
  const db = await connect();
  await ensureMigrationsTable(db);
  const applied = await appliedVersions(db);

  console.log(`\n  Database: ${config.database} @ ${config.host}:${config.port}\n`);

  for (const migration of migrations) {
    const appliedChecksum = applied.get(migration.version);
    if (!appliedChecksum) {
      console.log(`  pending   ${migration.version}  ${migration.name}`);
    } else if (appliedChecksum !== migration.checksum) {
      console.log(`  CHANGED   ${migration.version}  ${migration.name}`);
      console.log(`            file was edited after it ran — migrations are immutable once applied`);
    } else {
      console.log(`  applied   ${migration.version}  ${migration.name}`);
    }
  }

  const pending = migrations.filter((m) => !applied.has(m.version));
  console.log(`\n  ${applied.size} applied, ${pending.length} pending\n`);
  await db.end();
}

async function validate(allowNarrowing: boolean) {
  const migrations = await loadMigrations();
  console.log(`\n  Validating ${migrations.length} migrations against the safety rules\n`);
  const ok = runValidation(migrations, allowNarrowing);

  if (!ok) {
    console.log(`\n  ✗ Validation failed. These migrations would risk user data.\n`);
    process.exit(1);
  }
  console.log(`\n  ✓ All migrations pass\n`);
}

/** Row counts for every user-data table, so loss is detectable rather than assumed. */
async function snapshotCounts(db: mysql.Connection): Promise<Record<string, number>> {
  const [tables] = await db.query<mysql.RowDataPacket[]>(
    'SELECT table_name AS t FROM information_schema.tables WHERE table_schema = ?',
    [config.database],
  );

  const counts: Record<string, number> = {};
  for (const row of tables) {
    const table = row.t as string;
    if (!USER_DATA_TABLES.has(table.toLowerCase())) continue;
    const [result] = await db.query<mysql.RowDataPacket[]>(
      `SELECT COUNT(*) AS c FROM \`${table}\``,
    );
    counts[table] = Number(result[0]?.c ?? 0);
  }
  return counts;
}

async function up() {
  const migrations = await loadMigrations();
  const db = await connect();
  await ensureMigrationsTable(db);
  const applied = await appliedVersions(db);

  // Refuse to run if an already-applied file was edited.
  for (const migration of migrations) {
    const previous = applied.get(migration.version);
    if (previous && previous !== migration.checksum) {
      console.error(
        `\n  ✗ ${migration.file} was modified after it was applied.\n` +
          `    Applied migrations are immutable. Add a new migration instead.\n`,
      );
      await db.end();
      process.exit(1);
    }
  }

  const pending = migrations.filter((m) => !applied.has(m.version));
  if (pending.length === 0) {
    console.log('\n  Nothing to migrate — schema is up to date\n');
    await db.end();
    return;
  }

  console.log(`\n  Validating ${pending.length} pending migrations\n`);
  if (!runValidation(pending, process.argv.includes('--allow-narrowing'))) {
    console.log('\n  ✗ Refusing to run. Fix the violations above.\n');
    await db.end();
    process.exit(1);
  }

  // Snapshot before touching anything, so `verify` can prove nothing was lost.
  const before = await snapshotCounts(db);
  await writeFile(SNAPSHOT_FILE, JSON.stringify({ takenAt: new Date().toISOString(), counts: before }, null, 2));
  console.log(`\n  Snapshot taken for ${Object.keys(before).length} user-data tables`);

  const logLines: string[] = [];

  for (const migration of pending) {
    const started = Date.now();
    process.stdout.write(`  running  ${migration.version} ${migration.name} … `);

    try {
      await db.beginTransaction();
      // DDL auto-commits in MySQL, so the transaction protects the bookkeeping,
      // not the DDL itself. One migration per file keeps the blast radius small.
      await db.query(migration.sql);
      await db.query(
        'INSERT INTO schema_migrations (version, name, checksum, duration_ms) VALUES (?, ?, ?, ?)',
        [migration.version, migration.name, migration.checksum, Date.now() - started],
      );
      await db.commit();

      const ms = Date.now() - started;
      console.log(`ok (${ms}ms)`);
      logLines.push(
        `| ${migration.version} | ${new Date().toISOString().slice(0, 10)} | ${process.env.NODE_ENV ?? 'local'} | ${migration.name} | migrate:up | ✅ ${ms}ms |`,
      );
    } catch (error) {
      await db.rollback().catch(() => {});
      console.log('FAILED');
      console.error(`\n  ✗ ${migration.file}\n    ${(error as Error).message}\n`);
      console.error('  Stopped. Earlier migrations in this run stay applied — they are forward-only.');
      console.error('  Fix the migration and run again. Do not edit an applied file.\n');
      await db.end();
      process.exit(1);
    }
  }

  const after = await snapshotCounts(db);
  const lost = Object.entries(before).filter(([table, count]) => (after[table] ?? 0) < count);

  if (lost.length > 0) {
    console.error(`\n  ⚠ ROW COUNT DROPPED — investigate immediately:`);
    for (const [table, count] of lost) {
      console.error(`    ${table}: ${count} → ${after[table] ?? 0}`);
    }
    process.exitCode = 1;
  } else {
    console.log(`\n  ✓ Verified: no user-data table lost rows`);
  }

  await appendToMigrationLog(logLines);
  console.log(`  ✓ ${pending.length} migrations applied, DATABASE_MIGRATION_LOG.md updated\n`);
  await db.end();
}

async function verify() {
  if (!existsSync(SNAPSHOT_FILE)) {
    console.log('\n  No snapshot found — run migrate:up first\n');
    return;
  }
  const snapshot = JSON.parse(await readFile(SNAPSHOT_FILE, 'utf8'));
  const db = await connect();
  const now = await snapshotCounts(db);

  console.log(`\n  Comparing against snapshot from ${snapshot.takenAt}\n`);
  let lost = 0;
  for (const [table, before] of Object.entries(snapshot.counts as Record<string, number>)) {
    const after = now[table] ?? 0;
    const delta = after - before;
    const flag = delta < 0 ? '  ✗ LOST' : delta > 0 ? '  +' : '  =';
    if (delta < 0) lost += 1;
    if (delta !== 0) console.log(`${flag} ${table}: ${before} → ${after}`);
  }

  console.log(lost === 0 ? '\n  ✓ No table lost rows\n' : `\n  ✗ ${lost} tables lost rows\n`);
  await db.end();
  if (lost > 0) process.exit(1);
}

/** Every run appends to the permanent migration log. */
async function appendToMigrationLog(lines: string[]) {
  if (lines.length === 0) return;
  const logPath = path.join(here, '..', '..', 'DATABASE_MIGRATION_LOG.md');
  if (!existsSync(logPath)) return;

  const content = await readFile(logPath, 'utf8');
  const marker = '| — | — | — | _No migrations yet. Schema work begins in Phase 2._ | — | — |';
  const updated = content.includes(marker)
    ? content.replace(marker, lines.join('\n'))
    : content.replace(
        /(## MIGRATION HISTORY[\s\S]*?\|---\|---\|---\|---\|---\|---\|\n)/,
        `$1${lines.join('\n')}\n`,
      );
  await writeFile(logPath, updated);
}

/* ──────────────────────────────── entry ───────────────────────────────── */

const command = process.argv[2];
const allowNarrowing = process.argv.includes('--allow-narrowing');

switch (command) {
  case 'status':
    await status();
    break;
  case 'validate':
    await validate(allowNarrowing);
    break;
  case 'up':
    await up();
    break;
  case 'verify':
    await verify();
    break;
  default:
    console.log(`
  Usage: tsx scripts/migrate.ts <command>

    status     show applied and pending migrations
    validate   check pending migrations against the safety rules
    up         validate, snapshot, then apply pending migrations
    verify     compare row counts against the last snapshot

  Flags:
    --allow-narrowing   waive the type-narrowing warning (requires evidence it is safe)

  There is no 'down'. Rollback restores code, not schema (ADR-012).
`);
}
