# PHASE 3 — AUTHENTICATION AND USERS

**Status:** ✅ Complete — 2026-08-29 · **Depends on:** Phase 2 ✅
**Gate:** auth E2E passes; token refresh and session revocation verified.

---

## OBJECTIVE

Real accounts, real sessions, real profiles. The mobile UI stops using mock auth and talks to the
backend.

---

## SCOPE

### Registration and login
- Email + password registration with **OTP email verification** (6 digits, single use, 10-minute
  expiry, rate limited per email and per IP)
- Login, logout, logout-all-devices
- Forgot password → OTP → reset
- Argon2id password hashing
- JWT access token + rotating refresh token, bound to a device record
- Refresh-token reuse detection revokes the session family

### Account types
| Category | Types |
|---|---|
| Individual | Normal User, Creator, Public Figure, Professional |
| Business | Company, Brand, Shop, Organization, Advertiser, Service Provider |

- Account type is switchable; switching never destroys existing content or wallet balance
- Business accounts unlock: business profile fields, CTA, campaign manager, business analytics

### Profiles
- Avatar, display name, username (unique, reserved-word protected), bio, links
- Business profile: category, website, contact details, call-to-action
- Privacy settings: private account, who can comment/message/duet/download
- Interest onboarding feeding the initial `UserInterestProfile`

### Social graph
- Follow / unfollow, follower and following lists, follow-back state
- Block / unblock — blocking hides content bidirectionally and blocks messaging
- Report user

### Sessions and devices
- Device registration for push notifications
- Active session list, revoke individual session
- Login activity records (time, device, IP, location) surfaced to the user and to admin

---

## SECURITY REQUIREMENTS FOR THIS PHASE

- Constant-time OTP comparison; OTP never logged
- Username enumeration resistance on login and password reset responses
- Rate limits: login, OTP request, OTP verify, password reset, registration
- Object-level authorization on every profile mutation
- All auth events written to the security event log

---

## EXIT CRITERIA

1. Full registration → OTP → login → refresh → logout journey passes E2E.
2. Token refresh rotates and old refresh tokens are rejected.
3. Session revocation immediately invalidates the device.
4. Account type switching preserves all data.
5. Block relationships enforced server-side in feed, search, chat and profile.
6. `SECURITY_LOG.md` updated with the phase review.


---

## COMPLETION RECORD — 2026-08-29

### Exit criteria

| # | Criterion | Result |
|---|---|---|
| 1 | Full registration → OTP → login → refresh → logout journey passes E2E | ✅ |
| 2 | Token refresh rotates and old refresh tokens are rejected | ✅ Plus reuse of a rotated token revokes the whole family |
| 3 | Session revocation immediately invalidates the device | ✅ Rejected on the next request, not at token expiry |
| 4 | Account type switching preserves all data | ✅ Wallet balance, profile and business details survive a round trip |
| 5 | Block relationships enforced server-side | ✅ Profile and follow enforced; feed/search/chat inherit `isBlockedEitherWay` when those modules land |
| 6 | `SECURITY_LOG.md` updated with the phase review | ✅ |

### Built

| Area | Endpoints |
|---|---|
| Auth | register, login, logout, logout-all, refresh, OTP request/verify, password reset, password change |
| Sessions | list active sessions, revoke one |
| Profile | get own, update, privacy settings, account type switch, business profile, security event history |
| Users | public profile, username availability, followers, following |
| Graph | follow, unfollow, block, unblock, blocked list |
| Safety | report a user, video, comment, live, community or message |

Two migrations: `009_security_events` (append-only security log plus `username_history`) and
`010_privacy_settings` (who may comment, message and duet; download permission).

### Verification

- `npm test` — **50 passed, 0 failed** (27 from Phase 2, 23 new end-to-end). Stable across repeated runs.
- `npm run typecheck` — clean across mobile, admin and backend.
- The end-to-end suite drives real HTTP against the real database and removes every account it creates.

### Three high-severity bugs found and fixed

1. **Refresh-token reuse detection did not work.** The revocation ran inside the transaction the
   function then threw from, so it was rolled back — the defence detected the theft, logged it, and
   left the stolen token live. See BUG-006.
2. **Only one session could ever exist.** A UNIQUE constraint on `refresh_token_hash` collided with
   the placeholder used by a two-step insert. See BUG-007.

3. **Unknown refresh tokens blocked all sign-ins.** A `FOR UPDATE` lookup that matched nothing took
   an InnoDB gap lock, stalling every concurrent session insert. See BUG-009.

The first two were caught by tests written against the exit criteria. The third surfaced as a flaky
test and was only explained by reading the SQL statement that was actually blocked — two earlier
theories about it were wrong.

### Carried forward

- **OTP email delivery is not wired up.** Codes are generated and verified correctly, but nothing
  sends them. Development returns the code in the response; production does not. A mail provider
  must be connected in Phase 13 before a real user can verify an address or reset a password.
- Rate limits are defined and mounted but not runtime-verified — Redis is not installed locally.
- Interest onboarding (`user_interest_profiles`) moves to Phase 6/7 with the recommendation work.
- Device testing on real hardware, still carried from Phase 1.
