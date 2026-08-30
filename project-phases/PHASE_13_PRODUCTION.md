# PHASE 13 — PRODUCTION DEPLOYMENT

**Status:** Not started · **Depends on:** Phase 12
**Gate:** full restore-from-backup rehearsal passes.

---

## OBJECTIVE

Go live safely, and establish the operational discipline that keeps every future update from ever
harming existing user data.

---

## INFRASTRUCTURE

| Component | Production shape |
|---|---|
| API | Multiple Node instances behind a load balancer, health-checked, auto-scaled |
| Sockets | Separate socket tier with the Redis adapter and sticky sessions |
| Database | MySQL primary + read replicas, automated backups, point-in-time recovery |
| Cache/queues | Redis (managed), separate instances for cache and queues |
| Workers | Autoscaled transcode/ML/notification workers |
| Storage | Object storage, versioned, lifecycle rules, **outside any deployment directory** |
| CDN | Global edge for renditions, thumbnails and static assets |
| Media server | SFU cluster for live and group calls, with TURN |
| ML | Python services behind an internal load balancer |
| Secrets | Managed secret store, per-environment credentials |

---

## MONITORING AND ALERTING

Uptime · error rate · API latency (p50/p95/p99) · database connections and slow queries · Redis
memory · queue depth and job failures · transcode backlog · live stream health · push delivery ·
payment success rate · wallet reconciliation drift · moderation queue depth · CDN hit ratio ·
crash-free session rate.

Health endpoints: API · database · Redis · queues · storage · video processing · live · notifications
— all surfaced in the admin System Health module.

---

## BACKUPS AND DISASTER RECOVERY

- Automated daily full backups plus continuous binary logs
- **Restore is rehearsed, not assumed** — a full restore drill is a gate for this phase
- Media in versioned storage with cross-region replication
- Documented RTO and RPO
- Restore runbook stored in `docs/`

---

## RELEASE PROCESS (permanent)

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

- Backward-compatible code deploys **before** the migration
- New features ship behind feature flags, ramped gradually
- Mobile releases are staged rollouts; minimum supported version is enforced from admin settings
- If an update fails: **roll back code, keep data.** Never delete user data.

---

## LAUNCH CHECKLIST

- [ ] Security checklist in `SECURITY_LOG.md` fully complete
- [ ] Load tests passed at projected launch scale plus headroom
- [ ] Backup restore drill completed and timed
- [ ] Monitoring and alerting live, with an on-call path
- [ ] Rate limits tuned for real traffic
- [ ] Payment provider in production mode, webhooks verified
- [ ] App store listings, privacy labels and age rating complete
- [ ] Privacy policy, terms and community guidelines published and reachable in-app
- [ ] Moderation team trained, queues staffed, escalation path defined
- [ ] Support ticket system live
- [ ] Feature flags set to the intended launch state
- [ ] Rollback rehearsed
- [ ] `DEPLOYMENT_LOG.md` entry prepared

---

## POST-LAUNCH OPERATIONS

- Daily: error rate, queue depth, moderation queue, payment success, wallet reconciliation
- Weekly: retention cohorts, creator diversity, feed quality metrics, experiment review
- Monthly: security review, dependency audit, capacity planning, backup restore drill

---

## PERMANENT RULES AFTER LAUNCH

1. Every new instruction is an **update to this project**, never a new project.
2. Never remove existing features.
3. Never reset the database.
4. Never delete users, videos, drafts, chats, wallets, payments or analytics.
5. Always: `Read Existing Project -> Preserve Existing Work -> Add New Requirement -> Test -> Update Logs`.
