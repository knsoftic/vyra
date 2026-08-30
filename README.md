# Vyra — TikTok-Style Social Video Platform

A complete short-video social platform: native mobile app, Super Admin panel, Node.js backend and
Python ML services.

> **Working title.** The app name is admin-configurable (Super Admin → App Settings → App Name).

---

## Read this first

| Document | Purpose |
|---|---|
| [`PROJECT_MASTER_LOG.md`](PROJECT_MASTER_LOG.md) | **Permanent source of truth.** Read before any task. |
| [`project-phases/`](project-phases/) | The 13 phase specifications |
| [`CHANGELOG.md`](CHANGELOG.md) | What changed, when |
| [`ARCHITECTURE_DECISIONS.md`](ARCHITECTURE_DECISIONS.md) | Why the system is built this way |
| [`DATABASE_MIGRATION_LOG.md`](DATABASE_MIGRATION_LOG.md) | Migration history + data-safety rules |
| [`AI_MODEL_EXPERIMENTS.md`](AI_MODEL_EXPERIMENTS.md) | Model versions, weights, A/B results |
| [`TESTING_LOG.md`](TESTING_LOG.md) | Test strategy, phase gates, run history |
| [`SECURITY_LOG.md`](SECURITY_LOG.md) | Security baseline, threat model, reviews |
| [`DEPLOYMENT_LOG.md`](DEPLOYMENT_LOG.md) | Deployment history and release process |

---

## Repository layout

```
.
├─ mobile/          React Native (Expo + TypeScript) — Android + iOS user app
├─ admin/           Next.js + TypeScript + Tailwind — Super Admin panel
├─ backend/         Node.js + TypeScript API (Phase 2+)
├─ ml-service/      Python FastAPI ML microservices (Phase 6+)
├─ shared/          Shared API contracts consumed by mobile + admin
├─ docs/            Runbooks and supporting documentation
└─ project-phases/  Phase specifications
```

---

## Current phase — Phase 1: UI first

Mobile and admin UIs are built with **realistic mock data**. There is no backend yet, by design:

```
UI  ->  Local Preview  ->  Review  ->  Changes  ->  Approval  ->  Backend Development
```

---

## Running locally

Install everything once:

```bash
npm run install:all
```

### Mobile app (React Native / Expo)

```bash
npm run mobile
```

Then press `a` for Android, `i` for iOS (macOS), or `w` for a browser preview.
For the full native experience — camera, video playback, gestures, haptics — use a development
build on a real device. The browser preview cannot test safe-area insets or the Android back button.

### Admin panel (Next.js)

```bash
npm run admin
```

Opens on http://localhost:3000. It is **desktop-first** — view it at 1280px or wider.

### Typecheck both apps

```bash
npm run typecheck
```

---

## Design principles

Two rules bind all UI work:

**1. Mobile and desktop never share a layout** (ADR-016).

| | Mobile | Desktop admin |
|---|---|---|
| Navigation | Bottom tab bar | Persistent grouped sidebar |
| Layout | Single column, full-bleed | Multi-column, master–detail |
| Lists | Cards and scrolling rows | Dense sortable data tables |
| Actions | Bottom sheets | Toolbars, row actions, inspector panels |

**2. The product has its own visual identity** (ADR-017). The format is a vertical snap feed
because that is what the product is — but the palette (violet `#7C5CFF` + mint `#3DDC97`), the
horizontal feed action bar, the sound pill, the pill tab group and the compact type scale are
deliberately unlike the category leader.

---

## Permanent project rules

1. Every new instruction is an **update to this project**, never a new project.
2. Never remove existing features.
3. Never reset the database. Never delete users, videos, drafts, chats, wallets, payments or analytics.
4. Migrations are versioned, forward-only and backward compatible.
5. Always: `Read Existing Project -> Preserve Existing Work -> Add New Requirement -> Test -> Update Logs`.
