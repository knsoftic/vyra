# Vyra Backend

Express 5 + Socket.IO on Node 24, MySQL and Redis. Modular monolith (ADR-004), ESM throughout.

## Running it

```bash
npm install
cp .env.example .env
```

Generate the two JWT secrets and paste them into `.env` (they must differ from each other):

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Then create the database and apply the schema:

```bash
npm run migrate:up
npm run dev
```

The API listens on `http://localhost:4000`. `GET /health` answers if the process is up;
`GET /ready` reports whether MySQL and Redis are reachable.

### Database

Either works:

- **XAMPP (MariaDB 10.4)** — already on the dev machine. Create the database once:
  `CREATE DATABASE IF NOT EXISTS vyra CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`
- **Docker (MySQL 8.4)** — `docker compose up -d` from the project root. This is the production
  target; the port is **3307** to avoid clashing with XAMPP's 3306.

ADR-019 explains why the DDL stays compatible with both.

Redis is optional for the API to boot but required for rate limiting, idempotency and presence.

## Migrations

Forward-only. **There is no `down` command, deliberately** — a rollback that drops a column
destroys user data, and this project's standing rule is that updates never delete user data.

```bash
npm run migrate:status     # what is applied, what is pending, what was tampered with
npm run migrate:validate   # safety check without touching the database
npm run migrate:up         # validate, snapshot row counts, apply, verify, log
npm run migrate:verify     # re-check row counts against the last snapshot
```

`migrate:up` refuses to run if a migration contains `DROP TABLE`, `TRUNCATE`, `DROP DATABASE`,
an unbounded `DELETE`/`UPDATE`, a `DROP COLUMN` or `RENAME COLUMN` on a user-data table, a
`NOT NULL` column with no default, or a type change that could truncate values. It also refuses
if a migration file changed after it was applied.

To change something that a rule forbids, write a new additive migration — add the new column,
backfill it, switch reads, and leave the old one in place. Record it under **DEPRECATED COLUMNS**
in `DATABASE_MIGRATION_LOG.md`.

## Tests

```bash
npm test
```

The ledger suite runs against the real database. It creates its own users and removes them
afterwards, so it is safe to run repeatedly against a database that holds real data.

## Layout

```
src/
  core/        config, logger, errors, db, redis, settings, pagination, timeout
  middleware/  error, validate, auth, rbac, audit, ratelimit, idempotency, async
  modules/     feature modules — health, wallet (ledger), more in Phase 3
  app.ts       Express assembly (no port binding, so tests can mount it)
  socket.ts    Socket.IO gateway
  server.ts    process entry, graceful shutdown
migrations/    forward-only SQL
scripts/       migrate.ts, validate-migration.ts
```

`shared/contracts/` (one level up) holds the API types used by this server, the mobile app and
the admin panel. Types only, no build step.

## Money

`src/modules/wallet/ledger.ts` is the only code permitted to change a balance. Everything else
calls `credit`, `debit` or `convert` inside a transaction.

Four balances, and they never merge (ADR-018):

| Balance | Earned from | Spendable on | Withdrawable |
|---|---|---|---|
| `coin` | Purchase, or converted reward | Promotion, gifts | No |
| `reward` | Daily tasks, referrals | Converts one-way into coins | No |
| `live_gift` | Gifts received while live | — | After clearing |
| `withdrawable` | Cleared live gift earnings | — | Yes |

Business values — coin rates, task rewards, monetization thresholds, the new-creator exploration
rate — live in `system_settings` and are read through `core/settings.ts`. They are admin-editable
at runtime and must never be hard-coded (ADR-015).
