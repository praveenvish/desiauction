# WR-1 — My plan (the owner's private auction plan)

Status: **Phase 1 complete — M1–M5 landed 2026-09-03 (schema, policy, rules module, server layer, plan page, live Owner Room, organizer switch, e2e).**
Product name: **My plan** (engineering shorthand: war room). Phase 1 is deterministic; no AI.

## Decisions (binding for Phase 1)

- **Not auction truth.** The engine never reads the plan, the snapshot never carries it, and
  nothing derived from it can place or refuse a bid. The plan is served from the web tier
  beside the snapshot (the `lotMedia` pattern) and folded client-side on every frame.
- **Keyed by registration, not lot.** Lot ids die with an abandoned auction; registrations
  survive into the recreated one.
- **No revised price per player, ever.** The fold states facts and consequences (exposure,
  headroom, fit, the amount to recover, which targets could be shed) and never edits or
  proposes a max on a named person. Opportunity detection and scarcity judgments wait for
  squad requirements to exist as data (Phase 2).
- **Participant-scoped RLS.** `auction_team_targets` and `auction_team_target_revisions` carry
  the org floor **and** a participant arm (live paddle grant ∪ held paddle ∪ accepted owner
  invite for that team of that auction) in the policy itself — the first tables in the schema
  to do so. Organizer, rival and plain member are equally blind at the database.
- **Target edits are not audited.** Org admins read `audit_log`; an edit timestamp during a
  lot is itself a leak. History lives in the private, append-only revisions table. Only
  feature-switch flips are audited.
- **First feature-flag table.** `feature_settings` (platform / org / auction rows) with
  absence = code default and layers that only subtract (`resolveFeature`, order env → tier →
  platform → org → auction). `auctions.config` was not used: it locks at creation.

## M1 — what landed and how it was proven

| Piece | Where |
|---|---|
| Tables + FKs + policies | `packages/db/migrations/0041_my_plan.sql`, journal idx 41 (`when` 1787241600000) |
| Drizzle schema | `packages/db/src/schema.ts` (`auctionTeamTargets`, `auctionTeamTargetRevisions`, `featureSettings`) |
| Rules module | `packages/core/src/team-plan.ts` (`evaluatePlan`, `whatIf`, `ladderFloor`, `validateTargetMax`, `fallbackWouldCycle`) + 28 tests |
| Feature resolver | `packages/core/src/feature-settings.ts` (`FEATURES.my_plan`, `resolveFeature`) + 9 tests |
| Role recipe | `ops/db/create-app-role.sql`: engine/runner lose SELECT on the plan tables; revisions append-only for every role |
| Gates | `apps/web/scripts/verify-grants.ts` (private-table expectations), `apps/web/scripts/verify-rls.ts` (participant proof replaces the org-count equality for participant-scoped tables) |

Proven locally on 2026-09-03: migration applied from scratch; `grants:verify` green (285
expectations); under `desiauction_app` a real participant sees their team's rows, a same-org
non-participant sees none and cannot insert (RLS refusal), revisions cannot be updated
(permission denied), and no context sees nothing. Core suite 431/431, typecheck, lint,
prettier and depcruise green.

**Operator note:** after applying 0041 in any environment, re-run `ops/db/create-app-role.sql`
(or at least its two WR-1 `revoke` statements) — `grants:verify` fails until you do.

## M2 — what landed and how it was proven

| Piece | Where |
|---|---|
| Storage + validation | `apps/web/src/server/auction/owner-plan.ts` (`planLots`, `targetsOf`, `addTarget`, `updateTarget`, `removeTarget`, `validateTarget`, `pickPlanTeam`, `teamStanding`, `planRulesOf`) |
| Actions (`"use server"`) | `apps/web/src/server/auction/owner-plan-actions.ts` (`planView`, `addTargetAction`, `updateTargetAction`, `removeTargetAction`) — gate is `liveGate(slug).myTeamIds`; null = 404 for feature-off, not-in-room and not-your-team alike; writes refused once the auction is terminal |
| Feature resolver | `apps/web/src/server/feature-settings.ts` (`featureEnabled`, `setAuctionFeature` with in-transaction audit `auction.feature_toggled`); env kill switch `MY_PLAN_DISABLED` in `apps/web/src/env.ts` |
| Suites | `owner-plan.regression.test.ts` (13: pool, refusals, revisions, per-team isolation, fold from rows, switch layers + audit), `owner-plan-guardrail.test.ts` (admin, engine and auction package never name the plan tables) |

Proven locally on 2026-09-03: 19/19 including the client-boundary regression; typecheck, lint,
prettier, depcruise green; the suite tears down to zero residue. The RLS participant arm is
NOT exercised by these suites (local runs as owner) — see M1's probe and `rls:verify`.

## M3 — what landed and how it was proven

