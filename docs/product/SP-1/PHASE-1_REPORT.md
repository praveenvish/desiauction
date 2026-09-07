# SP-1 PHASE 1 — SPORT BECOMES A DIMENSION · IMPLEMENTATION REPORT

## DesiAuction NEXT · 2026-09-05 · Engineering · **Status:** COMPLETE

Migration **0046**. A competition can now say which sport it is, and the read
path acts on the answer. One migration, one new table, two columns, no
behaviour change for anybody running cricket.

---

## 1 · What was built

| Piece | Where |
|-------|-------|
| `sports` catalogue — one row per shipped pack, with an `enabled` flag | migration 0046, `schema.ts` |
| `competitions.sport`, `tournaments.sport` — `NOT NULL DEFAULT 'cricket'`, FK to `sports.key` | migration 0046 |
| `sportPackFor(key)` — the read path's resolver | `packages/core/src/sports/index.ts` |
| `enabledSports` / `sportCatalogue` / `isSportEnabled` | `server/competition/sports.ts` |
| Sport on the create path — writer, action guard, self-adjusting picker | `competitions.ts`, `actions.ts`, `create-competition-form.tsx` |
| `sportCatalogueProjection` + read-only panel on `/admin` | `server/admin/views.ts`, `app/admin/page.tsx` |

**176 existing competitions backfilled to `cricket`**, verified in Postgres.

## 2 · The foreign key is the design

`competitions.sport` references `sports.key`, and a catalogue row exists only
for a pack that shipped. That makes *"a season cannot name a sport the platform
has no pack for"* a fact about the database rather than a convention somebody
remembers. The registry (what we CAN run) and the catalogue (what is switched
ON) stay separate, and the FK is the join between them.

## 3 · Why the default is honest here

`DEFAULT 'cricket'` backfills truthfully: every competition and tournament on
the platform today *is* cricket, because there has never been a way to create
anything else. That is the opposite of `demo_requests.sport` (0045), which had
to stay **nullable** — there the question had never been put to anyone, and a
default would have invented an answer in the one column that exists to be
counted.

The default survives Phase 1 deliberately: with one sport enabled it stays true
and keeps every existing insert path working untouched. **Phase 2 drops it**, on
the day a second pack makes it a lie.

## 4 · The deviation: no admin toggle

The plan said "sports catalogue, admin toggle". The catalogue shipped; the
toggle deliberately did not.

Platform administration is *provably* read-only, held by three locks — a
structural one, the `admin-is-read-only` dependency rule, and a runtime proof
that drives every projection through a handle which throws on mutation. A fourth
lock, a source-level scan, permits a write verb in exactly one file
(`access-log.ts`). That file's header states the test: administration may record
its own observation, but it *"cannot ACT on the platform"*.

Enabling a sport is acting on the platform. It is also always a deploy — the
flag cannot usefully move ahead of the pack it names — so a click-toggle over a
two-row list would spend a hard-won property to save editing a seed. The
catalogue is seeded by migration and `/admin` observes it, which is what
administration is for.

`access-log.ts` predicted this exact moment: *"the day someone needs a button
here, this rule fails and the conversation happens at review, not in
production."* This is that conversation, and the answer is: not yet. When a
pilot-org toggle has a real user, the table is already the right shape.

**The read-only proof is unchanged and still green** (26 tests).

## 5 · The Phase 0 promise, collected

Phase 0 left `results.ts` reaching for `DEFAULT_SPORT`, with a comment saying
the right pack was the competition's and the compiler would say so once the
column existed. It did. `recordFixtureResult` now joins `competitions`, resolves
the season's pack, and judges the scoreline by *that* pack's bounds. The
score-plausibility check is the first thing on this platform to behave according
to a competition's own sport.

## 6 · This was built ahead of its gate

`PLAN.md` §5 gates Phases 1–4 on demand data from `/schedule-demo`. That gate
was **not** met. Phase 1 was built on an explicit instruction after the
rationale was put twice and overruled, and this section exists so nobody later
reads the code as evidence the gate was satisfied.

The distinction that makes it defensible: Phase 1 is sport-*agnostic*
scaffolding. It names no second sport and encodes no guess about which one is
next, so it costs little if the answer turns out to be "cricket only". The
expensive, guess-dependent work is **Phase 2 — writing the second pack** — and
that is still gated, still unwritten, and still the thing the demand data
decides. `demo_requests.sport` keeps collecting.

## 7 · Operational note — READ THIS BEFORE DEPLOYING

**CORRECTED 2026-09-07 — no recipe re-run was needed.** This section originally
said `sports` would be invisible to `desiauction_app` until
`ops/db/create-app-role.sql` was re-run. That was wrong, and it was wrong
because it trusted that file's header comment ("grants are static by design, no
ALTER DEFAULT PRIVILEGES") over the six `alter default privileges` statements 47
lines below it, which have covered the app role since they landed.

Verified rather than argued: `sports` and `player_sport_profiles` both carry
`SELECT, INSERT, UPDATE, DELETE` for `desiauction_app` with no recipe run, and
`pnpm --filter @desiauction/web grants:verify` reports **292 expectations across
62 tables and 4 roles** — a real pass, because the verifier enumerates tables
from `pg_tables` at runtime rather than from a list, so both new tables were
genuinely checked.

What DOES still need a re-run is a new table that `desiauction_system`,
`_engine` or `_runner` must reach: their grants are enumerated per table on
purpose, because a least-privilege role that silently acquires every future
table is not least-privileged. Neither of these two tables is in that position.
The recipe's header has been corrected so the next reader is not sent the same
way.

## 8 · Verification

| Gate | Result |
|------|--------|
| `pnpm verify` | **green** (lint, typecheck ×11, unit, format, depcruise, motion) |
| `packages/core` unit | **469 passed** |
| `pnpm test:integration` | **928 passed** (72 engine + 856 web) |
| `pnpm check:posture` | green — `sports.ts` listed `by-design` (global reference data, no tenant to scope to) |
| Admin read-only proof | **26 passed**, unchanged |
| Full e2e, precompiled | **99 passed, 29 skipped, 0 failed** |

Two e2e specs flaked under the 6.9m serial run (`auction-experience`,
`conduct-ceremony`) and pass **3/3 in isolation in 1.3m**. Both are the long
gavel-timer journeys; neither touches the sport dimension.

## 9 · What Phase 1 deliberately did not do

- **No second pack.** `cricket.ts` is still the only one.
- **No `registrations.role` change** — it stays `NOT NULL` with its four-value
  enum until Phase 2 opens it.
- **No terminology dictionary**, no `score jsonb`, no standings tiebreaker
  chain. All Phase 2.
- **No admin write** — §4.
