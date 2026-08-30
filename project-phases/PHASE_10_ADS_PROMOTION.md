# PHASE 10 — ADS, PROMOTIONS AND BUSINESS SYSTEM

**Status:** Not started · **Depends on:** Phase 7, Phase 9
**Gate:** campaign budget cannot be exceeded; no fake engagement is ever generated.

---

## OBJECTIVE

Let creators promote videos and businesses run self-service campaigns, delivered through the real
recommendation system.

---

## VIDEO PROMOTION (creator-facing, coin-funded)

Campaign goals: views · reach · profile visits · followers · website traffic · engagement
opportunity · awareness.

Flow: pick video → pick goal → pick audience → set coin budget → set duration → see estimated reach →
confirm → track results.

> **Promotion buys distribution, nothing else.
> The platform never creates fake likes, fake followers or fake comments.**
> Promoted videos enter the same feed as organic content and are shown to real, relevant users. All
> resulting engagement is genuine.

### Admin boost settings
Minimum coins · maximum coins · daily budget · campaign duration · estimated reach formula ·
promotion categories · restricted content rules · boost availability.

---

## ADVERTISING SYSTEM (business-facing)

Formats: in-feed ads · sponsored videos · promoted videos · banner advertising · business promotion ·
app promotion · website traffic campaigns.

Objectives: awareness · reach · video views · engagement · followers · profile visits ·
website traffic · leads · app promotion.

### Structure
```
Campaign (objective, budget, schedule)
└─ Ad Group (targeting, bid, placement)
   └─ Creative (video, caption, CTA, landing destination)
```

### Audience options
| Mode | Behaviour |
|---|---|
| Automatic | The system selects the audience |
| Custom | The advertiser selects targeting |
| Broad | Minimal targeting, maximum reach |

Allowed targeting criteria: country · city · language · interests · categories · device ·
operating system · age where legally permitted.

**Never allowed as targeting criteria:** sensitive personal characteristics.

### Delivery
Auction-based, blended into the organic feed at an admin-configured density. Ad relevance is scored
by the same engine, so poor ads are shown less rather than being force-fed.

### Budget safety
- Spend is checked before every delivery decision
- Daily and lifetime caps are hard limits
- Overspend is structurally impossible; spend reconciliation runs continuously

---

## BUSINESS ACCOUNTS

Business profile · category · website · contact information · call-to-action button · advertising
access · campaign manager · business analytics · verification eligibility.

---

## CREATOR DASHBOARD

Followers · follower growth · likes · views · watch time · average watch duration · completion ·
rewatch · shares · saves · profile visits · gifts · audience categories · best videos · promotions ·
revenue where enabled.

---

## ADMIN AD MANAGEMENT

View campaigns · approve · reject · pause · resume · disable · view spend · view targeting · view
performance · set minimum budget · set maximum budget · configure ad pricing.

---

## EXIT CRITERIA

1. A creator can promote a video with coins and see real, attributable results.
2. A business can build a campaign end to end and it delivers.
3. Budget caps hold under concurrent delivery (load-tested).
4. Admin approval gates campaigns before they run.
5. Audit confirms **zero** synthetic engagement anywhere in the system.
6. Analytics reconcile between the advertiser view and the admin view.
