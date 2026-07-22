# Product Strategy — living governance ledger

> Engineering serves product strategy; product strategy serves business outcomes.
> Updated per iteration. Every investment below names the business metric it moves.
> **Honesty note:** DesiAuction is pre-launch (RC-1). The North-Star *values* are
> not yet measured — several aren't even instrumented. Health ratings are a
> product judgment from what is built, not from usage data. Marked as such.

## The three questions (answered before each portfolio review)

1. **Why does this product exist?** To let grassroots/amateur cricket organizers
   run IPL-style **live player auctions** — build a player pool, let team owners
   bid to form squads, broadcast it, settle — productized, multi-tenant,
   auditable, accessible. The incumbent (Super Player Auction) does this without
   any of those platform qualities.
2. **Which segment creates the most value?** The **organizer**. They create the
   competition (the unit of value *and* of monetization), invite players, run the
   auction, and decide to come back. Players and spectators drive volume and
   virality, but organizers create competitions. Optimize the organizer's path to
   a *completed auction* and to their *next* competition.
3. **Which business metric should improve next?** **Repeat Usage / Competition
   Creation** — see the capability map: acquisition was just strengthened twice;
   the weak, engineering-addressable link is now *retention*.

## North-Star metrics

| Metric | Why it matters | Instrumented? |
|---|---|---|
| Organizer Activation (signup → 1st competition) | Leading indicator of everything | Partial — `org.created`, onboarding events exist; no funnel rollup |
| Competition Creation (per org) | The value + revenue unit | Not yet (audit `competition.created` exists; not aggregated) |
| Registration Conversion (view → submit) | Fills the pool | Partial — `showcase.*` + register events; no rollup |
| Auction Completion (opened → settled) | The core promise delivered | Not yet (settlement state exists; no metric) |
| **Repeat Usage (org runs a 2nd+ competition)** | **Retention → LTV → monetization** | **Not yet — no re-engagement path even existed** |
| Public Share Rate / Referral Rate | Cheap acquisition loop | Partial — `showcase.exported`, `showcase.player_profile_opened`; OG shares not measurable server-side |
| Revenue per Competition | The business | **Not started (Tier C — commercial decision)** |

**Systemic finding:** the business largely cannot see its own funnel yet. A
business-metrics rollup over the existing telemetry + audit log is a ranking
Observability investment (backlog), but it does not by itself create customer
value, so it trails a retention feature that does.

## Business capability map — health

`Acquire → Register → Run Auction → Manage → Publish Results → Share Results → Retain Organizers → Monetize`

| Capability | Health (judgment) | Note |
|---|---|---|
| Acquire Players | **Healthy** ↑ | Showcase, share links, competition + player OG cards (last 2 iterations) |
| Register Players | Healthy | PX-3/PX-5: 3-step register, draft recovery, self-photo, profile |
| Run Auction | **Strong (moat)** | Deterministic engine, cockpit, board, overlay, spectate, ceremony |
| Manage Competition | Healthy | PX-4 workspace, readiness centre, teams, assign |
| Publish Results | Healthy | PX-7 settlement, squads CSV, results |
| Share Results | Healthy ↑ | Share-card platform (this programme) |
| **Retain Organizers** | **Weak** ← selected | No repeat-usage path: re-running a competition meant re-entering everything |
| Monetize Platform | **Weak (Tier C)** | Pricing page only; plans/paywall need a commercial decision — **escalate, do not self-decide** |

**Rule applied:** *never optimize a healthy capability while a weaker one limits
the business.* Acquisition/Share are now healthy → stop investing there. Monetize
is the ultimate metric but Tier C. The highest-ROI **Tier-A** move is the weakest
addressable link: **Retain Organizers**.

## Selected investment — "Run it again" (clone a competition)

| Field | Value |
|---|---|
| Business metric | **Repeat Usage / Competition Creation** (→ Organizer Retention → monetizable events) |
| Expected impact | Collapses the #1 cost of a second season — re-entering teams, branding, config — to one click. The classic retention lever for event-based SaaS. |
| Capability | Retain Organizers (weakest Tier-A) |
| Scope (safe default) | New **draft** competition in the same org: name (trailing season year bumped), location, **team shells** (name/short/colour/coach). **NOT** the player pool (no PII copy — fresh registration), fixtures, or auction state. |
| Risk | Write path, but composes existing capability-gated, audited primitives; no migration, no engine, no money. Schema-free rollback preserved. |
| Evidence | Pure core (`nextSeasonName`) unit-tested; `cloneCompetition` RUNTIME-tested on PG17; `competition.cloned` audit + telemetry for the metric. |

## Escalations (owner decisions, not engineering)
- **Monetization model** (plans, paywalled competitions, payment provider) — needs
  a commercial/legal decision + credentials. Flagged, not built.
- **Real North-Star measurement** requires a decision on an analytics sink; until
  then metrics stay instrumented-but-not-rolled-up.
