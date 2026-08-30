# DEPLOYMENT LOG

Every deployment to any environment, newest first.

---

## ENVIRONMENTS

| Environment | Purpose | Status |
|---|---|---|
| Local | Development on the workstation | Active |
| Staging | Production-shaped rehearsal, production-sized data copy | Not provisioned |
| Production | Live platform | Not provisioned |

**Standing rule for the current phase:** no production backend is deployed before the UI is
reviewed and approved.

---

## STANDARD UPDATE PROCESS (permanent)

```
Read Master Log
  -> Backup
  -> Validate Migration
  -> Test on Staging
  -> Deploy Code
  -> Safe Migration
  -> Verify Existing Data
  -> Health Check
  -> Gradual Feature Rollout
  -> Update Logs
```

If an update fails: **roll back safely. Never delete user data.**

- Code rolls back. Schema does not roll back destructively — it moves forward with a compensating
  migration.
- Deploy order is always: backward-compatible code first, then migration, then feature flag on.
- New features reach users behind a feature flag, ramped gradually, never all at once.

---

## PRE-DEPLOYMENT CHECKLIST

- [ ] `PROJECT_MASTER_LOG.md` read; current phase confirmed
- [ ] Database backup taken **and restore verified**
- [ ] Migrations reviewed against the rules in `DATABASE_MIGRATION_LOG.md`
- [ ] Staging deployment successful against a production-sized copy
- [ ] Test suites green (recorded in `TESTING_LOG.md`)
- [ ] Security checklist reviewed (`SECURITY_LOG.md`)
- [ ] Feature flags configured for the new features (default off)
- [ ] Rollback plan written and understood
- [ ] Monitoring and alerting cover the new surface
- [ ] Mobile: minimum supported app version updated if the API contract changed

## POST-DEPLOYMENT VERIFICATION

- [ ] Health endpoints green (API, MySQL, Redis, queues, storage, media pipeline, sockets)
- [ ] Row counts of critical tables unchanged or increased — never decreased
- [ ] Error rate within baseline
- [ ] Feed latency within budget
- [ ] Wallet reconciliation job clean
- [ ] Sample user journeys manually verified in production
- [ ] `DEPLOYMENT_LOG.md` and `CHANGELOG.md` updated

---

## DEPLOYMENT HISTORY

| Date | Version | Environment | Components | Migrations | Result | Rollback? | Notes |
|---|---|---|---|---|---|---|---|
| — | — | — | — | — | — | — | _No deployments yet._ |

---

## MOBILE RELEASE HISTORY

| Date | Version | Build | Platform | Track | Minimum supported version | Notes |
|---|---|---|---|---|---|---|
| — | — | — | — | — | — | _No releases yet._ |
