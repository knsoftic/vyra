# ARCHITECTURE DECISION RECORDS (ADR)

Every significant technical decision is recorded here with its context, the decision itself, and its
consequences. Decisions are **never deleted** — they are superseded.

Status values: `Accepted` · `Superseded by ADR-xxx` · `Deprecated` · `Proposed`

---

## ADR-001 — React Native for the mobile application
**Date:** 2026-08-28 · **Status:** Accepted

**Context.** The product must ship on Android and iOS, feel genuinely native (60fps vertical video
feed, native camera, gestures), and be maintainable by one team.

**Decision.** React Native with TypeScript.

**Consequences.**
- One codebase, two platforms; native modules available where performance demands them.
- WebView-based approaches (Cordova, wrapped web app) are explicitly rejected — they cannot deliver
  the required feed performance or camera/editor experience.
- Performance-critical paths (feed recycling, video preloading, editor rendering) must be measured
  on real devices, not simulators.

---

## ADR-002 — Expo (dev-client / prebuild) rather than bare React Native
**Date:** 2026-08-28 · **Status:** Accepted

**Context.** The app needs camera, microphone, gallery, notifications, file picker, video recording,
audio recording, calls and runtime permissions. It also needs native modules that Expo Go cannot
host (WebRTC, live streaming, advanced video editing).

**Decision.** Use Expo with **prebuild + development builds** (`expo-dev-client`), not Expo Go.

**Consequences.**
- Full access to `android/` and `ios/` native projects when needed, while keeping Expo's module
  ecosystem, config plugins and build tooling.
- Any native library is usable; there is no "ejecting" cliff.
- Phase 1 UI can still be previewed quickly during development.
- EAS Build is optional, not required — local Gradle/Xcode builds remain possible.

---

## ADR-003 — Next.js for the Super Admin panel
**Date:** 2026-08-28 · **Status:** Accepted

**Context.** The admin panel has ~30 modules, heavy tables, forms, charts and role-gated navigation.

**Decision.** Next.js (App Router) + TypeScript + Tailwind CSS.

**Consequences.**
- File-system routing maps cleanly to admin modules.
- Server components available later for heavy list endpoints.
- Tailwind gives a consistent design system without a large component-library dependency.

---

## ADR-004 — Node.js modular monolith for the backend
**Date:** 2026-08-28 · **Status:** Accepted

**Context.** Microservices from day one would slow delivery and complicate transactions across
wallets, videos and social graph. But the platform must eventually scale to millions of users.

**Decision.** A **modular monolith** in Node.js + TypeScript. Each domain (auth, video, feed, chat,
live, wallet, ads, admin) is a self-contained module with its own routes, controllers, services and
repositories. Cross-module access happens only through service interfaces, never direct table reads.

**Consequences.**
- Fast Phase 3–11 delivery with transactional integrity.
- Any module can be lifted into its own service later because call sites already go through an
  interface.
- Module boundaries must be enforced in review; a direct cross-module SQL query is a defect.

---

## ADR-005 — MySQL as the primary datastore
**Date:** 2026-08-28 · **Status:** Accepted

**Context.** Specified by the project owner. The data is highly relational (users, follows, videos,
wallets, transactions) and money movement requires ACID transactions.

**Decision.** MySQL 8, InnoDB, `utf8mb4`. Redis for cache/queues. Object storage for media.
High-volume behavioural events (impressions, watch events) are written through a queue and rolled up
into aggregate tables; a column-store/warehouse can be added later for analytics without changing
the transactional schema.

**Consequences.**
- Wallet and payment correctness is straightforward.
- Behavioural event volume must never be queried directly for feed serving — always via aggregates
  and Redis.

---

## ADR-006 — Python microservices for ML
**Date:** 2026-08-28 · **Status:** Accepted

**Context.** Recommendation, video intelligence and quality scoring need the Python ML ecosystem.
The application backend needs Node's I/O concurrency.

**Decision.** Keep ML in separate Python (FastAPI) services. Node calls them over internal HTTP for
synchronous ranking and via queues for batch/async analysis.

**Consequences.**
- Models can be retrained and redeployed independently of the app backend.
- A network hop exists on the ranking path — mitigated by caching candidate scores and by a
  rules-based fallback ranker in Node so the feed never breaks if ML is unavailable.

---

## ADR-007 — Recommendation engine is staged, not big-bang
**Date:** 2026-08-28 · **Status:** Accepted

**Decision.** Ship v1 (rules + weighted ranking) first, then v2 content-based + collaborative
filtering, v3 learning-to-rank, v4 two-tower retrieval, v5 sequence-aware personalization.

**Consequences.**
- The feed works from Phase 7 onward with no ML dependency.
- Every later model competes against the previous one through the A/B framework before rollout.
- Ranking weights live in the database, not in code, so admins tune without a deploy.

---

## ADR-008 — Behavioural signals are first-party and in-app only
**Date:** 2026-08-28 · **Status:** Accepted

**Context.** Audience intelligence quality vs. user privacy.

**Decision.** All recommendation signals come from **in-app behaviour only**. The microphone is used
solely for recording, voice notes, calls and live streaming, always under explicit permission.
Sensitive personal characteristics are never used as ranking features.

**Consequences.**
- No ambient audio capture exists anywhere in the codebase. Any such request is refused.
- The behaviour engine must be rich enough that first-party signals alone produce a strong feed.

---

## ADR-009 — Watch-signal thresholds scale with video length
**Date:** 2026-08-28 · **Status:** Accepted

**Decision.**
- Video **under 20s** → completion percentage is the primary signal.
- Video **20–30s** → a 20-second watch is a strong positive signal.
- Video **over 30s** → a 30-second watch is a strong positive signal.

**Consequences.** Short videos are not unfairly advantaged by raw watch duration, and long videos are
not punished for incomplete watches.

---

## ADR-010 — Guaranteed exploration budget for new creators
**Date:** 2026-08-28 · **Status:** Accepted

**Decision.** `NEW_CREATOR_FYP_EXPLORATION_RATE` defaults to **10%** of For You slots and is
admin-configurable. Every change is audit-logged.

**Consequences.**
- New accounts get a real, bounded discovery opportunity — not guaranteed virality.
- Exploration cost is capped and measurable; the A/B framework tracks its effect on retention.

---

## ADR-011 — Video quality influences ranking but does not gate it
**Date:** 2026-08-28 · **Status:** Accepted

**Context.** Quality scoring must not become a tax on creators with inexpensive phones.

**Decision.** `VideoQualityScore` is decomposed into technical quality, content relevance, thumbnail
quality, caption relevance, spam probability, duplicate probability and safety status. Only **safety**
and **spam/duplicate** can suppress distribution. Low technical quality applies a mild ranking
adjustment only; audience response outweighs it.

**Consequences.** A low-resolution video that audiences watch and finish still travels.

---

## ADR-012 — Soft deletes and forward-only migrations
**Date:** 2026-08-28 · **Status:** Accepted

