# SECURITY LOG

Security decisions, reviews, findings and incidents. Append-only.

---

## SECURITY BASELINE

### Authentication
- Passwords hashed with **Argon2id** (never MD5, SHA1, or unsalted hashes).
- Email + OTP registration; OTP is 6 digits, single-use, 10-minute expiry, rate limited per email and
  per IP, and is compared in constant time.
- JWT access tokens (short lived) + rotating refresh tokens bound to a device record.
- Refresh-token reuse detection revokes the whole session family.
- Admin authentication is separate from user authentication and is 2FA-ready from day one.

### Authorization
- Role-based access control for admin, with per-module permissions
  (view / create / edit / delete / approve / reject / suspend / export / manage settings).
- **Object-level checks on every resource access** — never trust an ID from the client.
- Community/group role checks enforced server-side, never in the UI alone.

### Input and output
- Schema validation (allow-list) on every request body, query and param.
- Parameterised SQL only. String-concatenated queries are a blocking defect.
- Output escaping in admin views; no `dangerouslySetInnerHTML` on user content.
- CSRF protection on cookie-authenticated admin routes.
- Upload validation: extension + MIME + magic bytes + size + duration; media is re-encoded, never
  served as uploaded.

### Transport and secrets
- TLS everywhere; HSTS on web surfaces.
- Secrets in environment/secret manager. **Never** committed. `.env` files are git-ignored.
- Separate credentials per environment; production credentials never present on a developer machine.

### Abuse protection
- Per-route and per-identity rate limiting.
- Anomaly detection on: login attempts, OTP requests, coin purchases, gift sends, follows, reports.
- Idempotency keys on all money-moving endpoints.

### Privacy
- Microphone used **only** for recording, voice notes, calls and live streaming, always with explicit
  permission. No ambient or background audio capture exists in this codebase (ADR-008).
- Behavioural signals are first-party and in-app only.
- Sensitive personal characteristics are never used as ranking or targeting features.
- Admin access to private communication content is restricted, justified and audit-logged.

### Auditing
- Every critical admin action writes: admin, action, module, target, old value, new value, timestamp,
  reason, IP and user agent.
- Audit records are append-only and cannot be edited or deleted from the panel.

---

## THREAT MODEL — TOP RISKS

| # | Threat | Impact | Mitigation |
|---|---|---|---|
| 1 | Account takeover via OTP brute force | High | Rate limits, lockout, single-use codes, constant-time compare |
| 2 | Wallet manipulation / double spend | Critical | Ledger design, DB transactions, idempotency keys, reconciliation job (ADR-013) |
| 3 | Malicious file upload (RCE, stored XSS) | Critical | Magic-byte validation, re-encoding, isolated storage domain, no execution in media paths |
| 4 | IDOR on videos, chats, wallets, campaigns | High | Object-level authorization on every read and write |
| 5 | Admin privilege escalation | Critical | Server-enforced RBAC, separate admin auth, 2FA, audit log |
| 6 | Payment fraud / chargeback abuse | High | Provider-side verification, webhook signature checks, no client-trusted amounts |
| 7 | Scraping of users and communities | Medium | Rate limits, member-list restriction (ADR-014), pagination caps |
| 8 | Spam and coordinated inauthentic behaviour | Medium | Behaviour anomaly detection, AI moderation assist, human review |
| 9 | Live-stream abuse | High | Real-time reports, admin force-stop, host warnings, mute, ban |
| 10 | Data loss through a bad migration | Critical | Backup-first policy, forward-only migrations, no hard deletes (ADR-012) |

---

## SECURITY REVIEW HISTORY

| Date | Scope | Reviewer | Findings | Status |
|---|---|---|---|---|
| 2026-08-28 | Phase 0 — documentation and structure only, no code | — | No code surface exists yet | Complete |

---

## INCIDENT LOG

| Date | Severity | Description | Detection | Response | Root cause | Prevention |
|---|---|---|---|---|---|---|
| — | — | _No incidents._ | — | — | — | — |

---

## PRE-PRODUCTION SECURITY CHECKLIST (Phase 13 gate)

