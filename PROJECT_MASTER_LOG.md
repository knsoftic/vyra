# PROJECT MASTER LOG

> **This file is the permanent source of truth for the project.**
> Read this file **before** starting any new task. Update it **after** every task.
> Never delete history from this file — append and amend.

| Field | Value |
|---|---|
| Project Codename | **Vyra** (working title — changeable from Super Admin → App Settings → App Name) |
| Repository Root | `C:\xampp\htdocs\video app` |
| Created | 2026-08-28 |
| Last Updated | 2026-08-30 |
| Current Phase | **Phase 13 — Notifications, Email & Launch Readiness** (complete) |
| UI Wiring | Mobile: fully wired (auth, feed, profiles, graph, discovery, creation catalogue, inbox, chat, communities, calls, live, money, trust, notifications). Admin: fully wired — every module reads and writes the backend; no sample data remains — 2026-08-30 |
| Phase 0 Status | Complete |
| Phase 1 Status | Complete — UI approved by owner 2026-08-29 |
| Phase 2 Status | Complete — 2026-08-29 · 89 tables, 27 tests passing, API boots |
| Phase 3 Status | Complete — 2026-08-29 · auth, users and graph live, 50 tests passing |
| Phase 4 Status | Backend complete — 2026-08-29 · upload, EDL, render, catalogue, drafts |
| Phase 5 Status | Backend complete — 2026-08-29 · pipeline, ABR ladder, HLS, quality, playback |
| Phase 6 Status | Complete — 2026-08-29 · events, interests, segments, affinity, privacy |
| Phase 7 Status | Complete — 2026-08-29 · candidates, scoring, re-ranking, distribution |
| Phase 8 Status | Complete — 2026-08-29 · chat, groups, communities, calls, realtime |
| Phase 9 Status | Complete — 2026-08-29 · live streaming, gifting, wallet reads |
| Phase 10 Status | Complete — 2026-08-29 · coins, withdrawals, tasks, referrals |
| Phase 11 Status | Complete — 2026-08-29 · campaigns, targeting, delivery, charging |
| Phase 12 Status | Complete — 2026-08-29 · verification, moderation, support · 485 tests passing |
| Phase 13 Status | Complete — 2026-08-30 · notifications, preferences, outbox, OTP email, preflight · 507 tests, 70 smoke checks passing |
| Admin Panel Status | Live — 2026-08-30 · sign-in, all 36 modules on real data, SMTP configurable from Settings · 520 tests |
| Production Status | Not deployed (by design — no backend deployment before UI approval) |

---

## 1. PROJECT PURPOSE

Build a complete, modern, scalable, secure and production-ready **TikTok-style short-video social
platform** consisting of:

1. A **native mobile application** (React Native — Android + iOS) that is the product for end users.
2. A **web-based Super Admin panel** that controls nearly every configurable part of the platform.
3. A **Node.js backend** exposing REST + real-time APIs.
4. **Python ML microservices** powering the recommendation engine, video intelligence and quality scoring.

The mobile app must feel like a **real native application** — not a website inside a WebView.

## 2. PROJECT GOALS

| # | Goal | Notes |
|---|---|---|
| 1 | Native Android/iOS experience | 60fps feed, gesture driven, native camera/mic/gallery |
| 2 | Premium short-video UI with its own identity | Full-screen vertical feed, dark-first, light mode supported. Format is category-standard; styling is deliberately distinct (ADR-017) |
| 3 | Advanced recorder + editor + filters + effects + music | On-device preview, admin-managed asset catalogue |
| 4 | Intelligent For You feed | Multi-stage ML recommendation, behaviour driven |
| 5 | Creator fairness | 10% fresh-creator exploration, progressive distribution ladder |
| 6 | Full social layer | Chat, groups, communities, voice/video calls, live streaming |
| 7 | Monetization | Coins, gifts, video promotion, self-service advertising |
| 8 | Business + verification | Business accounts, campaign manager, verified badges |
| 9 | Powerful Super Admin | Feature flags, AI weights, moderation, audit logs, system health |
| 10 | Safe forever-updates | Never delete/reset user data; versioned, backward-compatible migrations |
| 11 | Scale | Architecture must reach millions of users without a rewrite |

