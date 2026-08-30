# TESTING LOG

Every test run that gates a phase or a deployment is recorded here.

---

## TEST STRATEGY

| Layer | Tooling | Scope |
|---|---|---|
| Mobile unit | Jest + React Native Testing Library | Components, hooks, stores, formatters |
| Mobile E2E | Detox / Maestro | Auth flow, feed scroll, record → edit → publish, chat, wallet |
| Admin unit | Jest + React Testing Library | Tables, forms, permission gating |
| Admin E2E | Playwright | Login, each module smoke path, role gating |
| Backend unit | Jest | Services, ranking math, wallet ledger |
| Backend integration | Jest + test MySQL + test Redis | Routes, transactions, socket events |
| ML | pytest | Feature extraction, scoring, ranking determinism |
| Load | k6 | Feed endpoint, chat fan-out, live viewer join |
| Migration | Staging replay on production-sized copy | Row counts before/after, timing, locks |

### Device matrix (mobile)

| Tier | Devices |
|---|---|
| Low-end Android | 3GB RAM, Android 10 |
| Mid Android | 6GB RAM, Android 13 |
| High Android | 12GB RAM, Android 15 |
| iOS | iPhone SE (small screen), iPhone 14, iPhone 16 Pro (Dynamic Island) |

Every feed change must be measured on the **low-end Android** tier, not only on a simulator.

---

## PHASE GATES

A phase is not complete until its gate tests pass and are recorded below.

| Phase | Gate |
|---|---|
| 1 | Every screen reachable, no crashes, no layout breakage on small screens or notch/Dynamic Island devices, dark + light both correct |
| 3 | Auth flows pass E2E; token refresh and session revocation verified |
| 4 | Record → edit → filter → music → publish completes on all device tiers |
| 5 | Transcode pipeline produces every rendition; playback starts under 1s on mid-tier |
| 6 | Behaviour events arrive exactly once; no PII in the event payload |
| 7 | Feed latency p95 under budget; fallback ranker verified by killing the ML service |
| 8 | Message delivery, receipts and call setup verified across networks |
| 9 | Wallet ledger reconciles; concurrent gift sends cannot double-spend |
| 10 | Campaign budget cannot be exceeded; no fake engagement generated |
| 11 | Every admin action writes an audit row; role gating cannot be bypassed |
| 12 | A/B framework assigns deterministically; guardrails trip correctly |
| 13 | Full restore-from-backup rehearsal passes |

---

## TEST RUN HISTORY

| Date | Phase | Suite | Environment | Passed | Failed | Notes |
|---|---|---|---|---|---|---|
| 2026-08-29 | 1 | `tsc --noEmit` (mobile) | Local | ✅ | 0 | Clean across all 55 screens and shared components |
| 2026-08-29 | 1 | `tsc --noEmit` (admin) | Local | ✅ | 0 | Clean across all 30 modules |
| 2026-08-29 | 1 | `next build` (admin) | Local | ✅ | 0 | All 30 routes prerendered as static |
| 2026-08-29 | 1 | `expo config` validation | Local | ✅ | 0 | Camera/microphone permission strings present |
| 2026-08-29 | 1 | Manual smoke — mobile | Expo web preview | ✅ | 0 | Splash → onboarding → auth → For You → Explore → Profile all render; feed snap, sheets and tabs work |
| 2026-08-29 | 1 | Manual smoke — admin | Chromium 1440×900 | ✅ | 0 | Sidebar, topbar, dashboard, users master–detail verified |
| 2026-08-29 | 1 | Expo SDK 57 API review | Docs | ✅ | 0 | `useVideoPlayer`/`VideoView` and `CameraView`/`useCameraPermissions` usage confirmed against v57 docs; separate microphone permission added |
| 2026-08-29 | 1 | Feed snap regression test | Web 375×812 | ✅ | 0 | Scrolled to video 4 and 6: `scrollTop` a clean multiple of page height (2244 = 3×748); all 4 action counts inside viewport (bottom 722 < 748) |
| 2026-08-29 | 1 | Responsive breakpoint test | Web 375 / 1400 | ✅ | 0 | 375px → nav labels share y=788 (bottom bar), feed full-bleed. 1400px → nav labels stack at x≈51 (sidebar), feed a centred 9:16 card with action rail |
| 2026-08-29 | 1 | Viewport fill check | Web 1400×880 | ✅ | 0 | Root and children all 880px = innerHeight; no layout gap (earlier grey band was pane letterboxing) |
| 2026-08-29 | 1 | Monetization screens | Web 375×812 | ✅ | 0 | Monetization 68% / 4 of 8; Daily tasks 67/100 likes and 3/5 referrals; Wallet shows all four balances distinctly |
| 2026-08-29 | 1 | Coin calculator | Web 375×812 | ✅ | 0 | PKR 2,000 → 700 coins at the displayed 0.35 rate; packages re-priced into PKR |
| 2026-08-29 | 1 | `next build` (admin, 35 routes) | Local | ✅ | 0 | All routes prerendered after adding 5 monetization modules |
| 2026-08-29 | 1 | Admin approval queues | Chromium 1400×880 | ✅ | 0 | Coin requests: 4 queued, 3 flagged, proof status per row. Withdrawals: 4 queued ($2,220), fee/net breakdown, 2 needing sign-off |

---

## OPEN DEFECTS FOUND BY TESTING

| ID | Date | Severity | Area | Description | Status |
|---|---|---|---|---|---|
| BUG-001 | 2026-08-29 | High | Feed | Action bar, author row and caption pushed below the fold from the 2nd video onward — `pagingEnabled` fought `snapToInterval`, and page height came from a stale `Dimensions.get()` | ✅ Fixed — container now self-measures |
| BUG-002 | 2026-08-29 | Low | Navigation | Inbox unread badge overlapped the sidebar label | ✅ Fixed — uses `tabBarBadge` |
| BUG-003 | 2026-08-29 | Medium | Onboarding | Horizontal paging broke on window resize (stale `Dimensions`) | ✅ Fixed — `useWindowDimensions` |

---

## MANUAL UI REVIEW CHECKLIST (Phase 1)

- [x] Splash → onboarding → auth → home flows without a dead end
- [x] Every bottom-tab destination renders
- [x] Every screen listed in `PHASE_01_UI_UX.md` is reachable from the UI (enforced by the typed
      navigation graph — an unregistered route is a compile error)
