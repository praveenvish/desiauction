# COMPETITION RUNBOOKS

## DesiAuction NEXT · v1.0 · 2026-07-14 · CTO · **Permanent engineering asset** (IP-3, M-IP3-4)

> Operator procedures for implemented behavior. Every mutation below is audited; when in
> doubt, the audit timeline (per registration / per fixture) is the source of truth.

## R-1 · Stand up a competition from nothing (the canonical walkthrough)

1. Sign in → create/open your organization → **Venues** → create the venue, add grounds
   (surface, capacity, floodlights, indoor).
2. **/competitions** → create the competition with name, location, start/end dates
   (required before intake can open).
3. Competition page → **Begin setup** → **Open registration**; share the registration
   link. Add teams (unique names).
4. **Manage registrations** → import players by CSV or triage self-service submissions;
   approve/waitlist/reject (reason required, never shown to players).
5. **Fixtures** → Generate (rounds, start date, kickoff times, grounds) → review drafts →
   **Schedule all drafts** → **Publish schedule**.
6. Browse **Calendar** / **Match day**; **Export CSV** for circulation.

## R-2 · A published fixture must move (rain, ground clash, team request)

Published fixtures never move by edit — use **Move** (the reschedule workflow) on the
fixtures dashboard. Pick the new kickoff/ground; blocking conflicts (team/ground
double-booking, outside window) are refused with the reason; resolve by choosing a free
slot. The audit row `fixture.rescheduled` records old → new. If the fixture cannot be
played at all: **Cancel** (optionally with a reason) — the slot is released, the row and
history remain.

## R-3 · A ground becomes unavailable

Org page → **Venues** → mark the ground **unavailable**. It leaves every scheduling
picker and generator immediately. Existing fixtures on it are NOT auto-moved (no hidden
mutations): filter the fixtures dashboard by that ground and Move each one. Mark
**active** again when restored.

## R-4 · The whole schedule is wrong — regenerate

Generation is refused while any non-cancelled fixture exists (stable numbers are never
reallocated). Procedure: cancel the wrong fixtures (bulk: filter → cancel each; every
cancel is audited), then Generate again with corrected inputs. Identical inputs always
produce the identical schedule — verify inputs, not luck.

## R-5 · Import went wrong

Both imports (registrations, fixtures) validate the ENTIRE file before writing and commit
atomically — a failed import wrote nothing; fix the reported line errors and retry.
A *successful but mistaken* registration import: the created registrations are in
`submitted` — bulk-reject with reason `other` (players never see reasons). A mistaken
fixture import: the fixtures are drafts — cancel them. Re-running a registration import
skips already-registered people (`duplicates` count), so re-import after fixing rows is
safe.

## R-6 · A rejected/withdrawn registration must come back

Dashboard → the row → **Restore** (the only exit from rejected/withdrawn; returns to
`submitted` for re-triage and clears rejection provenance). There is no path that skips
the human approval gate.

## R-7 · Conflict panel triage

The fixtures dashboard lists every conflict involving this competition. **Blocking**
(red) should be impossible for live fixtures — if one appears it involves drafts
(they hold slots deliberately): edit or cancel one of the drafts. **Warnings** (amber:
same-venue overlap, same-pair same-day) are legal; review and either Move a fixture or
accept the warning.

## R-8 · Suspected cross-tenant access

Non-members resolve every competition/org slug to 404 by design — a member reporting
"someone else's data" is a P0. Verify: run the integration suite's RLS proofs
(`pnpm --filter @desiauction/web test:integration`, the `RLS PROOF` / `RLS WRITE PROOF`
tests), and inspect `audit_log` for the reported scope (`scope_id = <orgId>` ordered by
`at`). Every mutation has an actor; there is no unaudited write path.

## R-9 · Verify the subsystem after any change (the freeze bar)

`pnpm verify` (types, lint, unit, format, boundaries) → `pnpm --filter @desiauction/web
test:integration` (real PG; includes RLS + rollback + scale proofs) → `npx playwright
test` in `apps/web` (founder journeys + axe) → `pnpm --filter @desiauction/db db:migrate`
(idempotence) → `pnpm build`. Performance evidence: `pnpm --filter @desiauction/web
perf:competition` (seeds, measures, cleans up; numbers in
[PERFORMANCE](PERFORMANCE.md)). All green = the Competition contract holds.