## 3. CURRENT PHASE

**Phase 13 — Notifications, Email and Launch Readiness. Complete.**

All thirteen planned phases are built and tested locally. What remains before a deployment is
infrastructure this machine does not have, not features:

- Redis is not installed — rate limiting, idempotency replay and presence all degrade without it.
- No SMTP host, so the outbox drains to the console. Codes are queued correctly and delivered
  nowhere.
- No push provider, so push rows fail visibly rather than pretending to deliver.
- No FFmpeg and no media server, so the render pipeline and live ingest are untested end to end.
- `STORAGE_PUBLIC_URL` points at localhost, so no device off this machine could load media.
- Four payment methods still carry `REPLACE IN ADMIN` account details.
- No administrators exist, so nobody could approve a payment or review a report.

`npm run preflight` enumerates all of this and exits 1. Run it against the target environment before
any deployment; a green run is the gate.

Rules still in force:
- **Do not deploy a production backend before UI approval.**
- Never delete or reset existing user data. Every instruction is an update to this project.

## 4. COMPLETE FEATURE LIST (target scope)

### 4.1 Mobile — Content
Short vertical videos, For You feed, Following feed, Trending, Explore, Search, Categories,
Nearby (permission-gated), Video player, Comments, Share, Save, Hashtags, Mentions, Sounds

### 4.2 Mobile — Creation
Video recording (front/back camera, flash, timer, countdown, multi-clip, pause/resume, retake,
delete clip, playback preview), Upload from gallery/storage, Trim, Split, Cut, Rearrange clips,
Crop, Rotate, Speed (0.5x–2x, extensible), Cover/thumbnail selection, Caption, Hashtags,
Mentions, Location, Privacy, Comment toggle, Drafts, Publish

### 4.3 Mobile — Creative Assets
20 base filters, Manual adjustments (brightness, contrast, saturation, exposure, highlights,
shadows, temperature, tint, sharpness, fade, vignette), Effects (blur, zoom, shake, flash, glitch,
slow/fast motion, reverse, transitions, light, colour, background), Optional beauty effects,
Text on video (font, size, align, background, animation, duration, drag/rotate/resize), Stickers and
emoji, Music library, original sound, voiceover, per-track volume, audio trim

### 4.4 Mobile — Social
Private chat, Group chat, Community chat, Voice call, Video call, Group calls, Live streaming
with comments, likes, gifts, guests/co-host, Followers/following, Notifications, Block, Report

### 4.5 Mobile — Money
Wallet (four separate balances: coin, reward, live gift, withdrawable), Buy coins with
multi-currency calculator and manual payment methods (EasyPaisa, JazzCash, bank, USDT),
Transaction history, Send gifts, Video promotion, Self-service advertising, Creator dashboard,
Business analytics, Monetization criteria and progress, Daily earning tasks, Referral rewards,
Reward→coin conversion, Live gift earnings, USDT/USD withdrawals

### 4.6 Mobile — Account
Individual (Normal, Creator, Public Figure, Professional), Business (Company, Brand, Shop,
Organization, Advertiser, Service Provider), Email + OTP registration, Verification requests,
Privacy, Settings, Blocked users, Reports, Help and Support

### 4.7 Intelligence
Video interest profile, Video quality score (0–100), User behaviour engine, User interest profile
(short + long term), Audience segmentation, Negative signals, Video audience profile, Creator
affinity score, Priority creator audience, Multi-stage recommendation (candidate generation → ML
scoring → re-ranking), FYP distribution score, New-account exploration, Progressive distribution,
A/B testing framework

### 4.8 Super Admin
Dashboard, Users, Videos, Filters/Effects/Stickers, Music, Categories, Hashtags, Comments,
Live, Chat and communities, Coins, Gifts, Payments, Ads, Boost settings, Verification,
Roles and permissions, AI/recommendation control, AI model management, Moderation, Notifications,
Banners and promotions, Support tickets, Feature flags, App settings, Country/region settings,
Security, Audit log, System health, Analytics

