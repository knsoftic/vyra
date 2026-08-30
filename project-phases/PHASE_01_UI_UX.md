# PHASE 1 — COMPLETE UI/UX (MOBILE + ADMIN)

**Status:** ✅ Complete — approved 2026-08-29 · **Started:** 2026-08-28 · **Built:** 2026-08-29
**Gate:** every screen reachable, no crashes, dark + light correct, small-screen and notch-safe,
presented for review and approved.

---

## OBJECTIVE

Build the **complete user interface** for the React Native mobile app and the web Super Admin panel
using realistic demo/mock data. No production backend. No network dependency. Everything runs
locally.

```
UI  ->  Local Preview  ->  Review  ->  Changes  ->  Approval  ->  Backend Development
```

---

## GROUND RULES

1. Mock data only — a single `src/mock/` module per app, shaped exactly like the future API response
   so Phase 3+ swaps the data source without touching screens.
2. No hard-coded colours, spacing or font sizes in screens — everything comes from the theme tokens.
3. Every screen respects safe areas and works on a 5-inch Android and an iPhone SE.
4. Dark mode is the primary design; light mode must be equally complete.
5. Android hardware back must behave correctly on every screen.
6. Components are reusable; a screen that needs a list uses the shared list primitives.

---

## MOBILE SCREEN INVENTORY

### Auth and onboarding
| Screen | Notes |
|---|---|
| Splash | Logo, brand animation, routes to onboarding or home |
| Onboarding | 3–4 slides, skip, interest picker |
| Login | Email + password, social placeholders |
| Signup | Account type choice → email → password |
| OTP | 6-digit input, resend timer |
| Forgot Password | Email → OTP → new password |

### Feed and discovery
| Screen | Notes |
|---|---|
| Home | Hosts For You / Following / Trending tabs |
| For You | Full-screen vertical snap feed |
| Following | Same feed component, different source |
| Trending | Same feed component, trending source |
| Explore | Grid of categories, trending hashtags, featured creators |
| Search | Tabs: Top, Users, Videos, Sounds, Hashtags; recent + suggested |
| Categories | Category browse and per-category feed |
| Video Player | Deep-linked single video |
| Comments | Bottom sheet: list, reply, like, report |
| Share | Bottom sheet: share targets, copy link, save, not-interested, report |

### Creation
| Screen | Notes |
|---|---|
| Record Video | Camera UI, multi-clip, timer, flash, speed, countdown, progress ring |
| Upload Video | Gallery picker grid |
| Video Editor | Timeline, clip tools, tool rail |
| Filters | Horizontal filter carousel with live preview |
| Effects | Effect categories and grid |
| Adjustments | 11 manual sliders with reset and before/after |
| Text on Video | Font, size, align, background, animation, duration |
| Stickers | Emoji, sticker packs |
| Music | Trending, new, categories, favourites, search, trim |
| Voiceover | Record over the timeline, volume mix |
| Cover Picker | Frame scrubber, custom upload, cover text |
| Caption Editor | Caption, hashtags, mentions, location |
| Post Settings | Privacy, comments, share, download, remix, duet toggles |
| Drafts | Saved drafts grid |

### Profile and social
| Screen | Notes |
|---|---|
| User Profile | Own profile, tabs: videos, liked, saved, private |
| Creator Profile | Other user, follow/message/gift actions |
| Business Profile | Category, website, contact, CTA button |
| Followers | List with follow-back |
| Following | List with unfollow |
| Notifications | Tabs: all, likes, comments, mentions, followers, system |

### Messaging and calls
| Screen | Notes |
|---|---|
| Chat List | Conversations, unread badges, search |
| Private Chat | Text, media, voice note, reply, forward, receipts, typing |
| Group Chat | Plus member list, pinned message, shared media |
| Group Info | Name, picture, description, owner, admins, members, permissions |
| Community | Announcements, chat, rules, join state |
| Community Info | Roster visible only to owner/admin/moderator |
| Community Requests | Join request queue (admin view) |
| Voice Call | Avatar, duration, mute, speaker, end |
| Video Call | PiP self-view, switch camera, mute, camera off, end |
| Group Call | Participant grid |
| Call History | Missed, incoming, outgoing |

