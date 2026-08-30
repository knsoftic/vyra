# CHANGELOG

All notable changes to this project are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/). Versioning is date-based during
pre-release; semantic versioning starts at the first production deployment.

---

## [Unreleased] — Phase 4 (mobile) and production wiring

### Planned
- Native multi-clip camera capture, GPU shader preview, timeline editor on device.
- Real transports behind the outbox: an SMTP host, and FCM or APNs for push.
- The infrastructure preflight still reports missing: Redis, FFmpeg, a media server for live
  ingest, and object storage on a non-local host.

---

## [0.9.0] — 2026-08-29 — Phase 8: Chat, communities and calls

Private and group messaging, communities, and voice/video calling — delivered over a realtime
socket, with the same access rules the rest of the platform already enforces.

### Added — messaging
- **Private chats, groups and community rooms**, all one entity with different policy on top.
  Opening a conversation with someone is idempotent: two people tapping "message" at the same
  moment land in one conversation, not two.
- **Realtime** over Socket.IO. Rooms are joined from the database on connect, never from a room
  name the client asks for — the socket layer has no other authorisation check, so that is the
  whole of it. Typing indicators expire on their own timer, because a sender who closes the app
  mid-word must not leave "typing…" on screen for ever.
- **Delivery and read receipts.** Only the sender sees them; a recipient has no use for delivery
  state and showing it would leak when other people opened the chat.
- **Optimistic sending.** The bubble appears immediately, is replaced by the server's copy when it
  lands, and is marked failed — never silently dropped — if it does not. A failed bubble is
  tappable, and the retry carries the original client id.
- **Delete for me** and **delete for everyone**. The second belongs to the sender alone: a group
  admin removing someone else's words is moderation, which goes through the report queue.
- Someone added to a group cannot read what was said before they joined.

### Added — communities
- Public communities admit immediately; private ones record a join request for staff to decide.
- **ADR-014 is enforced and surfaced.** An ordinary member gets the staff list, not the roster, and
  the response says `restricted` so the app can label it rather than implying the community has
  four people in it.
- Roles, muting and banning. A ban removes the account from the conversation as well — leaving
  them able to read and post would make the ban decorative.
- Moderators run the room but cannot rename the community or promote anyone, including themselves.

### Added — calls
- Voice and video, with the server as a **signalling relay and nothing more**: SDP and ICE are
  passed between peers unread, so the server never becomes a place where call content could be
  inspected.
- **A call is offered before any device opens a microphone.** Answering is an explicit call, not
  something inferred from the first candidate arriving.
- The messaging rules cannot be bypassed by dialling: someone who cannot be messaged cannot be
  rung either.

### Added — mobile
- Inbox, private chat, group chat, communities, community info, join requests and call history are
  live. A socket at the app root outlives navigation, so messages arriving mid-navigation are not
  the ones you miss.
- `metro.config.js` — the app's first *value* import from `shared/contracts`. Copying the socket
  event names into the app instead would let the two ends drift on the exact strings they use to
  talk to each other.

### Fixed
- **Every timestamp the API returned was hours in the future.** The pool read MySQL DATETIMEs as
  UTC while MySQL wrote them in the machine's local zone, shifting every one by the host's offset —
  five hours here. "2 minutes ago" rendered as "just now", and every session looked like it had
  been used seconds ago. Affected every timestamp in the product, not only chat.
- **Message idempotency depended on Redis.** A retry after a dropped connection double-posted
  whenever the cache was unavailable — which is exactly when a connection has just dropped. The
  guarantee now lives in a unique key on the messages table, with Redis as a fast path only.
- **A dead Redis made chat slow.** Presence and send-idempotency called it directly, so each
  request paid the full connect-retry backoff: 36 seconds per operation with Redis down, 0.15
  after. Third instance of this pattern; the guarded cache now covers set operations too.
- **Unknown routes answered 401 instead of 404.** `router.use(requireAuth)` runs for every request
  that reaches a router, not only the paths it handles. Auth is now attached per route, where the
  decision is visible.
- Community info showed a hard-coded "2 reports" and "4 blocked users", and its "Leave community"
  button only navigated back.

### Known — still sample data
Wallet, coins, withdrawals, promotion, ads, daily tasks, referrals and creator earnings; live
streaming; verification and support; the activity feed. Each is labelled on screen.

---

## [0.14.0] — 2026-08-30 — Admin panel live, Gmail SMTP, launch documentation

The Super Admin panel stops being a mock-up. Every module reads and writes the real
backend, operators sign in with real credentials, and SMTP is configured from the
panel itself.

### Added — admin access
- **Admin sign-in.** Admins use their normal platform account; what admits them is the
  `admin_users` row the backend resolves on every request. Disabling the row ends the
  access — there is no separate admin credential to leak.
- **`npm run seed:admin`** creates or repairs the super administrator, idempotently,
  with credentials from the environment. The preflight's "no administrators" failure
  now has a one-command fix.
- **`GET /admin/me`**, and a session layer in the panel with single-flight token
  refresh — a page load's parallel 401s share one refresh instead of racing the
  rotation and signing the operator out (found in browser testing).

### Added — admin backend (26 new routes)
- **Overview:** dashboard (live counts and queue depths), analytics (four 14-day
  series), audit log reader, security events + admin sign-in attempts.
- **People & content:** user search/detail (wallet, counts, moderation history),
  video and comment queues — enforcement still goes only through the moderation
  module (ADR-038).
- **Catalogues, one allow-listed editor:** categories, hashtags, music, creative
  assets, feature flags (+create), countries/regions, banners (+create/status),
  coin packages, gift catalogue, payment methods, payout methods, daily tasks,
  monetization criteria. Column names are matched against a per-table allow-list —
  "edit any column by name" would be SQL injection dressed as a feature.
