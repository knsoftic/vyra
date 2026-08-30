# PHASE 2 — SYSTEM ARCHITECTURE

**Status:** ✅ Complete — 2026-08-29 · **Depends on:** Phase 1 approval ✅
**Gate:** schema reviewed, migration tooling proven, contracts published, local stack boots.
**Gate result:** all four met. 89 tables applied to a real database; the validator was tested
against deliberately destructive SQL and refused all of it; contracts published under
`shared/contracts/`; the API boots and serves `/health` and `/ready`.

---

## OBJECTIVE

Turn the approved UI into a concrete system: database schema, backend skeleton, shared contracts,
infrastructure and the migration discipline that protects user data forever.

---

## DELIVERABLES

### 1. Database schema (MySQL 8)
Full DDL for every entity group listed in `PROJECT_MASTER_LOG.md` section 8, with:
- `id` BIGINT UNSIGNED AUTO_INCREMENT (or ULID where distribution matters)
- `created_at`, `updated_at`, `deleted_at` on every user-owned table
- Foreign keys with explicit `ON DELETE` behaviour (never cascade-delete user content)
- Indexes designed from the actual query list, not guessed
- `utf8mb4_unicode_ci` collation throughout — revised from `utf8mb4_0900_ai_ci` so the same
  DDL runs on MySQL 8.4 and MariaDB 10.4 (ADR-019)

### 2. Migration tooling
- Versioned, forward-only migrations with a `schema_migrations` table
- A `migrate:status`, `migrate:up`, `migrate:validate` command set
- Validation refuses: `DROP TABLE`, `DROP COLUMN` on user tables, `TRUNCATE`, `NOT NULL` without
  default on a populated table
- Every run appends to `DATABASE_MIGRATION_LOG.md`

### 3. Backend skeleton (Node.js + TypeScript)
```
backend/src/
├─ modules/{auth,users,videos,feed,behaviour,chat,live,wallet,ads,verification,admin,moderation}
│   └─ each: routes.ts · controller.ts · service.ts · repository.ts · schema.ts · types.ts
├─ core/{config,db,redis,queue,storage,logger,errors,http,socket}
├─ middleware/{auth,rbac,ratelimit,validate,audit,error}
├─ jobs/{transcode,thumbnails,quality,intelligence,notifications,rollups,reconcile}
└─ server.ts
```

### 4. Shared contracts
`shared/contracts/` — TypeScript types for every API request/response, consumed by `mobile/` and
`admin/`. Single source of truth; drift is a build failure.

### 5. Local infrastructure
`docker-compose.yml` providing MySQL, Redis, MinIO (S3-compatible) and the ML service, so the whole
stack boots with one command.

### 6. Cross-cutting design
- Error envelope: `{ error: { code, message, details? } }` with stable machine codes
- Pagination: cursor-based for feeds and messages, offset for admin tables
- Idempotency: `Idempotency-Key` header honoured on all money-moving routes
- Config: database-backed settings cached in Redis with explicit invalidation
- Observability: structured logs with request id, metrics, health endpoints per dependency

---

## KEY DESIGN DECISIONS TO SETTLE HERE

| Question | Direction |
|---|---|
| ID strategy | BIGINT for internal joins, public ULID/hashid to avoid enumeration |
| Event volume | Watch/impression events go to a queue, batch-inserted, rolled up hourly |
| Feed serving | Precomputed candidate cache in Redis per user, refreshed on session start |
| Media naming | Content-addressed keys; originals retained separately from renditions |
| Multi-region | Single region at launch; schema carries `region` columns so sharding is possible later |

---

## EXIT CRITERIA

1. Schema DDL reviewed and applied to a local database.
2. Migration validator rejects every unsafe operation in a test.
3. Backend boots, health endpoints green against the local stack.
4. Shared contracts compile and are imported by both frontends.
5. `ARCHITECTURE_DECISIONS.md` updated with any new ADRs.


---

## COMPLETION RECORD — 2026-08-29

### What was built

| Deliverable | Result |
|---|---|
| Database schema | 89 tables, 6 migrations, applied and verified |
| Migration tooling | `status` / `validate` / `up` / `verify`, forward-only, no `down` |
| Shared contracts | `shared/contracts/` — 10 modules, consumed by backend, mobile and admin |
| Backend skeleton | Express 5 + Socket.IO, core + middleware + ledger, boots clean |
| Local stack | `docker-compose.yml` (MySQL 8.4, Redis, MinIO); XAMPP MariaDB also works |

### Verification performed

| Check | Result |
|---|---|
| `npm run typecheck` (backend + shared) | Clean |
| `npm test` | 27 passed, 0 failed |
| Migrations applied to a live database | 6 applied, 89 tables, partitions present |
| Re-running `migrate:up` | Correctly a no-op |
| Destructive migration (`DROP TABLE wallets`) | **Refused**; the table survived |
| Editing an applied migration | **Refused** — checksum mismatch detected |
| User data survives a migration | Verified: user + four balances unchanged across two migrations |
| Concurrent debits on one wallet | Exactly 5 of 10 succeeded; balance landed on 0, never negative |
| Reward → withdrawable conversion | **Refused** — task farming cannot become cash |
| `/health`, `/ready` | 200 / correct 503 semantics, both under 1s |

### Two real defects found and fixed

1. **The type-narrowing migration rule never fired.** Its regex ended in ``, which cannot match
   after a type closing in `)`, so `VARCHAR(20)` and `CHAR(10)` narrowing passed validation
   silently. Fixed and covered by a regression test.
2. **`/ready` hung for 6+ seconds** while the Redis driver retried a dead connection. A readiness
   probe that hangs reads as a crashed process to an orchestrator. Both checks are now bounded.

### Carried forward

- Device testing on real Android and iOS hardware — still outstanding from Phase 1, needs the
  owner's physical device.
- Redis is not installed on the development machine, so rate limiting and idempotency were
  verified by code review and typecheck rather than at runtime. Both fail safe: rate limiting
  fails open, idempotency fails closed. They need a live run once Redis is available — either via
  `docker compose up redis` or a native install.
- Feature routers are not yet mounted; `app.ts` has the mount point ready. That is Phase 3.
