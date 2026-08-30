# DATABASE MIGRATION LOG

Every schema change to any environment is recorded here, newest first.
**No migration reaches production without an entry in this file.**

---

## SAFETY RULES (permanent)

1. **Never reset the production database.** Not for a bug, not for a refactor, not for convenience.
2. **Never delete user data** — users, videos, drafts, profiles, followers, chats, messages, groups,
   communities, wallets, coins, transactions, payments, campaigns, verification records, media,
   analytics.
3. **Forward-only migrations.** A rollback restores code, not schema. Schema moves forward with a
   compensating migration.
4. **New columns must be nullable or carry a safe default.** Never `NOT NULL` without a default on a
   populated table.
5. **Never drop a column that holds user data.** Mark it deprecated in this log, stop writing to it,
   keep the data.
6. **Never rename in one step.** Add new → dual-write → backfill → switch reads → deprecate old.
7. **Backfills run in batches** outside the migration transaction, with progress logging.
8. **Index changes on large tables** use online DDL (`ALGORITHM=INPLACE, LOCK=NONE`) or a
   gh-ost/pt-osc style copy.
9. Required order for every production migration:
   `Backup → Validate → Staging Test → Production Migration → Verify Existing Data → Health Check`
10. If a migration fails: **stop, restore code, keep data, investigate.** Never "clean up" by
    truncating.

---

## PRE-MIGRATION CHECKLIST

- [ ] Full database backup taken and its restore verified
- [ ] Migration reviewed for the safety rules above
- [ ] Row counts of affected tables recorded before
- [ ] Executed on staging against a production-sized copy
- [ ] Execution time measured; lock impact assessed
- [ ] Application code is backward compatible with the **old** schema (deploy order safe)
- [ ] Rollback plan written (code rollback, not data destruction)
- [ ] Row counts verified after
- [ ] Entry appended to this log

---

## MIGRATION HISTORY

| Version | Date | Environment | Description | Applied by | Status |
|---|---|---|---|---|---|
| 025 | 2026-08-30 | local | notification_preferences, outbox, quiet hours on user_profiles | migrate:up | ✅ |
| 008 | 2026-08-29 | local | video_featured_at | migrate:up | ✅ 7ms |
| 007 | 2026-08-29 | local | user_timezone | migrate:up | ✅ 11ms |
| 001 | 2026-08-29 | local | identity_and_graph | migrate:up | ✅ 181ms |
| 002 | 2026-08-29 | local | content_and_creative | migrate:up | ✅ 354ms |
| 003 | 2026-08-29 | local | engagement_and_intelligence | migrate:up | ✅ 402ms |
| 004 | 2026-08-29 | local | messaging_and_realtime | migrate:up | ✅ 263ms |
| 005 | 2026-08-29 | local | wallet_and_monetization | migrate:up | ✅ 365ms |
| 006 | 2026-08-29 | local | growth_trust_and_platform | migrate:up | ✅ 441ms |

---

## DEPRECATED COLUMNS (retained, not dropped)

| Table | Column | Deprecated on | Reason | Replacement |
|---|---|---|---|---|
| — | — | — | — | — |

---

## DATA VERIFICATION SNAPSHOTS

Row counts captured before and after each production migration, so data loss is detectable.

| Date | Migration | Table | Rows before | Rows after | Verdict |
|---|---|---|---|---|---|
| — | — | — | — | — | — |