**Decision.** All user-owned rows use `deleted_at`. Migrations are versioned and forward-only.
New columns are nullable or defaulted. Columns holding user data are deprecated, never dropped.

**Consequences.**
- Content removal is reversible; moderation mistakes are recoverable.
- Rollback of a deploy never requires a destructive down-migration.

---

## ADR-013 — Money is a ledger, never a mutable balance
**Date:** 2026-08-28 · **Status:** Accepted

**Decision.** Every coin movement is an immutable ledger row recording previous balance, delta, new
balance, reference, status and timestamp. The wallet balance is derived and reconciled against the
ledger. All write paths carry idempotency keys.

**Consequences.** Duplicate transactions, double spending and replay attacks are structurally
prevented, and every balance is auditable to its origin.

---

## ADR-014 — Communities hide their member roster from ordinary members
**Date:** 2026-08-28 · **Status:** Accepted

**Decision.** Community members see the member **count** but not the member **list**. Only owner,
admin and moderator roles can browse members, join requests and reports.

**Consequences.** Communities can be large and public without becoming a scraping target. Group chats
(a different entity) keep full member visibility.

---

## ADR-015 — Everything operationally significant is admin-configurable
**Date:** 2026-08-28 · **Status:** Accepted

**Decision.** Ranking weights, exploration rates, feature flags, upload limits, coin packages, ad
pricing, filters, effects, stickers, music and region availability all live in the database and are
edited from the Super Admin panel. Every change writes an audit record with old and new values.

**Consequences.**
- Operating the platform does not require a deploy.
- Config reads must be cached in Redis with explicit invalidation on write.

---

## ADR-016 — Mobile and desktop use different layout systems, never a shared one
**Date:** 2026-08-29 · **Status:** Accepted

**Context.** The platform has two very different surfaces: a phone app used one-handed in
portrait, and a web Super Admin panel used at a desk on a wide screen. Reusing one layout for both
produces a stretched phone UI on desktop and a cramped desktop UI on the phone. Both feel wrong.

**Decision.** The two surfaces are designed independently. They share only the **brand identity**
(colour, tone, naming) — never navigation patterns, layout, or density.

| Concern | Mobile (React Native) | Desktop / web (Super Admin) |
|---|---|---|
| Primary navigation | Bottom tab bar, thumb reachable | Persistent left sidebar, grouped, collapsible |
| Secondary navigation | Push stack + bottom sheets | Top bar, breadcrumbs, in-page tabs |
| Layout | Single column, full-bleed | Multi-column grids, master–detail split panes |
| Lists | Cards and scrolling rows | Dense data tables with sortable columns and inline actions |
| Actions | Bottom sheets, floating buttons | Toolbars, row actions, right-hand detail drawer |
| Input | Touch, gesture, swipe | Pointer, hover states, keyboard shortcuts, right-click |
| Density | Generous tap targets (44px) | Compact rows (32–40px), 14px root font |
| Typography | Compact mobile scale | Denser data-first scale, tabular numerals |

**Consequences.**
- No layout component is shared between `mobile/` and `admin/`. Shared code is limited to
  **API contracts and domain types** (`/shared/contracts`).
- The admin panel is **desktop-first**. On narrow viewports the sidebar collapses to a drawer — it
  never becomes a bottom tab bar, because it is a professional tool, not a phone app.
- The mobile app is **portrait-first** and never renders a sidebar.
- A feature added to both surfaces is designed twice, on purpose.

---

## ADR-017 — Distinct visual identity, not a clone of the category leader
**Date:** 2026-08-29 · **Status:** Accepted

**Context.** The product format is a full-screen vertical short-video feed, which is the category
standard. Early UI work drifted into copying the best-known app in that category — its red/cyan
palette, its right-hand vertical action rail and its spinning vinyl sound disc. Being
indistinguishable from a competitor is a product risk and a brand dead end.

**Decision.** Keep the **format** (vertical snap feed, swipe navigation) because that is what the
product is. Change every **signature** that identifies a specific competitor.

| Element | Rejected (too close to the reference) | Chosen |
|---|---|---|
| Palette | Red `#FE2C55` + cyan `#25F4EE` | Violet `#7C5CFF` + mint `#3DDC97` |
| Feed actions | Vertical rail down the right edge | Horizontal glass action bar under the caption |
| Sound indicator | Spinning vinyl disc | Compact sound pill with a live equalizer |
| Feed tabs | Centred underlined tabs | Left-aligned pill group |
| Create button | Wide rounded rectangle | Circular, raised |
| Type scale | Standard mobile scale | Compact scale (body 13, h1 21) |

**Consequences.**
- The feed reads as its own product at a glance while remaining instantly familiar to use.
- The compact type scale fits noticeably more content per screen; all sizes come from
  `theme/tokens.ts` so the whole app rescales from one edit.
- Any future UI work is checked against this table before merging.

---

## ADR-018 — Four separate balances; only live gift earnings are payable
**Date:** 2026-08-29 · **Status:** Accepted

**Context.** The monetization system mixes money of very different kinds: coins a user **bought**
with real money, credit a user **earned** from daily tasks and referrals, and gifts a creator
**received** from viewers. Holding these in one balance would let promotional credit be cashed out,
which is a fraud vector and, in most jurisdictions, a regulatory problem.

**Decision.** The wallet is four distinct balances that never merge.

| Balance | Source | Spendable on | Withdrawable |
|---|---|---|---|
| **Coin** | Purchased, or converted from reward | Video promotion, live gifting | ❌ Never |
| **Reward** | Daily tasks, referrals, milestones | Converts one-way into coins | ❌ Never |
| **Live gift** | Gifts received while streaming | — | ✅ After clearing |
| **Withdrawable** | Cleared portion of live gift | — | ✅ Yes |

Rules that follow from this:
- Conversion is **one-way**: reward → coins. Coins never become reward or cash.
- Only `live_gift` matures into `withdrawable`, after a config-driven clearing period.
- Every ledger row carries a `wallet` field, so no transaction is ambiguous about which balance
  it moved.
- Purchased coins are never refundable to cash — that would make the app a money transmitter.

**Consequences.**
- A user cannot farm daily tasks and withdraw the proceeds; task rewards only reduce the cost of
  promotion, which keeps the incentive aligned with using the platform.
- The UI must state, on every surface, which balance is being shown and what it can be used for.
  Ambiguity here is a support burden and a trust problem.
- The database keeps four balance columns plus a partitioned ledger, not one running total.
- Thresholds, rates, clearing period and withdrawal availability are **configuration**, served by
  the backend, so the app always displays currently active values.

---

## ADR-019 — MySQL 8 is the target, but the DDL stays MariaDB-compatible

**Status:** Accepted — 2026-08-29
**Context.** ADR-005 chose MySQL. The owner develops on XAMPP, which ships **MariaDB 10.4**, and
Docker is not installed on that machine. The first migration run failed immediately:
`utf8mb4_0900_ai_ci` is a MySQL 8 collation that MariaDB does not have.