## 5. COMPLETED FEATURES

| Date | Phase | Item | Notes |
|---|---|---|---|
| 2026-08-28 | 0 | Master log + companion logs created | This file, CHANGELOG, ADR, migration/AI/testing/security/deployment logs |
| 2026-08-28 | 0 | 13 phase files created | `/project-phases/PHASE_01..13` |
| 2026-08-28 | 0 | Repository folder structure created | `mobile/ admin/ backend/ ml-service/ shared/ docs/ project-phases/` |
| 2026-08-29 | 1 | Mobile app scaffold | Expo SDK 57 + RN 0.86 + TypeScript, React Navigation, theming, app config with camera/mic permission strings |
| 2026-08-29 | 1 | Design system | `theme/tokens.ts` — compact type scale, violet/mint identity, dark + light palettes |
| 2026-08-29 | 1 | Mock data layer | users, videos, social, creative, money, discovery, account — shaped like the future API |
| 2026-08-29 | 1 | Shared component library | Text, Pressable, Screen/Header, Button, Input, Avatar, Controls, Lists, Cards, Sheet, Charts |
| 2026-08-29 | 1 | All 55 mobile screens | auth, feed, discovery, creation, profile, inbox, chat, calls, live, money, account |
| 2026-08-29 | 1 | Full navigation graph | Typed root stack + bottom tabs; every screen reachable |
| 2026-08-29 | 1 | Admin panel scaffold | Next.js 16 + TypeScript + Tailwind v4, desktop shell (sidebar + topbar) |
| 2026-08-29 | 1 | All 30 admin modules | Every module in PHASE_01 built and routed; production build passes |
| 2026-08-29 | 1 | UI differentiation pass | ADR-017 — distinct palette, feed layout and type scale |
| 2026-08-29 | 1 | Platform layout separation | ADR-016 — mobile bottom-nav vs desktop sidebar, no shared layout |
| 2026-08-29 | 1 | Admin monetization modules | Coin request approvals, withdrawal approvals, criteria/creator management, daily task config, rates and payment methods — 5 modules, admin total now 35 |
| 2026-08-29 | 1 | User monetization system | Monetization criteria, daily tasks, referrals, four-balance wallet, coin purchase with multi-currency calculator and manual payments, live gift earnings, withdrawals (ADR-018) |
| 2026-08-30 | 13 | Notification system | One `notify()` entry point; ten categories across in-app, push and email; blocks, self-action and preferences enforced once (ADR-040) |
| 2026-08-30 | 13 | Notification preferences and quiet hours | Per-channel switches that persist; marketing off by default; account and verification notices always reach the inbox; quiet hours suppress push, never the record |
| 2026-08-30 | 13 | Outbox delivery | Rows claimed before sending, bounded retries, abandonment rather than infinite retry, templates rendered at send time, transport reported honestly (ADR-039) |
| 2026-08-30 | 13 | Verification codes delivered | The Phase 3 gap closed — `requestOtp` queues an email keyed on the code's own row |
| 2026-08-30 | 13 | Launch preflight | `npm run preflight` — secrets, infrastructure, migrations, payment placeholders, money settings, administrators, outbox backlog, media URLs, CORS |
| 2026-08-30 | 13 | Notification UI wired | Settings screen writes to the server on every switch; inbox activity tab reads the real inbox and marks read server-side |
| 2026-08-30 | 13 | Profiles resolve to real accounts | `GET /users/:handle` accepts a public id or a username; an unknown id is an empty profile, never a different person (ADR-041) |
| 2026-08-30 | 13+ | Admin authentication | Login page, session guard, single-flight refresh; admins are users with an admin_users link (ADR-042); `npm run seed:admin` bootstraps the super admin |
| 2026-08-30 | 13+ | Admin backend | 26 new /admin routes: dashboard, analytics, users, videos, comments, catalogues (allow-listed editors), settings, SMTP test, announcements, payments view, security, audit (ADR-043) |
| 2026-08-30 | 13+ | Admin panel fully live | All 36 modules on real data; queue badges, audit trail, health — zero sample data left in the admin surface |
| 2026-08-30 | 13+ | Gmail SMTP from the panel | Settings-first mail transport, send-test button verified against Google's live server; password write-only |
| 2026-08-30 | 13+ | Deployment documentation | DEPLOYMENT_GUIDE.md, UPDATE_GUIDE.md (zero-data-loss updates), illustrated Word edition with diagrams |

