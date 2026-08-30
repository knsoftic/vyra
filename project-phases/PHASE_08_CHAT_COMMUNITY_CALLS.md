# PHASE 8 — CHAT, GROUPS, COMMUNITIES AND CALLS

**Status:** Not started · **Depends on:** Phase 3
**Gate:** message delivery, receipts and call setup verified across network conditions.

---

## OBJECTIVE

The full social communication layer: private chat, group chat, community chat, and voice/video
calling.

---

## PRIVATE CHAT

Text · emoji · image · video · document · voice note · shared video · reply · forward · delete ·
delivered receipt · seen receipt · typing indicator · online status · last seen · block · report.

- Messages persist server-side; deletion is soft and respects "delete for me" vs "delete for everyone"
- Media uploads happen out-of-band, then the message references the stored asset
- Blocking prevents delivery in both directions

## GROUP CHAT

Name · picture · description · owner · admins · members · invite · remove · leave · mute ·
shared media (voice notes, images, videos, documents, links) · pinned message.

Members can see: member count, member list, member profiles, admins and the owner.

## COMMUNITY CHAT

Name · logo · description · rules · public/private · invite · join requests · announcements · chat ·
owner · admin · moderator · ban · remove · mute · pin.

**Visibility rule (ADR-014): ordinary community members do NOT see the full member list.**
Only owner / admin / moderator can view total members, the member list, member profiles, join
requests, reports, activity and blocked users.

Per-role permissions: can post · can comment · can send media · can send links · can invite.

## VOICE AND VIDEO CALLS

1-to-1 voice · 1-to-1 video · group voice · group video.

Accept · reject · end · mute · speaker · camera on/off · switch camera · screen share · duration ·
call history · missed calls.

**Architecture:** WebRTC. 1-to-1 peer-to-peer with TURN relay fallback; group calls through an SFU.
Signalling over the existing Socket.IO layer. Push notification wakes the callee (CallKit on iOS,
ConnectionService on Android) so incoming calls behave natively.

---

## REAL-TIME INFRASTRUCTURE

- Socket.IO with the Redis adapter for horizontal scale
- Per-conversation rooms; presence tracked in Redis with TTL
- At-least-once delivery plus client-side deduplication by message id
- Offline users receive push notifications; messages are queued and delivered on reconnect

---

## MODERATION AND PRIVACY

- Report flows for messages, groups and communities
- Admin manages groups, communities, owners, moderators, join rules and abuse reports
- **Admin must not casually expose private communication content.** Access to private content is
  restricted, requires justification, and is audit-logged.

---

## EXIT CRITERIA

1. Messages deliver reliably and exactly once under flaky networks and app restarts.
2. Receipts, typing and presence are accurate.
3. Community member lists are provably hidden from ordinary members at the API level.
4. 1-to-1 and group calls connect across NATs, with TURN fallback verified.
5. Incoming calls ring natively on both platforms when the app is backgrounded.
6. Admin moderation actions on chats and communities write audit records.
