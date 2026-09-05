# SP-1 PHASE 0 — THE SPORT REGISTRY · IMPLEMENTATION REPORT

## DesiAuction NEXT · 2026-09-05 · Engineering · **Status:** COMPLETE

Phase 0 introduces **zero migrations, zero database change and zero new
surfaces**. It moves a vocabulary that was already in the product into one
place, and adds a test that keeps it there. Net **−95 lines**.

---

## 1 · What was built

| File | Purpose |
|------|---------|
| `packages/core/src/sports/types.ts` | The `SportPack` contract — roles, attributes, score fields, points. |
| `packages/core/src/sports/cricket.ts` | Cricket's whole vocabulary, carried over unchanged. |
| `packages/core/src/sports/index.ts` | The registry and pack-generic readers (`parseRoleIn`, `roleLabelIn`, `attributeOptionLabel`, `scoreWithinBounds`, …). |
| `packages/core/src/sports/registry.test.ts` | 18 tests, including the drift guard (§4) and an alias-ambiguity check. |
| `packages/core/src/sports/sport-vocabulary.test.ts` | The boundary guardrail (§3). |

Every helper takes the pack as its **first argument** rather than reaching for a
default. That is the shape Phase 1 needs; until `competitions.sport` exists,
callers pass `DEFAULT_SPORT`, and when it arrives the compiler produces the list
of callers that still assume one sport.

## 2 · The defect this closed

The four playing roles were declared **six** times:

| # | Where | What |
|---|-------|------|
| 1 | `core/player-profile.ts` | The enums, labels and the form-spelling aliases |
| 2 | `core/competition.ts` | `REGISTRATION_ROLES`, a second literal union |
| 3 | `apps/web/src/lib/playing-roles.ts` | A third label map — **module deleted** |
| 4 | `teams-panel.tsx` | A fourth label map |
| 5 | `teams-panel.tsx` | A hardcoded role display-**order** array |
| 6 | `register-flow.tsx` | A fifth label map — in the **public registration form** |

Copies are the disease; drift is the symptom. Two of those maps spelled
`all_rounder` **"All-rounder"** and two spelled it **"All rounder"**, so a player
read as one thing on their share card and another in the registrations table.

Copies 5 and 6 were found by the guardrail, after the visible ones had been
fixed and the work looked finished.

## 3 · The guardrail

`sport-vocabulary.test.ts` fails the build on a second copy. It flags three
things, deliberately not a fourth:

- **two or more distinct role tokens in one file** — that is a list or a map,
  never a use. A single role value in ordinary use is not an offence, and
  flagging it would make the test noise;
- **any role label in quotes** — the offence that actually shipped. Both losing
  spellings are in the pattern, so the one that lost cannot come back;
- **any batting/bowling style token** outside the pack.

Comments are stripped before matching: a doc comment *explaining* the drift is
not a copy of anything, and a scan that flags prose teaches the next reader to
delete the explanation.

Two self-checks keep the test honest — it asserts it can still see the pack (so
a rename cannot silently blind it) and that its walk covers >200 files.

**Allowlist**, complete and reasoned:

| File | Why |
|------|-----|
| `sports/cricket.ts` | The pack. That is the point. |
| `packages/ui/src/identity/player-card.tsx` | `packages/ui` is **forbidden** to import core by the `no-ui-to-core` dependency rule, so its badge marks are a presentation enum that cannot read the pack even in principle. Its tokens deliberately differ from the stored ones. |
| `apps/web/src/app/gallery/identity-demo.tsx` | Sample data for the component gallery, which exists to render components without a database. |
| `apps/web/src/content/marketing.ts` | Hand-written illustrative copy for the landing page's specimen auction — the same file says "Fast bowler", which is nobody's stored token. |

### READ WITH `readFileSync`, NEVER `grep`

`player-profile.ts` held a regex written with **literal** control bytes
(`no-control-regex`, in `validateProfileLocation`). grep classified the file as
binary and returned nothing — `grep -c "export"` exited 1 in silence while
`grep -a -c "export"` returned 29. Every recursive grep over this repository was
skipping the one file that held the entire role vocabulary, and a grep-based
version of this guardrail would have passed by refusing to look at it.

The literals were escaped to `\u0000-\u001f\u007f` in this phase — behaviour
identical, and proven so by the existing control-character test in
`player-profile.test.ts`. `gender-boundary.test.ts` was already doing this
correctly.

## 4 · How the types survived

`PlayerRole`, `RegistrationRole`, `BattingStyle` and `BowlingStyle` are
literal-union types the whole product is checked against. Deriving them from
`readonly string[]` would have widened every one to `string` and deleted the
compiler's ability to catch a misspelt role.

The pack therefore exports its key **tuples** (`CRICKET_ROLE_KEYS` and the two
style tuples) and builds its term lists from them, so the runtime values have one
home while the types stay exact — with **no casts anywhere**. The drift guard in
`registry.test.ts` closes the other direction, asserting that the tuples and the
pack's own term lists remain two expressions of one fact.

## 5 · The one intentional behaviour change

`all_rounder` now reads **"All-rounder"** on every surface.

It already did on the share card, the poster, the public player page and the
career header. The registrations table, the season pool and the teams panel said
"All rounder" because they read the second map. One spelling had to win, and the
hyphenated one wins because it is the one on the public surfaces a player sees
about themselves. One e2e assertion updated (`registration-ops.spec.ts` — the
Google Form mapping journey).

## 6 · Verification

| Gate | Result |
|------|--------|
| `pnpm verify` (lint · typecheck ×11 · unit · format · depcruise · motion) | **green** |
| `packages/core` unit | **463 passed**, including 23 new |
| depcruise (incl. the no-circular gate) | **no violations** — 2065 modules, 11622 dependencies |
| Full e2e, precompiled server | **101 passed, 29 skipped, 0 failed** (4.0m) |

The 29 skips are the `/gallery` family, which 404s by design under
`NODE_ENV=production`.

**A note on the e2e run.** `PLAYWRIGHT_PRECOMPILED=1` does **not** build — it
runs `next start` against whatever `.next-e2e` already holds. The first run of
this phase failed on exactly the changed label because the build was 16 hours
stale, which reads like a real defect and is not one. Rebuild first:

```
cd apps/web
NEXT_DIST_DIR=.next-e2e node --env-file-if-exists=../../.env.local \
  node_modules/next/dist/bin/next build
PLAYWRIGHT_PRECOMPILED=1 pnpm exec playwright test
```

## 7 · What Phase 0 deliberately did not do

- No `sport` column, no `sports` table, no migration.
- No second pack. The interface has obvious extension points and they stay
  empty until a real organizer asks — see `PLAN.md` §5.
- **No terminology dictionary.** 95 of 240 components say "player" and none of
  them read a dictionary; declaring one nobody consumes would be an abstraction
  pretending to be a feature. It lands with the second sport, which is when a
  wrong guess gets corrected instead of entrenched.
- No standings tiebreaker chain, for the same reason — `compareStandings` still
  walks points → net run rate → wins directly.