## 6. PENDING FEATURES

Everything in section 4 that is not listed in section 5. Phase-by-phase breakdown lives in
`/project-phases/`.

Immediate queue (Phase 1):
- [x] Mobile app scaffold (Expo + TypeScript + React Navigation + theming)
- [x] Mock data layer
- [x] All mobile screens listed in `PHASE_01_UI_UX.md`
- [x] Admin panel scaffold (Next.js + TypeScript + Tailwind)
- [x] All admin modules listed in `PHASE_01_UI_UX.md`
- [x] Local run verification (typecheck clean, both apps boot and render)
- [x] **Owner approved Phase 1 and directed Phase 2 to begin (2026-08-29)**
- [ ] Device testing on real Android and iOS hardware — still outstanding, carried into Phase 2

## 7. CURRENT BUGS

None open. Phase 13 found and fixed five; the last four are one recurring shape, recorded as
ADR-041 so it stops being rediscovered.

| ID | Severity | Area | Description | Status |
|---|---|---|---|---|
| BUG-055 | High | Delivery | `queue()` read `affectedRows` from `ON DUPLICATE KEY UPDATE`; mysql2's prepared statements report a matched row either way, so every deduplicated message was reported as freshly queued | Fixed 2026-08-30 |
| BUG-056 | High | Mobile | `VerifiedBadge` returned null only for `'none'`, so an `undefined` tier drew a verification tick on unverified accounts | Fixed 2026-08-30 |
| BUG-057 | High | Mobile | `getUser(id)` fell back to `currentUser`, so every real account opened as the same invented person with 128K followers | Fixed 2026-08-30 |
| BUG-058 | Medium | Mobile | A profile with no videos was padded with six sample clips carrying millions of plays | Fixed 2026-08-30 |
| BUG-059 | Low | Notifications | Quiet hours could be written but not read, so the screen would have had to guess what was set | Fixed 2026-08-30 |
| BUG-060 | High | Settings | `system_settings.value` (LONGTEXT on MariaDB) was never parsed on read — a stored `false` came back as the truthy string "false"; a kill switch that could not kill | Fixed 2026-08-30 |
| BUG-061 | High | Admin panel | Parallel 401s raced the rotating refresh token and signed the operator out every 15 minutes | Fixed 2026-08-30 — single-flight refresh |
| BUG-062 | Medium | Admin analytics | DATE() values (JS Dates) matched against ISO strings — every chart drew zero under correct totals | Fixed 2026-08-30 |

## 8. DATABASE ARCHITECTURE

**Engine:** MySQL 8 (InnoDB, utf8mb4). **Cache:** Redis. **Object storage:** S3-compatible.

Entity groups (full DDL arrives in Phase 2 — see `PHASE_02_ARCHITECTURE.md`):

| Group | Tables |
|---|---|
| Identity | `users`, `user_profiles`, `business_profiles`, `user_devices`, `user_sessions`, `otp_codes` |
| Graph | `follows`, `blocks`, `user_reports` |
| Content | `videos`, `video_drafts`, `video_metadata`, `video_assets`, `video_categories`, `video_hashtags`, `hashtags`, `sounds`, `music_tracks` |
| Creative | `filters`, `effects`, `sticker_packs`, `stickers`, `text_styles`, `editor_assets` |
| Intelligence | `video_quality_scores`, `video_interest_profiles`, `video_embeddings`, `video_audience_profiles`, `user_interest_profiles`, `creator_affinity`, `audience_segments`, `user_segments` |
| Behaviour | `video_views`, `watch_events`, `impressions`, `likes`, `comments`, `comment_likes`, `shares`, `saves`, `negative_signals` |
| Ranking | `recommendations`, `recommendation_impressions`, `fyp_distribution`, `experiments`, `experiment_assignments`, `ranking_weights` |
| Messaging | `chats`, `chat_participants`, `messages`, `message_receipts`, `groups`, `group_members`, `communities`, `community_members`, `community_rules`, `community_join_requests` |
| Realtime | `calls`, `call_participants`, `live_streams`, `live_viewers`, `live_comments`, `live_gifts` |
| Money | `wallets`, `coin_transactions`, `coin_packages`, `payments`, `gifts`, `gift_transactions`, `payouts` |
| Growth | `promotions`, `ads`, `campaigns`, `campaign_targeting`, `campaign_analytics`, `banners` |
| Trust | `verification_requests`, `verification_documents`, `reports`, `moderation_actions`, `support_tickets`, `ticket_messages` |
| Platform | `roles`, `permissions`, `role_permissions`, `admin_users`, `feature_flags`, `system_settings`, `country_settings`, `notifications`, `notification_campaigns`, `audit_logs` |

