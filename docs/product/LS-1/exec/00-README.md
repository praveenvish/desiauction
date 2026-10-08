# LS-1 Execution Plan: how to execute (READ FIRST, EVERY SESSION)

**Audience:** an autonomous coding agent (Codex or similar) executing this plan end to end.
**Author:** Claude (architect).
**Validator:** Claude re-validates every commit against `04-validation.md` after the PR is complete.

**Product context:** `docs/product/LS-1/FINAL.md` (the binding product decisions) and the mockup canvas linked there.

The goal is to beat CricHeroes. That means a live cricket scoring product that is:
- faster to start;
- more trustworthy;
- more premium in both themes.

It must be built on DesiAuction's existing seasons, squads and lineups, and extensible to every sport.

**This plan is the contract.** Do not redesign, rename, reorder, skip or merge commits. When something in the repo contradicts this plan, STOP and log it (§6). Do not improvise.

---

## 1. Files in this plan (read in this order)

| File | What it is |
|---|---|
| `00-README.md` | Rules, branch, gates, traps (this file) |
| `01-contracts.md` | Exact data contracts: DB tables, event types, fold state, APIs, URLs. **Source of truth for names.** |
| `02-commits.md` | The ordered commit list. Each entry has scope, files, spec, tests, gate and acceptance IDs |
| `03-sports-families.md` | Milestone 11+ (rally, timed, kabaddi, placement). Start only after milestone 10 is green |
| `04-validation.md` | Acceptance matrix. Every ID must be true at the end. The validator uses it line by line |

---

## 2. Branch and commit rules

1. **One branch only:** `feat/ls1-live-scoring`, created from the latest `origin/main`:
   ```bash
   git fetch origin && git switch -c feat/ls1-live-scoring origin/main
   ```