**Decision.** Production still targets **MySQL 8.4** (the `docker-compose.yml` stack). The schema is
written to the intersection of both engines so the same migrations run unmodified on either:

- `utf8mb4_unicode_ci` instead of `utf8mb4_0900_ai_ci` — valid on MySQL 8.4 and MariaDB 10.4.
- No `CAST(… AS JSON)` in application SQL; MariaDB's `JSON` is `LONGTEXT` with a validity check,
  and both engines accept a serialised string into a JSON column.
- No expression indexes and no functional defaults, which MariaDB 10.4 lacks.
- Foreign keys stay off the range-partitioned tables (`watch_events`, `impressions`), since
  neither engine permits them there.

**Consequences.**
- The owner can run the real schema on the machine they already have, today, with no new software.
- `utf8mb4_unicode_ci` is UCA 5.2.0 rather than 9.0.0, so collation is slightly older for newer
  emoji and scripts. Sorting and comparison of ordinary text are unaffected; this is a fair trade
  for being able to develop against the actual schema.
- Anything MySQL-8-only that a later phase wants — functional indexes, `CHECK` on generated
  columns — must be introduced as an additive migration guarded by an engine check, not assumed.
- CI and production should pin MySQL 8.4 so the stricter engine is what actually gets released.

---

## ADR-020 — Money routes are idempotent by requirement, not by convention

**Status:** Accepted — 2026-08-29
**Context.** Mobile networks drop requests mid-flight and users double-tap buttons. A retried
"buy coins" or "send gift" that executes twice takes real money from someone.

**Decision.** Every route that moves value requires an `Idempotency-Key` header. The middleware
rejects the request outright when the header is missing — it is not optional and there is no
default. The first request stores its response against the key for 24 hours; a repeat with the
same key replays that stored response without re-executing. A repeat with the *same key but a
different body* is rejected as `idempotency_key_reused`, because that means the client has a bug
and either interpretation would be wrong.

The route list lives in `shared/contracts/routes.ts` as `IDEMPOTENT_ROUTES`, so the client knows
which calls must carry the header without guessing.

**Consequences.**
- Clients must generate and persist a key per logical operation, not per HTTP attempt.
- The ledger additionally carries a unique `idempotency_key` column, so even a bug that bypasses
  the middleware cannot write the same movement twice.
- Redis is on the money path. If it is unavailable the middleware fails the request rather than
  allowing an unprotected retry — unlike rate limiting, which fails open.


---

## ADR-021 — One parameter set drives both the GPU preview and the FFmpeg render

**Status:** Accepted — 2026-08-29
**Context.** PHASE_04 requires that what the user sees while editing matches what the server
renders. Those are two entirely different renderers: a GPU shader on the device and an FFmpeg
filter graph on the server. If either owns its own numbers they will drift, and the drift will be
invisible until a user complains that their video "looks different after posting".

**Decision.** Neither renderer owns the numbers. `ColorGrade` in `shared/contracts/creative.ts` is
eleven values in plain user-facing units (-100..100, or 0..100 for one-sided controls), and both
renderers read it. The shader converts a grade to uniforms; `grade.ts` converts the same grade to
an FFmpeg chain. A filter preset is simply a named grade.

Consequences that follow:

- **A filter is data, not code.** Adding one is a row in `creative_assets` whose `params` holds a
  grade. Both renderers already know how to interpret any grade, so a new filter needs no release
  on either side — which is exactly what exit criterion 4 asks for.
- **Intensity means the same thing everywhere.** `scaleGrade` is shared, so a slider at 40% is 40%
  of the same numbers on both sides. 0 is always the untouched frame.
- **The mapping is testable without FFmpeg.** `gradeToFilters` is pure, so every preset's graph is
  checked in CI on a machine with no FFmpeg installed.
- FFmpeg filter choices are deliberately conservative — `eq`, `curves`, `colorbalance`, `unsharp`,
  `vignette`. Newer conveniences like `colortemperature` are avoided: a graph that fails to parse
  on the render host is worse than one that is a shade less precise.

---

## ADR-022 — Strict SQL mode is enforced by the application, not assumed from the server

**Status:** Accepted — 2026-08-29
**Context.** XAMPP's MariaDB ships with a permissive `sql_mode`. Under it, an invalid ENUM value
becomes `''`, an over-long string is silently truncated, and an out-of-range number is clamped —
all without an error. This was not theoretical: seeding the catalogue wrote six rows with an empty
`kind` because the enum did not yet contain `font`, and nothing failed. The rows simply vanished
from every query that filtered by kind.

**Decision.** The pool sets `sql_mode` explicitly on every connection, including
`STRICT_TRANS_TABLES`. Bad data now raises an error at the insert that caused it.

**Consequences.**
- The guarantee travels with the application rather than depending on how a host is configured, so
  development, CI and production behave identically.
- Some previously "successful" writes will now fail loudly. That is the point — a failed insert is
  a bug report; a silently truncated one is a corruption discovered months later.
- The hook must use the callback form. Even on a promise pool, `pool.on('connection')` hands over
  the raw callback-style connection, and awaiting its `query` throws — which breaks every
  connection the pool opens.

---

## ADR-023 — Cache access is bounded by a circuit breaker

**Status:** Accepted — 2026-08-29
**Context.** Redis is a cache and a rate-limit counter, never a system of record, so the
application is written to work without it. But "works without it" turned out to mean "works
twelve seconds slower per call": ioredis retries with backoff, so a single `del` against a dead
server took over ten seconds before rejecting. Catching the error did not help — the time was
already spent. Seeding 41 catalogue items took eight minutes instead of three seconds.

**Decision.** All cache access goes through `core/cache.ts`. Every operation is bounded by a
250 ms timeout, and after three consecutive failures a breaker opens and calls return immediately
for thirty seconds without touching Redis at all.

**Consequences.**
- A Redis outage degrades the platform to "no caching", which is what was always intended, rather
  than to "everything is slow", which is what actually happened.
- Cache reads never throw. Callers get `null` and fall through to the database.
- Rate limiting continues to fail **open** — a limiter that cannot count must not lock everyone
  out. Idempotency continues to fail **closed**, because an unprotected retry could double-charge.


---

## ADR-024 — Processing is a resumable sequence of recorded stages

**Status:** Accepted — 2026-08-29
**Context.** Turning an upload into adaptive playback takes several minutes of CPU across probing,
rendering, transcoding five renditions, packaging, thumbnails and scoring. Any of it can be
interrupted: a worker is redeployed, a host is killed, FFmpeg dies. PHASE_05 requires that a worker
killed mid-job resumes without duplicating or losing output.

**Decision.** Every stage is a row in `processing_stages`, unique per (video, stage). A worker
claims a stage with a conditional UPDATE, runs it, and records the outcome before moving on. The
next worker skips anything already `complete` or `skipped` and resumes at the first that is not.

Three distinctions turned out to matter, and each one came from something going wrong:

- **`skipped` is not `failed`.** "No FFmpeg on this host" is an operational problem to fix, not a
  broken upload to discard. Skipping records the reason and lets the pipeline continue.
- **`deferred` is not an attempt.** Waiting on a render job that has not finished is not a failed
  try. Counting it as one meant a merely-slow render exhausted its three attempts in fifteen
  seconds and stranded the video forever. Deferring rolls the attempt counter back.
- **Render completion is not publication.** The render worker produces a master file; it does not
  make the video visible. Publishing before transcoding and packaging would expose a video with no
  renditions and no manifest.

**Consequences.**
- Progress is inspectable per stage, so "why is my video still processing" has a real answer.
- Reprocessing is resetting stage rows. The original upload is never touched, so it is safe to run
  on a live video.
- Two workers can run against the same queue without coordination beyond the database.
- Stages left `running` by a dead worker are swept back to `pending` without resetting attempts, so
  a stage that reliably kills its worker still stops rather than looping forever.


---

## ADR-025 — Collected fields are an allowlist, not a convention

**Status:** Accepted — 2026-08-29
**Context.** ADR-008 says audience intelligence comes from first-party in-app behaviour only, and
that sensitive personal characteristics are never used as ranking or targeting features. Stated as
a policy, that survives exactly as long as everyone remembers it. A single well-meaning addition —
"we could segment better if we knew their age" — quietly breaks it, and nothing fails.

**Decision.** `EVENT_FIELDS` in `shared/contracts/behaviour.ts` enumerates every field the server
will persist. Anything else is discarded on the way in. A second list, `FORBIDDEN_EVENT_FIELDS`,
names things that must never be sent at all, matched case- and separator-insensitively.

The two lists do different jobs, and both are needed:

- The **allowlist** is the protection. An unanticipated field is dropped whether or not anyone
  thought of it.
- The **denylist** is the alarm. A payload containing `email` would already have been stripped, so
  silently dropping it would hide a client that is trying to send it. The batch is rejected with a
  400 instead, and the attempt is logged.

Screening runs on the raw body, *before* schema validation. Zod strips unknown keys, so validating
first would erase the evidence — the data would be safe and the problem invisible.

**Consequences.**
- Adding a collected field is a visible, reviewable change to a short list, not an incidental edit.
- A test asserts that nothing on the allowlist matches the denylist, so the two cannot drift apart.
- Free text (currently only a search query) is scrubbed of anything resembling an email address or
  phone number before storage. A search box is where people occasionally paste exactly that.
- `deviceTier` is collected for playback tuning. It is a coarse performance bucket, never a
  targeting feature, and the distinction is written down where the field is declared.


---

## ADR-026 — The rules ranker is production, not a placeholder

**Status:** Accepted — 2026-08-29
**Context.** PHASE_07 puts a Python model at the centre of ranking, and requires that killing it
degrades the feed with no user-visible failure. The tempting reading is "write a trivial fallback
so nothing 500s". That produces a fallback nobody has ever looked at, which is discovered to be bad
at the worst possible moment — during an outage.

**Decision.** The rules ranker is a real weighted ranker over signals the platform already has:
interest match, creator affinity, freshness, trending, quality and predicted engagement derived
from those. It is the default path in development, it serves every test in this repository, and it
is what runs today because no model is deployed yet.

The ML service is treated as an optimisation on top: short timeout, circuit breaker, and a response
that is **validated rather than trusted**. A model returning NaN, a malformed body, or predictions
for only a third of the candidates is treated exactly like a model that is down — because a
confidently wrong ranking is worse than a modest one.

**Consequences.**
- `scoreWithFallback` cannot throw. Every path returns a usable ranking.
- The feed reports which ranker served it. Degraded service is visible in diagnostics rather than
  hidden.
- A partial response is rejected wholesale rather than merged, so half a page is never ranked by a
  different function than the other half.
- The rules ranker's estimates are deliberately conservative — closer to the population average
  than a trained model would be. Being mildly wrong is recoverable; being confidently wrong is not.

---

## ADR-027 — Diversity is bounded by what the pool actually contains

**Status:** Accepted — 2026-08-29
**Context.** The re-ranker enforces a cap on how much of a page one category may occupy. Written as
an absolute rule, that cap is unsatisfiable whenever the candidate pool is thin: demanding no
category exceed 40% of ten slots is impossible when only two categories exist, and honouring it
literally returns a half-empty feed.

An empty feed is a worse outcome than a repetitive one. But simply relaxing the constraint on a
backfill pass — which is what the first implementation did — meant the cap was quietly ignored
whenever it bound, which is precisely when it mattered.

**Decision.** The effective cap is the looser of the configured share and an even split across the
categories actually present. With five categories the configured 40% binds; with two, an even split
is the most diversity the pool can offer and the cap yields to it.

Filling then proceeds in staged passes — strict, then relaxed creator spacing, then unconstrained —
so a full page is always produced but the first pass always gets the diversity it can.

**Consequences.**
- The cap means "as diverse as this pool allows", not "diverse or empty".
- A thin pool produces a full page; a rich pool produces a varied one.
- Only the first pass counts toward the "repeats prevented" diagnostic: a later pass admitting
  something is the system working as designed, not a violation to alarm about.


---

## ADR-028 — Every client surface distinguishes live, sample and offline

**Status:** Accepted — 2026-08-29
**Context.** The UI was built in Phase 1 against sample data and the backend arrived later. During
the transition — which will last through several more phases — a screen may be showing real data,
sample data, or nothing at all because the API is unreachable.

Collapsing those three states into two is harmful in both directions. Treating "offline" as an
error leaves the app blank whenever the backend is not running, which makes the UI impossible to
develop against. Treating sample data as real is worse: it makes a half-built feature look finished,
and on the admin side it invites someone to make a decision on a number nobody ever measured.

**Decision.** Three explicit states, surfaced in the interface:

| State | Meaning | What the user sees |
|---|---|---|
| `checking` / `unknown` | The first request has not resolved | A holding state, never a guess |
| `live` | The API answered | Real data, labelled as live |
| `offline` / `sample` | The API is unreachable or has no content | Sample data, labelled as such |

The mobile feed carries a badge reading "Live · rules" or "Sample data". The admin health page
labels its live panel and states outright that every other figure on the page is sample data.

**Consequences.**
- The app remains fully usable with no backend running, which keeps UI work unblocked.
- Nobody can mistake sample data for measurements, because the label sits next to it.
- "Live · rules" also reveals *which ranker* served the feed, so a missing ML service is visible
  rather than silently degraded.
- As modules move onto real data the labels disappear one at a time, which makes the remaining
  mock surface obvious rather than something to be discovered.

---

## ADR-029 — The feed relaxes "already seen" rather than returning nothing

**Status:** Accepted — 2026-08-29

**Context.** Re-ranking drops any video the viewer has already seen twice. That rule is right: a
third showing of the same clip is a worse use of the slot than almost anything else.