**Hard rules**
- Soft-delete (`deleted_at`) for all user-owned content. **No hard deletes in production.**
- New columns are nullable or carry safe defaults.
- Every migration is versioned, forward-only, and logged in `DATABASE_MIGRATION_LOG.md`.

## 9. BACKEND ARCHITECTURE

- **Runtime:** Node.js 24 + TypeScript, Express (HTTP) + Socket.IO (real-time).
- **Layout:** modular monolith split by domain module, each module owning routes → controller →
  service → repository. Extractable into services later without rewriting call sites.
- **Async:** BullMQ on Redis for video processing, notifications, analytics rollups, ML feature jobs.
- **Media:** FFmpeg pipeline → HLS/ABR renditions → object storage → CDN.
- **Auth:** JWT access tokens + rotating refresh tokens, device-bound sessions.
- **Contracts:** shared TypeScript types in `/shared/contracts` consumed by mobile + admin.

## 10. MOBILE ARCHITECTURE

- **Framework:** React Native via **Expo (dev-client / prebuild)** + TypeScript.
- **Navigation:** React Navigation (native stack + bottom tabs + modal stacks).
- **State:** Zustand for app state, TanStack Query for server state (wired in Phase 3).
- **Video:** `expo-video` in the Phase 1 mock feed; native player + preloading window in Phase 5.
- **Theming:** single design-token source (`theme/tokens.ts`), dark and light modes, compact type scale.
- **Identity:** violet/mint palette and a feed layout deliberately distinct from the category leader (ADR-017).
- **Structure:** `src/{screens,components,navigation,theme,mock,store,services,hooks,types,utils}`.

## 11. ADMIN ARCHITECTURE

- **Framework:** Next.js (App Router) + TypeScript + Tailwind CSS.
- **Layout:** persistent grouped sidebar + sticky topbar, module pages under `/app/(dashboard)/...`.
- **Desktop-first:** master–detail tables, inspector panels and dense rows. Never a mobile layout stretched wide (ADR-016).
- **Access:** role-gated navigation; every module declares its permission key.
- **Phase 1:** mock data only, no network calls.

## 12. AI ARCHITECTURE

Python microservices (FastAPI), called by the Node backend over internal HTTP + queue:

| Service | Responsibility |
|---|---|
| `video-intelligence` | Category, topics, objects, scene, speech, on-screen text, language → `VideoInterestProfile` |
| `quality-scorer` | Technical quality, blur, lighting, stability, audio, compression → `VideoQualityScore` 0–100 |
| `embeddings` | Video + user vectors for similarity retrieval |
| `ranker` | ML scoring of candidates (watch, completion, engagement, negative probabilities) |
| `moderation` | Spam, duplicate, prohibited content, suspicious activity — advisory, human has final say |

## 13. RECOMMENDATION ARCHITECTURE

Three stages: **candidate generation → ML scoring → re-ranking**, producing
`FYPDistributionScore` (0–100).

Key constants (all admin-tunable, all changes audited):

| Constant | Default |
|---|---|
| `NEW_CREATOR_FYP_EXPLORATION_RATE` | **10%** |
| `FRESH_VIDEO_TEST_RATE` | 15% |
| Watch signal — video < 20s | completion percentage |
| Watch signal — video 20–30s | 20-second watch |
| Watch signal — video > 30s | 30-second watch |