| Piece | Where |
|---|---|
| Route | `apps/web/src/app/seasons/[slug]/auction/plan/` — `layout.tsx` (name gate with its own return address), `page.tsx` (`planView` → 404 on null; Live shell via `plan` in `LIVE_SEGMENTS`; mounts its own `AnnouncerProvider`), `plan-panel.tsx` (client), `plan-model.ts` (pure helpers + 5 tests), `plan.css` |
| Behaviour | search-to-add (tokens over name / number / role; decided lots and existing targets excluded), inline max in rupees (blur or Enter saves), priority, backup, remove; the fold re-runs client-side on every change; errors render under the field; read-only once the auction is terminal |
| Doors | auction hub "My plan" (`viewer.planAvailable` = holds a team ∧ feature on); the plan page's exits lead to the Owner Room and the hub. The Owner Room's own door arrives with M4 |
| View additions | `PlanView.planRules` (money-typed rules for the client fold) and `PlanView.lotMedia` (consent-gated photos) |

Proven locally on 2026-09-03 by driving the page in headless Chromium against the dev
server as a real owner: add → max ₹5,00,000 → headroom fell by exactly that; priority change;
second target; 390px viewport with no horizontal overflow; hub door visible; zero console
errors; anonymous visit 307s to /login. Screenshots reviewed at 1280 and 390. Running it
caught one real defect the gates could not: the Live shell has no `AnnouncerProvider`, so
`useAnnouncer` threw — the page now mounts its own.

## M4 — what landed and how it was proven

| Piece | Where |
|---|---|
| View | `LiveAuctionView.planAvailable` (the door) and optional `plan` (`LivePlan`: lots with the registration join, money-typed rules, targets keyed by the viewer's own team ids; omitted when off / no team / nothing planned) — built by `livePlanFor` inside the existing tenant transaction in `live-actions.ts` |
| Client fold | `apps/web/src/app/seasons/[slug]/auction/plan-live.ts` (`liveLots` precedence block → history → queue → server; `liveCurrentLot` decides "leading" by team; `evaluateLivePlan`; `backupFor`) + 5 tests |
| Surfaces | fourth tile `my-plan-headroom` on `MyTeamCard` (headroom + Fits / At risk / Over purse); `PlanLine` (`plan-line.tsx`) under the raise button in `PaddleControl` with a verdict-only polite live region; "My plan" door in the room's exits |
| Untouched | engine, snapshot, WS protocol, ledger, `AuctionAnnouncer`, `auction.css` (styles live in `plan/plan.css`, imported by the live page) |

Proven locally on 2026-09-03 against the real engine: with a target planted at the next lot's
base price, the room showed the headroom tile and the door between lots; `OpenLot` made the line
read WITHIN YOUR PLAN (max ₹10,000 · next bid ₹10,000); a rival's `PlaceBid` flipped it to OVER
YOUR MAX BY ₹5,000 within one frame; no horizontal overflow at 390px; zero console errors.
Screenshots reviewed at 1280 and 390. An owner with no targets receives no `plan` key and the
room renders as before (plus the door in the exits).

## M5 — what landed

| Piece | Where |
|---|---|
| Organizer switch | `setAuctionFeatureAction(slug, enabled)` in `server/auction/actions.ts` (conduct-gated; row + audit `auction.feature_toggled` in one transaction via `setAuctionFeature`); `AuctionDashboard.ownerPlans` (enabled + which layer decided, conductors only); the "Owner plans" row on the lifecycle card in `auction-panel.tsx`, disabled with an explanation when the platform, org or deploy layer said no |
| E2E | `auction-experience.spec.ts` gains: owner A builds a two-target plan with ₹12,000 maxes; the organizer switches owner plans off (plan page 404s, door and tile vanish) and on again (plan intact); on the block the line reads within → over by ₹8,000 → leading past the max; the headroom tile follows the purse; **served-bytes blindness** (`request.get(...).text()`: A's Owner Room carries `targetsByTeam`/`maxBid`, B's Owner Room and the public stage carry neither); read-only plan with "Signed" after completion; axe + no-overflow at 360px on the plan page |
| Warm list | `/seasons/warmup/auction/plan` in `e2e/global-setup.ts` |

Proven locally on 2026-09-03: `auction-experience.spec.ts` 2/2 green against the **precompiled**
server (`NEXT_DIST_DIR=.next-e2e next build`, then `ALLOW_INSECURE_LOCAL_PRODUCTION=1
PLAYWRIGHT_PRECOMPILED=1 playwright test`). Under `next dev` the same run failed twice at the
organizer's first login (empty response / connection reset from the cold compiler) — the harness
class the memory already records, not the feature. One real defect surfaced by the run: the
organizer's switch was fully server-controlled, so a click snapped back before the refresh and
read as "did not change state"; it is now optimistic and reconciled like the messaging switches.

## Remaining

- Nothing in Phase 1 scope. Phase 1.5 items are listed above.

## Rules of the fold (for reviewers)

- planned amount = max, else the lot's base price (flagged "counted at base")
- exposure = Σ planned over open targets; headroom = purseRemaining − exposure
- slotsAfterPlan = max(0, squadMin − squadSize − openTargets); reserve = slots × minPossiblePrice
- fits: headroom ≥ reserve · at risk: 0 ≤ headroom < reserve · does not fit: headroom < 0
- lot: leading · engine ceiling (squad full or next bid > `maxAffordableBid`) beats everything ·
  target with no max · within plan (next ≤ max) · over max (next > max, difference stated)
- backup: follow fallback pointers from a lost/unavailable target to the first open player