But it had no floor. A viewer who had caught up with everything available hit the rule on every
candidate and was served an empty page. On a mature platform that state is unreachable; on a new
one, a niche one, or a development machine it is the normal case. An empty feed does not read as
"you are up to date" — it reads as a broken app.

**Decision.** When, and only when, the seen rule alone empties the pool, it is dropped and the
candidates come back ordered by least-seen first, then by score.

The other hard constraints do not take part in this. Blocked creators, hidden creators, videos
removed for safety, and categories the viewer has rejected are excluded in both passes. The retry
is a separate call with one rule turned off, not a lowered bar.

**Consequences.**
- The feed is never empty while any permitted content exists.
- A re-run leads with whatever the viewer has seen least, so it degrades gradually.
- `removedByConstraint.seenRuleRelaxed` records that it happened, so "why am I seeing this again"
  is answerable from the diagnostics.
- Nothing a safety rule removed can return through this path — which is the property that had to
  hold for the relaxation to be acceptable at all, and it is covered by tests that assert a block
  and a suppressed category survive an exhausted pool.

---

## ADR-030 — SQL is parsed, not pattern-matched, before it is trusted

**Status:** Accepted — 2026-08-29

**Context.** The migration validator refuses migrations that could destroy user data. It found what
it was looking for with a sequence of regular expressions: strip block comments, strip `--`
comments, strip `#` comments, blank string literals, split on semicolons, then match rules.

Applied in order, those passes are wrong, because SQL's delimiters nest. A `#` inside a string
literal is not a comment — but the `#` pass runs before the string pass, so it was treated as one
and consumed the rest of the line, semicolon included. The consequence was not only false alarms:

```sql
INSERT INTO t VALUES ('#x'); DROP TABLE users;
```

The `#` opened a "comment" that swallowed the `DROP` before any rule could see it. A tool whose
whole purpose is to catch that statement did not know it was there.

This had been passing every migration in the project. Migration 017 passed only because the
swallowed text happened to reassemble into statements that each still carried a `WHERE`.

**Decision.** Anything that decides whether SQL is safe must parse it with a scanner that tracks
context — inside a string, inside a backtick identifier, inside a comment — and only then decide
what a character means. Sequential regex passes are not permitted for this purpose.

The scanner follows MySQL's actual rules: `--` starts a comment only when followed by whitespace,
both `\'` and `''` escape a quote inside a string, and backtick identifiers are preserved because
the rules match table names on them.

**Consequences.**
- A destructive statement can no longer be hidden from review by a character inside a string.
- Colour values, URLs and any other string containing `#` stop producing false alarms.
- The normaliser is longer and slower than the regexes it replaced. For a tool that runs once per
  migration and exists to prevent data loss, that is not a trade worth making the other way.
- Nine regression tests cover both directions: real comments are still stripped, and characters
  inside strings no longer act as delimiters.

**Wider point.** The validator was wrong in a way that usually produced the right answer, which is
why nobody noticed. A safety check that is only sometimes correct is worse than an obviously
missing one, because it is trusted.


---

## ADR-031 — Socket rooms are joined from the database, never from a client request

**Status:** Accepted — 2026-08-29

**Context.** Socket.IO rooms are just strings. A client can emit `join` with any name it likes, and
the default behaviour is to honour it. For chat that would mean anyone who guessed or obtained a
conversation id could listen to it — and unlike the REST API, a socket has no per-message
authorisation step to catch that later.

**Decision.** On connect, the server loads the caller's conversations from `chat_participants` and
joins those rooms itself. The client may ask to join one room — a conversation created after the
socket opened — and that request is checked against the database before it is honoured. Typing
events re-check membership on every emit rather than trusting the join, because someone removed
from a group keeps their socket until they reconnect.

**Consequences.**
- A leaked chat id is not a subscription.
- Presence is broadcast only into rooms the user is already in, so it reaches the people they talk
  to and nobody else; someone who has blocked them shares no room and is never told.
- The socket has one authorisation rule and it is in one place.

---

## ADR-032 — Correctness guarantees do not live in the cache

**Status:** Accepted — 2026-08-29

**Context.** Message sends carry a client-generated id so that a retry after a dropped connection
does not post twice. That was implemented by recording the id in Redis against the resulting
message.

Which fails exactly when it matters. Redis is a cache on this path and is allowed to be
unavailable; a client retries precisely when the network has just misbehaved. With Redis down,
every retry produced a second message.

**Decision.** A guarantee the product depends on is stored where the data is. `messages` carries a
`client_id` with a unique key on `(sender_id, client_id)`, so a duplicate insert cannot succeed
however the request arrived. Redis remains a fast path that saves a round trip. A race that loses
the unique key is treated as the duplicate it is and returns the original message, not an error.

This is the same reasoning that put a unique `idempotency_key` on `wallet_ledger` (ADR-020),
applied to the second place in the product where "exactly once" is a promise to a user.

**Consequences.**
- Send idempotency holds with the cache completely unavailable, which is when it is needed.
- The rule to apply elsewhere: if losing Redis changes an *answer* rather than a *latency*, the
  answer was in the wrong place.

---

## ADR-033 — Timestamps are instants, and the database connection has to agree

**Status:** Accepted — 2026-08-29

**Context.** MySQL's `DATETIME` carries no time zone: it stores the wall-clock value written to it.
Everything here is written with `CURRENT_TIMESTAMP(3)`, which uses the server's session zone —
`SYSTEM` by default, so local time.

The pool was configured with `timezone: 'Z'`, telling the driver to read those local values as
though they were UTC. Every timestamp the API returned was therefore shifted by the host's offset:
five hours into the *future* on this machine. "2 minutes ago" rendered as "just now", and every
active session looked like it had been used seconds earlier. It had been wrong since the pool was
written and was found only because a seeded conversation refused to show its age.

**Decision.** The driver reads DATETIME values the way they were written. Storing UTC would be the
better long-term shape, but it needs every stored value in every table migrated by the offset at
once; interpreting them correctly does not, and fixes the existing rows as well as new ones.

A test asserts that a freshly created message's `createdAt` is within a few seconds of now, so an
offset cannot be reintroduced quietly.

**Consequences.**
- Relative times, session activity, call durations and video ages are all correct.
- The general lesson: a timestamp that looks plausible is not evidence it is right. This one looked
  fine on every screen — "just now" is a perfectly ordinary thing for a timestamp to say.


---

## ADR-031 — Live engagement is measured, never reported

**Status:** Accepted — 2026-08-29

**Context.** A live screen shows a viewer count, a like total and a gift total. Each is trivially
easy to let the client own — the viewer screen already knows when it opened, and incrementing a
local number is one line. Phase 1's screens did exactly that, and went further: a timer nudged the
viewer count every two seconds and the broadcast screen invented gift income, so an empty stream
looked busy and a creator with no supporters looked paid.

That is the same thing the platform refuses to do elsewhere. Promotion buys distribution and never
manufactures likes or followers; a live stream cannot be the one place where the numbers are made
up, whether the source is an advertiser or a `setInterval`.

