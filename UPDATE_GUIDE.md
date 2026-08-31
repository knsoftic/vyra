# Vyra — Update Guide (zero data loss)

How to put a new version of Vyra on a server that already has **live users**,
without losing or damaging anything they own. This is the procedure behind the
project's permanent rule: *every instruction is an update to the same project;
user data is never deleted or reset.*

---

## The principles (why the steps are what they are)

1. **Data outlives code.** Users, videos, wallets, chats, payments and analytics
   are never dropped, truncated or "cleaned up" by an update. A failed update is
   fixed by restoring **code**, never by touching data.
2. **Migrations are forward-only and additive.** New columns are nullable or
   carry a safe default. Nothing renames in one step, nothing drops a column
   that holds user data. A mistake gets a *new* compensating migration.
3. **Old code must survive the new schema.** Because columns are only added,
   the running (old) API keeps working while you migrate — so the database is
   migrated **first**, then the code is switched.
4. **Prove, then switch.** Row counts before and after; preflight before
   restart; health checks after.

---

## The routine update (5–10 minutes)

### Step 0 — Backup (never skip)

```bash
mysqldump -u vyra -p --single-transaction --routines vyra | gzip > ~/backup_vyra_$(date +%F_%H%M).sql.gz
ls -lh ~/backup_vyra_*        # confirm it exists and is not 0 bytes
```

`--single-transaction` takes a consistent snapshot **without locking** the live
platform — users notice nothing.

### Step 1 — Record what the data looks like

```bash
mysql -u vyra -p vyra -e "
  SELECT (SELECT COUNT(*) FROM users)   AS users,
         (SELECT COUNT(*) FROM videos)  AS videos,
         (SELECT COUNT(*) FROM wallets) AS wallets,
         (SELECT COUNT(*) FROM messages) AS messages,
         (SELECT COALESCE(SUM(coin_balance),0) FROM wallets) AS total_coins;"
```

Save the output. After the update these numbers must be **equal or higher** —
never lower.

### Step 2 — Fetch the new code (without switching to it yet)

```bash
cd /var/www/vyra
git fetch
git log --oneline HEAD..origin/main     # read what you are about to deploy
```

### Step 3 — Validate the new migrations BEFORE applying

```bash
git checkout origin/main -- backend/migrations backend/scripts
cd backend
npm run migrate:validate
```

The validator refuses migrations containing destructive statements
(`DROP TABLE`, `TRUNCATE`, `DELETE` without care, …). If it fails, **stop** —
do not deploy that version.

### Step 4 — Apply migrations (old code still running)

```bash
npm run migrate:up
npm run migrate:status      # confirm the new version numbers are applied
```

The API keeps serving throughout — additive migrations do not break it.

### Step 5 — Switch the code

```bash
cd /var/www/vyra
git checkout main && git pull
cd backend && npm ci && npm run build
cd ../admin && npm ci && npm run build
```

**The backend build is not optional.** PM2 runs `node dist/backend/src/server.js`
— compiled output, not the TypeScript sources. Pulling new code and restarting
without building restarts the *previous* build, and the symptom is confusing
rather than obvious: the server is up, old routes answer normally, and only the
routes added since the last build return 404. This step was missing from this
guide once, and that is exactly what happened.

### Step 6 — Preflight, then restart

```bash
cd /var/www/vyra/backend
NODE_ENV=production npm run preflight     # exit 1 = do NOT restart; investigate
pm2 restart vyra-api vyra-worker vyra-admin
```

Or, in one command that cannot have a step left out of it:

```bash
cd /var/www/vyra && git pull && cd backend && npm run deploy && pm2 restart all
```

`npm run deploy` is install, build, migrate and preflight in that order. It
exists because the sequence is easy to write out by hand and easy to write out
wrong — leaving out the build is silent, and leaving out the migrations is not.

### Step 7 — Verify

```bash
curl -s https://vyra.example.com/health     # {"ok":true,...}
curl -s https://vyra.example.com/ready
```

Re-run the Step-1 count query. Every number equal or higher → the update
preserved the data. Open the admin panel → Dashboard and click through one or
two queues.

### Step 8 — Log it

Append a row to `DATABASE_MIGRATION_LOG.md` (version, date, environment, row
counts before/after) and an entry in `DEPLOYMENT_LOG.md`. Future-you will need
it.

---

## If something goes wrong

**The new code misbehaves:**

```bash
cd /var/www/vyra
git checkout <previous-tag-or-commit>
cd backend && npm ci
pm2 restart vyra-api vyra-worker
```

Leave the schema as it is — additive migrations are compatible with the old
code. That is the entire point of rule 3.

**A migration itself failed halfway:** stop, do not "clean up", read the error.
Migrations run in a transaction where possible; the failed one simply is not
recorded as applied. Fix the migration file, `npm run migrate:up` again.

**The guard refused to run a migration** (`✗ Refusing to run`): that is the
data-protection validator, and it is right far more often than it is wrong.
Read which rule it names. `no-drop-table`, `no-truncate` and the unbounded
`DELETE`/`UPDATE` rules can never be waived — a migration that trips one of
those is a migration that would destroy user data, and it needs rewriting.

`review-type-narrowing` is the one that can be set aside, and only with
evidence. Check what is actually stored first, for example:

```bash
mysql -u vyra -p vyra -e "SELECT MAX(CHAR_LENGTH(email)) FROM users;"
```

If it is genuinely safe, the waiver goes **in the migration file**, with the
reason, so it stays visible in review:

```sql
-- migration-waiver: review-type-narrowing — VARCHAR(191) is unchanged; only
-- NOT NULL becomes NULL, so no value can be truncated. Widest stored was 29.
```

A waiver written this way means the migration runs on the server without
anybody having to remember a command-line flag. There is still a
`--allow-narrowing` flag for a one-off, but prefer the written waiver: a flag
typed once at a terminal leaves no record of why.

**Data actually damaged** (should be impossible via this procedure): restore
the Step-0 backup into a **new** database, compare, and recover the affected
rows only. Never `DROP DATABASE` on the live one.

```bash
# restore to a SIDE database for comparison — never over the live one
mysql -u root -p -e "CREATE DATABASE vyra_restore"
gunzip < ~/backup_vyra_XXXX.sql.gz | mysql -u root -p vyra_restore
```

---

## What an update never does

- Never `DROP TABLE`, `TRUNCATE`, or `DELETE` user rows.
- Never renames a column in one step (add new → dual-write → backfill → switch reads → deprecate old).
- Never adds `NOT NULL` without a default to a populated table.
- Never resets settings, payment methods, gift catalogues or ranking weights —
  those are operator data too, changed only through the admin panel where every
  change is audited.
- Never runs `seed:demo` in production. The other seeds (`seed`, `seed:gifts`,
  `seed:monetization`) are idempotent and additive — safe, but only needed when
  a release note says so.

---

## Scheduled once a month

- Test a backup restore into `vyra_restore` (a backup you have not restored is a hope, not a backup).
- Check disk usage of `backend/storage/` and the database.
- Rotate the admin passwords; review Roles & Permissions and the Audit Log.