- [ ] No secrets in the repository or in any build artifact
- [ ] All dependencies audited; no known critical CVEs
- [ ] Rate limits verified on auth, OTP, upload, payment and messaging endpoints
- [ ] Object-level authorization tested with a second account for every resource type
- [ ] File upload fuzzed with mismatched extensions and crafted headers
- [ ] Admin RBAC tested per role, including horizontal escalation attempts
- [ ] Audit logging verified for every critical action
- [ ] Payment webhooks verify provider signatures
- [ ] Backup restore rehearsed end to end
- [ ] TLS configuration and security headers scored
- [ ] Privacy policy, terms and community guidelines published and reachable in-app

---

## PHASE 3 SECURITY REVIEW — Authentication and Users (2026-08-29)

Required by `PHASE_03_AUTH_USERS.md` exit criterion 6.

### Controls implemented

| Requirement | Implementation | Verified by |
|---|---|---|
| Argon2id password hashing | `argon2id`, m=19456 KiB, t=2, p=1 (OWASP baseline). Cost parameters live in the hash, so raising them later does not invalidate existing passwords; hashes are transparently upgraded on next sign-in | Code review + login test |
| Weak password rejection | Length bounds, a blocklist of the passwords credential-stuffing tools try first, and a rule that a password may not contain the email local part | `a weak or email-derived password is refused` |
| OTP: 6 digits, single use, 10-minute expiry | `otp_codes`, `consumed_at` set on use; requesting a new code consumes any pending one | `an OTP cannot be used twice` |
| OTP stored hashed | SHA-256; the plaintext is returned once to the caller for delivery and never persisted or logged | `the security log never stores an OTP code or a password` |
| Constant-time OTP comparison | `timingSafeEqual` over equal-length hashes; the no-pending-code path performs comparable work so timing does not distinguish it | Code review |
| OTP attempt limit | 5 attempts, then the code is burned; 60-second resend cooldown | Code review |
| JWT access + rotating refresh | Separate secrets for access and refresh. Refresh rotates on every use | `register → … → refresh → logout` |
| **Refresh reuse detection** | Rotation chains share a `family_id`. Replaying an already-rotated token revokes the entire family | `replaying a rotated refresh token revokes the entire session family` |
| Refresh tokens stored hashed | SHA-256 only; a database leak yields no usable token | Code review |
| Immediate session revocation | The access token carries its session id, and `requireAuth` joins the session row — a revoked session is rejected on the very next request, not at token expiry | `revoking a session invalidates its access token…` |
| Password change / reset ends sessions | A reset ends every session; a change ends every session except the one making the change | Two tests |
| Sign-in lockout | 8 failures against one email within 15 minutes pauses that email | Code review |
| Username enumeration resistance | Registration with a taken email, login with an unknown email, and password reset for an unknown address are all indistinguishable from the success or failure case | Three tests |
| Reserved usernames | Blocklist plus confusable-skeleton matching, so `adm1n` is refused as well as `admin` | Two tests |
| Retired usernames | `username_history` — a released username cannot be claimed by anyone but its previous owner | Code review |
| Object-level authorization | Every mutation derives the user id from the token, never from the body or path. Session revocation is scoped to the caller's own sessions | `unauthenticated requests to protected routes are rejected` |
| Age gate | 13+, checked server-side | `an under-13 registration is refused` |
| Blocks enforced server-side | Bidirectional, applied in profile reads and follows; a blocked viewer gets 404, not 403 | `a block hides the blocker…` |
| Security event log | Append-only `security_events`; no delete path exists in the codebase. The user can read their own history | `every auth action is written to the security log` |
| Secret redaction in logs | `password`, `code`, `destination`, `transactionRef`, tokens and `streamKey` are redacted by the logger | Code review |

### Deliberate design decisions

**A blocked user gets 404, not 403.** Returning "forbidden" would confirm the account exists and that it has blocked you. The blocker did not agree to share that.

**Registration with an existing email returns a generic 409.** The message deliberately avoids "already registered". The owner of the address finds out by email; a stranger probing the API learns nothing.

**Reuse detection revokes the legitimate device too.** When a rotated refresh token reappears we cannot tell replay from theft, so the whole family goes. Losing a session is recoverable; leaving a stolen token live is not.

