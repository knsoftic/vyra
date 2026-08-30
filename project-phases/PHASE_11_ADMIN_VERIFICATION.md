# PHASE 11 — ADMIN, VERIFICATION AND MODERATION

**Status:** Not started · **Depends on:** Phases 3–10
**Gate:** every admin action writes an audit row; role gating cannot be bypassed.

---

## OBJECTIVE

Wire the Super Admin panel to real data and real powers, with role-based access and complete
auditing.

---

## ROLES AND PERMISSIONS

Built-in roles: Super Admin · Admin · Moderator · Video Moderator · Live Moderator ·
Community Moderator · Verification Manager · Verification Officer · Ads Manager · Finance Manager ·
Support Agent · Content Manager · AI/Recommendation Manager.

**Super Admin can create custom roles.**

Every module exposes permissions: `view · create · edit · delete · approve · reject · suspend ·
export · manage_settings`.

Enforcement is **server-side**. Hiding a menu item is presentation, not security.

---

## MODULE SCOPE

| Module | Powers |
|---|---|
| Dashboard | Users, active/online, new, creators, businesses, verified, videos, uploads, views, watch time, lives, communities, groups, message volume, coin sales, gift revenue, promotion revenue, ad revenue, active campaigns, pending reports, verification requests, system status |
| Users | Search, filter, view, edit allowed details, suspend, ban, unban, freeze, verify, remove verification, change account type, view reports, moderation history, login activity, wallet summary, creator stats |
| Videos | View, search, filter, analytics, remove, disable, restore, feature, mark/remove trending, restrict distribution, review reports, change category, internal tags, trigger reprocessing, recalculate quality score |
| Creative assets | Filters, effects, stickers, text styles, editor assets — add, edit, enable, disable, reorder, mark trending/new/premium |
| Music | Add, edit metadata, disable, categorize, mark trending, restrict country, manage usage status |
| Categories | Video categories, subcategories, interests, audience segments, search and trending categories |
| Hashtags | Trending view, feature, block, restrict, official, sponsored |
| Comments | Search, delete, hide, reported queue, restrict a user from commenting, anti-spam rules |
| Live | Active lives, host, viewers, reports, gifts, duration; stop live, warn host, mute chat, ban user, disable live permission |
| Chat & communities | Groups, communities, reported content, owners, moderators, join rules, abuse reports — **without casually exposing private content** |
| Coins | Packages, currency, bonus, discounts, transactions, manual credit/debit with reason, freeze wallet |
| Gifts | Create, edit, upload animation, set coin value, activate, deactivate, feature |
| Payments | Successful, failed, pending, refunded; search by user, transaction, reference, date |
| Ads | Campaigns, approve, reject, pause, resume, disable, spend, targeting, performance, min/max budget, pricing |
| Boost settings | Min/max coins, daily budget, duration, reach formula, categories, restrictions, availability |
| Verification | Individual, creator and business queues; approve, reject, request documents, direct verify, remove badge |
| AI / Recommendation | Exploration rates, every ranking weight, diversity strength, candidate pool size |
| AI models | Current and previous version, deployment date, experiment status, performance, A/B test, rollout %, controlled rollout, stop experiment, roll back |
| Moderation | Reported users, videos, comments, lives, communities, groups; actions: no action, warning, content removal, temporary restriction, suspension, permanent ban |
| Notifications | Push, announcements, all users, selected audience, business users, creators, scheduled |
| Banners | App banners, home promotions, explore banners, campaign banners, featured creators/businesses/videos |
| Support | Tickets by type; assign, reply, change status, internal note, close |
| Feature flags | Toggle video upload, live streaming, calling, group chat, communities, gifts, coins, ads, promotion, business accounts, verification, new recommendation engine, new video editor |
| App settings | App name, logo, icon references, maintenance mode, minimum/latest app version, privacy policy, terms, community guidelines, upload limits, duration limits, file size limits, supported formats, maintenance message |
| Regions | Supported countries, languages, currency, regional coin packages, ad availability, business features, verification availability |
| Security | Admin login, RBAC, 2FA-ready, session management, login logs, audit logs, suspicious login detection, IP/device information |
| System health | API, database, Redis, queue, storage, video processing queue, failed jobs, live streaming, notifications, error rate |
| Analytics | Users, videos, creators, retention, watch time, engagement, categories, hashtags, search trends, coins, gifts, revenue, advertising, promotions, verification, live |

---

## VERIFICATION

Types: individual · creator · business. Users apply; admin can approve, reject, request more
information, verify directly, or remove a badge. Every decision is recorded with the deciding admin
and the reason.

---

## AI-ASSISTED MODERATION

Detects: spam · duplicate content · dangerous uploads · prohibited content · suspicious activity.

**A human moderator retains final control in important cases.** AI output is advisory: it queues,
prioritises and flags — it does not permanently ban a user on its own.

---

## AUDIT LOG

Every critical action records: admin · action · module · target · old value · new value · timestamp ·
reason (where applicable) · IP · user agent.

Critical actions include: user ban · coin change · verification decision · payment action ·
recommendation settings change · role change · feature flag change · content removal.

The audit log is **append-only** and cannot be edited or deleted from the panel.

---

## EXIT CRITERIA

1. Every module operates on real data.
2. Each role can do exactly what it should and provably nothing more (tested per role).
3. Every critical action produces a correct audit record including old and new values.
4. Feature flags toggle behaviour live, without a deploy.
5. Moderation actions apply immediately and are reversible where the action is reversible.
6. Private communication content is not exposed to routine admin browsing.
