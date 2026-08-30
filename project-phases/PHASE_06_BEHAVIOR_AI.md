# PHASE 6 — USER BEHAVIOUR INTELLIGENCE

**Status:** ✅ Complete — 2026-08-29 · **Depends on:** Phase 5 ✅
**Gate:** events arrive exactly once; no personally sensitive data in any event payload.

---

## OBJECTIVE

Build the behavioural substrate the recommendation engine will consume: event capture, interest
profiles, audience segmentation, creator affinity and negative signals.

---

## EVENT TAXONOMY

| Group | Events |
|---|---|
| Exposure | `impression`, `video_start` |
| Watch | `watch_2s`, `watch_5s`, `watch_10s`, `watch_20s`, `watch_30s`, `completion`, `rewatch` |
| Rejection | `quick_skip`, `not_interested`, `hide_creator`, `report` |
| Engagement | `like`, `comment`, `share`, `save` |
| Graph | `follow`, `unfollow`, `profile_visit` |
| Navigation | `search`, `category_view`, `hashtag_click` |

### Event payload
`user_id` · `video_id` · `creator_id` · `watch_duration` · `video_duration` · `completion_rate` ·
`feed_source` · `category` · `timestamp` · `session_id` · `app_version` · `device_tier`

Events are batched on device, sent with a client-generated deduplication key, queued server-side and
batch-inserted. **No sensitive personal characteristics are ever included.**

---

## WATCH SIGNAL RULES (ADR-009)

```
CompletionRate = WatchDuration / VideoDuration

video_duration <  20s  -> completion percentage is the primary signal
video_duration 20-30s  -> a 20-second watch is a strong positive signal
video_duration >  30s  -> a 30-second watch is a strong positive signal
```

Raw watch duration, completion percentage and rewatch are all retained — no single one is used
alone.

---

## USER INTEREST PROFILE

A dynamically changing weighted map, e.g. `Technology 90% · Gaming 80% · Business 65% · Cars 55% ·
Education 35%`.

Two horizons, combined at ranking time:

| Horizon | Window | Decay | Purpose |
|---|---|---|---|
| Short-term | Current session + recent days | Fast | Reacts to what the user wants right now |
| Long-term | Rolling months | Slow | Stable taste, survives a one-off session |

---

## AUDIENCE SEGMENTATION

Users are assigned to **multiple** segments simultaneously (AI, Technology, Gaming, Business,
Education, Sports, Comedy, Fashion, Beauty, Cars, Food, Travel, Entertainment, and any segment the
admin creates).

**Users are never permanently locked into one segment.** Segment membership is re-evaluated
continuously and decays without reinforcing behaviour.

---

## NEGATIVE SIGNALS

`quick_skip` · `not_interested` · `hide_creator` · `unfollow` · `report` · repeated skipping of a
category or creator. These reduce future exposure with an explicit, tunable penalty weight, and are
never silently ignored.

---

## CREATOR AFFINITY SCORE

Per (viewer, creator) pair, built from: follow · previous like · comment · save · share ·
profile visit · rewatch · long watch. Time-decayed. Used for candidate generation and re-ranking.

---

## VIDEO AUDIENCE PROFILE

Per video: which audience this content actually resonates with, derived from category, content
signals, observed watch behaviour, similar videos, similar creators and engagement history.

---

## PRIORITY CREATOR AUDIENCE

When a creator publishes, distribution prioritises, in order: followers → previous likers →
previous commenters → previous sharers → previous savers → profile visitors → repeat viewers →
long-watch viewers.

---

## PRIVACY (non-negotiable, ADR-008)

- The platform **never** listens to private conversations.
- The microphone is used only for recording, voice notes, calls, video calls and live streaming,
  always with explicit permission.
- Audience intelligence comes from first-party in-app behaviour only.
- Sensitive personal characteristics are never used as ranking or targeting features.

---

## EXIT CRITERIA

