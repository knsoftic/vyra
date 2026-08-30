# PHASE 7 — AI RECOMMENDATION ENGINE

**Status:** ✅ Complete — 2026-08-29 · **Depends on:** Phase 6 ✅
**Gate:** feed latency p95 within budget; fallback ranker verified by killing the ML service.

---

## OBJECTIVE

The For You feed: a three-stage recommendation system that is personalised, diverse, fair to new
creators and fully controllable from the Super Admin panel.

---

## STAGE 1 — CANDIDATE GENERATION

Retrieve a large, cheap candidate set from parallel pools:

| Pool | Source |
|---|---|
| Following | Creators the user follows |
| Creator affinity | High `CreatorAffinityScore` creators |
| User interests | Category/topic match against the interest profile |
| Similar videos | Embedding neighbours of recently enjoyed videos |
| Similar users | Collaborative neighbours |
| Trending | Current momentum |
| Fresh videos | Recently published, under-tested |
| New creators | Exploration budget |
| Discovery | Deliberate out-of-profile exploration |
| Language relevant | User language match |
| Category relevant | Category browse context |

`CANDIDATE_POOL_SIZE` default **800**, admin-tunable.

---

## STAGE 2 — ML SCORING

For each candidate, predict:

**Positive:** watch probability · watch duration · 20s probability · 30s probability · completion
probability · rewatch probability · like · comment · share · save · follow · profile visit.

**Negative:** quick skip · not interested · hide · report.

Serving: Python ranker microservice. **If it is unavailable, Node falls back to the rules-based
weighted ranker — the feed must never break.**

---

## STAGE 3 — RE-RANKING

Blend predictions into the final order using: interest match · creator affinity · quality ·
freshness · diversity · category variety · creator variety · new-creator discovery · negative
signals · safety · repetition control.

Hard constraints applied here:
- No creator appears twice within a sliding window
- No category dominates beyond the diversity threshold
- Already-seen videos are excluded unless explicitly rewatchable
- Blocked, hidden and reported content is removed
- Safety-suppressed content is removed

---

## FYP DISTRIBUTION SCORE (0–100)

Composed from relevance, watch probability, completion, rewatch, like, comment, share, save, follow,
creator affinity, freshness, quality, safety and negative feedback. Every input weight is
admin-configurable and every change is audit-logged.

---

## NEW ACCOUNT EXPLORATION

```
NEW_CREATOR_FYP_EXPLORATION_RATE = 10%   (default, admin-configurable)
```

A fresh account receives a **controlled discovery opportunity — not guaranteed virality.** The budget
is capped, measurable, and its effect on retention is tracked as an experiment guardrail.

---

## PROGRESSIVE DISTRIBUTION

| Level | Audience | Promotion condition |
|---|---|---|
| L1 | Small test audience | Meets watch/completion threshold |
| L2 | Similar audience | Sustains performance |
| L3 | Category audience | Sustains performance |
| L4 | Broad For You | Sustains performance |
| L5 | Trending candidate | Exceptional sustained performance |

Performance alone determines progression. Thresholds are admin-tunable.

---

## MODEL PROGRESSION

| Version | Approach |
|---|---|
| v1 | Rules + weighted ranking |
| v2 | Content-based + collaborative filtering |
| v3 | Learning-to-rank |
| v4 | Two-tower retrieval |
| v5 | Sequence-aware personalized recommendation |

Each version must beat the previous one in an A/B test before rollout. Every version stays
rollback-able from the admin panel.

---

## ADMIN CONTROL SURFACE

Fresh-account exploration % · fresh-video testing % · watch, completion, like, comment, share, save,
follow, rewatch, quality, freshness, creator-affinity and trending weights · negative-feedback
penalty · diversity strength · candidate pool size. All changes audited.

---

## EXIT CRITERIA

1. For You feed serves personalised, diverse results within the p95 latency budget.
2. Killing the ML service degrades to the rules ranker with no user-visible failure.
3. New-creator exploration measurably reaches the configured 10% of slots.
4. Progressive distribution levels observably promote and demote videos on performance.
5. Changing a weight in admin changes the feed without a deploy, and writes an audit record.


