# Investment Ledger — outcomes over outputs

> Outcome Governance: an investment is not "done" when it merges. Each records a
> **hypothesis**, a **metric**, and evidence at three levels —
> **Output** (shipped) → **Outcome** (behaviour changed) → **Impact** (business
> metric moved). Status: `Hypothesis | Measuring | Validated | Rejected`.
>
> **Honest baseline:** DesiAuction is pre-launch (RC-1). Every Output below is
> verified; every Outcome/Impact is `Hypothesis` because there is no real
> organizer traffic yet. What changed this iteration: the **measurement substrate
> now exists** (`adminOutcomes` over the audit log), so these can advance to
> `Measuring` the moment traffic arrives — they are no longer unmeasurable.

## Evidence source

`adminOutcomes(windowDays)` → `outcomesProjection` (`server/admin/views.ts`) folds
the **audit log** (durable, server-side truth) via the pure core `summarizeOutcomes`.
Surfaced on `/admin` ("Outcomes · last 30 days"). Audit is the source, not client
telemetry (there is no analytics sink yet). Metrics: competitions created, cloned,
clone-share, repeat orgs + rate, registrations, players placed.

---

## INV-1 · Competition share card (OG/Twitter)

| | |
|---|---|
| **Capability** | Acquire Players / Share Results |
| **Problem** | Every shared `/c/[slug]` link previewed blank — the WhatsApp loop was invisible. |
| **Hypothesis** | If shared competition links render a rich card, click-through → competition-view rises. |
| **Implementation** | `buildCompetitionShareCard` + `next/og` routes (`c03e088`). |
| **Metric / Method** | Referral-sourced competition views / (needs UTM or referrer capture — not yet wired). |
| **Success threshold** | ≥ 10% of new competition views from shared links. |
| **Review window** | 30 days post-launch. |
| **Output** | ✅ Shipped, RUNTIME-verified raster. |
| **Outcome / Impact** | — |
| **Status** | **Hypothesis** (measurement needs referrer capture — see Future). |

## INV-2 · Player profile + share card

| | |
|---|---|
| **Capability** | Acquire Players / Referral |
| **Problem** | Players had no shareable identity; the biggest viral unit was unaddressable. |
| **Hypothesis** | If a player can share their own card, registrations from player referrals rise. |
| **Implementation** | `/c/[slug]/p/[number]` page + player OG card (`cf44c57`). |
| **Metric / Method** | `showcase.player_profile_opened` telemetry + registrations referred from `/p/`. |
| **Success threshold** | ≥ 15% of registrations touch a player profile first. |
| **Review window** | 30 days post-launch. |
| **Output** | ✅ Shipped, RUNTIME-verified raster; page noindex. |
| **Outcome / Impact** | — |
| **Status** | **Hypothesis**. |

## INV-3 · "Run it again" (clone competition)

| | |
|---|---|
| **Capability** | **Retain Organizers** (weakest Tier-A) |
| **Problem** | A second season meant re-entering teams, branding, config — a hard stop on repeat usage. |
| **Hypothesis** | *If organizers can clone a competition, repeat competition creation increases.* |
| **Implementation** | `cloneCompetition` + `cloneCompetitionAction` + "Run it again" (`cf26758`). |
| **Metric / Method** | `cloneAdoptionRate` (clones / creations) and `repeatOrgRate` — **both now in `adminOutcomes`**. |
| **Success threshold** | `cloneAdoptionRate ≥ 20%`, or a measurable lift in `repeatOrgRate` vs pre-feature. |
| **Review window** | 60 days post-launch. |
| **Output** | ✅ Shipped, RUNTIME-verified on PG17. |
| **Outcome / Impact** | Baseline 0 (pre-launch); **measurement wired** (INV-4). |
| **Status** | **Measuring** (substrate live; awaiting traffic). |

## INV-4 · Outcome measurement substrate

| | |
|---|---|
| **Capability** | Observability / measure the funnel |
| **Problem** | None of INV-1..3 could produce Outcome/Impact evidence — the funnel was unmeasured. |
| **Hypothesis** | If outcome metrics are visible, roadmap decisions become evidence-driven, not guesses. |
| **Implementation** | `summarizeOutcomes` (core) + `outcomesProjection` (read-only audit projection) + `/admin` Outcomes section (this iteration). |
| **Metric / Method** | Meta: are investments advancing past `Hypothesis`? |
| **Output** | ✅ Shipped; core 6 tests + RUNTIME projection on PG17. |
| **Status** | **Validated (output)** — INV-3 advanced to `Measuring` because of it. |

---

## Lessons learned
- Measurement is a prerequisite, not a follow-up. Three features shipped before
  anything could tell whether they worked. INV-4 should have been earlier.
- The **audit log** is a better outcome source than client telemetry here: durable,
  server-side, already emitted by every write — no analytics sink required.
- A clone emitting both `competition.created` and `competition.cloned` means
  retention shows up automatically in `repeatOrgRate` — instrument the *primitive*,
  get the metric for free.

## Future opportunities (ranked by the ledger)
1. **Referrer / UTM capture** on `/c/[slug]` and `/p/` → unblocks INV-1/INV-2
   Outcome measurement (currently their only gap).
2. **Post-auction organizer hub** — results + share + "Run it again" in one moment;
   compounds INV-2 (share) and INV-3 (retention).
3. **Trend, not snapshot** — persist daily outcome rollups so `repeatOrgRate` can be
   compared *before/after* a feature (the experiment loop needs a baseline series).
4. **Monetize** — still Tier C (commercial decision); revisit once retention shows signal.