**Decision.** Every number on a live screen comes from rows the server wrote.

- **Viewers** are `COUNT(*)` over `live_viewers` where nobody has left. Joining twice is one viewer;
  a crashed client is released when the stream ends. The count is recomputed, never incremented, so
  it cannot drift upward.
- **Likes** are per-viewer rows. Live likes are taps and there are many per person, so the stream
  total stays denormalised — but it is recomputed from those rows, and each call is capped, so a
  client cannot post a number it invented.
- **Gift coins** are the sum of transactions that actually charged someone.
- `peak_viewers` only ever moves up, because it records what happened rather than what is happening.

**Consequences.**
- A quiet stream looks quiet. That is the point.
- The client cannot inflate any of it, because it is never asked.
- The sample data behind these screens still exists for development, but it is labelled, and the
  scripted comment replay stops entirely the moment real comments arrive — a screen mixing invented
  chatter with real chatter is worse than one showing neither.

---

## ADR-032 — Idempotency lives in the database; the cache is an optimisation

**Status:** Accepted — 2026-08-29 · Refines ADR-020

**Context.** ADR-020 put money-route idempotency in Redis and made the middleware fail closed: if
the cache is unavailable, refuse the request rather than risk a double charge. That was the right
call when the cache was the only protection.

Two things then went wrong in practice. First, the lookup had no timeout, so a dead cache added its
full connect-retry backoff — about twelve seconds — to every money request before failing. Second,
the same pattern reached chat: message sends deduplicated retries through a Redis key, and with the
cache down a client retrying after a dropped connection posted the same message twice. The cache
being unavailable is precisely when clients retry, so protection that lives only there is absent
exactly when it is needed.

**Decision.** A correctness guarantee belongs in the database. The cache may make it faster; it may
never be the only copy.

- `messages` carries `client_id` under a unique index on `(sender_id, client_id)`.
- `gift_transactions` carries the caller's `Idempotency-Key` under a unique index on
  `(sender_id, idempotency_key)`.
- `wallet_ledger.idempotency_key` was already unique and remains the backstop under both.
- Every cache lookup on these paths is bounded, and a duplicate-key error is caught and answered
  with the original result rather than an error the client cannot act on.

The middleware now takes an explicit `durable` flag, declared where the route is mounted. A durable
route continues when the cache is unreachable, because the guarantee has not gone anywhere. A route
without its own key keeps ADR-020's fail-closed behaviour.

**Consequences.**
- Retries are safe whether or not Redis is running, which is the only version of "safe" that means
  anything.
- The header stays mandatory on money routes regardless of cache state.
- The `durable` flag is per route and visible at the mount point, so it cannot be assumed by a
  handler that has not earned it.
- Bounding the lookups took chat sends from 36 seconds to 0.15 with the cache down — the same class
  of failure as the cache circuit breaker (ADR-023) and the rate limiter, fixed this time as a
  pattern rather than one more instance.


---

## ADR-033 — A withdrawal request is the hold

**Status:** Accepted — 2026-08-29

**Context.** A payout has two moments: the user asks for it, and an administrator pays it. Days can
pass between them. The obvious implementation leaves the balance alone until payment and checks it
at request time — which is wrong, and wrong in a way that costs real money.

With the balance untouched, someone with $500 can submit five $500 requests in a minute. Each
passes its own balance check, because none of the others has been paid yet. An administrator
working the queue pays them one at a time and has no reason to suspect the fourth is against money
that left with the first.

**Decision.** The balance is debited inside the same transaction that writes the request. The
request *is* the hold.

- `debit` throws `insufficient_balance` rather than clamping, so a second request against the same
  money fails outright.
- The ledger row is written with `status = 'pending'`: the money is out of the balance but not yet
  paid, and the row says so.
- **Rejection and cancellation refund.** This is the corollary, not an extra feature: the money has
  already gone, so refusing to pay has to put it back or the user has simply lost it.
- Marking a request paid moves no value. It settles the row that recorded the hold.

**Consequences.**
- The available balance a user sees is money nothing else has a claim on.
- Every state change is claimed with a conditional `UPDATE ... WHERE status IN (...)`, so two
  administrators acting at once produce one outcome and the loser gets
  `invalid_state_transition` rather than a second payment.
- A user can cancel only while `pending`. After approval the money may be moving, and a refund then
  would pay them twice.
- `pending_withdrawal` on the wallet is maintained alongside, so "held" is visible without reading
  the ledger.

---

## ADR-034 — Earned rewards are spendable, never payable

**Status:** Accepted — 2026-08-29

**Context.** The platform hands out coins for things that cost it nothing to grant: finishing a
daily task, referring a friend, hitting a milestone. It also handles money that genuinely entered
the system — someone bought coins, someone sent a gift.

If those two pools are the same pool, the platform prints money. A task farm becomes a payroll, and
a promotional grant becomes a cash withdrawal.

**Decision.** Four separate balances, and only one of them can leave.

| Balance | Source | Can be spent in-app | Can be withdrawn |
|---|---|---|---|
| `coin` | Purchased, or converted from reward | Yes | **No** |
| `reward` | Tasks, referrals, milestones | After conversion to coins | **No** |
| `live_gift` | Gifts received, while held | No | After clearing |
| `withdrawable` | Cleared gift earnings | No | **Yes** |

`assertPayable` refuses any wallet but `withdrawable` on the payout path, and `convert` refuses any
pair not on an explicit allow-list. Reward converts to coins at a configurable rate; nothing
converts back, and nothing converts into `withdrawable`.

**Consequences.**
- Money can only leave if money came in for it. Every withdrawable unit traces to a gift someone
  paid for, held through its clearing period.
- The conversion is one-way by construction rather than by convention — there is no route back,
  which is a stronger guarantee than a rule saying there should not be.
- Users have to be told this plainly, and are: the tasks screen says task rewards are not
  withdrawable and only live gift earnings can be taken out.
- A promotional grant is safe to give. It can buy promotion or gifts and cannot become cash.


---

## ADR-035 — Promotion buys distribution, and says so

**Status:** Accepted — 2026-08-29

**Context.** An advertising product on a social platform has two obvious ways to go wrong, and both
are profitable in the short term.

The first is selling engagement: charging for likes, follows or comments and manufacturing them.
The numbers look better for the advertiser, and every one of them is a lie told to everyone else on
the platform about how popular something is.

The second is hiding the placement: blending paid content into the organic feed without marking it,
because unmarked advertisements perform better.

**Decision.** Neither, structurally rather than as policy.

**There is no field anywhere for buying engagement.** Not in `CreateCampaignBody`, not in the
database, not in the routes. Adding one would mean adding it to the contract, the schema and the
service, which is a decision somebody would have to make deliberately and defend. Every counter a
campaign reports is a count of something a real person did.

**Every promoted item carries `isPromoted` all the way to the screen**, and the client renders a
SPONSORED badge from it. The flag is set by the delivery service and passed through the feed
service, the hydration step and the client adapter — four places that would each have to drop it
for an unmarked advertisement to reach anyone.