2. **One commit per entry** in `02-commits.md` (C00 → C46), then `03-sports-families.md` (C47 → C56), strictly in order. The commit subject is the exact `Subject:` line given (Conventional Commits; CI's `pr-title` check requires this format for the PR title too). The body lists the acceptance IDs it satisfies, e.g. `Acceptance: A-C09-01..A-C09-08`.
3. **A commit is only made when its Gate passes** (§4). Never commit red. Never use `--no-verify`.
4. **Do not rebase or squash** the branch history while executing. If `main` moves and conflicts appear, merge `origin/main` into the branch in a separate commit, `chore(ls1): merge main`. Then re-check migration numbering (§5, trap T1).
5. Push after every commit:
   ```bash
   git push -u origin feat/ls1-live-scoring
   ```
6. Open **one** PR to `main` after C00:
   - title: `feat(ls1): live scoring, stats and awards (cricket first)`;
   - draft until C56.

   Keep the PR body's checklist updated (template in `04-validation.md` §0).
7. **Never** touch:
   - `apps/engine/**`, except where a commit explicitly says so (none do);
   - `packages/core/src/auction*.ts`;
   - settlement or finops code;
   - existing migrations (only add new ones).

---

## 3. Global invariants (must hold after every commit)

| ID | Invariant |
|---|---|
| INV-01 | `packages/core` stays pure. No imports outside itself plus `ulidx`/`ulid` (depcruise rule `core-is-pure`). No zod in core: validators are hand-written. |
| INV-02 | Sport pack files contain **values only**: no `=>` and no `function` (enforced by `pack-contract.test.ts`). Behaviour lives in `packages/core/src/scoring/**`. |
| INV-03 | Every new table is org-scoped with `org_id char(26) NOT NULL`, `ENABLE` + `FORCE ROW LEVEL SECURITY`, and policy `<table>_tenant` using `current_setting('app.org_id', true)`. The only exception is a person arm where `01-contracts.md` says so. |
| INV-04 | `match_events` is append-only for **all four** roles: `REVOKE UPDATE, DELETE`, in the migration (guarded), in `ops/db/create-app-role.sql` (lines 236-237 list) and in `APPEND_ONLY` in `apps/web/scripts/verify-grants.ts`. |
| INV-05 | No web file reaches `systemDb`/`systemHandle`/`db` outside `withTenantDb` unless listed in `ops/posture-allowlist.json` with class and reason (`pnpm check:posture`). Public read models are the only allowed new `by-design` entries. |
| INV-06 | Writes from the web tier go through `withTenantDb(dbHandle, {personId, orgId}, fn)`. Inserts that can hit a unique constraint use `writeSurvivingConstraint` or `ON CONFLICT DO NOTHING`, never try/catch inside the transaction (savepoint trap). |
| INV-07 | The auction engine (`apps/engine`) is not modified. Live scoring never uses the engine. |
| INV-08 | The client and the server run **the same fold** (`replayMatch` from `@desiauction/core/scoring`). The server re-validates every event with it before append. |
| INV-09 | Nothing that happened is ever destroyed. Corrections are `void`/`amend` events; restart increments `attempt`. No `DELETE` on match data in app code. |
| INV-10 | Typed results and scored results never collide: `fixture_results.source`; a typed write on a fixture with events is refused. |
| INV-11 | Public pages expose names, numbers and initials only: never phones, emails or DOB. Minors (under 18 by `registrations.date_of_birth`) show initials and no photo unless `photo_consent_at` is set (§ `01-contracts.md` P-6). |
| INV-12 | Both themes. Every new screen renders correctly in `data-theme="daylight"` and `data-theme="floodlight"` using existing tokens from `@desiauction/ui` (`packages/ui/src/generated/{daylight,floodlight}.css`). No hard-coded hex in components except the field greens and team colours listed in `01-contracts.md` UI-3. |
| INV-13 | Every new notification kind is registered in `packages/messaging/src/catalogue.ts` plus its template/inbox label (see `notification-guard.test.ts`). No send path bypasses the gate. |
| INV-14 | All copy is plain English: no "Successfully", no exclamation marks, sentence case. Hindi strings exist for the scoring pad (`01-contracts.md` UI-5). Numerals stay Western in Hindi. |
| INV-15 | No new dependency without a line in the commit body explaining it. Allowed new dependencies: `idb-keyval` (web, IndexedDB queue) and `qrcode` (web, handover QR). Anything else: STOP and log. |

---

## 4. Gates

Run all commands from the repo root. A commit's Gate column lists which gates apply. **All listed gates must exit 0.**

| Gate | Commands |
|---|---|
| **G-core** | `pnpm --filter @desiauction/core test` then `pnpm --filter @desiauction/core typecheck` then `pnpm --filter @desiauction/core lint` |
| **G-static** | `pnpm format:check && pnpm depcruise && pnpm check:posture && pnpm check:motion && pnpm turbo run lint typecheck --force` |
| **G-db** | `node packages/db/scripts/check-journal.mjs && pnpm --filter @desiauction/db db:migrate` (local DB from `.env.local`) |
| **G-int** | `pnpm --filter @desiauction/web test:integration -- <the regression files named in the commit>`. At milestone ends, run the **full** `pnpm test:integration` |
| **G-roles** | Apply roles, then verify grants, RLS and posture. Use the same env as CI `integration` job (passwords `ci-app`, `ci-system`, `ci-engine`, `ci-runner`). See the block below this table |
| **G-e2e** | Precompiled e2e for the named specs. See the block below this table |
| **G-full** | `pnpm verify` + full `pnpm test:integration` + G-roles + full e2e suite (precompiled). Required at C46, at C56 and at every milestone end marked ★ |

G-roles commands:
```bash
psql "$DATABASE_URL" -v app_password=ci-app -v system_password=ci-system -v engine_password=ci-engine -v runner_password=ci-runner -f ops/db/create-app-role.sql
pnpm --filter @desiauction/web grants:verify
APP_DATABASE_URL=… pnpm --filter @desiauction/web rls:verify
pnpm posture:verify
```

G-e2e commands:
```bash
cd apps/web
NEXT_DIST_DIR=.next-e2e OTP_PROVIDER=dev node --env-file-if-exists=../../.env.local node_modules/next/dist/bin/next build
PLAYWRIGHT_PRECOMPILED=1 OTP_PROVIDER=dev pnpm exec playwright test e2e/<spec>.spec.ts
```

**Turbo caching hides cross-package test failures. Always pass `--force` to turbo in gates.**

---

## 5. Known traps in this repo (each one has burned a previous change)

| ID | Trap | Rule |
|---|---|---|
| T1 | Migration journal `when` values are hand-spaced ahead of real time | The next entry is the previous `when` + `86400000`. `idx` = array position (file 0071 does not exist, so `idx` = file number − 1). Never run `drizzle-kit generate`. Before numbering, run `select id, created_at from drizzle.__drizzle_migrations order by created_at desc limit 5`. Starting numbers: **0112 / idx 111 / when 1793376000000**. If `main` added migrations meanwhile, renumber ours after theirs, re-bump `when`, then fix every file and test that names our migration numbers |
| T2 | A `loading.tsx` above a gated page commits HTTP 200 before `notFound()`/`redirect()` | No `loading.tsx` above any page that gates. Gate first, then stream |
| T3 | `export type {X}` in a `"use server"` file 500s the page in dev (Turbopack) | Server action files export only async functions. Types go in a sibling `*-types.ts` |
| T4 | Next's vendored React lacks `useEffectEvent` | Never import it (lint bans it) |
| T5 | A server-action `redirect()` inside routes with the `@action` slot (`/home`, `/orgs`, `/tournaments`) is abandoned | Return the target and navigate client-side, closing any dialog first |
| T6 | Closed `FormDialog` keeps its form in the DOM | In e2e, scope `getByLabel` to `getByRole("dialog")` |
| T7 | Filter bars that build the next URL from a live `useSearchParams` snapshot race | Use `useFilterQuery` |
| T8 | WebKit with a controlling service worker bypasses `page.route` | Offline tests use `context.setOffline(true)`. Specs that mock routes set `test.use({ serviceWorkers: "block" })` |
| T9 | Editing files while an e2e run is going hangs server actions | Never edit during e2e runs. Batch changes, then run hands-off |
| T10 | Killing a Playwright run lets its teardown SIGTERM the next run's runner | Wait for teardown. Kill stray servers by pattern **and** port (`lsof -ti :3050`, `pkill -f next-server`) |
| T11 | OTP cap: 5 sends per phone per hour | e2e phones are derived from `Date.now()` stamps (see `e2e/fixtures.spec.ts`). Never reuse a phone across specs |
| T12 | `Date.now()`-derived seed phones can collide with leftover dev-DB data | Use the `STAMP` pattern plus a per-spec 2-digit prefix not used elsewhere (grep `e2e/` for the prefix first) |
| T13 | `grep` silently skips files containing control bytes | Repo-scanning tests use `readFileSync` |
| T14 | `apps/web` has no `test` script; web vitest runs only under `test:integration` | Put web unit tests in `*.test.ts` anyway; they run there |
| T15 | Posters and OG images must render through `server/image-text/image-response.ts` (a guard test enforces this) | Never import `ImageResponse` directly |
| T16 | `SportPack` carries functions (`summariseSide`, `parse`) | Never pass a pack to a client component. Pass plain format data |
| T17 | The console shell owns the page `<h1>` and breadcrumb | Console pages must not render their own title (console identity bar rule). The `/score/**` pad layout is outside the console shell and owns its own `<h1>` |

---

## 6. When blocked

If a step is impossible as written:
- a file is missing;
- an API differs;
- a gate fails for a reason outside the commit's scope.

Then:
1. Do **not** guess a workaround.
2. Append an entry to `docs/product/LS-1/exec/EXEC-LOG.md`:
   ```
   ## <date> · <commit id> · BLOCKED
   What the plan says: …
   What the repo has: … (paths, line numbers)
   Smallest change that would satisfy the plan's intent: …
   ```
3. Commit that log alone: `docs(ls1): blocked at <commit id>`.
4. Stop and wait for the architect.

Allowed without stopping:
- Choosing private helper names inside a new file.
- Splitting a large new file into siblings in the same folder.
- Adding extra tests.
- Fixing a typo in this plan (log it as `NOTE`, not `BLOCKED`).

---

## 7. Definition of done for the whole plan

- All 57 commits (C00–C56) on `feat/ls1-live-scoring`, each with its gate green.
- G-full green at C46 (cricket complete) and at C56 (all sports).
- CI green on the PR (all jobs: quality, integration, e2e, images, secrets-scan, pr-title).
- Every ID in `04-validation.md` checked in the PR body.
- `docs/product/LS-1/exec/EXEC-LOG.md` has an entry per milestone with gate output summaries (counts of tests passed).
- **The PR is not merged by the executor.** The architect validates first.