1. Every event type is emitted from the app and persisted exactly once under retry and offline.
2. Interest profiles visibly shift within a session and stabilise over time.
3. Negative signals measurably reduce exposure of the rejected category or creator.
4. Creator affinity computed and queryable within the latency budget.
5. Event payloads audited — no sensitive fields present.


---

## COMPLETION RECORD — 2026-08-29

### What was built

| Area | Delivered |
|---|---|
| Event taxonomy | All 23 events across exposure, watch, rejection, engagement, graph, navigation |
| Ingestion | Batched, deduplicated, exactly-once under retry and concurrency |
| Watch rules | ADR-009 length-scaled interpretation, decided server-side |
| Interest profiles | Two horizons with exponential decay, blended at read time |
| Segmentation | Multi-segment, weighted, lapsing — 18 seeded segments |
| Negative signals | Explicit rejections weighted far above passive positives |
| Creator affinity | Per (viewer, creator), time-decayed, queryable |
| Video audience | Which segments actually engaged, observed not declared |
| Priority audience | The eight-tier distribution order, de-duplicated and block-aware |
| Privacy | Allowlist plus denylist, enforced before validation (ADR-025) |

Migration `014_behaviour_events`: the general event log (partitioned, uniquely keyed for
exactly-once), segment decay columns, video audience profiles, and a rebuild queue.

### Exit criteria

| # | Criterion | Status |
|---|---|---|
| 1 | Every event persisted exactly once under retry and offline | ✅ Verified under retry, repeated retry and concurrency |
| 2 | Interest profiles shift within a session and stabilise over time | ✅ Verified, including that a rebuild with no new signals is identical |
| 3 | Negative signals measurably reduce exposure | ✅ Verified — a rejection drives a topic below an untouched one, and below its own prior positive |
| 4 | Creator affinity computed and queryable | ✅ Verified, including that hiding a creator drives it negative |
| 5 | Event payloads audited — no sensitive fields | ✅ Enforced structurally, and audited across stored rows |

Criterion 1 says "emitted from the app". The server half — persisted exactly once under retry — is
verified. Emission from the device is part of the outstanding mobile work.

### Verification

- `npm test` — **255 passed, 0 failed**, stable across repeated runs.
- `npm run smoke` — **51 live checks** across all six phases against a booted server.
- Typecheck clean; zero database residue.

### Bugs found and fixed

| ID | Severity | Finding |
|---|---|---|
| BUG-022 | **High** | Interest profiles were never populated from video events. The category was only read when a client sent one explicitly, but for a video event it belongs to the video — so watching, liking and saving contributed nothing to a profile. The entire point of collecting the events |
| BUG-023 | **High** | Every priority-audience tier silently returned nobody. The query referenced a SELECT alias in its WHERE clause, which MariaDB rejects, and the error was caught and logged — so a broken tier looked exactly like a creator with no audience |
| BUG-024 | Medium | Sensitive fields were stripped by schema validation before the privacy check ran. The data was safe, but a client sending them would never have been noticed |

BUG-023 is the instructive one: the `.catch()` that made it invisible was added for robustness. It
now rethrows, because a distribution tier returning nothing is not a condition worth surviving
quietly.

### Design notes worth keeping

**Profiles are rebuilt, never incremented.** Recomputing from the event log costs more, but a
profile can always be explained by pointing at the events behind it, and a weighting bug is fixed
by recomputing rather than by trying to unwind accumulated damage. A test asserts that rebuilding
twice with no new signals produces an identical profile.

**Decay is applied on read, not by a sweep.** An unreinforced weight falls off on its own, which is
what makes segment membership genuinely temporary — nobody is filed permanently under a category
they engaged with once.

**Rejections outweigh positives.** `not_interested` carries roughly four times the magnitude of a
completed watch. Treating them symmetrically is how a feed ends up ignoring explicit feedback.

### Not done

- **Emission from the device.** The ingestion API and its guarantees are built and tested; the app
  does not yet send events. That belongs with the outstanding mobile work.
- **Content-derived interests.** Topics currently come from a video's category. Deriving them from
  the content itself needs the embeddings and classification in Phase 7.