**Placement rules that are not for sale:**
- Promoted items are chosen *after* ranking, so money cannot move an organic video's position.
- Never the first slot. A feed that opens on an advertisement is one people stop opening.
- Density is a ceiling. Unsold inventory stays organic; nothing fills it.
- Blocks, bans, privacy and the minimum age apply unchanged.

**Consequences.**
- An advertiser can buy more people seeing their video and nothing else. That is the entire product.
- A campaign that reaches many people and engages none reports exactly that, which is the
  information the advertiser actually needs.
- The "no fake engagement" rule is now enforced by the shape of the code rather than by remembering
  it — there is no code path that could produce a fake like even by mistake.

---

## ADR-036 — Delivery is charged once, against a record of it

**Status:** Accepted — 2026-08-29

**Context.** Charging per impression means the billing event is a signal from a feed build. Signals
retry, replay and arrive twice; a naive implementation bills the advertiser again each time, for
showing one person one video once.

The opposite failure is worse in a quieter way: a campaign that is never charged delivers for ever
on a budget it never spends, and that is exactly what happened here. `campaigns.spent_coins` was a
BIGINT while an impression cost 0.05 coins, so every charge rounded to zero. Spend stayed at 0,
which also meant the budget-exhaustion check never fired.

**Decision.** Charging is bookkeeping against a durable record of the delivery.

- `campaign_impressions` has a unique key on (campaign, viewer, impression id). Recording the
  delivery *is* the claim to charge for it; a duplicate loses the insert and costs nothing.
- The row is written first, inside the same transaction as the charge, so an impression cannot be
  charged without being recorded or recorded without being charged.
- Budget and daily cap are re-read `FOR UPDATE` inside that transaction. A delivery that would
  exceed either is recorded at zero — it was served, so it is not hidden, but the advertiser did not
  agree to spend more than their budget.
- Spend columns are `DECIMAL(16,4)`. Budgets stay whole coins because an advertiser commits a round
  number; only accumulated spend needs the precision.
- Views are a separate event on the same row, charged once via `viewed_at`. Clicks are recorded and
  never charged.

**Consequences.**
- A retried or replayed signal is free, and the test that proves it charges the same impression id
  twice and asserts one row.
- A campaign cannot outspend its budget however many deliveries race each other.
- Every coin of spend traces to a row naming who was shown what and when — which is what makes an
  advertiser's invoice answerable rather than asserted.


---

## ADR-037 — Identity documents leave the system as soon as they have done their job

**Status:** Accepted — 2026-08-29

**Context.** Verification asks people to send a passport or national ID. Once that file exists on
the platform it is a liability every day it remains: a breach discloses identity documents, and a
copy kept for convenience is a copy kept for whoever eventually gets in.

The convenient design keeps them — for re-review, for audit, for "in case". Every one of those
reasons is real and none of them outweighs holding a folder of scanned passports indefinitely.

**Decision.** Documents are write-only from the API's point of view, and short-lived in storage.

- **Never returned.** No endpoint returns a storage key or a URL for a verification document.
  The applicant gets a count; the review queue gets document *ids*. The mobile contract has no
  field that could hold one, so the app cannot render a link even by mistake.
- **One way in.** A reviewer requests a viewing link for one document. It is signed to that
  reviewer, expires in five minutes, and issuing it writes a `verification_document_viewed`
  security event against the *subject's* account — so the person whose passport it is has a record
  of who opened it.
- **Destroyed on decision.** Approving or rejecting deletes the files. The `verification_requests`
  row survives with its decision, reviewer and note, so the decision remains auditable without the
  evidence remaining recoverable. `more_info` keeps them, because the applicant is being asked to
  add to them.
- **A sweep catches the rest.** Object storage is not transactional, so a delete can fail after the
  row is marked. An hourly sweep removes orphans, which is what makes the guarantee true rather
  than usually true.
- **Keys are verified as the applicant's own** before a reviewer is ever pointed at them.

**Consequences.**
- The window in which a document exists is the review, not the lifetime of the account.
- Looking at someone's identity document is an act that leaves a trace naming who did it.
- Re-reviewing an old decision means asking for the documents again. That is the correct cost.

---

## ADR-038 — A moderation decision is the enforcement, not a record of one

**Status:** Accepted — 2026-08-29

**Context.** Moderation systems fail in a specific way: the queue records a suspension, the
moderator moves on, and the account keeps posting. The row says one thing and the platform does
another, and nobody notices until someone asks why a banned account is still there.

The mirror failure is as bad. An action that cannot be undone means every mistake is permanent, and
moderation is done at speed on partial information, so there will be mistakes.

**Decision.** The record and the change are one transaction, and both directions work.

- Every `moderation_actions` row is written in the same transaction as the change it describes. A
  suspension sets `users.status` **and** revokes every session, so it takes effect immediately
  rather than when an access token happens to expire.
- Each action returns a plain statement of what it actually did — "suspended the account and ended
  its sessions" — which is logged and returned. A claim backed by a description of the change,
  rather than an assumption that the change happened.
- **Reverting restores.** Un-suspending sets the account active again; un-removing restores the
  video. A "reverted" row that leaves the suspension in place is a lie told to whoever reads the
  record next.
- **A reason is mandatory.** A decision with an empty reason cannot be reviewed, appealed or learned
  from, so it is refused.
- **Temporary means temporary.** A scheduled sweep lifts expired restrictions, and only what that
  action imposed — a separately banned account is not released because an unrelated suspension
  expired.
- **A ban deletes nothing.** Content, wallet and history remain; a ban is a loss of access.

**Consequences.**
- The queue and reality cannot drift apart, because they are written together.
- Every action is attributable, reasoned and reversible, which is what makes an appeal process
  possible rather than nominal.
- The reporter is told the outcome and nothing more. A report is not a window into someone else's
  record.

---

## ADR-039 — Nothing leaves the platform without a row saying it should

**Status:** Accepted — 2026-08-30

**Context.** Twelve phases produced things that need to reach a person outside the app: a
verification code, a password reset, a moderation notice, a support reply. Until now they had
nowhere to go. The signup flow returned the code in its own HTTP response, which works in
development and is the whole security model in production.

Sending inline is the obvious fix and the wrong one. A slow SMTP server becomes a slow signup. A
provider outage becomes a broken signup. And a request that is retried sends the message twice —
which for a password reset means two valid codes sitting in somebody's inbox.

**Decision.** Every outbound message is a row in `outbox`, written in the transaction that caused
it, and delivered later by a drain.

- **The write is part of the cause.** The event and the message are committed together, so a crash
  loses neither, and a dead provider fails the drain rather than the user's request.
- **A row is claimed before it is sent.** The claim is a conditional `pending → sending` update, so
  two workers cannot both send it. A message is sent at most once even with several drains running.
- **A dedupe key makes queueing idempotent**, and the answer comes from the database rejecting the
  insert — not from `affectedRows`, which mysql2's prepared statements report as a matched row
  whether or not anything was written.