Progressive distribution ladder: L1 small test → L2 similar audience → L3 category audience →
L4 broad For You → L5 trending candidate. Promotion between levels is performance-gated.

Model roadmap: v1 rules+weights → v2 content-based + collaborative filtering → v3 learning-to-rank →
v4 two-tower → v5 sequence-aware.

## 14. CHAT ARCHITECTURE

Socket.IO namespaces with Redis adapter for horizontal scale. Per-conversation rooms, delivery and
read receipts persisted, media uploaded out-of-band then referenced by message.
Communities deliberately **do not** expose the full member list to ordinary members — only owner /
admin / moderator roles see the roster.

## 15. VIDEO ARCHITECTURE

Upload (resumable) → validate → queue → FFmpeg transcode to ABR ladder (240p/360p/480p/720p/1080p) →
thumbnail + cover candidates → quality scoring → intelligence tagging → publish → CDN.
Drafts persist independently of app updates.

## 16. LIVE STREAMING ARCHITECTURE

Ingest (RTMP/WebRTC) → media server (SFU) → HLS/LL-HLS for viewers, WebRTC for guests/co-host.
Live chat, likes and gifts ride the Socket.IO layer. Admin can stop a live, mute chat, warn, ban.

## 17. ADVERTISING ARCHITECTURE

Campaign → ad group (targeting + budget + schedule) → creative. Auction-based delivery blended into
the organic feed at admin-configured density. Objectives: awareness, reach, video views, engagement,
followers, profile visits, website traffic, leads, app promotion.
**No fake likes, followers or comments are ever generated** — promotion buys distribution only.

## 18. MONETIZATION ARCHITECTURE

Coins (purchased) → gifts / promotion. Every coin movement is a ledger row carrying previous balance,
new balance, reference and status. Idempotency keys prevent duplicate charges and replays. Manual
admin credit/debit always requires a reason and writes an audit record.

## 19. SECURITY REQUIREMENTS

Argon2id password hashing, OTP rate limits + expiry, JWT + rotating refresh tokens, per-route rate
limiting, schema validation on every input, parameterised SQL only, output escaping, CSRF on
cookie-authed admin routes, MIME + magic-byte file validation, object-level authorization checks,
admin RBAC, 2FA-ready admin auth, full audit logging, abuse/anomaly detection.

## 20. DATA PROTECTION RULES

> **PERMANENT RULE — future updates must NEVER delete or reset existing user data.**

Protected forever: users, videos, drafts, profiles, followers, chats, messages, groups, communities,
wallets, coins, transactions, payments, campaigns, verification records, media, analytics.

- Never reset the production database.
- Never drop a column that holds user data — deprecate it instead.
- Media lives in object storage, **outside** any code/deployment directory.
- Every destructive-looking migration requires a backup + staging proof first.

## 21. TESTING RESULTS

See `TESTING_LOG.md`.

- **507 backend tests** (`npm test`), all passing.
- **70 smoke checks** (`npm run smoke`) against a running server, all passing.
- **25 migrations** validated (`npm run migrate:validate`).
- Admin production build passes; mobile and backend typecheck clean.
- Browser verification: notification settings persist and read back; the inbox activity tab shows a
  real follow with no fabricated badge; an account with no videos shows an empty profile.

## 22. DEPLOYMENT HISTORY

See `DEPLOYMENT_LOG.md`. No deployments — correct for the current phase.

## 23. FUTURE FEATURES (backlog, not in current scope)

Duet/Stitch, Series and long-form, Creator fund payouts, In-app shop / product tagging,
Subscriptions, Multi-language auto-captions, Desktop web viewer, Story-format posts,
Advanced brand-safety controls for advertisers.

---

## STANDARD OPERATING PROCEDURE (before every new task)

1. Read this master log.
2. Check the current phase.
3. Inspect the existing code.
4. Check database migrations.
5. Preserve existing features.
6. Make only the required changes.
7. Test the changes.
8. Update the project logs.

**Never restart or rebuild completed modules unnecessarily.**