- [x] Feed scrolls smoothly, snaps one video per swipe
- [x] Admin panel: sidebar reaches every module (nav hrefs diffed against the route folder)
- [ ] Safe-area insets on real notch / Dynamic Island / gesture-bar hardware
- [ ] Small-screen (iPhone SE / 5" Android) layouts do not clip
- [ ] Dark mode and light mode both legible on device
- [ ] Back navigation on Android hardware back button
- [ ] Admin tables and forms at 1280px and 1920px

**Outstanding:** the unchecked items need real devices — the web preview cannot verify safe-area
insets, the Android hardware back button, or on-device scroll performance.

---

## PHASE 2 — BACKEND (2026-08-29)

### Automated suite

`npm run backend:test` — **27 passed, 0 failed.**

| Suite | Tests | Covers |
|---|---|---|
| `test/validate-migration.test.ts` | 16 | Every data-safety rule, plus the shipped migrations |
| `test/ledger.test.ts` | 11 | Money invariants, against a real database |

### Data-safety verification (the owner's permanent rule)

| Scenario | Expected | Result |
|---|---|---|
| `DROP TABLE wallets` in a migration | Refused | ✅ Refused; table and rows survived |
| `TRUNCATE`, `DROP DATABASE` | Refused | ✅ Refused |
| `DELETE` / `UPDATE` without `WHERE` | Refused | ✅ Refused |
| `DROP COLUMN` on a user table | Refused | ✅ Refused |
| `RENAME COLUMN` on a user table | Refused | ✅ Refused |
| `NOT NULL` without a default | Refused | ✅ Refused |
| Narrowing `VARCHAR(255)` → `VARCHAR(20)` | Flagged | ✅ Flagged (after fixing BUG-004) |
| Widening a type | Allowed | ✅ Allowed |
| Editing an already-applied migration | Refused | ✅ Refused on checksum mismatch |
| User + wallet balances across 2 migrations | Unchanged | ✅ 5000 / 250 / 900 / 12.50 preserved exactly |
| Re-running `migrate:up` | No-op | ✅ "Nothing to migrate" |

### Money invariants (ADR-013, ADR-018)

| Scenario | Expected | Result |
|---|---|---|
| Credit writes balance and ledger together | Both, atomically | ✅ |
| Four balances kept separate | No bleed | ✅ |
| Debit beyond balance | Refused, nothing written | ✅ No orphan ledger row |
| reward → coin | Allowed, one-way | ✅ |
| coin → reward, coin → withdrawable | Refused | ✅ |
| **reward → withdrawable** | Refused | ✅ Task farming cannot become cash |
| Only `withdrawable` is payable | Other three refused | ✅ |
| Frozen wallet | Blocks spend, allows admin credit | ✅ |
| 10 concurrent debits of 20 against 100 | Exactly 5 succeed | ✅ Landed on 0, never negative |
| Reconcile after mixed sequence | No drift | ✅ |
| Reconcile with injected drift | Reports, does not repair | ✅ Evidence preserved |

### API smoke test

| Endpoint | Result |
|---|---|
| `GET /health` | 200, `{ok:true,...}`, no dependency touched |
| `GET /ready` | Correct 503 semantics; reports database up, redis down |
| Unknown route | 404 in the standard error envelope |

### Bugs found and fixed

| ID | Date | Severity | Area | Description | Status |
|---|---|---|---|---|---|
| BUG-004 | 2026-08-29 | **High** | Migration safety | The type-narrowing rule never fired. Its regex ended in `\b`, which cannot match after a type closing in `)`, so `VARCHAR(20)`/`CHAR(10)` narrowing passed validation silently — the exact case most likely to truncate user data | ✅ Fixed — `(?!\w)` guard, regression test added |
| BUG-005 | 2026-08-29 | Medium | Health probes | `/ready` hung 6s+ while the Redis driver retried a dead connection; a hanging probe reads as a crashed process | ✅ Fixed — both checks bounded to 2s |

### Not yet verified

- **Redis-dependent paths** (rate limiting, idempotency replay, presence). Redis is not installed
  on the development machine. Both were reviewed and typechecked but not exercised at runtime.
  Rate limiting fails open by design; idempotency fails closed. Needs `docker compose up redis`
  or a native install before Phase 3 money endpoints ship.
- **MySQL 8.4.** The schema was verified on MariaDB 10.4 (what XAMPP ships). ADR-019 keeps the DDL
  inside the intersection of both engines, but a run against MySQL 8.4 should confirm it before
  release.


---

## PHASE 3 — AUTHENTICATION AND USERS (2026-08-29)

### Automated suite

`npm test` — **50 passed, 0 failed.** Stable across repeated runs.

| Suite | Tests | Covers |
|---|---|---|
| `test/validate-migration.test.ts` | 16 | Migration data-safety rules |
| `test/ledger.test.ts` | 11 | Money invariants against a real database |
| `test/auth.e2e.test.ts` | 23 | Real HTTP against a real database |

### Exit criteria

| # | Criterion | Test | Result |
|---|---|---|---|
| 1 | register → OTP → login → refresh → logout | `register → verify email → login → refresh → logout` | Pass |
| 2 | Refresh rotates; old tokens rejected | `replaying a rotated refresh token revokes the entire session family` | Pass |
| 3 | Session revocation is immediate | `revoking a session invalidates its access token on the next request` | Pass |
| 4 | Account type switch preserves data | `switching account type preserves wallet balance and profile` | Pass |
| 5 | Blocks enforced server-side | `a block hides the blocker from the blocked user and severs the follow` | Pass |

### Security behaviour verified

| Scenario | Expected | Result |
|---|---|---|
| Register with an existing email | Generic 409, no confirmation the address is known | Pass |
| Login: unknown email vs wrong password | Identical status, code and message | Pass |
| Password reset for an unknown address | Reports success | Pass |
| OTP reused | Refused | Pass |
| Wrong OTP vs no pending code | Identical response | Pass |
| OTP or password appearing in the security log | Never | Pass |
| Reserved usernames, and lookalikes of them | Refused | Pass |
| Weak or email-derived password | Refused | Pass |
| Under-13 registration | Refused | Pass |
| Protected routes without a token | 401 | Pass |
| Password reset | Ends every session | Pass |
| Password change | Keeps current session, ends the rest | Pass |
| Follow twice | Counter stays at 1 | Pass |
| Follow yourself | Refused | Pass |
| Unblock | Restores visibility but not the follow | Pass |

### Bugs found and fixed

| ID | Date | Severity | Area | Description | Status |
|---|---|---|---|---|---|
| BUG-006 | 2026-08-29 | **High** | Auth | Refresh-token reuse detection was inert. The family revocation ran inside the transaction the function then threw from, so it rolled back — the defence detected theft, logged it, and left the stolen token live | Fixed — revocation moved outside the transaction; covered by a test asserting the legitimate token also dies |
| BUG-007 | 2026-08-29 | **High** | Auth | Only one session could ever be created. `user_sessions.refresh_token_hash` is UNIQUE, and the row was inserted with a fixed placeholder hash before the token was minted, so the second session collided | Fixed — the refresh token now carries a random `jti`, removing the circular dependency and the placeholder |
| BUG-008 | 2026-08-29 | Medium | Tooling | The root `typecheck` script checked nothing for mobile or admin. `npm --prefix X exec -- tsc` runs from the repo root, finds no tsconfig, prints tsc's help and exits 0 — so both had been silently "passing" | Fixed — each package owns its own `typecheck` script |
| BUG-009 | 2026-08-29 | **High** | Auth | Every unknown or expired refresh token took a gap lock. `SELECT ... WHERE refresh_token_hash = ? FOR UPDATE` that matches nothing makes InnoDB lock the index gap, blocking all concurrent `INSERT INTO user_sessions` until the transaction ends — so ordinary junk traffic could stall sign-ins platform-wide | Fixed — the row id is resolved with an unlocked read first, so the `FOR UPDATE` is always a single-row primary-key lock with no gap |

### How BUG-009 surfaced

It presented as a flaky test, not as a bug: `register → … → logout` failed roughly one run in three,
always at exactly ~51 seconds — MariaDB's 50-second lock-wait timeout plus overhead. The first two
explanations were both wrong. Pinning test concurrency to 1 did not fix it, and there were no
lingering transactions when the database was inspected at rest.

Reading the blocked statement was what settled it: the insert into `user_sessions` was waiting on a
gap lock that a *failed* refresh-token lookup had taken. Runs killed mid-flight left that lock
behind, which is why the failure clustered after an interrupted run and cleared on its own later.

The flake was a symptom of a real production defect, and the same fix removed both.

### Test infrastructure notes

- Integration tests run **one file at a time**. Run in parallel, the ledger suite's deliberate lock
  contention collided with the auth suite's registration transactions and hit MariaDB's 50-second
  lock-wait timeout, producing a flaky `internal_error`.
- The E2E suite sets `RATE_LIMIT_ENABLED=false` **before** importing the app, via dynamic import.
  ESM hoists static imports, so an assignment above them runs too late — with rate limiting still
  on and Redis absent, every request waited out the driver's retry backoff and the first test took
  87 seconds.
- The enumeration test now uses a fresh unknown address per run. It previously reused one constant
  address, and the per-email sign-in lockout eventually returned 429 instead of 401 — making the test
  fail for a reason unrelated to what it was checking.
- Each test account is removed afterwards. Verified: users, sessions and wallets all return to zero
  after a run. Security events with a null user id (a code requested for an address with no account)
  are intentionally retained — the log is append-only.

### Not verified

- **OTP email delivery.** No mailer is connected. Development returns the code in the response so
  the flow is testable end to end; production returns nothing, so a real user cannot yet complete
  verification or a password reset. Phase 13.
- **Rate limiting at runtime.** Needs Redis, which is not installed on the development machine.


---

## PHASE 4 — CREATION PIPELINE (2026-08-29)

### Automated suite

`npm test` — **117 passed, 0 failed.**

| Suite | Tests | Covers |
|---|---|---|
| `test/validate-migration.test.ts` | 16 | Migration data-safety rules |
| `test/ledger.test.ts` | 11 | Money invariants |
| `test/auth.e2e.test.ts` | 23 | Authentication and users |
| `test/creative.test.ts` | 41 | Grade → FFmpeg, edit-list validation (pure, 0.6s) |
| `test/creative.e2e.test.ts` | 26 | Upload, drafts, publish, catalogue |

### Exit criteria

| # | Criterion | Result |
|---|---|---|
| 1 | Record → publish on three device tiers | ⛔ Blocked — needs physical devices |
| 2 | Device preview matches server render | 🟡 Server half verified; shader half needs a device |
| 3 | Drafts survive an app update | ✅ Verified with a client holding no local state |
| 4 | Admin adds a filter, no app release | ✅ Verified end to end |
| 5 | Upload resumes after interruption | ✅ Verified |

### Upload behaviour

| Scenario | Expected | Result |
|---|---|---|
| Single chunk | Completes | Pass |
| Four chunks, assembled | Byte-identical to source | Pass |
| Chunks out of order | Assembles correctly | Pass |
| Interrupted midway | Completion refused; status lists what is missing; resume works | Pass |
| Duplicate chunk | Accepted as a no-op, count unchanged | Pass |
| Wrong-sized chunk | Refused | Pass |
| Tampered bytes, correct length | Caught by checksum | Pass |
| Out-of-range index | Refused | Pass |
| Another user's session | 404, not 403 | Pass |
| Unsupported format / oversized / too long | Refused | Pass |

### Edit-list security

| Scenario | Expected | Result |
|---|---|---|
| References another user's upload | Refused | Pass |
| References a key never uploaded | Refused | Pass |
| References an incomplete upload | Refused | Pass |
| Path traversal in a source key | Refused | Pass |
| Colour field carrying an FFmpeg argument | Refused | Pass |
| Caption with quotes, colons, brackets, percent signs | Escaped, graph intact | Pass |
| Zero or negative clip speed | Refused | Pass |
| Out-of-range grade values | Refused, not clamped | Pass |
| Unknown keys | Stripped | Pass |

### Render translation

| Property | Result |
|---|---|
| Neutral grade produces no filters | Pass |
| Intensity 0 is the untouched frame, for all 20 presets | Pass |
| Every preset except Original changes the frame | Pass |
| All generated values inside FFmpeg's legal ranges | Pass |
| Speed changes applied to video and audio together | Pass |
| Speeds beyond atempo's 0.5–2.0 range chained correctly | Pass |
| Clips padded to a common size so concat cannot fail | Pass |
| Output is browser-playable (yuv420p, faststart) | Pass |
| Music mixes over clip audio rather than replacing it | Pass |

### Render worker with FFmpeg absent

Exercised deliberately, since FFmpeg is not installed here: the job is retried three times and then
failed with "FFmpeg is not installed on the render host… Install FFmpeg and retry the job." The
video is marked failed rather than left in `processing` indefinitely.

### Bugs found and fixed

| ID | Date | Severity | Area | Description | Status |
|---|---|---|---|---|---|
| BUG-010 | 2026-08-29 | **High** | Database | MariaDB's permissive default `sql_mode` silently coerced an invalid ENUM to `''`, writing six catalogue rows that no kind-filtered query could see. Strings would truncate and numbers clamp the same way | Fixed — `STRICT_TRANS_TABLES` set per connection |
| BUG-011 | 2026-08-29 | Medium | Infrastructure | Every cache write against an unreachable Redis blocked ~12s. The error was caught, but the retry backoff was already spent, so seeding took eight minutes instead of three seconds | Fixed — bounded cache with a circuit breaker |
| BUG-012 | 2026-08-29 | Medium | Storage | No chunk could be stored: chunk keys embed an uppercase ULID, and the key validator allowed lowercase only | Fixed |
| BUG-013 | 2026-08-29 | Low | Database | The strict-mode hook awaited a callback-style connection, throwing and breaking every pooled connection. Introduced and caught while fixing BUG-010 | Fixed — callback form |

### Not verified

- **No video has actually been transcoded.** FFmpeg is not installed on this machine. The filter
  graph is generated and tested as a pure function, but the first real render still has to happen
  on a host that has FFmpeg.
- **The GPU shader half of "preview matches render".** Requires a device.
- **Rate limiting at runtime**, still — Redis is not installed.


---

## PHASE 5 — PROCESSING AND STREAMING (2026-08-29)

### Full regression across all phases

`npm test` — **189 passed, 0 failed**, stable across three consecutive runs.

| Suite | Tests | Covers |
|---|---|---|
| `validate-migration.test.ts` | 16 | Migration data-safety rules |
| `ledger.test.ts` | 11 | Money invariants |
| `auth.e2e.test.ts` | 23 | Authentication, profiles, graph |
| `creative.test.ts` | 41 | Grade → FFmpeg, edit-list validation |
| `creative.e2e.test.ts` | 26 | Upload, drafts, publish, catalogue |
| `media.test.ts` | 43 | Ladder, HLS, magic bytes, quality scoring |
| `media.e2e.test.ts` | 29 | Pipeline, resumption, playback privacy |

Plus a **live smoke test**: 43 checks against a booted server, walking two users through
registration, profile, follow, OTP, catalogue, chunked upload, drafts, publish, processing and
privacy-gated playback.

### Verification battery

| Check | Result |
|---|---|
| Typecheck (mobile + admin + backend) | Clean |
| Admin panel build | Compiled successfully |
| Migrations | 13 applied, 0 pending, all validate |
| Destructive SQL guard | 9 of 9 dangerous statements refused |
| Database residue after a full run | Zero users, videos, stages, jobs, uploads, drafts |
| Suite stability | 3 consecutive clean runs |

### Exit criteria

| # | Criterion | Result |
|---|---|---|
| 1 | Every rendition and thumbnail produced | 🟡 Translation verified; no real transcode (no FFmpeg here) |
| 2 | Playback starts under 1s on mid-tier | ⛔ Needs a device |
| 3 | 60fps feed scroll on low-end | ⛔ Needs a device |
| 4 | Quality scores stored decomposed | ✅ |
| 5 | Killed worker resumes without duplicating or losing | ✅ |
| 6 | Admin reprocess and recalculation | ✅ |

### Pipeline resumption (exit criterion 5)

Simulated by claiming a stage and abandoning it, exactly as a `kill -9` would leave it.

| Scenario | Expected | Result |
|---|---|---|
| Two workers claim the same stage | Exactly one wins | Pass |
| A completed stage is re-offered | Never re-run; output preserved | Pass |
| Worker killed mid-stage | Stall sweeper releases it; next worker resumes there | Pass |
| Earlier completed stages | Preserved, not repeated | Pass |
| Attempts after resumption | Not reset, so a stage that keeps failing still stops | Pass |
| A genuinely running stage | Left alone by the sweeper | Pass |
| A stage exceeding its attempts | Pipeline stops rather than looping | Pass |
| Waiting on a slow render | Does **not** consume an attempt | Pass (regression for BUG-014) |

### ADR-011 — technical quality never suppresses

| Scenario | Expected | Result |
|---|---|---|
| Technical score 0 | Not suppressed | Pass |
| Every non-suppressing component at worst | Not suppressed | Pass |
| Spam ≥ 70 | Suppressed | Pass |
| Duplicate ≥ 85 | Suppressed | Pass |
| Safety restricted | Suppressed | Pass |
| Safety under review | Not suppressed | Pass |
| Technical ranking influence | Capped at ±5% | Pass |
| Unprobed video | Neutral score, not penalised | Pass |

### Playback privacy

| Scenario | Expected | Result |
|---|---|---|
| Public, signed out | Plays, unsigned URL | Pass |
| Private, another user | 404 | Pass |
| Private, owner | Plays, signed URL | Pass |
| Followers-only, non-follower | 404 | Pass |
| Followers-only, follower | Plays | Pass |
| Friends-only, one-way follow | 404 | Pass |
| Friends-only, mutual follow | Plays | Pass |
| Public video, viewer blocked | 404 | Pass |
| Still processing | Reports progress, not a broken URL | Pass |
| Failed video | Never reported playable | Pass (regression for BUG-016) |
| Signed URL tampering (viewer, expiry, key) | All rejected | Pass |

### Bugs found and fixed

| ID | Date | Severity | Area | Description | Status |
|---|---|---|---|---|---|
| BUG-014 | 2026-08-29 | **High** | Pipeline | Polling a render stage consumed a retry attempt, so a merely-slow render exhausted its budget in ~15s and stranded the video forever | Fixed — `deferStage` rolls the attempt back; regression test added |
| BUG-015 | 2026-08-29 | **High** | Pipeline | `status` and `processing_status` could disagree, because a stage failing without throwing skipped reconciliation | Fixed — reconciled after every stage |
| BUG-016 | 2026-08-29 | **High** | Playback | A failed video was served with `ready: true` and a null URL | Fixed — gated on `processing_status` |
| BUG-017 | 2026-08-29 | Medium | Render | Videos were published before transcoding or packaging, exposing a video with no renditions | Fixed — only the pipeline's publish stage publishes |
| BUG-018 | 2026-08-29 | Medium | Render | `video_assets.kind = 'video'` is not in the enum; pre-strict-mode it stored `''`, hiding the asset and stalling the pipeline silently | Fixed |
| BUG-019 | 2026-08-29 | Medium | Quality | `technicalRankingAdjustment(NaN)` returned NaN, poisoning ranking comparisons without throwing | Fixed — non-finite input clamps to neutral |
| BUG-020 | 2026-08-29 | Medium | Infrastructure | `closeRedis()` hung when Redis was unreachable; the same hang would block the API's graceful shutdown | Fixed — retries stopped, then forced disconnect |
| BUG-021 | 2026-08-29 | Medium | Publish | Privacy "followers" was silently stored as "friends", giving a different audience than chosen | Fixed |

### What the smoke test caught that the suites did not

Four of these — BUG-014, 015, 016, 017 — were invisible to the unit and integration suites, because
those suites create videos with no render job and therefore never exercise the waiting path. They
only appeared once a real publish put a real job in the queue. The suites were not wrong; they were
testing units in isolation, which is what they are for. The lesson kept: an end-to-end pass over a
booted server earns its place.

### Test infrastructure fixed

- Teardown is wrapped in `try/finally` in all three E2E suites. A failing cleanup statement
  previously left the pool and Redis open, so the process hung and the real error was never
  reported — the failure looked like a timeout.
- `server.closeAllConnections()` before `close()`: `fetch` keeps sockets alive, and `close()` waits
  for every one of them.
- The media suite's teardown was missing `notifications`, which hold a foreign key to users.

### Not verified

- **No real transcode.** FFmpeg is absent here; the ladder, HLS and filter graphs are verified as
  pure functions only.
- **Device playback targets** (start time, 60fps scroll) need real hardware.
- **Rate limiting at runtime**, still — Redis is not installed.


---

## PHASE 6 — BEHAVIOUR INTELLIGENCE (2026-08-29)

### Full regression

`npm test` — **255 passed, 0 failed**, stable across repeated runs.
`npm run smoke` — **51 live checks** across all six phases.

| Suite | Tests |
|---|---|
| `validate-migration.test.ts` | 16 |
| `ledger.test.ts` | 11 |
| `auth.e2e.test.ts` | 23 |
| `creative.test.ts` | 41 |
| `creative.e2e.test.ts` | 26 |
| `media.test.ts` | 43 |
| `media.e2e.test.ts` | 29 |
| `behaviour.test.ts` | 40 |
| `behaviour.e2e.test.ts` | 26 |

### Exit criteria

| # | Criterion | Result |
|---|---|---|
| 1 | Events persisted exactly once under retry | ✅ Server half verified; device emission is outstanding mobile work |
| 2 | Profiles shift within a session, stabilise over time | ✅ |
| 3 | Negative signals reduce exposure | ✅ |
| 4 | Creator affinity computed and queryable | ✅ |
| 5 | No sensitive fields in payloads | ✅ Enforced structurally and audited |

### Exactly-once delivery

| Scenario | Expected | Result |
|---|---|---|
| Single event | Stored once | Pass |
| Whole batch replayed | Nothing new; duplicates reported | Pass |
| Same event sent five times | One row | Pass |
| Five concurrent sends of one event | One row | Pass |
| Watch event replayed | One row | Pass |
| Event dated 90 days in the future | Rejected | Pass |
| One malformed event in a batch | The rest still land | Pass |

### Watch rules (ADR-009)

| Scenario | Expected | Result |
|---|---|---|
| 10s of a 12s video vs 10s of a 3m video | The short one scores higher | Pass |
| 20s watch on a 25s video | Strong positive | Pass |
| 30s watch on a 5m video | Strong positive | Pass |
| Rule boundaries at 20s and 30s | Exactly as specified | Pass |
| Sub-2s skip on a 30s video | Negative, not weak positive | Pass |
| Sub-2s watch on a 1.5s video | Not a skip | Pass |
| Looping | Completion capped at 1, rewatch flagged | Pass |
| Negative, NaN, Infinity durations | Finite bounded signal | Pass |
| Server-side interpretation | Client's claimed event does not decide | Pass |

### Interest and segments

| Scenario | Expected | Result |
|---|---|---|
| A session spent on one topic | That topic leads the profile | Pass |
| Short vs long horizon | Short reacts at least as strongly | Pass |
| Rebuild with no new signals | Byte-identical profile | Pass |
| 50 consecutive rejections | Bounded, not runaway | Pass |
| 200 consecutive positives | Bounded | Pass |
| Multiple interests | Multiple simultaneous segments | Pass |
| Interest stops | Segment membership lapses | Pass |

### Negative signals

| Scenario | Expected | Result |
|---|---|---|
| `not_interested` on a topic | Goes negative, below an untouched topic | Pass |
| Rejection after prior positive watching | Net exposure reduced | Pass |
| `hide_creator` | Recorded and queryable for suppression | Pass |
| Quick skip | Recorded without any user action | Pass |
| Rejection weight vs watch weight | Rejection is larger | Pass |

### Privacy (ADR-025)

| Scenario | Expected | Result |
|---|---|---|
| Every field on the denylist | Batch rejected with 400 | Pass |
| Casing and separator variants | All caught | Pass |
| Unknown but harmless field | Dropped, not rejected | Pass |
| Rejected batch | Nothing stored at all | Pass |
| Email/phone pasted into a search box | Scrubbed before storage | Pass |
| Audit of stored event detail | No sensitive fields present | Pass |
| Allowlist vs denylist overlap | None — asserted by test | Pass |

### Bugs found and fixed

| ID | Date | Severity | Area | Description | Status |
|---|---|---|---|---|---|
| BUG-022 | 2026-08-29 | **High** | Behaviour | Interest profiles were never populated from video events — the category was only read when a client sent one explicitly, but it belongs to the video | Fixed — derived from the video |
| BUG-023 | 2026-08-29 | **High** | Behaviour | Every priority-audience tier silently returned nobody: the query referenced a SELECT alias in its WHERE clause, and the error was caught and logged | Fixed — column names parameterised; the catch now rethrows |
| BUG-024 | 2026-08-29 | Medium | Privacy | Sensitive fields were stripped by schema validation before the privacy check ran, so a client sending them was never noticed | Fixed — raw body screened first |

BUG-023 is worth remembering: the `.catch()` that hid it was added for robustness. A distribution
tier returning nothing is not a condition worth surviving quietly, so it now fails loudly.

### Not verified

- **Event emission from the device.** The API and its guarantees are tested; the app does not send
  events yet.
- **Content-derived interests.** Topics come from a video's category; deriving them from the
  content needs Phase 7.


---

## PHASE 7 — RECOMMENDATION ENGINE (2026-08-29)

### Full regression

`npm test` — **327 passed, 0 failed**, stable across repeated runs.
`npm run smoke` — **59 live checks** across all seven phases.

| Suite | Tests |
|---|---|
| `validate-migration.test.ts` | 16 |
| `ledger.test.ts` | 11 |
| `auth.e2e.test.ts` | 23 |
| `creative.test.ts` | 41 |
| `creative.e2e.test.ts` | 26 |
| `media.test.ts` | 43 |
| `media.e2e.test.ts` | 29 |
| `behaviour.test.ts` | 40 |
| `behaviour.e2e.test.ts` | 26 |
| `feed.test.ts` | 43 |
| `feed.e2e.test.ts` | 29 |

### Exit criteria

| # | Criterion | Result |
|---|---|---|
| 1 | Personalised, diverse results within budget | ✅ |
| 2 | ML failure degrades silently to rules | ✅ Exercised by every test — no ML service exists here |
| 3 | New-creator exploration reaches 10% | ✅ |
| 4 | Distribution promotes and demotes on performance | ✅ Both directions, plus held and suppressed |
| 5 | Weight change alters the feed, and is audited | ✅ |

### Ranking fairness

| Scenario | Expected | Result |
|---|---|---|
| Max quality vs strong relevance | Relevance wins | Pass |
| Quality weight vs any engagement weight | Quality is smaller | Pass |
| Quality weight ceiling | ≤ 1, capped in the schema | Pass |
| New creators scoring below established ones | Still reach ≥ 10% of slots | Pass |
| Everything from new creators | Page still fills | Pass |
| Exploration rate default | 0.10, bounded at 0.5 | Pass |

### Diversity and constraints

| Scenario | Expected | Result |
|---|---|---|
| Blocked creator, top score | Removed | Pass |
| Rejected category | Removed | Pass |
| Video already seen twice | Removed | Pass |
| One creator, alternatives available | Spacing holds | Pass |
| One creator, nothing else available | Page still fills | Pass |
| Two categories, ten slots | Even split, cap yields to availability | Pass |
| Five categories, ten slots | Configured 40% cap binds | Pass |
| Creator at end of previous page | Does not lead the next | Pass |

### Fallback behaviour

| Scenario | Expected | Result |
|---|---|---|
| No ML service | Rules ranker serves, reason recorded | Pass |
| Client-visible effect | None — 200 with a normal envelope | Pass |
| Repeated failures | Breaker opens, stops retrying every request | Pass |
| Feed with breaker open | Still serves | Pass |

### Progressive distribution

| Scenario | Expected | Result |
|---|---|---|
| Strong performance at L1 | Promoted to L2 | Pass |
| Collapse at L3 | Demoted to L2 | Pass |
| Excessive skip rate | Demoted regardless of completion | Pass |
| Awful performance at L1 | Suppressed | Pass |
| Too little data | Held, not guessed | Pass |
| At L5 | Held, not promoted past the top | Pass |
| Identical metrics | Identical verdict — nothing else is an input | Pass |
| Every move | Recorded with its numbers and an explanation | Pass |

### Admin control

| Scenario | Expected | Result |
|---|---|---|
| Ordinary user changes a weight | 403 | Pass |
| Admin changes a weight | Applies immediately, no deploy | Pass |
| Audit record | Written with previous and new value | Pass |
| Change without a reason | Refused | Pass |
| Value outside bounds (100 for a 0–0.5 weight) | Refused | Pass |
| Unknown weight | 404 | Pass |
| Non-admin on an admin route | 403 | Pass |

### Bugs found and fixed

| ID | Date | Severity | Area | Description | Status |
|---|---|---|---|---|---|
| BUG-025 | 2026-08-29 | **High** | Security | `requireAdmin` matched `admin_users.id` against `users.id` — separate auto-increment sequences. A user whose id collided with an admin row's would inherit that admin's permissions | Fixed — explicit `user_id` link |
| BUG-026 | 2026-08-29 | Medium | Feed | The diversity backfill ignored the category cap, letting one category take 60% of a page | Fixed — availability-aware cap, staged relaxation |
| BUG-027 | 2026-08-29 | Medium | Feed | A single-creator pool collapsed to one item rather than filling the page | Fixed |

BUG-025 was found by testing the **negative** case — that a non-admin *cannot* reach an admin route
— rather than only confirming that an admin can. Worth repeating elsewhere.

### Not verified

- **The ML ranker itself.** The client, contract, validation and fallback are tested; no Python
  service exists yet.
- **Real load.** The latency assertion is a regression guard against a per-candidate query, not a
  load test. That is Phase 12.
- **Embeddings.** `similar_videos` approximates with category and watch history.


---

## UI WIRING — BROWSER VERIFICATION (2026-08-29)

The mobile app and admin panel were run in a browser against the live backend.

### Servers

| Service | Port | Status |
|---|---|---|
| Backend API | 4000 | Running |
| Mobile web (Expo) | 8081 | Running |
| Admin (Next.js) | 3000 | Running |
| MySQL | 3306 | Running |
| Redis | 6379 | **Not installed** — the app degrades to no caching |

### Verified in the browser

| Check | Result |
|---|---|
| App loads (onboarding) | Pass |
| Login form starts empty, button disabled until valid | Pass |
| Sign in with a real account | Pass — 200, navigates to the feed |
| Session survives a reload | Pass — restores and opens on the feed, not onboarding |
| Feed shows live recommendations | Pass — real creators, real stats |
| "Live · rules" badge on desktop | Pass — reports the ranker serving the feed |
| "Sample data" badge when the feed is empty | Pass |
| Vertical scroll advances one video per swipe | Pass — the Phase 1 fix still holds |
| Action bar stays positioned while scrolling | Pass — BUG-001 has not regressed |
| New-creator video appears in the feed | Pass — the 12-follower account surfaced |
| Desktop shows a sidebar, mobile a bottom bar | Pass — ADR-016 holds |
| Admin System Health reads the live API | Pass — API up, database up, Redis down |
| Console free of wiring errors | Pass — remaining entries are absent media, which is accurate |

### An instructive detail

On the first browser run the feed returned **zero items** and fell back to sample data. The cause
was not a bug: earlier API calls had recorded impressions, and the "seen twice, never again" rule
then correctly excluded everything. With only 18 demo videos the pool was simply exhausted. The
seed was deepened to 48 videos.

Worth remembering — the exclusion rule is right for a platform with millions of videos and
surprising on a development machine with eighteen.

### Bugs found and fixed

| ID | Date | Severity | Area | Description | Status |
|---|---|---|---|---|---|
| BUG-028 | 2026-08-29 | **High** | Infrastructure | Every rate-limited route took ~12s with Redis down. The limiter caught the error but had already spent the retry backoff. Sign-in took twelve seconds | Fixed — bounded at 150ms with a breaker; login 12s → 0.3s |
| BUG-029 | 2026-08-29 | Medium | Mobile | An unrendered video passed an empty string as a media source, which makes the browser re-download the page | Fixed — null source, poster carries the frame |
| BUG-030 | 2026-08-29 | Medium | Admin | The client treated `/ready`'s 503 as a failure, showing "cannot reach the API" when the API had answered correctly | Fixed — readiness reads the body regardless of status |
| BUG-031 | 2026-08-29 | Low | Seed | Demo rows pointed at storage paths that do not exist, producing broken images and making object storage look wired up | Fixed — no poster key on demo rows |

BUG-028 is the same class as BUG-011 from Phase 4, which was fixed for the cache but never applied
to the rate limiter. Fixing one instance of a pattern is not fixing the pattern.

### Regression after the changes

- `npm run typecheck` — clean across mobile, admin and backend.
- `npm test` — 327 passed, 0 failed.
- `npm run smoke` — 59 passed, 0 failed.
- `npm run admin:build` — compiled successfully.

### Still on sample data

- Every mobile screen except auth and the For You feed.
- Every admin module except System Health.
- Following and Trending feeds — the recommendation engine currently serves For You only.

---

## UI WIRING — DISCOVERY, GRAPH, PRIVACY AND SECURITY (2026-08-29)

Continuation of the wiring above: everything that had a backend but was still drawing sample data.

### Endpoints added and exercised

| Route | Result |
|---|---|
| `GET /discover/categories` | 18 categories, each with icon and colour |
| `GET /discover/categories/:slug/videos` | 6 for `gaming`, 8 for `music?sort=recent` |
| `GET /discover/categories/nope/videos` | 404 `not_found` — a missing category is not an empty list |
| `GET /discover/hashtags` | 6 tags with derived counts |
| `GET /discover/hashtags/:tag/videos` | 3 for `tech` |
| `GET /discover/trending` | ordered by measured views |
| `GET /discover/creators` | 5, ordered by real follower counts |
| `GET /search?q=demo` | 6 accounts |
| `GET /search?q=%25&type=users` | **0** — the wildcard is escaped, not matched |
| `GET /me/reports` | 0, correctly |
| `GET /auth/sessions` | 14 live sessions |
| `GET /me/security-events` | 17 events |
| `GET /music` | 8 tracks, 4 trending |

The `%` case is the one that matters. An unescaped `LIKE` term would have returned every account
on the platform to anyone who typed a percent sign.

### Verified in the browser

Signed in as `demo_maya@vyra.demo` at `http://localhost:8081`.

| Screen | Observed |
|---|---|
| For You feed | `Live · rules`, real videos from the demo creators |
| Profile | 5 following · 5 followers · 6.8K likes — all recomputed from rows |
| Followers | `Live followers`, five real accounts, each showing "Following" |
| Explore | `Live categories`, `Live hashtags`, `Live creators`, `Live videos`; live streaming labelled "not built yet" |
| Categories | 18 categories with the icons and colours from migrations 017/018 |
| Search | `Live results`, "Following" on followed accounts, "You" on the caller's own |
| Settings | The signed-in account, not the sample one |
| Privacy | `Live privacy settings`; three-way audience controls |
| Login activity | `Live sessions`, "This device" on the browser session, End on the others |
| Add sound | `Live library`, the eight seeded tracks, favourite round-trips to the account |
| Stickers | `Live sticker packs`, emoji rendering correctly |

The privacy change was checked in the database rather than on screen: setting "who can comment" to
Followers stored `followers`, which is the value a boolean toggle could not have represented.

### Bugs found and fixed

| ID | Date | Severity | Area | Description | Status |
|---|---|---|---|---|---|
| BUG-032 | 2026-08-29 | **High** | Tooling | The migration validator stripped `#` comments before blanking string literals, so a `#` inside a string ate the rest of the line — semicolon included. A destructive statement placed after one on the same line was never seen by any rule | Fixed — single scanner tracking string/identifier/comment state; 9 regression tests |
| BUG-033 | 2026-08-29 | **High** | Feed | A viewer who had seen every available video got an empty feed. The "seen twice" rule filtered the whole pool and nothing put a floor under it | Fixed — the rule is relaxed only when it alone empties the pool, least-seen first; safety rules never relax. 4 regression tests |
| BUG-034 | 2026-08-29 | **High** | Social graph | `listGraph` took the viewer's id and used it only to filter blocks, so follower and following lists rendered "Follow" on every row including accounts already followed | Fixed — relationship resolved in the same query; verified absent for anonymous callers |
| BUG-035 | 2026-08-29 | Medium | Mobile | The music library was fetched and then discarded: its `useMemo` omitted the request state from its dependencies, so the list was computed once against empty data | Fixed — deps corrected; the other three catalogue screens were checked and were already right |
| BUG-036 | 2026-08-29 | Medium | Mobile | The favourite button on a music track rendered its state and did nothing on press | Fixed — writes to the account and refreshes |
| BUG-037 | 2026-08-29 | Medium | Search | Search results offered to let you follow your own account, and showed "Follow" for accounts already followed | Fixed — `isFollowing` and `isSelf` returned and honoured |
| BUG-038 | 2026-08-29 | Low | Seed | Follower counts were headline numbers with no rows behind them: a profile claiming 12.4K followers opened onto an empty list. `video_count` and `like_count` were zero because the seed bypasses the publish service that maintains them | Fixed — a real follow graph, counters recomputed from rows |
| BUG-039 | 2026-08-29 | Low | Seed | Hashtag counters left by earlier smoke runs claimed 23 videos each with no links behind them | Fixed — demo videos carry hashtags; counters derived from the link table |
| BUG-040 | 2026-08-29 | Low | Mobile | Settings showed the sample account while the profile tab showed the signed-in one | Fixed — `useCurrentUser` is the single answer |
| BUG-041 | 2026-08-29 | Low | Mobile | Horizontal chip rows stretched to fill the remaining height on web, leaving a large gap under the tabs | Fixed — `flexGrow: 0` on the row |

BUG-032 deserves the most attention. It is a safety tool that could be made to approve exactly the
thing it exists to catch, and it had been passing every migration in the project — including
migration 017, which passed only because the swallowed text happened to reassemble into statements
that each still carried a `WHERE`. Migration 018, written the same way, failed loudly and exposed
it. A validator that is wrong in a way that sometimes produces the right answer is the worst case,
because nothing draws attention to it.

BUG-033 is a reminder that a correct rule still needs a floor. Nothing about "do not show the same
video three times" is wrong; it just has to lose to "show something".

### Regression after the changes

- `npm run typecheck` — clean across mobile, admin and backend.
- `npm test` — **340 passed**, 0 failed (327 + 13 new).
- `npm run smoke` — 59 passed, 0 failed.
- `npm run admin:build` — compiled successfully.

### Still on sample data

Each of these is labelled on screen rather than left to look finished.

| Area | Waiting on |
|---|---|
| Inbox, chat, communities, calls | Phase 8 |
| Live streaming and gifting | Phase 9 |
| Wallet, coins, withdrawals, tasks, referrals | Phase 10 |
| Promotion, ads, campaigns, creator earnings | Phase 11 |
| Verification, support tickets, moderation queue | Phase 12 |
| Notification preferences, OTP email delivery | Phase 13 |
| Explore banners, "Nearby" | No backend planned yet |
| Every admin module except System Health | Their own phases |

---

## PHASE 8 — CHAT, COMMUNITIES AND CALLS (2026-08-29)

### Gate

| # | Criterion | Result |
|---|---|---|
| 1 | A chat id is not a key — a non-member can neither read nor write | Pass — `not_found`, not `forbidden` |
| 2 | Blocks stop messaging in both directions | Pass |
| 3 | `whoCanMessage` is enforced where messages are sent, not only where displayed | Pass — including on a conversation that already exists |
| 4 | A retried send produces one message, not two | Pass — **with Redis down**, which is when it matters |
| 5 | Read receipts move the sender's tick, and only the sender sees it | Pass |
| 6 | Joining a group is not a licence to read its past | Pass |
| 7 | "Delete for everyone" is the sender's right alone | Pass |
| 8 | ADR-014 — an ordinary member cannot enumerate the roster | Pass — owner sees 5, member sees 1 with `restricted: true` |
| 9 | A call is offered before any device opens a microphone | Pass — `ringing` until explicitly answered |
| 10 | The messaging rules cannot be bypassed by calling instead of typing | Pass |

### Tests

- `chat.e2e.test.ts` — 23 tests
- `communities.e2e.test.ts` — 23 tests
- Full suite: **386 passed**, 0 failed (340 before this phase)
- `npm run smoke` — 59 passed, 0 failed
- `npm run typecheck` — clean across mobile, admin and backend
- `npm run admin:build` — compiled successfully

### Verified in the browser

Signed in as `demo_maya@vyra.demo` at `http://localhost:8081`.

| Screen | Observed |
|---|---|
| Inbox | `Live conversations`, four real chats, a real unread badge, relative times |
| Private chat | `Live conversation`, seeded thread with read ticks; a message typed in the browser reached the database with its client id |
| Community | `Live community`, "Editor Beta Testers · 5 members", real messages |
| Community info | Real name, description, seeded rules, "You are the owner", real permissions and counts |
| Call history | `Sample call history` — correct, no calls have been made |

### Bugs found and fixed

| ID | Date | Severity | Area | Description | Status |
|---|---|---|---|---|---|
| BUG-042 | 2026-08-29 | **High** | Infrastructure | Every timestamp the API returned was shifted by the host's UTC offset — five hours into the future. The pool read MySQL DATETIMEs as UTC while MySQL wrote them in local time. Affected every timestamp in the product | Fixed — driver reads them as written; regression test asserts a new message is within seconds of now |
| BUG-043 | 2026-08-29 | **High** | Chat | Send idempotency lived only in Redis, so a retry after a dropped connection double-posted whenever the cache was down — exactly when connections drop | Fixed — unique `(sender_id, client_id)` on `messages`; Redis demoted to a fast path (ADR-032) |
| BUG-044 | 2026-08-29 | **High** | Routing | `router.use(requireAuth)` runs for every request reaching a router, not only the paths it handles, so every unknown path under the API prefix answered 401 instead of 404 | Fixed — auth attached per route; tests cover both directions |
| BUG-045 | 2026-08-29 | Medium | Infrastructure | Presence and send-idempotency called Redis directly, so a dead cache added its full retry backoff: 36s per chat operation, 0.15s after | Fixed — set operations added to the guarded cache |
| BUG-046 | 2026-08-29 | Medium | Mobile | The app could not build: `SOCKET_EVENTS` is the first *value* import from `shared/contracts`, and Metro will not resolve outside its project root | Fixed — `metro.config.js` with the shared folder watched |
| BUG-047 | 2026-08-29 | Low | Mobile | Community info showed a hard-coded "2 reports" and "4 blocked users", and "Leave community" only navigated back | Fixed — invented counts removed, leaving writes to the server |
| BUG-048 | 2026-08-29 | Low | Seed | Seeded conversations were invisible: participants joined "now" while the messages were backdated, so the hide-history-before-you-joined rule correctly hid all of them | Fixed — join times backdated. The rule was working |

BUG-042 is the one worth dwelling on. It had been wrong since the connection pool was written, was
present in every timestamp the product has ever served, and nothing looked broken — "just now" is
an ordinary thing for a timestamp to say. It surfaced only because a seeded conversation refused to
admit its age. A plausible wrong answer is much harder to notice than an implausible one.

BUG-045 is the third appearance of the same pattern (BUG-011 cache, BUG-028 rate limiter). Each
time it was fixed for one caller rather than for the class. The guarded cache now covers the set
operations too, which is the last direct Redis use on a request path.

### Not done in this phase

- **Media messages.** Images, video and voice notes are modelled, validated and stored, but the
  client cannot yet attach one — that needs the upload flow from Phase 4 wired into the composer.
- **WebRTC on device.** Signalling is complete and tested; no peer connection is opened yet, so a
  call rings, connects in the database and ends without carrying audio. Native capture is part of
  the device work carried since Phase 4.
- **Notifications.** The activity tab is still sample data; there is no notification service yet.

---

## PHASE 9 — LIVE STREAMING AND GIFTING (2026-08-29)

### Gate

| # | Criterion | Result |
|---|---|---|
| 1 | A stream key is issued once and never readable again | Pass — stored as a SHA-256 hash, absent from every later response, destroyed on end |
| 2 | Viewer counts are derived, not reported | Pass — recomputed from `live_viewers`; a rejoin does not inflate it |
| 3 | A gift moves value or moves nothing | Pass — an unaffordable gift leaves both wallets untouched and writes no transaction |
| 4 | A retried gift charges once | Pass — with Redis unavailable, which is the case that matters |
| 5 | The platform share is configuration, and what applied is recorded | Pass — 30% and 90% both honoured; the transaction carries its own split |
| 6 | Earnings are held before they can be taken | Pass — credited to the held balance, released only after `clears_at` |
| 7 | Gifting is not a route around the payout rules | Pass — self-gifting refused |
| 8 | An admin can stop a stream and the host cannot undo it | Pass — distinct state, reason recorded |

### Live route check (against the running backend)

```
login                  OK   two demo accounts
start stream           OK   Thrifting the whole outfit - key 59 chars
list live              OK   [('Thrifting the whole outfit', 0)]
maya joins             OK   1 watching
comment                OK   love this jacket
likes                  OK   {'likeCount': 12, 'yours': 12}
likes capped           ERROR validation_failed          ← 1,000,000 likes refused
gift catalogue         OK   12 gifts
send gift              OK   spent 50, creator 25 (50% platform)
gift retry             OK   duplicate=True, balance still 4900
gift, no key           ERROR bad_request                ← the header is mandatory
maya wallet            OK   4900 coins
zara wallet            OK   75 held, 0 withdrawable
ledger                 OK   ['gift_sent', 'gift_sent', 'gift_sent']
viewers (host)         OK   1 listed
viewers (viewer)       ERROR forbidden                  ← only the host sees the audience
stream totals          OK   1 watching, 12 likes, 50 gift coins
end stream             OK   ended
```

The three `ERROR` lines are the assertions, not failures: a capped like count, a mandatory
idempotency header, and an audience only its host can enumerate.

### Verified in the browser

Signed in as `demo_maya@vyra.demo` with `demo_zara` broadcasting.

| Screen | Observed |
|---|---|
| Live list | `Live streams`, the real broadcast, "started 1m ago" |
| Live viewer | `Live stream` badge, 1 watching, 0 likes — the true figures |
| Comment | "this jacket is unreal" appeared in the stream, attributed to Maya Chen |
| Like | Count moved 0 → 1 |
| Gift sheet | 4,900 coins — the real balance; all 12 seeded gifts at real prices, "Hot" on the featured ones |
| Send Cake | Maya 4900 → 4800, Zara's held balance 75 → 125, recorded at the 50% share |

### Bugs found and fixed

| ID | Date | Severity | Area | Description | Status |
|---|---|---|---|---|---|
| BUG-042 | 2026-08-29 | **High** | Chat | Idempotency and presence called Redis directly, so a dead cache added its full connect-retry backoff to every message send | Fixed — routed through the guarded cache; 36s per operation → 0.15s |
| BUG-043 | 2026-08-29 | **High** | Chat | Message send idempotency lived only in Redis, so a retry after a dropped connection double-posted whenever the cache was down — exactly when clients retry | Fixed — unique index on `(sender_id, client_id)`; ADR-032 |
| BUG-044 | 2026-08-29 | **High** | Money | The idempotency middleware hung ~12s on a dead cache before failing, and refused requests whose handler was already protected | Fixed — bounded to 250ms; per-route `durable` flag |
| BUG-045 | 2026-08-29 | **High** | Money | A cheap gift under a high platform share credited the creator zero and failed the whole gift. `10 × (1 − 0.9)` is `0.9999999999999998`, which floors to 0 | Fixed — the split is computed from the platform's cut; a zero share records the gift rather than rejecting it |
| BUG-046 | 2026-08-29 | Medium | Mobile | Live screens fabricated engagement: a timer nudged the viewer count every two seconds, the broadcast screen invented gift income, and the comment stream replayed scripted chatter over real conversations | Fixed — all three read the server; the sample replay stops when real data arrives. ADR-031 |
| BUG-047 | 2026-08-29 | Low | Backend | Settings were typed as their literal defaults, so `getSetting('monetization.enabled') === false` failed to compile — a correct comparison against a value an admin can change | Fixed — literal types widened to what the setting can hold |

BUG-042 is the fourth appearance of one pattern: an unbounded Redis call in a hot path, after the
cache (BUG-011), the rate limiter (BUG-028) and now chat. The fix this time was to give the guarded
cache the operations the callers actually needed, so there is no longer a reason to reach past it.

BUG-045 is the one that would have cost money quietly. A 90% platform share is a legitimate
configuration, and under it every gift below a certain price would have failed with an error about
a positive number — a message that tells the sender nothing and the operator less.

### Regression

- `npm run typecheck` — clean across mobile, admin and backend.
- `npm test` — **412 passed**, 0 failed.
- `npm run smoke` — 59 passed, 0 failed.
- `npm run migrate:validate` — all migrations pass.
- `npm run admin:build` — compiled successfully.

### Carried forward

- **No media server.** The application issues ingest credentials and records the broadcast; RTMP
  ingest and HLS packaging are deployment, not application code. Nothing has yet pushed video.
- **Co-hosting and guests** are modelled in the schema but not built.
- **Chargeback reversal** — `gift_clearing.reversed_at` exists and clearing respects it, but no
  process writes it yet. That belongs with payments in Phase 10.


---

## PHASE 10 — WALLET, COINS AND MONETIZATION (2026-08-29)

### Gate

| # | Criterion | Result |
|---|---|---|
| 1 | Coins credited on approval, never on submission | Pass — a pending request leaves the balance untouched |
| 2 | A withdrawal debits on request, so the same money cannot be claimed twice | Pass — the second request fails on an empty balance |
| 3 | Rejection and cancellation refund | Pass — both return the full amount, once |
| 4 | Only cleared gift earnings are payable | Pass — reward balance cannot be withdrawn |
| 5 | A task reward is claimed once | Pass — a second claim returns `alreadyClaimed` and credits nothing |
| 6 | Task progress is measured, never submitted | Pass — a new account reads 0 with no field the client could set |
| 7 | Reward converts to coins but never to cash | Pass — conversion is one-way and `withdrawable` stays 0 |
| 8 | Amounts are configuration, and the configured value applies | Pass — rate, minimum and fee all honoured from settings |

### Live route check

```
coin packages              OK   [(100, '$1'), (525, '$5'), (1100, '$10')]
payment methods            OK   ['Bank transfer', 'Easypaisa', 'JazzCash', 'USDT (TRC20)']
payout methods             OK   [('Bank transfer', '1% fee', 'min 100'), ('Easypaisa', '2% fee', 'min 50')]
purchase request           OK   1000 coins for 10 USD, status pending
credited on submit?        NO  (correct)
purchase retry             OK   same request: True
zara withdrawable          OK   200
withdrawal request         OK   50 less 0.5 fee = 49.5, to ****7788
balance held on request    OK   200 -> 150, pending 50
cancel withdrawal          OK   rejected
refunded on cancel         OK   back to 200
daily tasks                OK   [('Watch 10 minutes', '0/10', 'active'), ...]
claim unfinished           ERROR bad_request That task is not finished yet.
referrals                  OK   code C9YRPC04, 100 coins per qualified referral, 0 invited
```

The clearing job was exercised separately: `npm run clearing:release` moved five held rows into the
withdrawable balance (150 coins at the configured 0.01 payout rate = $1.50), correctly below the
$50 minimum and therefore not withdrawable yet.

### Verified in the browser

| Screen | Observed |
|---|---|
| Wallet | `Live balances`, 4.8K coins — Maya's real balance after the Phase 9 gift |
| Wallet tiles | Reward 0, live gift 0 = $0.00, withdrawable $0.00, pending 0 |
| Daily tasks | `Live tasks`, the five seeded tasks at real progress and real rewards |
| Task header | Reward balance 0, earned today 0 |
| Refer and earn | 0/5, 0 qualified all time |

### Bugs found and fixed

| ID | Date | Severity | Area | Description | Status |
|---|---|---|---|---|---|
| BUG-048 | 2026-08-29 | **High** | Money | Coin purchases failed entirely while the cache was down: the route fell back to ADR-020's fail-closed path because a purchase request carried no database key | Fixed — `coin_purchase_requests` carries the key under a unique index; the route is durable (ADR-032) |
| BUG-049 | 2026-08-29 | Medium | Mobile | The wallet showed a live balance of 0 live-gift coins as "= $684.00" — the figure from the server, the estimate beside it from the sample data | Fixed — the payout rate travels with the balances, so the two cannot disagree |
| BUG-050 | 2026-08-29 | Medium | Mobile | A fallback of the form `earnedToday OR sampleTodayEarned` turned a genuine zero into the sample's 310 | Fixed — a zero is a zero |
| BUG-051 | 2026-08-29 | Low | Mobile | The daily tasks screen showed a live task list beside a sample reward balance and a sample referral count | Fixed — all three read the server |

BUG-049 and BUG-050 are the same mistake in two shapes: a real number placed next to an invented
one. Neither would fail a test that only checked the live value, which is why the browser pass
matters — the inconsistency is only visible when you look at the screen as a whole.

BUG-048 is worth noting as a consequence of getting ADR-020 right and then not revisiting it.
Failing closed was correct when the cache was the only protection; it stopped being correct the
moment there was a database key available, and the reasoning in the route comment ("no ledger row
to fall back on") described a gap rather than a constraint.

### Regression

- `npm run typecheck` — clean across mobile, admin and backend.
- `npm test` — **437 passed**, 0 failed (412 + 25 new).
- `npm run smoke` — 59 passed, 0 failed.
- `npm run migrate:validate` — all migrations pass.
- `npm run admin:build` — compiled successfully.

### Carried forward

- **No payment gateway.** Every method is a manual transfer confirmed by an administrator. That is
  deliberate for this market, but it means nothing settles automatically and the approval queue is
  a real operational load.
- **No daily spend or withdrawal caps.** A per-account limit is a safety feature as much as a
  financial one; it needs the admin surface in Phase 11 to configure it.
- **Chargeback reversal** still has its column and its clearing check but nothing writes it, because
  there is no provider to report one.
- **Milestone rewards** are in the ledger's vocabulary but have no rules engine behind them yet.


---

## PHASE 11 — PROMOTION, ADS AND CAMPAIGNS (2026-08-29)

### Gate

| # | Criterion | Result |
|---|---|---|
| 1 | Promotion buys distribution and never engagement | Pass — no field accepts it, and nothing is created on anyone's behalf |
| 2 | The budget is held on creation | Pass — two campaigns cannot be funded from the same coins |
| 3 | Unspent budget is returned | Pass — on stop, on rejection and on expiry, once each |
| 4 | A campaign cannot outspend its budget or daily cap | Pass — four 40-coin impressions against a 100-coin budget stayed within it |
| 5 | A replayed impression is not charged twice | Pass — one delivery, one row, one charge |
| 6 | Targeting filters, and cannot go below the minimum age | Pass — advertiser, blocked viewer and under-13 targeting all refused |
| 7 | Promoted items are labelled and never first | Pass — SPONSORED renders; first slot is always organic |
| 8 | Every reported number is a count of something real | Pass — all zeros before delivery; cost-per-view absent rather than 0 |

### Live delivery check

```
campaign                   01M184ZDCD0SZ3MTKX16WXNSZZ - pending_review
approved                   active
feed items                 20            <- the page honours limit=20
promoted in feed           1
first promoted position    9  (OK)       <- never the first slot
labelled                   YES
reason shown               Promoted
charged for delivery       0.0500 coins
impressions recorded       1
```

Campaign lifecycle, separately:

```
zara coins before          5000
estimate                   reach 9800-18200, 142/day
create campaign            pending_review, budget 500
budget held                5000 -> 4500
delivered before review?   NO  (correct)
pause                      ERROR invalid_state_transition   <- pending cannot be paused
stop and refund            completed
refunded on stop           back to 5000
metrics                    0 impressions, 0 views, 0 spent
```

### Verified in the browser

The SPONSORED badge renders on the promoted item and on nothing else — confirmed by counting the
rendered badges in the live DOM (exactly one across the whole feed) and by screenshot. The first
item on opening the app was organic.

### Bugs found and fixed

| ID | Date | Severity | Area | Description | Status |
|---|---|---|---|---|---|
| BUG-052 | 2026-08-29 | **High** | Ads | Campaigns delivered indefinitely for free. `campaigns.spent_coins` was a BIGINT while an impression costs 0.05 coins, so every charge rounded to zero — and because spend never moved, the budget-exhaustion check never fired either | Fixed — widened to `DECIMAL(16,4)` in migration 024 |
| BUG-053 | 2026-08-29 | Medium | Feed | A request for 20 items returned 21 once promotion was blended in, which would quietly break anything paging by count | Fixed — promotion takes a slot rather than lengthening the page |

BUG-052 is the one that mattered. It was found by a test asserting `spent_coins > 0` after a
charge — an assertion that looks redundant next to "the charge returned success", and was the only
thing standing between this and an advertising system that never billed anyone. The two failing
tests both failed on that same assertion, from different directions.

### Regression

- `npm run typecheck` — clean across mobile, admin and backend.
- `npm test` — **460 passed**, 0 failed (437 + 23 new).
- `npm run smoke` — 59 passed, 0 failed.
- `npm run migrate:validate` — all migrations pass.

### Carried forward

- **No automated policy check on creatives.** Every campaign goes to a human review queue. That is
  the right default, and it does not scale.
- **No auction.** Eligible campaigns are ordered by remaining budget, which is a placeholder for
  real bidding. It is fair enough at this volume and will not be at any other.
- **Reach is approximated by impressions.** Distinct-viewer reach needs the impression table
  aggregated per campaign, which is a report rather than a counter.
- **No spend caps per advertiser per day**, only per campaign — the same gap noted in Phase 10.


---

## PHASE 12 — VERIFICATION, SUPPORT AND MODERATION (2026-08-29)

### Gate

| # | Criterion | Result |
|---|---|---|
| 1 | An identity document is never returned through the API | Pass — the key is absent from the submission response, the applicant's list and the review queue |
| 2 | Documents are destroyed once the decision is final | Pass — zero live documents after a decision; `more_info` keeps them |
| 3 | An internal staff note never reaches the user | Pass — the user sees 2 messages, staff see 3 |
| 4 | A decision enforces what it says | Pass — the suspended account's next request returns `account_suspended` |
| 5 | Every action is attributed, reasoned and reversible | Pass — an empty reason is refused; reverting restores; a second revert is refused |
| 6 | A reporter learns the outcome and nothing else | Pass — no action, no reasoning, no username in the response |
| 7 | An ordinary account cannot reach any staff surface | Pass — all four routes return 403 |
| 8 | A temporary restriction lifts by itself | Pass — the sweep returns the account to active |

### Live route check

```
open ticket                  OK   Coins have not arrived - open, 1 message(s)
reply to own ticket          OK   2 messages, status open
another account reads it     ERROR not_found Ticket not found.
my verification              OK   0 request(s)
verification with no docs    ERROR validation_failed
verification with a bad key  ERROR forbidden This edit references media you did not upload.
ordinary account -> verification  forbidden
ordinary account -> reports       forbidden
ordinary account -> tickets       forbidden
ordinary account -> ban           forbidden
file a report                OK   01M187NNE3SSSZ37E3GVCHY96R
report outcome               OK   pending - This report is still being reviewed.
someone else reads it        ERROR not_found Report not found.
```

The `ERROR` lines are the assertions: a ticket that is not yours is not found, a document key that
is not yours is refused, and every staff surface is closed to an ordinary account.

### Verified in the browser

| Screen | Observed |
|---|---|
| Verification (before fix) | `Sample applications` and a **Creator verification — Approved** card, for an account that had never applied |
| Verification (after fix) | `Live applications` and **Not applied** |

### Bugs found and fixed

| ID | Date | Severity | Area | Description | Status |
|---|---|---|---|---|---|
| BUG-054 | 2026-08-29 | **High** | Mobile | A signed-in account with no verification applications was shown a sample **Approved** application as though it were theirs. `useApiData` fell back to sample content whenever a live result was empty — correct for discovery, actively false for anything belonging to the caller | Fixed — `fallbackOnEmpty` is now opt-in per call, and every personal list (verification, tickets, reports, campaigns) reports empty as empty |

BUG-054 is the third of this kind across the last two phases, after the wallet's "0 coins ≈ $684"
and the tasks screen's zero-becomes-310. All three came from the same instinct — a blank screen
looks broken, so fill it — and all three produced a statement about the user that was untrue. The
fix this time is at the hook rather than at the screen, so the next personal list inherits the
correct behaviour instead of repeating the mistake.

It is also the clearest case yet for the browser pass. Every backend test for verification passed
while the screen was telling people they were verified.

### Regression

- `npm run typecheck` — clean across mobile, admin and backend.
- `npm test` — **485 passed**, 0 failed (460 + 25 new).
- `npm run smoke` — 59 passed, 0 failed.
- `npm run migrate:validate` — all migrations pass.
- `npm run admin:build` — compiled successfully.

### Carried forward

- **No document upload on the verification screen.** The backend takes document keys and refuses an
  application without them; the mobile screen has no picker yet, so the live path explains that
  rather than submitting an empty application.
- **No appeals flow.** Actions are reversible by an administrator, but there is no route for a user
  to ask for that. Reversal exists; the request for it does not.
- **No automated content scanning.** Everything reaches the queue through a human report.
- **Moderation is not surfaced in the admin panel yet** — the routes exist and are tested, the UI
  does not.

---

## PHASE 13 — NOTIFICATIONS, EMAIL AND LAUNCH READINESS (2026-08-30)

### Gate

| # | Criterion | Result |
|---|---|---|
| 1 | A preference actually stops the notification | Pass — with `inApp` off the row is never written; the API round-trips and persists |
| 2 | Marketing is off on every channel by default | Pass — consent is given, not withdrawn |
| 3 | Nobody is notified about their own action | Pass — `skipped: 'self'` |
| 4 | A blocked actor cannot reach you through a notification | Pass — `skipped: 'blocked'`, in either direction of the block |
| 5 | Requesting a code queues exactly one email | Pass — one row, keyed on the code's own id; an address with no account queues nothing |
| 6 | A row is claimed before it is sent, so nothing sends twice | Pass — a second drain finds nothing |
| 7 | A duplicate dedupe key queues one message | Pass — and the answer comes from the database, not `affectedRows` |
| 8 | Push with no provider fails visibly | Pass — `sent: 0`, `failed: 1`, the reason on the row |
| 9 | A message that keeps failing is abandoned, not lost | Pass — `abandoned` after 5 attempts, row retained |
| 10 | Quiet hours suppress the interruption, not the record | Pass — no push queued, the notification still in the inbox |
| 11 | A notification failing never fails the action that caused it | Pass — `notify()` returns rather than throwing |
| 12 | The outbox is staff-only | Pass — 403 for an ordinary account |

### Live route check

`/me/notifications`, `/me/notifications/count`, `/me/notifications/read`,
`/me/notifications/:id/read`, `/me/notification-preferences` (GET and PATCH), `/me/quiet-hours`,
`/me/devices` (POST and DELETE), `/admin/outbox`, `/admin/outbox/drain`. All exercised against a
running server; the inbox and the outbox both reject unauthenticated callers, and the outbox rejects
non-staff.

### Verified in the browser

- **Notification settings.** Turned Likes→Push off and set quiet hours to 10pm–7am. Both reached the
  database (`notification_preferences`, `user_profiles.quiet_hours_start/end`) and both read back
  after a full reload. The screen labels itself "Live notification settings — Every switch saves as
  you move it."
- **The inbox activity tab.** Registered a second account and had it follow the signed-in user
  through the API. The follow appeared as "notifver059356 started following you — just now", unread,
  under a "Live activity" label. Before the follow the tab correctly read "Nothing here yet" rather
  than showing sample likes.
- **Marking read.** Tapping the row set `read_at` on the server, and the unread count dropped.
- **The profile it links to** shows the real account — 1 following, 0 followers, 0 likes, no badge,
  "No videos yet".

### Bugs found and fixed

| ID | Date | Severity | Area | Description | Resolution |
|---|---|---|---|---|---|
| BUG-055 | 2026-08-30 | **High** | Delivery | `queue()` decided whether a message was newly queued from `affectedRows` on an `ON DUPLICATE KEY UPDATE`. The MySQL CLI reports 0 for a no-op, but mysql2's prepared statements report a matched row, so every deduplicated message was reported as successfully queued — the dedupe worked and the answer about it was always wrong | Fixed — a plain INSERT, with `ER_DUP_ENTRY` as the signal; `isDuplicateKey` given a canonical home in `core/db.ts` |
| BUG-056 | 2026-08-30 | **High** | Mobile | A brand-new account displayed a verified badge in the inbox. `VerifiedBadge` returned `null` only for `'none'`, so an `undefined` tier fell through and drew a blue tick | Fixed — the badge renders only for `individual`, `creator` or `business`; the notification actor now carries its real tier |
| BUG-057 | 2026-08-30 | **High** | Mobile | Tapping any real account opened a sample creator with 128K followers and 2.1M likes. `getUser(id)` returns `usersById[id] ?? currentUser`, so every unrecognised id resolved to the same invented person | Fixed — `GET /users/:handle` now accepts a public id as well as a username, and the profile screen loads from the server |
| BUG-058 | 2026-08-30 | Medium | Mobile | A profile with no videos was padded with `videos.slice(0, 6)` — six sample clips with millions of plays, under a real name | Fixed — an account the server answered for shows an empty grid when it is empty |
| BUG-059 | 2026-08-30 | Low | Notifications | Quiet hours could be written but not read, so the settings screen would have had to guess what was set | Fixed — `quietHoursFor` added and returned alongside the preferences |

BUG-056, 057 and 058 are the same bug three times, and the eighth occurrence of its shape across the
project: a real value rendered beside an invented one. Each previous instance was fixed where it was
found. This time the rule went into ADR-041 instead — sample data is for a screen with no live data
at all, and is never mixed into one — and `VerifiedBadge` was hardened so the next caller with an
incomplete user object cannot reintroduce it.

BUG-055 is the more interesting failure. Every test of the dedupe passed, because the dedupe was
never broken; what was broken was the report of it. The lesson is that `affectedRows` means
different things on the text and binary protocols, and that a fact worth acting on should come from
the database refusing to do something, not from a count of what it did.

### Regression

- `npm run typecheck` — clean across mobile, admin and backend.
- `npm test` — **507 passed**, 0 failed (485 + 22 new).
- `npm run smoke` — **70 passed**, 0 failed (59 + 11 new).
- `npm run migrate:validate` — all 25 migrations pass.
- `npm run admin:build` — compiled successfully.
- `npm run preflight` — 13 pass, 2 warnings, 5 failures, all correct for this machine.

### Carried forward

- **No SMTP host.** The outbox drains to the console: codes are queued correctly and delivered
  nowhere. `transportKind()` reports `console` so the admin view does not claim otherwise.
- **No push provider.** Push rows fail on every attempt and are abandoned after five. This is
  deliberate — marking them sent would make the outbox lie.
- **No scheduled drain.** `npm run drain:outbox` exists and `/admin/outbox/drain` works, but nothing
  runs them on a timer yet; the preflight warns when anything has been queued over an hour.
- **Device push tokens are registered but never used**, for the same reason.
- **Notifications are not surfaced in the admin panel** beyond the outbox status route.
- Everything under section 3 of the master log — Redis, FFmpeg, media server, storage host, payment
  placeholders, administrators — remains outstanding and is what the preflight is for.

---

## ADMIN PANEL + SMTP (2026-08-30)

### Gate

| # | Criterion | Result |
|---|---|---|
| 1 | An ordinary account gets 403 from every admin surface | Pass — five surfaces checked |
| 2 | Settings validate the key and the type, and mask the secret | Pass — typo 400, wrong type 400, password comes back as dots |
| 3 | A settings change is audited with who and what | Pass |
| 4 | The email test never claims delivery it did not make | Pass — console transport answers sent:false with the reason |
| 5 | Catalogue editors accept only allow-listed columns | Pass — unknown column 400, injection-shaped column 400, wrong type 400 |
| 6 | An announcement lands in user inboxes, counted honestly | Pass — one row per active user |
| 7 | Granting admin needs an existing account and a super admin | Pass — ghost email 404, duplicate 409 |
| 8 | Nobody can disable their own admin access | Pass — 409 |

### Verified in the browser

- **Sign-in** with the seeded super admin; a wrong-password and a no-admin account each get one clear sentence.
- **Dashboard** live: 184 users, queue card "2 coin purchases" matching the database, live sidebar badges.
- **Users** — opened a real account's drawer (wallet, counts) and issued a warning; "recorded a warning" came back from the enforcement.
- **Coin Requests** — approved a pending purchase with a note; the buyer's wallet went from 4,750 to 5,750 coins and the audit row exists.
- **SMTP** — pressed "Use Gmail", saved, sent a test: Google's live server answered `535 BadCredentials` for the placeholder password and the UI showed it verbatim. With a real App Password this is delivery. Cleared back to console for dev.
- **Announcement** — composed in the panel, "Sent to 184 inboxes", then read the same notification in the mobile app's live inbox. Panel → backend → phone, one pipeline.
- **Audit Log** — every one of the above visible with before/after values.

### Bugs found and fixed

| ID | Severity | Area | Description | Resolution |
|---|---|---|---|---|
| BUG-060 | **High** | Settings | LONGTEXT settings never parsed on read; stored `false` was the truthy string "false" — a kill switch that could not kill. Strings exposed it; booleans had been silently wrong | Parse on read, tolerate legacy raw strings |
| BUG-061 | **High** | Admin panel | Refresh-token stampede: parallel 401s raced the rotation; losers cleared the session. Operator signed out every 15 minutes | Single-flight refresh promise |
| BUG-062 | Medium | Analytics | `DATE()` columns return JS Dates; `String(date).slice(0,10)` is "Sat Aug 29" — charts all-zero under correct totals | One local-time day formatter for both sides |

Also hit (environment, not code): the machine's timezone changed mid-session while MariaDB kept its startup zone — every new timestamp shifted three hours and two unrelated tests failed. One MariaDB restart fixed it; both deployment guides now say "set the server to UTC first".

### Regression

- `npm test` — **520 passed** (507 + 13 new admin e2e), 0 failed.
- `npm run smoke` — 70 passed. `npm run migrate:validate` — all 25 pass.
- `npm run admin:build` — compiled; typecheck clean across all three apps.
- `npm run preflight` — 14 pass / 2 warn / 4 fail; the four are the known environment items (Redis, SMTP credentials, payment placeholders, storage host), all now fixable from the admin panel or the deployment guide.

### Carried forward

- Payment placeholders and SMTP credentials are the owner's to enter (Rates & Methods, Settings → Email). Everything needed is in the panel.
- Role-permission granularity: non-super roles enforce per-module grants server-side, but the panel has no matrix editor yet — roles ship as view + grant/disable.