### Live
| Screen | Notes |
|---|---|
| Live List | Active streams grid |
| Live Setup | Title, category, thumbnail, settings |
| Live Broadcast | Host view: viewers, comments, gifts, guests, controls |
| Live Viewer | Viewer view: comment, like, gift, follow, share, report |
| Live Gifts | Gift picker sheet with coin costs |

### Money
| Screen | Notes |
|---|---|
| Wallet | Balance, quick actions, recent transactions |
| Buy Coins | Coin packages, bonus badges, payment method |
| Transactions | Filterable ledger |
| Video Promotion | Goal, audience, budget, duration, estimated reach |
| Advertising | Campaign list |
| Campaign Builder | Objective → audience → budget → creative → review |
| Creator Dashboard | Overview, analytics, audience, content, revenue |
| Business Analytics | Business-account metrics |

### Account
| Screen | Notes |
|---|---|
| Verification | Type, requirements, form, status |
| Settings | Account, privacy, notifications, content, display, about |
| Privacy | Account privacy, interaction controls, data |
| Blocked Users | List with unblock |
| Reports | Report history and status |
| Help & Support | FAQ, ticket list, new ticket |
| Edit Profile | Avatar, name, username, bio, links |

**Total: 55 screens.**

---

## MOBILE NAVIGATION MAP

```
RootNavigator
├─ Splash
├─ AuthStack           Onboarding · Login · Signup · OTP · ForgotPassword
└─ AppStack
   ├─ MainTabs
   │  ├─ Home          (For You | Following | Trending)
   │  ├─ Explore       -> Search · Categories · Hashtag
   │  ├─ Create        (modal -> CreateStack)
   │  ├─ Inbox         (Chats | Notifications)
   │  └─ Profile
   ├─ CreateStack      Record · Upload · Editor · Filters · Effects · Adjust · Text ·
   │                   Stickers · Music · Voiceover · Cover · Caption · PostSettings · Drafts
   ├─ SocialStack      Profile · Followers · Following · EditProfile
   ├─ ChatStack        PrivateChat · GroupChat · GroupInfo · Community · CommunityInfo · Requests
   ├─ CallStack        VoiceCall · VideoCall · GroupCall · CallHistory
   ├─ LiveStack        LiveList · LiveSetup · LiveBroadcast · LiveViewer
   ├─ MoneyStack       Wallet · BuyCoins · Transactions · Promotion · Ads · CampaignBuilder ·
   │                   CreatorDashboard · BusinessAnalytics
   └─ SettingsStack    Settings · Privacy · Blocked · Reports · Support · Verification
```

---

## ADMIN MODULE INVENTORY

