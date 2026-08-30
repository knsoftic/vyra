# PHASE 9 — LIVE STREAMING, COINS AND GIFTS

**Status:** Not started · **Depends on:** Phase 8
**Gate:** wallet ledger reconciles; concurrent gift sends cannot double-spend.

---

## OBJECTIVE

Live broadcasting with real-time interaction, and the money layer that powers it.

---

## LIVE STREAMING

Start live · title · category · thumbnail · viewer count · comments · likes · gifts · follow · share ·
guest · co-host · block · mute · report · end live.

**Architecture:** WebRTC ingest from the app → SFU media server → LL-HLS to viewers. Guests and
co-hosts join over WebRTC. Chat, likes and gifts ride the Socket.IO layer.

**Admin controls:** view active lives with host, viewer count, reports, gifts and duration; force
stop a live; warn the host; mute live chat; ban a user; revoke live permission.

---

## COINS

Users can buy coins, view balance, view transaction history, send gifts and promote videos.

**Every transaction is permanently recorded** with:
`transaction_id · user · type · amount · previous_balance · new_balance · payment_reference ·
status · timestamp`

### Ledger rules (ADR-013)
- The ledger is append-only and immutable; the balance is derived from it
- Every mutation happens inside a database transaction with row locking
- All money endpoints require an `Idempotency-Key`
- A reconciliation job continuously verifies balance equals ledger sum

### Prevented by design
Duplicate transactions · double spending · replay attacks · unauthorized balance changes.

---

## GIFTS

Catalogue examples: Rose · Heart · Star · Crown · Trophy · Diamond.

Admin manages: name · icon · animation · coin cost · status · featured.

Sending a gift is a single atomic operation: debit sender, record gift transaction, credit recipient
earnings, emit the animation event. Any failure rolls the whole thing back.

---

## PAYMENTS

- Coin packages with currency, bonus coins and discounts, configurable per region
- Payment provider integration with **server-side verification** — amounts are never trusted from
  the client
- Webhook signature verification on every callback
- Payment states: successful · failed · pending · refunded
- Admin can search payments by user, transaction, payment reference or date

### Admin wallet powers
Manually credit coins · manually debit coins **with a mandatory reason** · freeze a wallet.
**Every manual wallet change writes an audit record.** No exceptions.

---

## EXIT CRITERIA

1. A live stream starts, is viewable, accepts comments, likes and gifts, and ends cleanly.
2. Guests/co-hosts join and leave without disrupting the broadcast.
3. Admin can force-stop a live and the client handles it gracefully.
4. Coin purchase completes with server-side verification and a ledger entry.
5. Concurrent gift sends from the same wallet cannot overdraw it (load-tested).
6. Reconciliation reports zero drift after a load test.
7. Every manual admin wallet action appears in the audit log with its reason.