**Email verification does not gate sign-in.** An unverified account can browse. Verification will gate money operations in Phase 9. Blocking the first session on a mail round trip loses users to a slow mail server, not to a security threat.

### Bugs found and fixed during this phase

| ID | Severity | Finding |
|---|---|---|
| BUG-006 | **High** | Refresh-token reuse detection did not work. The family revocation ran inside the same transaction as the detection, and the function then threw — which rolled the revocation back. A stolen token would have been detected, reported, and then left live. Fixed by committing the read transaction and revoking outside it. Now covered by a test that asserts the legitimate token dies too. |
| BUG-007 | **High** | Only one session could ever be created. `user_sessions.refresh_token_hash` is UNIQUE, and the session row was inserted with a fixed placeholder hash before the token was minted, so the second insert collided. Root cause was a circular dependency: the token embedded the session id, which required the insert first. Removed by giving the refresh token a random `jti` instead — lookup is by hash, so the row id was never needed in the token. |
| BUG-009 | **High** | Every unknown or expired refresh token took a gap lock on `uq_refresh_hash`, blocking all concurrent session inserts for the life of the transaction. An attacker replaying junk tokens could have stalled sign-ins for everyone — a denial of service reachable without any credentials. Fixed by resolving the row id with an unlocked read first, so the lock is always a single-row primary-key lock. |

### Not yet done (carried to later phases)

- **OTP delivery.** Codes are generated, hashed and verified, but no mailer is wired up. In development the code is returned in the response so the flow is testable; in production it is not. Phase 13 must connect a mail provider before launch — until then, email verification and password reset cannot complete for a real user.
- **Rate limits are not runtime-verified.** The limiter needs Redis, which is not installed on the development machine. The limits are defined and mounted, and the middleware fails open by design, but no test has yet observed one triggering.
- **Login activity is not surfaced to admin.** `security_events` and `login_attempts` are populated; the admin panel does not read them yet (Phase 11).
- **Interest onboarding** feeding `user_interest_profiles` is not built. It belongs with the recommendation work in Phase 6/7.

---

## UI WIRING REVIEW (2026-08-29)

### The migration validator could be made to miss a destructive statement

**Severity: High.** Logged as BUG-032.

`scripts/validate-migration.ts` is the tool that stands between a migration and the production
database. It normalised SQL with a sequence of regular expressions applied in order: block
comments, `--` comments, `#` comments, string literals, then split on semicolons.

That order is wrong, because SQL's delimiters nest. The `#` pass ran before the string pass, so a
`#` inside a string literal was treated as a comment opener and consumed the rest of the line —
including the semicolon that terminated the statement, and everything after it:

```sql
INSERT INTO t VALUES ('#x'); DROP TABLE users;
```

The `DROP` was consumed as part of a comment that was never there. No rule ran against it. A
migration containing that line would have been reported clean.

It had been passing every migration in the project. Migration 017 passed only because the
swallowed text happened to reassemble into statements that each still carried a `WHERE` clause.
Migration 018, written in the same style, failed loudly with a nonsensical error, which is what
exposed it.

**Fixed** by replacing the regex chain with a single scanner that tracks whether it is inside a
string, a backtick identifier or a comment, and decides what each character means from that state.
It follows MySQL's actual rules: `--` opens a comment only when followed by whitespace, `\'` and
`''` both escape a quote, backtick identifiers are preserved. Recorded as ADR-030.

Nine regression tests now cover both directions — real comments are still stripped, and characters
inside strings no longer act as delimiters.

**Why this one matters more than its exploitability.** Nobody was attacking this; the flaw was
reached by writing a colour value. But it is a safety check that was wrong in a way that usually
produced the right answer, which is exactly the failure mode nothing draws attention to. The rule
taken from it: anything that decides whether SQL is safe parses it, never pattern-matches it.

### Relationship data was under-returned, never over-returned

Three endpoints (`listGraph`, `/search`, `/discover/creators`) were returning follow state
incorrectly. In every case the error was omission — the client was told less than it was entitled
to, never more — so the fixes added data rather than removing a leak. The privacy-relevant part is
that the flags are still **absent, not false**, for an anonymous caller: "unknown" and "not
following" are different answers, and only a signed-in viewer is told which applies to them.