| # | Module | Key screens |
|---|---|---|
| 1 | Dashboard | KPI grid, charts, live activity, pending queues, system status |
| 2 | Users | List, filters, detail (profile, videos, wallet, reports, moderation, sessions), actions |
| 3 | Videos | List, detail, analytics, distribution controls, reprocess, quality recalculation |
| 4 | Creative Assets | Filters, effects, stickers, text styles — CRUD, order, trending, premium |
| 5 | Music | Tracks, metadata, categories, trending, region restrictions, usage status |
| 6 | Categories | Categories, subcategories, interests, audience segments |
| 7 | Hashtags | Trending, feature, block, restrict, official, sponsored |
| 8 | Comments | Search, delete, hide, reported queue, anti-spam rules |
| 9 | Live | Active streams, host, viewers, gifts, force-stop, warn, mute, ban |
| 10 | Chat & Communities | Groups, communities, owners, moderators, join rules, abuse reports |
| 11 | Coins | Packages, currency, bonuses, discounts, manual credit/debit with reason, freeze wallet |
| 12 | Gifts | CRUD, animation upload, coin value, activate, feature |
| 13 | Payments | All payments, status filters, search by user/transaction/reference/date |
| 14 | Ads | Campaigns, approve/reject/pause/resume, spend, targeting, performance, pricing |
| 15 | Boost Settings | Min/max coins, daily budget, duration, reach formula, restrictions |
| 16 | Verification | Individual/creator/business queues, approve, reject, request documents, direct verify |
| 17 | Roles & Permissions | Roles, per-module permission matrix, custom roles |
| 18 | AI / Recommendation | Exploration rates, all ranking weights, diversity, candidate pool size |
| 19 | AI Models | Versions, deployment dates, A/B status, rollout %, rollback |
| 20 | Moderation | Reported users/videos/comments/lives/communities/groups, action ladder |
| 21 | Notifications | Push, announcements, audience targeting, scheduling |
| 22 | Banners | App banners, home promotions, explore banners, featured entities |
| 23 | Support | Ticket queue, assignment, replies, internal notes, status |
| 24 | Feature Flags | Toggle every major feature without a deploy |
| 25 | App Settings | Name, logo, maintenance mode, versions, policies, upload limits, formats |
| 26 | Regions | Countries, languages, currency, regional packages, feature availability |
| 27 | Security | Admin logins, sessions, suspicious logins, 2FA state |
| 28 | Audit Log | Every critical action with old/new values and reason |
| 29 | System Health | API, DB, Redis, queues, storage, processing, failed jobs, error rate |
| 30 | Analytics | Users, videos, creators, retention, watch time, engagement, revenue, ads |

---

## DESIGN SYSTEM

**Palette (dark, primary):** near-black surfaces (`#0A0A0B` → `#1C1C1F`), white/grey text ramp,
brand gradient accent (magenta → cyan), semantic success/warning/danger/info.
**Palette (light):** white surfaces, dark text ramp, identical accent and semantics.

**Type scale:** display 34 · h1 28 · h2 22 · h3 18 · body 15 · label 13 · caption 11.
**Spacing scale:** 4 · 8 · 12 · 16 · 20 · 24 · 32 · 40 · 48.
**Radii:** sm 8 · md 12 · lg 16 · xl 24 · pill 999.
**Feed rule:** the video feed is always dark, regardless of the app theme — like every major
short-video product.

---

## DELIVERABLES

- [x] `mobile/` — Expo + TypeScript app, runs on Android and iOS
- [x] Theme tokens, dark + light, provider and hook
- [x] Mock data layer covering users, videos, comments, chats, communities, live, wallet, ads, admin
- [x] Shared component library (buttons, inputs, avatars, sheets, tabs, list rows, empty states)
- [x] All 55 mobile screens
- [x] Full navigation graph
- [x] `admin/` — Next.js + TypeScript + Tailwind, runs locally
- [x] Admin shell (sidebar, topbar, role switcher)
- [x] All 30 admin modules
- [x] Local run instructions verified
- [x] Review package presented and approved by the owner

---

## DESIGN DIRECTION (locked in during build)

Two decisions were taken while building and now bind all later UI work:

- **ADR-016 — platform layouts never converge.** Mobile uses a bottom tab bar, single-column,
  full-bleed cards and bottom sheets. Desktop uses a persistent grouped sidebar, multi-column
  grids, dense data tables and master–detail inspector panels. No layout component is shared.
- **ADR-017 — distinct visual identity.** The format stays a vertical snap feed, but the palette
  (violet + mint), the feed action bar, the sound pill, the pill tab group and the compact type
  scale are all deliberately unlike the category leader.

## EXIT CRITERIA

1. Both applications start locally with a documented command.
2. Every screen and module in this file is reachable through the UI.
3. No crash, no red screen, no unhandled navigation dead end.
4. Dark and light modes both complete.
5. Layouts verified on small screen, notch and Dynamic Island.
6. Review completed and changes applied.
7. **Explicit approval recorded before Phase 2 begins.**