- **Settings:** validated `GET/PATCH /admin/settings` (unknown keys and wrong types
  are errors), SMTP status and **send-test-email**, announcement campaigns
  (one INSERT…SELECT into every active user's inbox), payments ledger view,
  ranking models/experiments view.
- Every mutation writes the audit log with before/after values; secrets are logged
  as `(hidden)`.

### Added — SMTP from the admin panel (Gmail-ready)
- Settings gained `email.smtp_host/port/user/pass/from`. The mailer resolves
  configuration **settings-first, environment-fallback**, and rebuilds its transport
  when the settings change — pointing the platform at Gmail needs no deploy and no
  restart.
- The panel's Email section carries the Gmail instructions (App Password, port 587)
  and a **Send test** button that verifies against the provider before anything
  relies on it. Tested against Google's live SMTP: placeholder credentials produce
  Google's own `535 BadCredentials`, correctly surfaced in the UI.
- `email.smtp_pass` is write-only: the API masks it, the audit log hides it.

### Added — documentation
- **`DEPLOYMENT_GUIDE.md`** (aaPanel edition) — server requirements, what to upload,
  ten-step deployment through the aaPanel control panel (App Store, Databases, Files,
  Website + reverse proxy + Let's Encrypt, Cron for the outbox drain and DB backups),
  PM2 processes, preflight, first-login checklist, EAS build for the mobile app.
  Plain-Ubuntu procedure kept as Appendix A.
- **`UPDATE_GUIDE.md`** — the zero-data-loss update procedure: backup → count →
  validate → migrate (old code still serving) → switch → verify; rollback is code,
  never data.
- An illustrated Word edition of both, with architecture/step/Gmail/update diagrams.

### Fixed
- **BUG-060 (High):** `system_settings.value` is LONGTEXT on MariaDB, and mysql2
  never parses it — every stored setting came back as raw JSON text. A stored string
  read back with literal quotes, and a stored `false` read back as the TRUTHY string
  `"false"`: an operator switching withdrawals off would not have switched them off.
  Values are now parsed on read.
- **BUG-061 (High):** parallel 401s each rotated the refresh token; the losers'
  refreshes failed and cleared the session — the admin panel signed its operator out
  every 15 minutes. Refresh is now single-flight.
- **BUG-062 (Medium):** the analytics series matched `DATE()` values (returned as JS
  Dates) against ISO day keys, so every chart drew zero while the totals above were
  right. One local-time formatter now builds both sides of the join.
- The environment's own clock: the machine's timezone changed mid-session while
  MariaDB kept the old zone cached, shifting every new timestamp three hours. Not a
  code bug — documented in both guides ("keep the server on UTC").

### Changed
- The admin panel Topbar and Sidebar now show the real signed-in admin, live queue
  badges, and a working sign-out. The "STAGING" badge says LOCAL, because it is.
- The health page is fully live (API, DB, Redis, outbox transport) — the last
  sample-data panels in the admin surface are gone.
- Currency rates in Rates & Methods edit `coins.rates` — the setting the purchase
  flow actually quotes from — instead of an empty table nothing reads.

### Testing
- 520 backend tests (13 new admin e2e), 70 smoke checks, 25 migrations validated,
  admin production build green, mobile and backend typecheck clean.
- Browser-verified end to end: login → dashboard → user drawer (warn action) →
  coin-purchase approval (coins credited) → announcement composed in the panel and
  read in the mobile app's inbox → SMTP configured, tested against Google, cleared.

---

## [0.13.0] — 2026-08-30 — Phase 13: Notifications, email and launch readiness

The last gap between "the platform did something" and "the person it happened to knows about it".

### Added — notifications
- **One entry point, `notify()`**, that every module calls. It applies the three rules once, so no
  caller has to remember them: preferences decide delivery, blocks apply, and nobody is told about
  their own action.
- **Per-channel preferences** for ten categories across in-app, push and email. Marketing is off on
  all three by default — consent is given, not withdrawn.
- **Quiet hours** suppress the push, never the record. The notification is still written and still
  appears in the inbox; a window crossing midnight (23:00–07:00) is handled as the common case it is.
- **Account and verification notices always reach the inbox**, whatever else is off. A suspension
  nobody can find is a suspension nobody can appeal.
- Inbox, unread count, mark-one-read and mark-all-read; device registration for push.
- `notify()` never throws. A stale push token must not roll back the like that caused it.

### Added — delivery
- **An outbox.** Every outbound message is a row written in the transaction that caused it and
  delivered later, so nobody waits on SMTP and a provider outage is not a broken signup. See
  ADR-039.
- **A row is claimed before it is sent** — a conditional `pending → sending` update — so several
  drains can run without sending anything twice.
- Failures back off and retry; after five attempts a row is `abandoned` rather than retried for ever,
  and kept rather than deleted.
- Plain-text templates rendered at send time, so a correction reaches messages already queued.
- **Push fails visibly.** With no provider configured it throws and the row records why, rather than
  reporting a delivery that never happened.
- `GET /admin/outbox` reports the backlog, the failures and — honestly — which transport is carrying
  messages. In this build that is `console`.

### Added — verification codes actually get sent
- **The gap carried since Phase 3 is closed.** `requestOtp` queues an email, keyed on the code's own
  row so a retried request cannot send two emails carrying different codes. The code still comes back
  in the response in development, and never in production.
- An address with no account queues nothing, and the response is unchanged either way.

### Added — launch preflight
- `npm run preflight` enumerates everything thirteen phases left behind and fails loudly: development
  secrets, unreachable infrastructure, unapplied migrations, placeholder payment accounts, money
  settings out of range, no administrators, an outbox backlog, localhost media URLs, wildcard CORS.
- Deliberately pessimistic: a check that cannot prove something is configured reports it as not
  configured. Exit code 1 means do not deploy.
- Current result against this machine: 13 pass, 2 warnings, 5 failures — Redis unreachable, no SMTP
  host, four payment methods still on placeholder details, no administrators, and
  `STORAGE_PUBLIC_URL` pointing at localhost. All correct.

### Fixed
- **A duplicate outbox message was reported as successfully queued.** `queue()` read `affectedRows`
  from an `ON DUPLICATE KEY UPDATE`, which the MySQL CLI reports as 0 for a no-op but mysql2's
  prepared statements report as a matched row. The dedupe worked; the answer about it was always
  wrong. It now comes from the database rejecting the insert.
- **A brand-new account displayed a verified badge.** `VerifiedBadge` returned `null` only for
  `'none'`, so an `undefined` tier drew a blue tick. It now renders only for a tier that means
  verified.
- **Every real account opened as the same invented person.** `getUser(id)` fell back to
  `currentUser` for any unrecognised id, so a profile opened from a notification showed a sample
  creator with 128K followers and 2.1M likes. Profiles now load from the server, and
  `GET /users/:handle` accepts a public id as well as a username — usernames are lowercase-only and
  a public id is uppercase Crockford base32, so the two cannot collide.
- **A profile with no videos was padded with six sample clips.** A real name above millions of plays
  belonging to nobody. An account the server answered for now shows an empty grid when it is empty.
- **Quiet hours could be written but not read**, so any screen showing them would have had to guess.

### Changed
- The notification settings screen is live. It previously held its switches in component state and
  saved nothing — flipping "marketing email" off told the user it was off and changed nothing. See
  ADR-040.
- The inbox activity tab reads the real inbox. Read state is marked on the server, so the badge is
  still right on the next device.
- `isDuplicateKey` has a canonical home in `core/db.ts`, with the reason `affectedRows` cannot be
  trusted recorded next to it.

### Database
- Migration `025_notifications_and_delivery.sql`: `notification_preferences`, `outbox`,
  `quiet_hours_start` / `quiet_hours_end` on `user_profiles`, and an index for the inbox query.

### Testing
- 507 backend tests, 70 smoke checks. Both green.

---

## [0.12.0] — 2026-08-29 — Phase 12: Verification, support and moderation

Identity, help and enforcement.

### Added — verification
- Apply for an individual, creator or business badge with identity documents.
- **Documents never come back through the API** — not to the applicant, not in the review queue,
  not as a URL. The only way to see one is a five-minute link signed to a named reviewer, and
  issuing it writes a security event naming who looked.
- **Documents are destroyed once the decision is final.** The decision row survives so it stays
  auditable; the passport does not. An hourly sweep catches files whose deletion failed.
- A document key that belongs to another account is refused, so a reviewer cannot be pointed at a
  stranger's ID.
- One open application at a time. A badge can also be revoked, separately from moderation, because
  losing a business badge is not a punishment.

### Added — moderation
- A report queue ordered by severity, then by how many separate people reported the same thing,
  then by age — so the oldest unactioned item is never starved.
- Eight decisions, each of which **actually enforces what it says**: a suspension suspends and ends
  every session; a removal removes; restricting distribution takes a video out of recommendations
  while leaving it with its creator.
- Every action names the administrator, requires a stated reason, and is reversible — and reverting
  restores what the action changed rather than only marking a row.
- Temporary restrictions lift themselves on a schedule, because one nobody lifts is a permanent one.
- **A ban deletes nothing.** Content, wallet and history stay exactly where they are; a ban is a
  loss of access, and reversing one has to be possible.

### Added — support
- Tickets with a conversation, reopened automatically when a user replies to a resolved one.
- **Internal staff notes are excluded in the query, not the mapping.** A user-facing read never
  fetches an internal row, so no later mistake can leak one.
- An internal note does not move a ticket to "waiting on the user" — nobody has answered yet.

### Added — reporting back
- A reporter can see the outcome of their report: reviewed, dismissed, or acted on. Not who decided
  it, not what was done, not anything else about the account.

### Fixed
- **A screen told an account it held an approved verification it had never applied for.** The
  shared data hook fell back to sample content whenever a live result was empty, which is right for
  discovery and wrong for anything belonging to the caller. Personal lists now report empty as
  empty; the fallback is opt-in per call.

### Known — still sample data
Notification preferences and OTP email delivery (Phase 13). Verification has no document-upload flow
on the mobile screen yet, so the live path refuses rather than submitting an application with no
evidence.

---

## [0.11.0] — 2026-08-29 — Phase 11: Promotion, ads and campaigns

Paid distribution, blended into the feed and labelled.

### Added — campaigns
- Create, review, pause, resume and stop. Nine objectives, targeting by country, language, age,
  interest and category, and a per-campaign daily cap.
- **The budget is held on creation.** A campaign takes its whole budget out of the wallet the
  moment it is made, so two campaigns cannot be funded from the same coins.
- **What is not delivered is returned.** Stopping, rejection and expiry all refund the unspent
  balance, because a campaign nobody saw earned nothing.
- An estimate before committing — a range with a caveat, derived from the real cost per impression
  rather than a number chosen to look attractive.
- Only a published, public video the caller owns can be promoted. Promoting a private video would
  show it to the people its owner excluded.

### Added — delivery
- Promoted items are selected after ranking, never inside it, so paid money cannot move an organic
  video's position. A campaign buys a slot of its own; it does not outbid someone else's relevance.
- **Every promoted item is labelled.** `isPromoted` travels from the delivery service through the
  feed to the client, which renders a SPONSORED badge.
- Never in the first slot. The first thing someone sees when they open the app is chosen for them,
  not bought.
- Density is a ceiling, not a target: fewer eligible campaigns simply means a more organic page, and
  the page still honours the size the client asked for.
- A frequency cap stops one campaign following a person around all day.
- Blocks, bans and privacy apply unchanged. Money does not buy past them.

### Added — charging
- Charged per delivered impression, recorded in `campaign_impressions` under a unique key on
  (campaign, viewer, impression) — so a replayed signal costs nothing.
- Budget and daily cap are re-read inside the charging transaction, so concurrent deliveries cannot
  push a campaign past either.
- Views are charged separately for view-priced objectives, once per delivery: a rewatch does not
  bill again. Clicks are recorded and never charged — the impression already was.

### Added — mobile
- Promote and Ads screens on the real API: real balance, real videos, a server forecast, and a
  launch that actually holds coins.

### Fixed
- **Campaigns delivered indefinitely for free.** `spent_coins` was a BIGINT while an impression
  costs a fraction of a coin, so every charge rounded to zero — spend never moved, and the budget
  exhaustion check therefore never fired. Widened to `DECIMAL(16,4)`.
- A page of `limit` items came back with `limit + n` once promotion was blended in. Promotion now
  takes a slot rather than lengthening the page.

### Known — still sample data
Verification and support (Phase 12); notification preferences and OTP delivery (Phase 13). Campaign
review is a manual admin queue — there is no automated policy check on creatives yet.

---

## [0.10.0] — 2026-08-29 — Phase 10: Wallet, coins and monetization

Money in, money out, and the two ways to earn without paying.

### Added — buying coins
- Coin packages priced from a configurable rate table, so a new currency is a setting rather than a
  migration.
- Manual payment methods — bank, Easypaisa, JazzCash, USDT — with the account details and the steps
  to follow held in the database, because a stale copy in the app sends money somewhere nobody is
  watching.
- **Coins are credited on approval, never on submission.** A request is a claim that money was
  sent, not proof of it.
- The rate is quoted at request time and stored on the row, so a request approved next week settles
  at the rate the buyer was shown.

### Added — withdrawals
- Payout methods with per-method minimums, fees and processing times, all configurable.
- **The balance is debited when the request is made, not when it is paid.** The request is the
  hold, which is what stops the same money being claimed five times before anyone looks at it.
- Rejection and cancellation both refund, because the money already left the balance.
- Only cleared gift earnings are payable. Coins and reward balance are spendable in-app and never
  convertible to cash.
- Destinations are masked when read back — a withdrawal history gets screenshotted.
- An administrator can approve, pay and reject, each claimed with a conditional update so two
  people clicking at once produce one outcome.

### Added — earning
- Daily tasks whose **progress is measured, never submitted**. Each task names a metric the server
  already counts; a task nobody can verify cannot be defined.
- The target and reward are frozen onto a progress row the first time it is seen, so changing a
  task mid-day does not reduce what someone was already working towards.
- Rewards land in the reward balance, which converts to coins one way at a configurable rate and
  never becomes cash.
- Referral codes, and a reward that **qualifies on an action rather than a signup** — otherwise the
  platform pays for account creation.

### Added — wallet
- `GET /me/wallet` and `/me/wallet/ledger` — the balance and the append-only history behind it.
- `npm run clearing:release` releases gift earnings whose holding period has elapsed.
- `npm run seed:monetization` seeds packages, methods and tasks. Account numbers are obvious
  placeholders; a deployment sets the real ones from the admin panel.

### Added — mobile
- Wallet, buy coins, withdraw, daily tasks and referrals on the real API, each labelled.

### Fixed
- **Coin purchases could not be made while the cache was down.** The route failed closed because a
  purchase request wrote no ledger row to match a retry against — which was a reason to add the
  column, not to refuse the request. `coin_purchase_requests` now carries the key under a unique
  index and the route is durable, in line with ADR-032.
- **The wallet showed 0 live gift coins as "≈ $684.00".** The balance came from the server and the
  estimate beside it from the sample data. The payout rate now travels with the balances, so the
  two cannot disagree.
- **A genuine zero was replaced by sample data.** `earnedToday || walletBalances.todayEarned` meant
  "you earned nothing today" displayed as 310 — the one case where the number is most likely to be
  read carefully.
- The daily tasks screen showed a live task list beside a sample reward balance and a sample
  referral count. All three now come from the same place.

### Known — still sample data
Promotion, ads and campaigns (Phase 11); verification and support (Phase 12). No payment gateway is
connected: every method is a manual transfer an administrator confirms, which is deliberate for this
market but means nothing settles automatically yet.

---

## [0.9.0] — 2026-08-29 — Phase 9: Live streaming and gifting

Broadcasts, live chat, and the first path that moves real value between two people.

### Added — live streaming
- **Start, watch and end a broadcast.** The application never carries video: it issues the ingest
  credential, records what happened, and fans out everything that rides alongside the stream.
- **A stream key is a credential**, so it is generated once, returned once, and stored only as a
  SHA-256 hash. It expires, and ending a stream destroys it — a finished broadcast cannot be
  resumed with an old key.
- **Live chat, likes and viewer counts**, all derived from rows the server wrote. A client cannot
  report how many people are watching, and cannot claim an arbitrary number of likes: each call is
  capped and the stream total is recomputed from per-viewer rows.
- Hosts can see who is watching and remove someone; nobody else can enumerate the audience.
- An administrator can stop a stream. That is a distinct state from the host ending it, the reason
  is recorded, and the host cannot undo it.

### Added — gifting
- **The full money path**: sender's coin debit, creator's credit, gift record and clearing row, all
  in one transaction. A gift moves value or it moves nothing.
- **The platform share is configuration**, read per transaction and recorded on the row, so a
  creator can be shown the split that applied to *their* gift rather than today's setting.
- **Creator earnings are held before they can be taken.** `gift_clearing` holds the share for a
  configurable period, because a gift bought with a stolen card is charged back days later.
- **A retried gift charges once.** `gift_transactions` carries the caller's idempotency key under a
  unique index, so the guarantee holds when the cache does not.
- Gifting yourself is refused: it would turn coins into withdrawable balance, which is a cash-out
  route around the payout rules rather than a gift.
- A gift attributed to a stream must go to that stream's host, so a stream's totals cannot be
  inflated by a gift that had nothing to do with it.

### Added — wallet
- `GET /me/wallet` and `GET /me/wallet/ledger` — the balance, and the append-only history behind
  it. Reads only: everything that moves value lives with the reason for the movement.

### Added — mobile
- Live list, viewer and broadcast screens on the real API, with live chat, likes and gifts.
- The gift sheet shows the real catalogue at real prices and the balance that will actually be
  charged.

### Fixed
- **Chat sends took seconds with the cache unavailable.** Idempotency and presence called Redis
  directly, so a dead cache added its full connect-retry backoff to every message. Routed through
  the guarded cache: 36s per operation down to 0.15s. The same class as the rate limiter and the
  cache before it — this time the fix was applied to the pattern rather than the instance.
- **Message idempotency existed only in Redis**, so a retry after a dropped connection double-posted
  whenever the cache was down — which is exactly when clients retry. The key is now a unique index
  on `messages`, with the cache as a fast path.
- **The idempotency middleware hung for twelve seconds** on a dead cache before failing. Bounded to
  250ms, and a route whose handler carries its own durable key now continues instead of refusing
  (ADR-032).
- **A cheap gift under a high platform share credited the creator zero and failed the whole gift**
  with "Amount must be a positive number". The split is computed from the platform's cut so binary
  floating point cannot eat the creator's last coin, and a zero share records the gift rather than
  rejecting it.
- **Live screens fabricated their own engagement.** The viewer count was nudged by a timer every two
  seconds, the broadcast screen invented gift income, and the comment stream replayed scripted
  chatter over real conversations. All three now show what the server measured, and the sample
  replay stops the moment real data arrives.
- Settings typed as their literal defaults, so `getSetting('monetization.enabled') === false` failed
  to compile — a comparison that was correct, against a value an administrator can change.

### Known — still sample data
Wallet top-up, withdrawals, promotion, ads, daily tasks and referrals (Phase 10–11); verification
and support (Phase 12). Media ingest is deployment: the application issues credentials and records
the broadcast, but no media server is running locally.

---

## [0.8.2] — 2026-08-29 — The rest of the UI talks to the backend

Discovery, search, the social graph, privacy, security and the creative catalogue now run against
the real API. What remains on sample data is the work of phases that have not started, and every
one of those surfaces says so on screen.

### Added — backend
- **Discovery reads:** videos in a category, videos under a hashtag, trending videos, and featured
  creators. All four apply the same visibility rules as the feed — published, public, processed,
  and nothing from an account either party has blocked.
- **Search** across accounts, videos and hashtags. Wildcards in the search term are escaped, so
  searching `%` matches nothing rather than everything.
- **`GET /me/reports`** — the reports you filed, and what came of them. Someone who reports content
  is entitled to know the outcome; that is the difference between a report and a suggestion box.
- Trending, creators and search results carry the viewer's relationship to each account, so a
  follow button shows the state the account is actually in.

### Added — mobile
- **Discovery** — Explore, Categories, Category feed, Hashtag and Search are live. Explore is
  labelled section by section, because some of its sections have a backend and some do not.
- **Search** is debounced and ordered: one request per settled term rather than one per keystroke,
  and a slow response for an earlier term can no longer overwrite a newer result.
- **Privacy** is live, and audience settings are rendered as three-way choices rather than
  switches. The server stores everyone / followers / no one, and a two-state switch cannot express
  the middle value — showing "followers" as an ON toggle would mean turning it off and on again
  silently widens the audience to everyone.
- **Login activity** and **Change password** — two rows in Settings that did nothing while the
  endpoints behind them already existed. Sessions can be ended individually or everywhere, and
  recent security events are listed.
- **Connections**, **Edit profile**, **Your reports**, **Stickers**, and the **OTP** and
  **password reset** flows are live. With no mail server yet, the development build shows the code
  the API issued, labelled as a development aid.
- One `SourceNote` / `SourceTag` component behind every live-or-sample label, so the wording and
  colour are the same on every screen (ADR-028).
- `useCurrentUser` — one answer to "who is signed in". Settings was greeting one person while the
  profile tab showed another.

### Added — tooling
- The demo seed now builds a **real follow graph** and recomputes follower, following, video and
  like counters from the rows that exist. A profile claiming 12.4K followers with an empty
  followers list is worse than one that says 5 and can prove it.
- Demo videos carry hashtags, and a music library of eight tracks with four trending.
- Migrations 017 and 018 give every category an icon and colour, so a category added in the admin
  panel is drawable by the app without a release.

### Fixed
- **The migration validator could be made to miss a destructive statement.** Comment stripping ran
  before string blanking, so a `#` inside a string literal was read as a comment and swallowed the
  rest of the line — including its semicolon and anything after it. `INSERT INTO t VALUES ('#x');
  DROP TABLE users;` presented one statement to the rules, and the DROP was not in it. Replaced
  with a single scanner that tracks string, identifier and comment state. Nine regression tests.
- **The feed could return an empty page.** A viewer who had seen everything hit the "seen twice"
  rule on every candidate and got a blank screen, which reads as a broken app rather than as a
  compliment about how much they had watched. When, and only when, that rule alone empties the
  pool, it is relaxed and the least-seen videos come back first. Blocks, hidden creators and
  suppressed categories are not part of the retry and can never be relaxed by it.
- **Follower and following lists never showed who you already follow.** The endpoint took the
  viewer's id and used it only to filter blocks, so every row rendered "Follow" — including for
  accounts the viewer already followed. The relationship now comes back with the row.
- **The music library was fetched and then discarded.** Its `useMemo` omitted the request state
  from its dependencies, so the list was computed once against empty data and never recomputed.
  The screen showed sample tracks while holding the real ones.
- The favourite button on a music track rendered its state and did nothing on press. Favourites
  are per-account, which is the only reason the field exists.
- Search offered to let you follow your own account.
- Horizontal chip rows stretched to fill the remaining height on web, leaving a large gap under
  the tabs on the music and sticker screens.

### Known — still sample data
Wallet, coins, withdrawals, promotion, ads, daily tasks, referrals and creator earnings; inbox,
chat, communities and calls; live streaming; verification and support. Each has a backend phase
ahead of it, and each screen is labelled rather than left to look finished.

---

## [0.8.1] — 2026-08-29 — The UI talks to the backend

The app now runs against the real API instead of sample data.

### Added — mobile
- An API client with token storage, transparent token refresh, and the shared response envelope
  unwrapped in one place. Concurrent requests share a single refresh, so a burst of 401s cannot
  rotate the refresh token against itself and trip the server's reuse detection.
- A session provider backed by real accounts: sign in, sign up, sign out, and session restore on
  reload. A restored session opens straight on the feed instead of onboarding.
- The For You feed reads live recommendations, adapted to the components built in Phase 1 so the
  existing UI works unchanged.
- Every surface distinguishes live, sample and offline, and says which it is showing (ADR-028).

### Added — admin
- A backend client, and the System Health page reading real API, database and Redis status. The
  panel is labelled, and states plainly that every other figure on the page is sample data.

### Added — tooling
- `npm run seed:demo` creates six creators and 48 published videos, including one creator with 12
  followers so the new-creator exploration budget has something real to surface.

### Fixed
- **A dead Redis made every rate-limited route take twelve seconds.** The limiter caught the error
  but had already spent the retry backoff, so signing in took twelve seconds instead of failing
  open immediately. Now bounded at 150ms with a circuit breaker: login dropped from 12s to 0.3s.
- An unrendered video passed an empty string as a media source, which makes a browser re-download
  the whole page. The player is now given null and the poster carries the frame.
- The admin client treated `/ready`'s 503 as a failure. That endpoint deliberately answers 503 when
  a dependency is down — orchestrators need a non-200 — while returning a well-formed success
  envelope, because "not ready" is a successful report. It now reads the body regardless of status.
- The demo seed pointed at storage paths that do not exist, giving broken images and making object
  storage look wired up when it is not. Demo rows now carry no poster key at all.

---

## [0.8.0] — 2026-08-29 — Phase 7: Recommendation engine

The For You feed.

### Added — three-stage ranking
- **Candidate generation** from eleven parallel pools: following, creator affinity, interests,
  similar videos, similar users, trending, fresh, new creators, discovery, language and category.
  800 candidates by default, capped per pool, and a failing pool costs variety rather than the feed.
- **Scoring** through the ML service where available, with a real weighted ranker as the production
  fallback. Responses are validated rather than trusted — a model returning NaN or scoring only
  part of the page is treated exactly like one that is down (ADR-026).
- **Re-ranking** for diversity, with hard constraints that no score can argue past: blocked and
  hidden creators, rejected categories, already-seen videos, unprocessed and private content.

### Added — fairness
- New creators get a reserved share of every page, defaulting to 10% and admin-configurable
  (ADR-010). Newcomers score lower because they have no engagement history, so the slots are filled
  explicitly after the constraints — a floor, never a ceiling.
- Technical quality can move ranking by at most ±5%. A well-matched video shot on a cheap phone
  outranks a pristine irrelevant one even at the maximum quality weight (ADR-011).

### Added — progressive distribution
- Five levels from a small test audience to trending. **Performance alone decides** — not follower
  count, not account age. A video from an account with eleven followers reaches broad distribution
  on the same numbers as one from an account with a million.
- Videos are demoted as well as promoted, and every move records the metrics that justified it, so
  "why did my video stop being shown" is answerable months later.

### Added — admin control
- 27 ranking weights, every one bounded. A mistyped exploration rate of 100 instead of 0.10 is
  rejected rather than saved.
- Changes take effect immediately — the cache is dropped on write, not left to expire.
- Every change is audited with its previous and new value, and a stated reason is required.
- An explain endpoint returning the full reasoning behind a feed, including per-stage timings.

### Fixed
- **Privilege escalation in admin authorisation.** Admins were resolved by matching
  `admin_users.id` against `users.id` — two independent auto-increment sequences. Any ordinary user
  whose id happened to collide with an admin row's would have inherited that admin's permissions.
  The link is now explicit.
- The diversity backfill ignored the category cap, letting one category take 60% of a page whenever
  the primary pass fell short.
- A single-creator candidate pool collapsed to one item instead of filling the page.

### Testing
- 327 tests passing, stable across repeated runs.
- The live smoke test now covers all seven phases: 59 checks against a booted server.

---

## [0.7.0] — 2026-08-29 — Phase 6: Behaviour intelligence

The substrate the recommendation engine will consume.

### Added — event ingestion
- The full taxonomy: 23 events across exposure, watch, rejection, engagement, graph and navigation.
- Batched delivery with client-generated dedupe keys, because a phone sending one request per
  scroll would flatten its own battery.
- **Exactly-once under retry.** Deduplication keys on the client's event timestamp rather than
  arrival time, so a retry carries an identical pair and is rejected by the index. Verified under
  repeated retry and under concurrent delivery.
- A malformed event no longer costs the rest of its batch.

### Added — watch interpretation
- ADR-009 applied server-side: under 20 seconds completion is the signal; 20–30 seconds a
  20-second watch is a strong positive; beyond that, 30 seconds is. The client reports
  milliseconds and never decides what counts as a view, so the rule can change without an app
  release and cannot be inflated by a modified client.
- A quick skip is recorded as negative evidence, not merely a weak positive.

### Added — derived profiles
- Interest profiles on two horizons: short-term with a 3-day half-life that reacts within a
  session, long-term with a 60-day half-life that survives an unusual evening. Blended at read
  time so the balance stays tunable.
- Multi-segment membership across 18 seeded segments, weighted rather than flagged, and lapsing
  without reinforcement — nobody is filed permanently under a category they watched once.
- Creator affinity per viewer/creator pair, time-decayed, weighted toward deliberate acts.
- Video audience profiles: which segments actually engaged, observed rather than declared.
- The eight-tier priority distribution order, de-duplicated across tiers and respecting blocks.

### Added — privacy (ADR-025)
- Collected fields are an allowlist, so an unanticipated field is dropped whether or not anyone
  thought of it.
- A separate denylist rejects a batch outright if it carries anything sensitive, and logs it. The
  allowlist is the protection; this is the alarm — silently stripping would hide a client that is
  trying to send it.
- Screening runs on the raw body, before schema validation, because validation strips unknown keys
  and would otherwise erase the evidence.
- Search text is scrubbed of anything resembling an email address or phone number.

### Fixed
- **Interest profiles were never populated from video events.** The category was read only when a
  client sent one explicitly, but for a video event it belongs to the video — so watching, liking
  and saving contributed nothing to a profile, which is the entire point of collecting them.
- **Every priority-audience tier silently returned nobody.** The query referenced a SELECT alias in
  its WHERE clause, which MariaDB rejects; the error was caught and logged, so a broken tier looked
  exactly like a creator with no audience. It now rethrows.
- Sensitive fields were stripped by schema validation before the privacy check ran — safe, but
  invisible.

### Testing
- 255 tests passing, stable across repeated runs.
- The live smoke test now covers all six phases: 51 checks against a booted server.

---

## [0.6.0] — 2026-08-29 — Phase 5: Processing and streaming

An upload now becomes adaptive, privacy-aware playback.

### Added — validation
- Magic-byte checking before anything opens a file as media. A client's declared content type is a
  claim, not a fact; executables are rejected whatever they are labelled.
- ffprobe inspection for duration, codec, frame rate and audio presence, degrading honestly to
  "not probed" rather than inventing values when the tool is absent.

### Added — transcoding and delivery
- An adaptive ladder from 240p to 1080p that never upscales past the source.
- Identical keyframe intervals across every rendition, with scene detection disabled — without
  that, adaptive switching either stalls or silently never happens.
- HLS segmentation plus a generated master playlist, ordered cheapest-first so a player that has
  not yet measured the connection starts with the stream most likely to play immediately.
- Poster frames and cover candidates, sampled past the black frames videos tend to open on.

### Added — quality scoring
- Decomposed scores: technical, content relevance, thumbnail, caption, spam, duplicate, safety.
- **ADR-011 enforced in code, not just documented.** `canSuppress` reads only spam, duplicate and
  safety, so the technical score is structurally incapable of suppressing anything, and technical
  quality can move ranking by at most ±5%. A video recorded on a cheap phone cannot be buried for it.

### Added — pipeline
- Eight recorded stages, each atomically claimed, so two workers cannot run the same one.
- Resumable: a worker killed mid-stage leaves a known state and the next resumes exactly there.
- Stall sweeping for stages a dead worker left claimed.

### Added — playback
- Privacy enforced server-side: public, followers, mutual friends, private, plus blocks in either
  direction. A viewer who may not watch gets 404, never 403.
- Signed URLs for restricted media, binding key, expiry and viewer together so none can be altered.
  Public media stays unsigned so it remains cacheable at the edge.

### Added — admin
- Reprocess and rescore, audited, with the original upload never touched.

### Fixed
- **A slow render stranded a video permanently.** Polling the render stage consumed a retry attempt
  each time, so three polls — about fifteen seconds — exhausted the budget with nothing having
  failed. Waiting is now distinguished from attempting.
- **A video could read as failed and processing at once.** A stage failing without throwing skipped
  the reconciliation that updates the video's own status.
- **A failed video was served as playable**, with `ready: true` and a null URL.
- **Videos were published before they were transcoded**, exposing a video with no renditions and no
  manifest.
- **The render worker wrote an invalid `video_assets.kind`.** Before strict SQL mode it was stored
  as an empty string, making the asset invisible to the pipeline and stalling it with no error.
- `technicalRankingAdjustment(NaN)` returned NaN, which would poison every ranking comparison it
  touched without ever throwing.
- `closeRedis()` hung when Redis was unreachable — `quit()` queues behind a connection that never
  opens. The same hang would have blocked the API's graceful shutdown.
- Publishing with privacy "followers" silently stored "friends", giving the video a different
  audience than the creator chose.

### Testing
- 189 tests passing, stable across repeated runs.
- A live smoke test walks two users through every phase against a booted server. Four of this
  release's six bugs were found there rather than by the suites — they only appear once the pieces
  are wired together with a real job in the queue.

---

## [0.5.0] — 2026-08-29 — Phase 4 backend: creation pipeline

The whole server side of creating a video: upload, edit, render, publish.

### Added — the shared parameter set
- `ColorGrade`: eleven controls in plain user-facing units, read by both the device's GPU shader
  and the server's FFmpeg graph. Neither renderer owns the numbers, which is what makes the
  preview and the final render agree (ADR-021).
- All 20 required filters, expressed as grades and seeded as data rather than code.
- 13 effects, 2 sticker packs, 6 fonts, 11 manual adjustment controls.
- A cached, versioned catalogue endpoint. Adding or retiring a filter is a database write that
  takes effect immediately — no app release.

### Added — upload
- Resumable chunked upload. Chunks may arrive in any order, a re-sent chunk is a harmless no-op,
  and a client that lost its connection asks which chunks are missing and sends only those.
- Size, duration and format limits read from admin settings.
- Optional SHA-256 verification of the assembled file.
- Chunk size is configurable.

### Added — editing and rendering
- A strict edit-list schema: bounded numbers, stripped unknown keys, coherence checks, and
  ownership enforcement so an edit cannot reference media the caller did not upload.
- EDL → FFmpeg translation covering trim, speed, rotation, crop, per-clip and timeline grades,
  text overlays, and multi-track audio mixing.
- A render queue with atomic job claiming, progress reporting, retry limits and stall recovery.
- A background worker process, separate from the API.

### Added — drafts and publishing
- Server-side drafts: private, soft-deleted, and proven to survive a client with no local state.
- Publishing creates the video and its render job atomically; the video stays hidden until a
  playable file exists.
- Hashtags and mentions extracted from the caption and linked.

### Added — music
- Library with search, categories, trending and per-user favourites.

### Added — tests
- 26 new tests, 117 in total. 41 of them are pure unit tests over the grade mapping and edit-list
  validation, running in 0.6 seconds with no database, server or FFmpeg.

### Fixed
- **Silent data corruption.** MariaDB's default `sql_mode` is permissive, so an invalid ENUM value
  was written as `''` instead of being rejected — six catalogue rows were created that no query
  filtering by kind could see. Strict mode is now set on every connection (ADR-022).
- **A Redis outage made everything slow instead of uncached.** Each cache write against an
  unreachable server blocked for around twelve seconds; catching the error did not help, because
  the retry backoff had already been spent. Cache access is now bounded and breaker-protected
  (ADR-023).
- **No upload could store a chunk.** Chunk keys embed an upload's ULID, which is uppercase Base32,
  but the storage key validator only accepted lowercase.

### Security
- Edit lists are the highest-risk input in the application: they arrive from a client and drive a
  server-side FFmpeg process. Every field is bounded, storage keys are checked for traversal,
  overlay text is escaped for FFmpeg's filter-graph parser, and FFmpeg is spawned without a shell.
- Storage keys are always generated server-side and never taken from a request.

---

## [0.4.0] — 2026-08-29 — Phase 3: Authentication and users

Real accounts, real sessions, real profiles. The API now has a working identity layer.

### Added — authentication
- Registration with Argon2id hashing, a 13+ age gate, weak-password rejection and reserved-username
  protection.
- Email verification, password reset and login codes: six digits, single use, ten-minute expiry,
  five attempts, sixty-second resend cooldown. Stored hashed and compared in constant time.
- JWT access tokens plus rotating refresh tokens bound to a device record.
- **Refresh-token reuse detection.** Rotation chains share a family; replaying an already-rotated
  token revokes every session in that family.
- Sign-in lockout after 8 failures against one email within 15 minutes.
- Session list and per-session revocation, effective on the next request rather than at token expiry.
- Password change keeps the current session and ends all others; a reset ends every session.

### Added — profiles and accounts
- Own profile, public profile, display name, bio, avatar and links.
- Ten account types across individual and business categories, switchable at will.
- Business profile: category, website, contact details, call-to-action.
- Privacy settings — who can comment, message and duet, and whether downloads are allowed.
- Username availability with confusable matching, so a lookalike of a reserved name is refused too.
- Retired usernames cannot be claimed by anyone but their previous owner.

### Added — social graph
- Follow and unfollow with transactional counter updates.
- Block and unblock. Blocking is bidirectional, severs both follow directions, and hides the
  blocker entirely — a blocked viewer gets 404, never 403.
- Blocked list, and reporting for users, videos, comments, streams, communities and messages.

### Added — safety and audit
- `security_events`: an append-only record of every authentication action, readable by the account
  owner. No delete path exists anywhere in the codebase.
- `username_history`, so a released username is never recycled to a stranger.

### Added — tests
- 23 end-to-end tests driving real HTTP against the real database, covering every Phase 3 exit
  criterion. Total suite: **50 passing**.

### Fixed
- **Refresh-token reuse detection did not work.** The family revocation ran inside the transaction
  the function then threw from, so it was rolled back — the defence detected theft, logged it, and
  left the stolen token live.
- **Only one session could ever be created.** `refresh_token_hash` is UNIQUE and the session row was
  inserted with a fixed placeholder before the token existed, so the second session collided.
- **Unknown refresh tokens locked out sign-ins.** A `FOR UPDATE` lookup that matched nothing took an
  InnoDB gap lock on the unique index, blocking every concurrent session insert until the
  transaction ended. Since unknown and expired tokens are the common case, junk traffic alone could
  have stalled sign-ins.
- The root `typecheck` script never checked anything for mobile or admin. It ran tsc from the repo
  root, where there is no tsconfig, so tsc printed its help text and exited 0.

### Changed
- `AccountKind` in the shared contracts is replaced by `AccountCategory` plus `AccountType`, matching
  the database and the mobile app — which had agreed with each other but not with the contract.
- Integration tests run one file at a time. In parallel they contended on database locks and hit
  MariaDB's 50-second lock-wait timeout.

---

## [0.3.0] — 2026-08-29 — Phase 2: System architecture

The backend exists and runs. Schema, migration tooling and the money core are in place and
verified against a real database; feature endpoints arrive in Phase 3.

### Added — database
- 89 tables across six migrations: identity and graph, content and creative, engagement and
  intelligence, messaging and realtime, wallet and monetization, growth/trust/platform.
- `watch_events` and `impressions` are range-partitioned by day — they grow fastest and are
  queried by recency.
- Four separate wallet balances with a `CHECK` constraint forbidding a negative balance, plus an
  append-only `wallet_ledger` carrying balance-before and balance-after on every row (ADR-013/018).

### Added — migration tooling
- Forward-only runner with `status`, `validate`, `up` and `verify`. There is deliberately no
  `down`: a rollback that drops a column destroys user data.
- A validator that refuses to run destructive SQL — `DROP TABLE`, `TRUNCATE`, `DROP DATABASE`,
  unbounded `DELETE`/`UPDATE`, dropping or renaming a column on a user table, adding `NOT NULL`
  without a default, and narrowing a column type.
- Row-count snapshots taken before every run and verified after, so data loss is detected rather
  than discovered later.
- Applied migrations are checksummed; editing one after it has run is refused.

### Added — backend skeleton
- Express 5 + Socket.IO on Node 24, ESM throughout.
- Core: schema-validated config, bounded health probes, pooled MySQL with a transaction helper,
  Redis, cursor pagination with signed cursors, and DB-backed settings cached in Redis (ADR-015).
- Middleware: error envelope, Zod validation, JWT auth, admin RBAC, audit trail, Redis rate
  limiting, and idempotency on money routes (ADR-020).
- The ledger service — the only code permitted to change a balance.

### Added — shared contracts
- `shared/contracts/` — one set of API types consumed by the backend, the mobile app and the
  admin panel. Types only, no build step.

### Added — tests
- 27 tests, all passing: 16 on the migration validator, 11 on the ledger against a real database,
  including concurrent-debit safety and reconciliation drift detection.

### Fixed
- The type-narrowing migration rule never fired. Its pattern ended in ``, which cannot match
  after a type closing in `)`, so `VARCHAR(20)` and `CHAR(10)` narrowing passed silently.
- `/ready` could hang for six seconds or more while the Redis driver retried a dead connection.
  Both dependency checks are now bounded, so the probe answers in under a second.

### Changed
- Collation moved from `utf8mb4_0900_ai_ci` to `utf8mb4_unicode_ci` so the same schema runs on
  MySQL 8.4 and on the MariaDB 10.4 that XAMPP ships (ADR-019).

---

## [0.2.1] — 2026-08-29 — Admin monetization modules

Completes the operator half of 0.2.0 — the monetization system can now actually be run.

### Added — approval queues
- **Coin Requests** — manual payment verification queue. Shows payment proof, transaction
  reference, and the risk signals a reviewer needs (account age, previous purchases, report
  count, unusual amount). Approve credits coins instantly; reject requires a reason.
- **Withdrawals** — creator payout queue with fee breakdown and net payout, destination address
  shown in full for verification, identity-verified flag, live gift balance and balance-after,
  and the full lifecycle (pending → under review → approved → paid / rejected).

### Added — configuration
- **Criteria & Creators** — edit every monetization threshold (followers, views, likes, videos,
  watch time, account age, referrals, verification), toggle requirements on/off, plus payout
  settings (withdrawals master switch, minimum, clearing period, creator gift share) and reward
  economy (reward→coin rate, gift coins per USD, daily reward cap). Second tab reviews creators
  and their progress, with enable / suspend / reinstate.
- **Daily Tasks** — edit each task's target and reward, enable/disable, see completions and coins
  paid in the last 24h. Referral programme config (reward per referral, daily target,
  qualification rule) and abuse controls (daily cap, master switch).
- **Rates & Methods** — currency conversion rates with a **live calculator preview** mirroring
  exactly what the app quotes, payment methods (EasyPaisa, JazzCash, bank, USDT, card) with
  account details and manual/automatic flag, and payout methods with minimums and fees.

### Changed
- New "Monetization" sidebar group with live badge counts for pending coin requests and
  withdrawals.

### Verified
- `tsc --noEmit` clean; `next build` passes with all **35 routes** prerendered.
- Nav hrefs diffed against the route folder — exact match, no dead links.
- Both queues render with real review context; the seeded fraud case
  (10,000 coins, 0 previous purchases, 12-day-old reported account) surfaces its risk flags.

### Notes
- Cost visibility built in: the tasks screen shows daily coin issuance and its cash equivalent,
  because reward changes multiply across every completing user.

---

## [0.2.0] — 2026-08-29 — User monetization, tasks, coins and gifting

### Added — wallet model
- **Four separate balances** (ADR-018) — coin, reward, live gift, withdrawable — that never merge.
  Only live gift earnings ever become payable; task and referral rewards stay inside the app.
- Every ledger row now carries a `wallet` field, so no transaction is ambiguous about which
  balance it moved. Fiat leg (`amount` + `currency`) recorded for purchases and payouts.

### Added — screens (`mobile/src/screens/money/`)
- **Monetization** — live progress against every criterion (followers, views, likes, videos,
  watch time, account age, referrals, verification) with a percentage hero and "closest to done"
  shortlist. Thresholds are config, not constants.
- **Daily tasks** — task cards with progress, reward in coins and cash-equivalent, countdown to
  reset, and claim flow. Separate "ready to claim", "in progress" and "completed" groups.
- **Referral** — invite code and link, today's referral task progress, qualified vs pending
  breakdown, per-referral reward, and the referral list.
- **Live gift earnings** — gift coins received, estimated USD value, clearing and pending amounts,
  weekly trend, recent gifts and top supporters.
- **Withdraw** — USDT / bank / mobile-wallet payout with per-method minimums, fee breakdown,
  "you receive" preview, confirmation step and full status history
  (pending → under review → approved → paid → rejected).
- **Buy coins** — rebuilt: multi-currency calculator (USD, PKR, INR, USDT, AED) with live
  conversion and the active rate on screen, coin packages re-priced into the chosen currency,
  manual payment methods (EasyPaisa, JazzCash, bank transfer, USDT TRC-20) with per-method
  instructions, transaction-ID entry, screenshot upload and an approval-status request list.

### Changed
- **Wallet** rebuilt around the four balances, with a reward→coins converter and a legend
  explaining what each balance is for.
- **Transactions** now filter by wallet rather than by loose type grouping, and show the wallet
  plus the fiat leg on each row.
- Entry points added from Profile menu, Settings and the Creator dashboard revenue tab.

### Documentation
- ADR-018 — four separate balances; only live gift earnings are payable.

### Verified
- `tsc --noEmit` clean.
- Rendered and checked against the brief's own examples: monetization shows 750/1,000 followers,
  8,500/10,000 views, 85/100 likes; daily task shows "Get 100 likes 67/100 · $2.00"; referral task
  shows 3/5; the coin calculator converts PKR 2,000 → 700 coins at the displayed 0.35 rate.

### Notes
- User side only, as requested. Manual payment approval and withdrawal approval need the admin
  counterparts listed under Unreleased before this can be operated for real.

---

## [0.1.1] — 2026-08-29 — Feed scroll fix + responsive web layout

### Fixed
- **Feed overlay disappeared while scrolling.** The like/comment/save/share bar, author row
  and caption vanished on the 2nd video onward. Two compounding causes:
  1. `pagingEnabled` snapped to the **container** height while `snapToInterval` snapped to a
     **computed** height — the two fought and the offset drifted.
  2. That computed height came from `Dimensions.get('window')` captured once at module load,
     minus a guessed tab-bar height, so it never matched the real viewport and never updated
     on resize.

  `VerticalFeed` now measures its own container with `onLayout` and uses `pagingEnabled` alone.
  Verified: pages snap exactly (scrollTop is always a clean multiple of the page height) and all
  four action counts render inside the viewport on every video.
- Inbox unread badge collided with the sidebar label — replaced the hand-placed overlay with
  React Navigation's `tabBarBadge`, which positions correctly in both bar orientations.
- Onboarding paging used the same stale-`Dimensions` pattern and broke on window resize.

### Added
- `useResponsive()` / `useContentWidth()` / `useGridTileWidth()` hooks built on
  `useWindowDimensions`, so layout tracks the live viewport.
- **Desktop web layout** (≥1024px), distinct from the phone UI per ADR-016:
  - Navigation becomes a **left sidebar** (`tabBarPosition: 'left'`) instead of a bottom bar.
  - The feed renders a **centred 9:16 card with a vertical action rail beside it** rather than a
    full-bleed phone screen stretched across the monitor.
  - `Screen` centres content in a max-width column, with a `fullBleed` opt-out.
  - Bottom sheets become centred panels with a max width.
- Every grid (explore, search, profile, drafts, effects, stickers, upload, live, gifts, calls)
  now sizes tiles from the available content width instead of the raw window width, so nothing
  overflows the desktop column.

### Notes
- Native builds always render the phone layout regardless of reported width — the desktop
  branch is web-only.

---

## [0.1.0] — 2026-08-29 — Phase 1: Mobile + Admin UI

### Added — Mobile (`mobile/`)
- Expo SDK 57 / React Native 0.86 / TypeScript app with `expo-dev-client`-ready config.
- Design system in `src/theme/tokens.ts`: compact type scale, dark + light palettes, spacing,
  radii, shadows, gradients.
- Mock data layer (`src/mock/`) shaped like the future API: users, videos, social, creative
  assets, money, discovery, account.
- Shared component library: Text, Pressable, Screen/Header, Button, Input/OtpInput, Avatar,
  Chip/Segmented/Tabs/Toggle/Slider, ListRow/Card/EmptyState, Badge/Stat/VideoTile, Sheet, charts.
- Feed system: snap-scrolling `VerticalFeed` with a 3-item preload window, `FeedVideoItem`
  (double-tap like, tap to pause, mute), comments sheet, share sheet with negative-signal actions.
- All 55 screens: auth (6), feed and discovery (9), creation (14), profile (4), inbox (1),
  chat and communities (7), calls (4), live (4), money (8), account (7).
- Typed navigation graph — root native stack plus bottom tabs; every screen reachable.
- Native permission handling for camera and microphone, with a graceful denied state.

### Added — Admin (`admin/`)
- Next.js 16 / TypeScript / Tailwind v4 panel with a desktop-first shell: persistent grouped
  sidebar (collapsible, badge counts) and sticky top bar (breadcrumb, global search, environment
  badge, health indicator, notifications, role preview).
- Admin design tokens matching the mobile brand at a denser, data-first scale.
- Inline icon set (~55 glyphs) and a component library: Stat, Table/Row/Cell, Badge, Tabs,
  Toggle, Slider, charts, Notice, KeyValue, master–detail inspector panels.
- All 30 modules: Dashboard, Analytics, System Health, Users, Verification, Roles & Permissions,
  Videos, Comments, Categories, Hashtags, Filters & Effects, Music, Live, Chat & Communities,
  Moderation, Coins, Gifts, Payments, Ad Campaigns, Boost Settings, Recommendation, AI Models,
  Notifications, Banners, Support, Feature Flags, App Settings, Regions, Security, Audit Log.

### Changed
- **Visual identity** moved off the category leader's palette and layout signatures (ADR-017):
  violet `#7C5CFF` + mint `#3DDC97` replace red/cyan; the feed's right-hand action rail became a
  horizontal glass action bar; the spinning sound disc became a sound pill with a live equalizer;
  centred underlined feed tabs became a left-aligned pill group; the create button became circular.
- **Type scale reduced** across the mobile app (display 34→26, h1 28→21, body 15→13) so more
  content fits per screen.

### Documentation
- ADR-016 — mobile and desktop use different layout systems, never a shared one.
- ADR-017 — distinct visual identity, not a clone of the category leader.

### Verified
- `tsc --noEmit` clean in both `mobile/` and `admin/`.
- Expo dev server boots; splash → onboarding → auth → feed → explore → profile all render.
- `next build` succeeds; all 30 admin routes prerender.

### Notes
- No backend, no database, no deployment — correct for this phase.

---

## [0.0.1] — 2026-08-28 — Phase 0: Project Foundation

### Added
- `PROJECT_MASTER_LOG.md` — permanent project source of truth.
- `CHANGELOG.md` — this file.
- `ARCHITECTURE_DECISIONS.md` — ADR register.
- `DATABASE_MIGRATION_LOG.md` — migration history and safety rules.
- `AI_MODEL_EXPERIMENTS.md` — model versions, experiments, A/B results.
- `TESTING_LOG.md` — test runs and results.
- `SECURITY_LOG.md` — security decisions, reviews and incidents.
- `DEPLOYMENT_LOG.md` — deployment history.
- `/project-phases/` with the 13 phase specification files.
- Repository folder structure: `mobile/`, `admin/`, `backend/`, `ml-service/`, `shared/`, `docs/`.

### Notes
- No application code written in this release — Phase 0 is documentation and structure only.
- No database exists yet; nothing to migrate.