Verified explicitly: an unauthenticated request to `/users/:id/followers` returns rows with no
`isFollowing` key at all.

### Search terms are escaped, not interpolated

`/search` binds `q` as a parameter and escapes `%`, `_` and `\` inside it before building the
`LIKE` pattern. Without the escaping, searching for a single `%` would have returned every account
on the platform. Covered by a live check that asserts `?q=%25&type=users` returns zero results.

### Privacy audience settings are not booleans

The mobile privacy screen renders "who can comment / message / duet" as three-way choices, not
switches, because the server stores three values. Rendering `followers` as an ON toggle would mean
that switching it off and on again silently widens the audience from followers to everyone — a
privacy regression the user never asked for and would not see. Recorded in the changelog for
0.8.2.

---

## PHASE 8 — CHAT, COMMUNITIES AND CALLS (2026-08-29)

### Deliberate design decisions

**A non-member gets 404, not 403.** "You are not allowed in this chat" confirms the conversation
exists and that those people are talking — which is what someone probing ids is trying to learn.

**Socket rooms are joined from the database, never from a client request.** Socket.IO rooms are
strings, and honouring a client's `join` would make a leaked chat id into a live subscription. The
server joins the caller's own conversations on connect and verifies any later join against
`chat_participants` (ADR-031).

**`whoCanMessage` is checked on every send, not only when a conversation opens.** A chat can turn
hostile after it is created — someone blocks the other, or tightens who may write to them — and a
check that runs once would leave the old permission in force for ever.

**Calls obey the messaging rules.** A call is a more intrusive contact than a message, so anything
less would make the messaging rules bypassable by dialling instead of typing. Blocks and
`whoCanMessage` are both enforced at `startCall`.

**A call is offered before any device opens a microphone.** `answer` is an explicit request rather
than something inferred from the first ICE candidate arriving, so nothing is captured until the
callee has said yes. This is the mechanism behind the project's standing microphone rule.

**The server does not read call signalling.** SDP and ICE are relayed between peers unparsed, so
there is no point in the system where call content could be inspected. A test asserts that a
deliberately invalid payload is relayed anyway — the server must not care.

**Delete for everyone belongs to the sender.** A group admin removing someone else's words is
moderation, and moderation goes through the report queue where it leaves a record.

**Community rosters are hidden from ordinary members (ADR-014), and the client is told.** The
response carries `restricted`, so a narrowed list is labelled rather than presented as the whole
community.

### Bugs found and fixed during this phase

| ID | Severity | Finding |
|---|---|---|
| BUG-044 | **High** | Every unknown path under the API prefix answered `401 Authentication required` instead of `404`. `router.use(requireAuth)` applies to every request that *reaches* a router, not only the ones whose path it handles, so mounting three routers that way turned the entire unmatched surface into an authenticated one. Not a disclosure — but it broke the documented error contract, and it put a security decision somewhere invisible from the routes it governed. Auth is now attached per route, and tests assert both directions: unknown paths 404, chat routes without a token 401. |
| BUG-043 | **High** | Message send idempotency was stored only in Redis. With the cache down a retry created a second message — and a client retries precisely when the network has just failed. Moved into a unique database key, with the cache demoted to a fast path (ADR-032). |
| BUG-042 | **High** | Every timestamp the API returned was shifted by the host's UTC offset. Not itself a vulnerability, but security-relevant: the login-activity screen showed every session as "last active just now", which is exactly the signal someone would use to spot an unfamiliar session. |

### Not yet done (carried forward)

- **No end-to-end encryption.** Messages are stored in plaintext and are readable by anyone with
  database access. This is a deliberate scope decision for now, not an oversight — but it must be
  stated plainly rather than implied by the presence of "private chat" in the interface.
- **No media scanning on message attachments.** The upload pipeline's safety checks run on videos
  destined for the feed; a file attached to a message does not yet pass through them.
- **TURN credentials are not issued.** Calls will work between peers that can reach each other
  directly; a relay for the rest needs a TURN server and short-lived credentials, which belongs
  with the deployment work.

---

## PHASE 9 — LIVE STREAMING AND GIFTING (2026-08-29)

### Stream keys are credentials

A stream key lets whoever holds it broadcast as that creator. It is treated like a password:
generated with 24 bytes of `randomBytes`, returned exactly once in the response that creates the
stream, and stored only as a SHA-256 hash. There is no endpoint that returns it — a creator who
loses it starts a new stream, the same trade a password reset makes.

It also expires (12 hours), and ending a stream nulls the hash, so a finished broadcast cannot be
resumed with an old key. Verified by test: the key does not appear in any later response, the stored
value is a 64-character digest, and it is gone after `end`.

### Idempotency no longer depends on a cache

**Severity: High.** Logged as BUG-043 and BUG-044.

ADR-020 put money-route idempotency in Redis and failed closed when it was unavailable. Two
problems emerged.

The lookup had no timeout, so a dead cache added its full connect-retry backoff — about twelve
seconds — to every money request before refusing it. And the same pattern had spread to chat, where
message sends deduplicated retries through a Redis key with *no* database backstop: with the cache
down, a client retrying after a dropped connection posted the same message twice.

The cache being unavailable is precisely when clients retry. Protection that lives only there is
absent exactly when it is needed.

**Fixed** by moving the guarantee into the database — a unique index on `(sender_id, client_id)` for
messages and `(sender_id, idempotency_key)` for gifts, alongside the ledger's existing unique key —
and bounding every cache lookup to 250ms. The middleware now takes an explicit `durable` flag at
the mount point: a route whose handler carries its own key continues when the cache is down; one
without keeps ADR-020's fail-closed behaviour. The header stays mandatory either way. Recorded as
ADR-032.

### Money movements are atomic and attributable

A gift writes four rows — the sender's debit, the creator's credit, the transaction and the
clearing row — in one transaction. A test asserts that an unaffordable gift leaves both wallets
untouched and writes no transaction at all, so a refusal cannot leave a partial movement behind.

Every ledger row carries the balance either side of it, so a disputed figure can be reconstructed
rather than argued about. Verified by test that `balance_after = balance_before + amount` on both
sides of a gift.

Self-gifting is refused: it would convert coins into withdrawable balance, which is a cash-out route
around the payout rules rather than a gift.

### What a client is trusted with

Nothing that can be measured server-side.

- **Viewer counts** are recomputed from `live_viewers`, never incremented from a client report.
- **Likes** are capped per call and the stream total is recomputed from per-viewer rows. A request
  claiming a million likes is refused by validation, verified by test.
- **Gift totals** come from transactions that actually charged someone.

Recorded as ADR-031. The mobile screens previously invented all three on a timer; that is now gone.

### Audience privacy

Only a host can enumerate who is watching their stream. A viewer requesting the list gets 403,
verified by test. A blocked viewer is told the stream does not exist — the same answer the rest of
the product gives — and a banned viewer cannot rejoin or comment.

### Not yet done (carried to later phases)

- **Ingest authentication is unexercised.** `verifyStreamKey` exists and is correct, but no media
  server has called it: there is no RTMP endpoint running locally. The integration must be tested
  before launch.
- **Chargeback reversal.** `gift_clearing.reversed_at` exists and clearing respects it, but nothing
  writes it. Until a payment provider is connected there is no chargeback to react to; this belongs
  with Phase 10.
- **Gift spend limits.** There is no daily cap on how much one account can spend on gifts. That is a
  safety feature as much as a financial one, and it needs the wallet work in Phase 10 to sit on.


---

## PHASE 10 — WALLET, COINS AND MONETIZATION (2026-08-29)

### The double-spend the design exists to prevent

A withdrawal debits the balance when the request is made, not when it is paid. Without that, someone
with $500 could submit five $500 requests before an administrator looked at any of them, and each
would pass its own balance check because none of the others had settled.

Verified by test: the second request against the same money returns `insufficient_balance`, and the
balance shows the hold immediately. Recorded as ADR-033.

The corollary is equally load-bearing: rejection and cancellation must refund, because the money has
already left. Both are tested, and both refund exactly once — a second cancellation returns
`invalid_state_transition` rather than paying again.

### Money can only leave if money came in

Four balances, one payable. `assertPayable` refuses any wallet but `withdrawable` on the payout
path, and `convert` refuses any pair not on an explicit allow-list. Reward balance converts to coins
one way; nothing converts into `withdrawable`.

This is what stops a task farm becoming a payroll and a promotional coin grant becoming a cash
withdrawal. Tested from the outside: an account with 500 reward coins and no gift earnings cannot
withdraw anything, and its reward balance is untouched by the attempt. Recorded as ADR-034.

### Progress is measured, not reported

A daily task names a metric the server already counts — videos posted, follows made, minutes
watched. There is no field on the request where a client could state its progress, and adding a task
type requires adding a counter, so a task the server cannot verify cannot be defined.

Verified by test: a new account reads zero on every task, and a completed task is one the server
counted itself.

### Administrator actions are claimed, not assumed

Every decision — approving a purchase, approving, paying or rejecting a withdrawal — is a
conditional `UPDATE ... WHERE status IN (...)` inside the transaction that moves the money. Two
administrators clicking at once produce one outcome; the second gets `invalid_state_transition`.

Tested for both purchases (a second approval credits nothing) and withdrawals (a second payment is
refused).

### Purchases no longer fail closed unnecessarily

**Severity: High.** Logged as BUG-048.

Coin purchases could not be made at all while Redis was unavailable. The route used ADR-020's
fail-closed idempotency because a purchase request wrote no ledger row for a retry to match against.

That was a gap in the schema being treated as a constraint on the design. `coin_purchase_requests`
now carries the caller's key under a unique index on `(user_id, idempotency_key)`, and the route
uses the durable variant — a retry finds the original request rather than creating a second one for
an administrator to reconcile by hand. Consistent with ADR-032 and with how gifts and withdrawals
already worked.

### Account details are masked on the way out

A withdrawal history is read in support chats and screenshots. `destination` is returned masked to
the account holder — the last four characters only — and in full solely to the administrator who has
to make the payment. Verified by test.

### Not yet done (carried to later phases)

- **No spend or withdrawal caps.** Nothing limits how much one account can move in a day. This is a
  fraud and a safety control, and it needs the admin configuration surface in Phase 11.
- **No payment gateway**, so no automated settlement and no chargeback signal. `reversed_at` on
  `gift_clearing` is respected by the clearing job but nothing writes it.
- **Referral abuse detection is passive.** Signup IP and device are recorded on every referral,
  which is what a ring leaves a pattern in, but nothing analyses them yet.
- **Manual approval is the whole control on incoming money.** An administrator confirms every
  transfer against the receiving account. That is appropriate for the market and is also a single
  point of failure worth watching as volume grows.


---

## PHASE 11 — PROMOTION, ADS AND CAMPAIGNS (2026-08-29)

### Money does not buy past the safety rules

Every restriction that applies to organic content applies to a promoted one, enforced in the same
query that selects it:

- A blocked viewer never sees that advertiser's campaign, in either direction of the block.
- Only a published, public, fully processed video is eligible — a campaign cannot keep a deleted or
  privated video in circulation, and cannot show a private video to the people its owner excluded.
- An advertiser is never shown their own campaign, so budget cannot be burned by accident.
- Targeting cannot go below the platform's minimum age. The request schema floors it at 13 and the
  service floors it again, because a validation rule and an invariant are different things.

All four are covered by tests that assert the campaign is absent from the eligible set, not merely
that a flag was set.

### Charging cannot be replayed

`campaign_impressions` carries a unique key on (campaign, viewer, impression id), and the row is
written inside the transaction that charges. A retried or replayed signal loses the insert and costs
nothing. Verified by charging the same impression id twice and asserting one row and one charge.

Budget and daily cap are re-read `FOR UPDATE` inside that transaction, so concurrent deliveries
cannot push a campaign past either. A delivery that would exceed the budget is recorded at zero —
served, so not hidden, but not billed beyond what the advertiser agreed to.

### Campaigns delivered for free

**Severity: High.** Logged as BUG-052.

`campaigns.spent_coins` was a BIGINT while one impression costs a fraction of a coin. Every charge
rounded to zero, so spend never accumulated — and the check that stops a campaign once it exhausts
its budget compares spend against budget, so it never fired either. A campaign would have delivered
indefinitely without its advertiser ever being billed.

Fixed by widening both spend columns to `DECIMAL(16,4)` in migration 024. Budgets remain whole
coins; only accumulated spend needs the precision.

Worth recording how it was found: by a test asserting `spent_coins > 0` after a successful charge.
That assertion reads as redundant beside "the charge returned success", and was the only thing
standing between this and a billing system that billed nobody.

### The disclosure guarantee

`isPromoted` is set by the delivery service and passed through the feed service, the hydration step
and the client adapter — four places, any one of which dropping it would put an unmarked
advertisement in front of a user. The browser check counts the rendered SPONSORED badges in the live
DOM and asserts exactly one, which is the only way to confirm the whole chain rather than one link
of it.

Recorded as ADR-035, alongside the structural point: there is no field anywhere for buying
engagement, so no code path can produce a fake like even by mistake.

### Not yet done (carried to later phases)

- **No automated creative review.** Every campaign is approved by a human. Nothing scans a creative
  for policy breaches before it reaches that queue.
- **No per-advertiser spend cap.** A campaign is capped; an account is not. Same gap as Phase 10,
  and it needs the admin configuration surface to close.
- **Targeting is not audited.** Nothing records who targeted what, which is the trail needed if a
  campaign is later alleged to have targeted a protected characteristic. The dimensions available
  do not include one today, but the audit should exist before they ever could.


---

## PHASE 12 — VERIFICATION, SUPPORT AND MODERATION (2026-08-29)

### Identity documents

The most sensitive data the platform will ever hold, and the design treats it that way.

**Never returned.** No endpoint returns a storage key or a URL for a verification document. Tested
from three directions: the submission response, the applicant's own list, and the reviewer's queue
are each asserted not to contain the key. The mobile contract has no field that could hold one.

**One way in.** A reviewer requests a link for a single document. It is signed to that reviewer,
expires in five minutes, and the request writes a `verification_document_viewed` event against the
*subject's* account — so the person whose passport it is has a record naming who opened it. Tested
that the event exists and that its detail names the reviewer.

**Destroyed on decision.** Approving or rejecting deletes the files; the decision row survives so it
stays auditable. `more_info` keeps them because the applicant is being asked to add to them. An
hourly sweep removes files whose deletion failed, because object storage is not transactional.

**Ownership is checked.** A document key belonging to another account is refused before a reviewer
is ever pointed at it, with the deliberately vague message already used elsewhere so the response
does not confirm the key exists.

Recorded as ADR-037.

### Internal staff notes

`ticket_messages.is_internal` separates what staff write *to* a user from what they write *about*
one, and both live in the same table. The filter is in the WHERE clause of the user-facing query, so
an internal row is never fetched on a user read at all — a later mistake in a mapper cannot leak
one.

Tested by writing an internal note containing a distinctive string and asserting it is absent from
the serialised user response while the staff response contains it.

### Enforcement is real

A suspension sets `users.status` and revokes every session in the same transaction, so it takes
effect immediately rather than when an access token expires. Tested by making a request with a
still-valid token after suspension and asserting `account_suspended`.

Every action returns a description of what it actually changed, which is logged. A claim backed by a
statement of the change rather than an assumption that it happened. Recorded as ADR-038.

### What a reporter is told

The outcome, and nothing else: reviewed, dismissed, or acted on. Tested by asserting the response
contains neither the action taken, nor the moderator's reasoning, nor the reported account's
username. Another account reading the same report gets 404.

### The staff boundary

Every administrative route sits behind `requireAdmin` and none shares a handler with a user-facing
one — a single handler branching on role is how a permission check ends up on the wrong side of a
condition. Tested that an ordinary account gets 403 from the verification queue, the report queue,
the ticket queue and the moderation endpoint.

### Not yet done (carried to later phases)

- **No appeals route.** An administrator can revert any action; a user has no way to ask them to.
  The mechanism exists and the process around it does not.
- **No automated content scanning.** Everything reaches moderation through a human report, so
  nothing is caught before someone sees it.
- **Moderation has no admin UI.** The routes are built and tested; the panel is not.
- **Document viewing is logged but not alerted.** A reviewer opening an unusual number of documents
  leaves a trail nobody is watching.

---

## PHASE 13 — NOTIFICATIONS, EMAIL AND LAUNCH READINESS (2026-08-30)

### Verification codes finally leave the building

Until this phase `requestOtp` returned the code in its own HTTP response. In development that is a
convenience; in production it would have meant anyone who could make the request could read the code,
which is no authentication at all.

The code now goes to the outbox and the response carries it **only when `NODE_ENV` is not
production**. The dedupe key is the code's own row id, so a retried request cannot put two different
valid codes in one inbox.

The enumeration property is preserved. An address with no account queues nothing and returns the
same body as one that does — verified by asserting both the response and the absence of an outbox
row. A failure to queue is logged and swallowed for the same reason: an error that only appears for
real addresses is an account oracle.

### The outbox holds sensitive material, briefly

Queued rows contain live verification codes in their payload. Two mitigations:

- **`pruneSent` deletes delivered rows** after a retention window. A sent code has no value after the
  fact and every day it stays is a day it could be read.
- **Abandoned rows are kept deliberately** — they are the record of something that did not arrive —
  but they are the failure path, not the common one.

The outbox is staff-only (`requireAdmin`), and its status route returns counts and ages, never
destinations or payloads.

### Preferences cannot be used to silence safety

Push and email are the user's to turn off for anything. The **in-app record is not**, for `system`
and `verification`. A suspension or a verification decision that a user can make invisible to
themselves is a decision they cannot appeal, so those two categories keep their inbox row whatever
the switches say — enforced in `notify()` and locked in the UI rather than merely defaulted on.

Quiet hours suppress the interruption and never the record, for the same reason.

### Notifications cannot be used to reach someone who blocked you

`notify()` checks blocks in both directions before writing anything. Somebody who blocked you does
not hear from you, including indirectly through a notification about something you did — otherwise
the block would be bypassable by acting on their content.

### Push delivery does not pretend

With no provider configured, push throws and the row records the reason. Marking it sent would have
made the outbox report successful delivery of every security notification the platform never sent —
the kind of quiet lie that is only discovered when it matters.

### A fabricated verification badge

`VerifiedBadge` drew a blue tick for an `undefined` tier, so an account created seconds earlier
appeared verified in another user's inbox. A verification mark is a trust signal that the platform
vouches for; drawing one from a missing value is closer to a security problem than a display bug.
The component now renders only for a tier that means verified, so a caller with an incomplete user
object cannot produce one by accident. Recorded as ADR-041.

### Profile lookup by public id

`GET /users/:handle` now accepts a public id as well as a username. The two identifier spaces cannot
overlap — usernames are `^[a-z0-9._]+$`, lowercase only, and a public id is uppercase Crockford
base32 — so a username can never be chosen to impersonate an id, and an id can never shadow a
username. An unknown id is a 404, never a different account. Blocked-by and banned checks are
unchanged and apply to both paths.

### Launch preflight

`npm run preflight` is a security control as much as an operational one. It fails on development JWT
secrets, identical access and refresh secrets, wildcard CORS, and placeholder payment account
details, and it is deliberately pessimistic: a check that cannot prove something is configured
reports it as not configured. Exit code 1 means do not deploy.

---

## ADMIN PANEL + SMTP (2026-08-30)

**One auth system.** Admins authenticate as users; `admin_users` is authorization,
not identity (ADR-042). Lockouts, session revocation and security events cover
admins automatically. Disabling the row ends the access; nobody can disable their
own.

**The SMTP password is write-only.** It works — the mailer reads it — but the API
returns dots, and the audit log records `(hidden)`. A secret that can be read out of
a settings screen is a secret in every screen recording.

**Catalogue editors cannot be steered into SQL.** Editable columns are an explicit
per-table allow-list; the incoming name selects from the list and is never
interpolated. Tested with an injection-shaped column name — 400.

**BUG-060 had a security edge.** Stored settings came back as unparsed JSON text, so
a stored `false` was truthy — `monetization.withdrawals_open` switched off would not
have switched off. Found while wiring SMTP; fixed at the single read path.

**The audit trail covers the whole panel.** Every admin mutation — settings, rates,
catalogues, grants, announcements, moderation — lands in `audit_logs` with admin,
role, before/after and IP. The table has no delete path anywhere in the codebase.