---

## COMPLETION RECORD — 2026-08-29

### What was built

| Stage | Delivered |
|---|---|
| 1 — Candidates | Eleven parallel pools, 800-candidate default, per-pool cap, a failing pool degrades rather than breaks |
| 2 — Scoring | ML client with timeout, breaker and response validation; a real rules ranker as the production fallback (ADR-026) |
| 3 — Re-ranking | Hard constraints, creator spacing, category caps bounded by pool composition (ADR-027), reserved new-creator slots |
| FYP score | 0–100 from weighted positives minus penalties, with a per-component breakdown so any placement can be explained |
| Distribution | L1–L5, promoted and demoted on performance alone, every move recorded with its numbers |
| Admin surface | 27 bounded weights, live without a deploy, every change audited with before and after |

Two migrations: `015_recommendation` (distribution events, ranking models, seen tracking, rolling
performance) and `016_admin_user_link`.

### Exit criteria

| # | Criterion | Status |
|---|---|---|
| 1 | Personalised, diverse results within the latency budget | ✅ Verified, with per-stage timings recorded |
| 2 | Killing the ML service degrades silently to the rules ranker | ✅ Verified — the ML service is genuinely absent here, so every test exercises it |
| 3 | New-creator exploration reaches the configured 10% | ✅ Verified end to end |
| 4 | Progressive distribution promotes and demotes on performance | ✅ Verified in both directions, with held and suppressed cases |
| 5 | A weight change alters the feed without a deploy, and is audited | ✅ Verified, including bounds rejection and the required reason |

The p95 latency budget is measured on a laptop with no ML service and a cold cache. The assertion
catches the realistic regression — an accidental per-candidate query — rather than pretending to
be a production load test. That belongs in Phase 12.

### Verification

- `npm test` — **327 passed, 0 failed**, stable across repeated runs.
- `npm run smoke` — **59 live checks** across all seven phases.
- Typecheck clean; zero database residue.

### Bugs found and fixed

| ID | Severity | Finding |
|---|---|---|
| BUG-025 | **High** | Privilege escalation. `requireAdmin` resolved an admin by matching `admin_users.id` against `users.id` — two independent auto-increment sequences. Any ordinary user whose id happened to collide with an admin row's id would have inherited that admin's permissions |
| BUG-026 | Medium | The diversity backfill ignored the category cap entirely, so one category could take 60% of a page whenever the primary pass came up short |
| BUG-027 | Medium | A single-creator candidate pool collapsed to one item instead of filling the page — the backfill's spacing rule could never be satisfied |

BUG-025 is the one that matters. It was found by writing a test that asserted the *negative* case —
that a non-admin cannot reach an admin route — rather than only testing that an admin can.

### Design notes worth keeping

**Quality is capped at ±5% of ranking influence, and that cap is tested.** ADR-011 says a video is
never buried for being shot on a cheap phone. The test asserts that a well-matched video with zero
technical quality outranks a pristine irrelevant one even when the quality weight is at its
maximum.

**The new-creator reservation is a floor, not a ceiling.** Newcomers score lower because they have
no engagement history, so without an explicit reservation they never survive the sort. The slots
are counted and filled after the constraints, so exploration can never smuggle in something a
constraint just removed.

**Every weight has bounds.** A mistyped exploration rate of 100 instead of 0.10 would hand the
whole feed to untested videos, and nothing about the value alone would reveal the mistake. The
bounds make it impossible to save.

**Every score carries a breakdown.** An unexplainable ranking decision cannot be debugged, tuned,
or defended to a creator asking why their video stopped being shown.

### Not done

- **The ML service itself.** The client, contract, validation and fallback are built and tested;
  the Python ranker is not written. Model versions v2–v5 in the phase plan each need an A/B test
  before rollout, which is Phase 12 work.
- **Embeddings.** `similar_videos` currently approximates content similarity with category and
  watch history. Real neighbours need the embedding pipeline.
- **Load testing.** The latency assertion here is a regression guard, not a load test.
