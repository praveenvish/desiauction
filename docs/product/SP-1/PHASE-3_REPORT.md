# SP-1 PHASE 3 — THE PERSON AND THE PLAYER · IMPLEMENTATION REPORT

## DesiAuction NEXT · 2026-09-07 · Engineering · **Status:** COMPLETE

Migration **0048**. A person can now be an all-rounder at cricket and a
goalkeeper at football, and neither answer overwrites the other.

---

## 1 · The fact the old row could not hold

`player_profiles` carried two different kinds of fact in one row:

| About a PERSON | About a PLAYER |
|---|---|
| gender, date of birth, location, preferred jersey | default role, batting style, bowling style |

The first set is true of somebody whatever they play. The second is true of them
**in a sport** — and one row per person could only ever hold one answer. That
was invisible while the platform ran one sport. Phase 2 shipped football and it
stopped being invisible: saving a football role would have silently replaced
their cricket one.

`player_sport_profiles` is keyed by **(person_id, sport)** with no surrogate id.
The row *is* that pair, so the natural key says so and a generated id would be a
second way to name the same thing. It also keeps the backfill honest — a ULID
cannot be minted in SQL, and a 26-character string that merely looks like one is
worse than no id at all.

**43 existing profiles backfilled** as cricket rows. Only people who had
actually stated a role or a style got one: a profile that named none of them is
somebody who has not told us how they play, and inventing an empty cricket
profile for them would turn "never asked" into "plays cricket, said nothing".

## 2 · What it bought, on real screens

- **`/me/[sport]`** — one career per sport. `/me/cricket` still resolves, because
  it *is* this route with `sport = "cricket"`, so every existing link and
  bookmark keeps working and `/me/football` now exists beside it. No redirect
  was needed, which is the nicest kind of migration.
- **Registration prefills from the right profile.** Registering for a football
  season offers your football answers; the cricket ones stay where they belong.
  `RegistrationLanding` carries the season's sport so the form can ask.
- **"Remember this" writes to both halves.** Date of birth goes to the person,
  role and styles to that season's sport. Remembering a football role onto a
  cricket profile is precisely the bug this phase removes.
- **`/account` shows one panel per sport**, built from each pack.

## 3 · Decisions worth recording

**Completeness spans sports.** The 8-item account checklist asks "have you said
how you play?" — that is now a question about *any* sport. Someone who filled in
their football profile has answered it; asking them for a cricket role to
complete their account would be asking about a sport they do not play.

**The pack still cannot cross into a client component.** Same constraint Phase 2
hit: the account page flattens each pack to plain `{ key, label }` lists and the
server validates. `sport-profile-panel.tsx` names no sport anywhere in it.

**An accessibility finding, from the e2e.** With a panel per sport there are now
two controls whose accessible name would have been just "Playing role" —
ambiguous to anyone reading the page through its accessible names, where the
heading above disambiguates them only visually. The role select is now labelled
with its sport (`Cricket playing role`). The register form's own control is
still plain "Playing role", because that page shows exactly one.

## 4 · Migration 0048 · rollback

```sql
ALTER TABLE "player_profiles"
  ADD COLUMN "default_role" text,
  ADD COLUMN "default_batting_style" text,
  ADD COLUMN "default_bowling_style" text;
UPDATE "player_profiles" p SET
  "default_role"          = s."default_role",
  "default_batting_style" = s."attributes"->>'batting_style',
  "default_bowling_style" = s."attributes"->>'bowling_style'
FROM "player_sport_profiles" s
WHERE s."person_id" = p."person_id" AND s."sport" = 'cricket';
DROP TABLE "player_sport_profiles";
```

Reverting **loses every non-cricket profile**, which is the honest consequence of
going back to one row per person. Revert code first, then schema.

## 5 · Verification

| Gate | Result |
|---|---|
| `pnpm verify` | **green** (lint, typecheck ×11, unit, format, depcruise, motion) |
| `pnpm test:integration` | **931 passed** (72 engine + 859 web) |
| Full e2e, precompiled | **101 passed, 29 skipped, 0 failed, 0 flaky** |

**Proven, not assumed.** `profile.regression.test.ts` saves a cricket profile and
a football profile for one person and asserts neither overwrote the other —
including that cricket's `batting_style` did not leak into the football row.

Two guardrails caught real work during this phase, which is what they are for:

- **`gender-boundary.test.ts`** failed on the `cricket-profile-panel` →
  `person-profile-panel` rename, because its allowlist named the old path.
- **`database-vocabulary.test.ts`** had asserted `player_profiles.default_role`
  stayed cricket-only "until Phase 3 splits it". Phase 3 split it, so that test
  was rewritten to assert the new arrangement — exactly as its own comment said
  it should be, rather than deleted.

### A trap worth knowing

`player-identity.spec.ts` computes its test phone from `Date.now()` at **module
load**. On a Playwright retry the module is re-imported, so the retry invents a
*brand-new, nameless* player and lands on the onboarding gate — a failure that
looks nothing like the real one and hides it. Debug that spec with `--retries=0`.

## 6 · The nightly, and what it finally proved

`nightly-verify` had failed four consecutive nights at `pnpm test:integration`.
After the teardown fix it **passes that step** and four more — RLS probe,
restore-verify, seed, browser install — reaching `End-to-end journeys` for the
first time, where it failed 27 of 96.

Those 27 are not product defects. They are `ERR_CONNECTION_RESET` and
`page.goto` timeouts scattered across unrelated specs: the signature of a
`next dev` server crossing its memory threshold and restarting mid-request. The
same suite is **101 passed / 0 failed** against a compiled server.

The nightly's e2e step ran bare `npx playwright test` with none of the four
things `ci`'s own e2e job sets. It now matches that proven job:
`PLAYWRIGHT_PRECOMPILED=1`, `NEXT_DIST_DIR=.next-e2e`, `OTP_PROVIDER=dev`,
`ALLOW_INSECURE_LOCAL_PRODUCTION=1`, plus the build step a compiled server needs
(the flag serves `.next-e2e`; it never builds it).

Not yet proven by a real nightly run — the dispatch needs repo-admin rights this
session does not have. What was verified: the workflow parses, the step order is
right, and the exact CI build command (`pnpm --filter @desiauction/web exec next
build`, which skips the package script and so depends purely on job env) exits 0
against nothing but `DATABASE_URL`.

## 7 · Still open, deliberately

- **The nav still says "My cricket"** and points at `/me/cricket`. It resolves,
  but a person who plays football is offered the wrong career. Making it
  sport-aware means a query in the shell, which is a nav decision rather than a
  data one.
- **Terminology remains declared but barely consumed** (Phase 2 §7).
- **Phase 4** — the long tail — is untouched. The pack interface is now proven
  against two sports and a per-sport profile, so a third sport is a pack file.
