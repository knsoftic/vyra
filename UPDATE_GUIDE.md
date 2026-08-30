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
cd backend && npm ci
cd ../admin && npm ci && npm run build
```

### Step 6 — Preflight, then restart

```bash
cd /var/www/vyra/backend
NODE_ENV=production npm run preflight     # exit 1 = do NOT restart; investigate
pm2 restart vyra-api vyra-worker vyra-admin
```

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