- **Failure is recorded, backed off and retried**, and after five attempts the row is `abandoned`
  rather than retried for ever. Abandoned rows are kept: an address that always bounces is worth
  knowing about, and something undeliverable should be findable rather than silently gone.
- **The body is rendered at send time** from the template and the stored variables, so a correction
  to a template reaches messages already queued.
- **A missing transport fails loudly.** With no push provider configured, push throws and the row
  records why. Marking it sent would make the outbox lie about every notification the platform
  never delivered.

**Consequences.**
- Delivery is observable. `GET /admin/outbox` says how much is waiting, how much has failed, how old
  the oldest is, and which transport is actually carrying messages — `console` in this build.
- Nobody waits on SMTP.
- The queue is the single place to add a provider, a rate limit or a suppression list.

---

## ADR-040 — A preference the user cannot see is not a preference

**Status:** Accepted — 2026-08-30

**Context.** The notification settings screen held its switches in component state and saved
nothing. It looked like it worked. Flipping "marketing email" off told the user marketing email was
off, kept that answer until they navigated away, and then forgot it — while the platform carried on
as before. That is worse than having no settings screen, because it converts a silent default into
an explicit promise that is not kept.

The same shape appeared on the server: quiet hours could be written but not read, so any screen
showing them would have had to guess.

**Decision.** A preference is stored, readable, and enforced in one place.

- **Three channels, three switches.** In-app, push and email are different questions — what appears
  in your inbox, what interrupts you, what reaches your address. A single switch per category would
  have to pick one meaning and be wrong for someone.
- **Every switch writes immediately**, optimistically, and snaps back if the write fails. A switch
  left where the finger put it claims a change that never reached the server.
- **Everything that can be set can be read.** `GET /me/notification-preferences` returns the
  preferences and the quiet window together.
- **Enforcement is in `notify()`, once.** A preference honoured at four call sites out of five is a
  preference the user believes in and the platform ignores.
- **Marketing is off on all three channels by default.** Consent is given, not withdrawn.
- **Account and verification notices always reach the inbox.** Push and email stay the user's to
  silence; the record does not. A suspension nobody can find is a suspension nobody can appeal.
- **Quiet hours suppress the interruption, never the record.** The notification is still written and
  still appears in the inbox; only the push is withheld.

**Consequences.**
- What the screen shows is what the server will do.
- Adding a category means adding it to `PREFERENCE_KINDS` and its defaults — the enforcement and the
  UI follow.
- Quiet hours are stored as local hours on the profile, so a user who moves time zones carries their
  window with them rather than their old wall clock.

---

## ADR-041 — A real name never appears beside invented numbers

**Status:** Accepted — 2026-08-30

**Context.** This has now been the same bug eight times. A live figure rendered next to a sample
one; an empty live result replaced by sample content; a real account rendered with a stranger's
follower count. Each was fixed where it was found, and it kept coming back somewhere else, because
the fallback was doing exactly what it was written to do — keep the screen full.

Phase 13 surfaced three more at once, all downstream of linking notifications to real accounts:

- `VerifiedBadge` returned `null` only for `'none'`, so an `undefined` tier drew a blue tick. A
  brand-new account showed as verified in the inbox.
- `getUser(id)` returned `currentUser` for any id it did not recognise, so every real account opened
  as the same invented person with 128K followers.
- A profile with no videos was padded with `videos.slice(0, 6)` — six sample clips with millions of
  plays, under a real name.

**Decision.** Sample data is for a screen that has no live data at all. It is never mixed into one.

- **A fallback is whole-screen or nothing.** `useApiData` reports its `source`; a screen showing
  `live` may not render sample values anywhere.
- **`fallbackOnEmpty: false` is the default for anything belonging to a person** — their inbox,
  their profile, their applications, their tickets. Empty is a real answer.
- **A trust signal is drawn only from a value that means it.** `VerifiedBadge` renders for
  `individual`, `creator` or `business`, and for nothing else — including `undefined`. The type said
  the prop was required; a cast defeated that, and a fabricated verification is not something to
  leave resting on the type checker.
- **An identifier resolves or it does not.** An unknown user id is an empty profile, never a
  different person.

**Consequences.**
- Empty states are common now, and correct.
- Screens carry a `SourceNote` saying which mode they are in, so "sample" is a visible state rather
  than an indistinguishable one.
- Sample data keeps its real purpose: a demo with the backend switched off.

---

## ADR-042 — An admin is a user with a second key, not a second system

**Status:** Accepted — 2026-08-30

**Context.** The admin panel needed authentication. The obvious build is a parallel
one: admin tokens, admin sessions, an admin password table with its own reset flow —
twice the attack surface and a second place for every security fix.

**Decision.** Admins sign in through the same `/auth/login` as everyone else. What
makes them an admin is the `admin_users` row linked to their user account, resolved
by `requireAdmin` on every `/admin/*` request.

- Granting access requires an **existing** platform account; the grant route never
  handles credentials.
- Revoking is one UPDATE — disable the admin row (or the user account) and the
  access is gone with it. Nobody can disable their own row, so the last super admin
  cannot lock everyone out by accident.
- All user-side protections — lockouts, session revocation, security events —
  automatically cover admins, because admins are users.
- The panel's token refresh is single-flight: refresh tokens rotate on use, and a
  page load's parallel 401s would otherwise race the rotation and sign the operator
  out (BUG-061).

**Consequences.** One auth system to secure. The admin table is an authorization
record, not an identity store. The audit trail can always name a real account.

---

## ADR-043 — Configuration the operator can change must be readable, validated and audited

**Status:** Accepted — 2026-08-30

**Context.** Launch requires operations nobody should need SSH for: pointing email
at Gmail, replacing placeholder payment accounts, changing what a coin costs. Each
of those was an environment variable or a seeded row — changeable only by whoever
holds the server keys, invisible to everyone else.

**Decision.** Operator-changeable configuration lives in settings and catalogue
tables, edited through validated admin routes.

- **Settings are declared.** A key must exist in `SETTING_DEFAULTS`; a typo is an
  error, not a silent new row nothing reads. The value must match the default's
  shape — a string where a number belongs is refused at the door.
- **Catalogue edits are allow-listed per table.** The route names which columns are
  editable and their types; a column name is matched, never interpolated.
- **Secrets are write-only.** `email.smtp_pass` works but never comes back — not in
  the API, not in the audit log.
- **Order of truth for email:** settings first, environment as fallback, console as
  the loud last resort. The mailer rebuilds its transport when settings change, so
  the fix for a wrong password is a form, not a deploy.
- **Every write is audited** with who, before and after (BUG-060 made this sharper:
  the settings store returned raw JSON text on MariaDB, so a stored `false` was the
  truthy string "false" — values are parsed on read now).

**Consequences.** The preflight, the admin panel and the runtime all read the same
truth. "Who changed the payout rate" always has an answer. The operator can run the
platform — including its email — without touching the server.
