# AI MODEL EXPERIMENTS

Record of every recommendation / intelligence model version, experiment and rollout.

---

## MODEL ROADMAP

| Version | Approach | Status | Target phase |
|---|---|---|---|
| v1 | Rules + weighted ranking (no learned model) | Planned | Phase 7 |
| v2 | Content-based + collaborative filtering | Planned | Phase 7 |
| v3 | Learning-to-rank (gradient boosted trees) | Planned | Phase 12 |
| v4 | Two-tower retrieval (user tower / video tower) | Planned | Phase 12 |
| v5 | Sequence-aware personalized recommendation | Planned | Post-launch |

---

## CURRENTLY DEPLOYED

| Field | Value |
|---|---|
| Ranking model | none (no backend yet) |
| Video intelligence model | none |
| Quality scorer | none |
| Moderation classifier | none |
| Rollout percentage | — |
| Fallback | rules-based ranker (always available, must never be removed) |

---

## RANKING WEIGHTS (v1 defaults, admin-tunable)

These are the starting values for the Phase 7 rules ranker. Every change from the admin panel is
audit-logged and mirrored here when it becomes the new default.

| Signal | Default weight |
|---|---|
| Watch probability | 1.00 |
| Completion rate | 0.90 |
| 20s watch (20–30s videos) | 0.85 |
| 30s watch (>30s videos) | 0.85 |
| Rewatch | 0.70 |
| Like | 0.55 |
| Comment | 0.60 |
| Share | 0.75 |
| Save | 0.65 |
| Follow from video | 0.80 |
| Profile visit | 0.35 |
| Creator affinity | 0.70 |
| Interest match | 0.85 |
| Freshness | 0.40 |
| Technical quality | 0.20 |
| Trending momentum | 0.30 |
| Diversity strength | 0.35 |
| Negative feedback penalty | -1.20 |
| Quick skip penalty | -0.80 |
| Repetition penalty | -0.60 |

| Exploration constant | Default |
|---|---|
| `NEW_CREATOR_FYP_EXPLORATION_RATE` | 10% |
| `FRESH_VIDEO_TEST_RATE` | 15% |
| `CANDIDATE_POOL_SIZE` | 800 |

---

## EXPERIMENT REGISTER

| ID | Hypothesis | Variants | Traffic | Start | End | Primary metric | Result | Decision |
|---|---|---|---|---|---|---|---|---|
| — | _No experiments yet._ | — | — | — | — | — | — | — |

### Experiment template

```
ID:              EXP-YYYYMMDD-nn
Hypothesis:      <what we believe and why>
Variants:        control / treatment(s)
Traffic split:   e.g. 90/10
Guardrail metrics: report rate, hide rate, session length, creator diversity
Primary metric:  e.g. D7 retention
Secondary:       watch time, completion, shares, saves, follows
Minimum runtime: 7 days (covers weekly seasonality)
Stop conditions: guardrail regression > 2%, error rate spike, moderation load spike
Result:          <numbers>
Decision:        ship / iterate / roll back
```

---

## METRICS TRACKED FOR EVERY EXPERIMENT

Watch time · Completion rate · Engagement rate · Shares · Saves · Follows · D1/D7/D30 retention ·
Session length · Sessions per day · Report rate · Hide rate · "Not interested" rate ·
Creator diversity (unique creators per session) · New-creator impression share

---

## MODEL DEPLOYMENT HISTORY

| Date | Model | Version | Rollout % | Rolled back? | Notes |
|---|---|---|---|---|---|
| — | — | — | — | — | — |

---

## KNOWN RISKS AND MITIGATIONS

| Risk | Mitigation |
|---|---|
| Feedback loop narrows interests | Enforced diversity in re-ranking + exploration budget |
| Popularity bias buries new creators | Guaranteed 10% new-creator exploration, progressive ladder |
| Quality score penalizes cheap cameras | Technical quality capped at low weight; audience response dominates (ADR-011) |
| ML service outage breaks the feed | Rules-based fallback ranker in Node, always deployed |
| Cold-start users | Interest onboarding + trending + broad category pools |
| Model regression unnoticed | Guardrail metrics with automatic stop conditions |
