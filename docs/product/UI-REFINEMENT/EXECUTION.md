# DesiAuction interface execution plan

> Current checkpoint disposition: E12 completed its reviewed amended local engineering gate on 13 October; see [E12-EVIDENCE.md](E12-EVIDENCE.md). E13/E14 and external acceptance remain pending. The user authorizes verified local commits, with no push or deployment. Earlier failed E12 measurements and the historical freeze remain recorded in [CHECKPOINT-EXCEPTIONS.md](CHECKPOINT-EXCEPTIONS.md).

Executable planning contract approved by Astra · 11 October 2026 · Implementation authorised; E00 in progress

Execute complete user journeys in the order below, preserving baseline `55c97aef7887` on `feat/ls1-live-scoring`. [PLAN.md](PLAN.md) specifies the design direction, [FLOWS.md](FLOWS.md) specifies navigation and task continuity, and [SCREEN-INVENTORY.md](SCREEN-INVENTORY.md) records every page entry. The architecture review and its dispositions are recorded in [REVIEW.md](REVIEW.md). [CONTRACTS.md](CONTRACTS.md) is required for all packages.

The user authorised full local implementation on 11 October 2026 after Astra review. Remote publication and deployment remain outside that authorisation. Preserve the existing no-PR/no-push/no-merge preference and deferred implementation commits unless the user changes it. Do not apply the completed LS1 C00–C56 sequence to this separate refinement programme.

## Responsibility and progress tracking

The primary implementation agent owns the sequence, integration, evidence and progress log. Astra reviews substantive new architectural contradictions; it is not a substitute for user acceptance or usability evidence. The product owner reviews concrete designs and material product-policy changes. Users participating in research validate comprehension and task completion.

Track each package in `EXEC-LOG.md` with independent Build and Acceptance statuses. Build uses PENDING, IN PROGRESS, BLOCKED or BUILD-PASS. Acceptance uses PENDING, ACCEPTANCE-PASS or ACCEPTANCE-FAILED with individual evidence items. BUILD-PASS permits the next local package only after all applicable engineering gates pass and no known critical defect remains. Human studies, physical-device checks, product-owner design review and field measurement remain explicitly pending until observed; agent review cannot replace them. Record the exact scope, baseline, changes, retained capabilities, relevant route/state rows, commands/results, browser evidence, limitations and checkpoint tree. Do not equate a completed source edit with a completed package.

Every page/state row also gets a reviewer, design reference, functional evidence, visual evidence and performance status. Shared component changes do not automatically sign off dependent screens. Report completed packages and remaining gates, not an unsupported percentage based on files changed.

## Ordered work packages

| ID | Scope and dependencies | Concrete output | Exit gate |
| --- | --- | --- | --- |
| E00 | Baseline and scope | Confirm current HEAD/source; review all 141 entries for role, actions, states and dependencies; capture baseline evidence or explicitly gated states; identify existing defects separately | Inventory reconciled with current build; no missing capability; safe validation setup verified; architecture review findings dispositioned |
| E01 | Design and flow contract after E00 | One current token/terminology/shell contract; source/selection map for every task; scorer/manager/finance/operator Home adapter specification; role × scope × state, retention and publication matrices | No unresolved policy contradiction; current permissions and canonical sport rules retained; visual and state contracts reviewable |
| E02 | Designs and prototypes after E01 | Six representative phone/laptop designs, complete journeys and all significant states in both themes; formative tasks with counterbalanced order and per-role/task reporting | Concrete design approval; proposed comprehension/completion gates met without hiding a failed role in pooled results; critical errors resolved; exact before/after action mapping |
| E03 | Shared foundation after E02 | Minimal token/component refinements in existing UI package; component state gallery; focus/status/filter/data-row patterns | Foundation checks plus rendered both-theme states, keyboard/contrast/reduced motion and generated-token consistency |
| E04 | One complete delivery scoring pilot after E03 | Fixture setup → cricket scoring → corrections/recovery → finalisation/confirmation → public match/result; only the necessary shared entry points | All pilot functions preserved; full T10 and second-viewer acceptance, offline/claim/correction gates, visual/accessibility/performance comparisons pass |
| E05 | Identity personal Home and menus after E04 | Auth/invite intent; scorer/manager/finance/operator responsibility adapters; multi-scope task projections and stable ordering; notifications/returns | Sole and combined role matrix including captain without manager grant, newer scheduled/older live auctions and multiple fixtures; deep-link/Back/cleanup/privacy gates pass |
| E06 | Organisation season and match day after E05 | Applicable team formation, registration review, squads, readiness, fixtures/calendar/lineups/brief | All three formation paths pass; scope/selection/filter retention and role-limited payloads verified |
| E07 | Rally and raid after E06 | Family-specific layouts with shared task scaffold and legal actions | Rally/raid sport variants, clocks, substitutions/attribution, terminal and correction journeys pass |
| E08 | Timed and placement after E07 | Compact timed event workspace and complete squad/round entry | Existing timed sport and placement rules pass; zeroes/all squads/limits/ties/unsupported states remain honest |
| E09 | Auction owner and conductor after E08 | Room/plan/cockpit/replay and safe return; consistent scope/action priority | Exact bids/purse consequences, confirmations, pause/reconnect, audited correction and served-data boundaries pass |
| E10 | Profiles insights awards and results after E09 | Readable sample-aware charts, metrics/leaderboards, reasons and overrides, self/public distinctions | Denominators, eligibility, privacy/delay and unavailable data proven; all existing rows/actions accessible |
| E11 | Finance after E10 | Obligations, receipts, cases, documents/reconciliation and role-aware actions; focused finance user review | Existing money journeys, amounts, confirmation, authority and audit evidence preserved; no optimistic money state; no unresolved critical finance usability error |
| E12 | Acquisition discovery help and tools after E11 | Public start/demo journeys, useful content/navigation, help returns and existing tools | Truthful availability/CRO instrumentation, direct loads, metadata/canonical/sitemap/noindex, public/private payload and budget gates pass |
| E13 | Administration broadcast and remaining boundaries after E12 | Capability-shaped administration with focused operator review; readable board/overlay/embed, system errors and remaining inventory entries | All rows accounted for; broadcasts retain geometry/contrast, staff gating and recovery pass; operator-only tasks usable; development surfaces remain gated |
| E14 | Consolidated verification and release preparation after E13 | Fresh complete regression/evidence pack, performance comparisons, user findings, known limitations and rollback instructions | All applicable gates pass; no missing screen/state, critical regression or falsely claimed field result; product review complete |

No live release is authorised by E14. After local completion, present the exact reviewable result and any remaining real-device or staging acceptance. Production rollout and field measurement proceed only when separately authorised.

## Verification sets

Select relevant tests from actual changes, not just a generic checklist. Declare each package's applicable gate set before editing. Expand to shared dependants when tokens/shells/actions change. Run full verification at E04, E09 and E14; use focused checks between them unless a change expands the risk. Failed checks require a fix and refreshed affected evidence; unrelated passing suites need not be repeated without a reason.

### Foundation and source checks

Existing commands, run serially from the worktree root:

```sh
pnpm format:check
pnpm depcruise
pnpm check:motion
pnpm check:posture
pnpm --filter @desiauction/ui build
pnpm --filter @desiauction/ui test
pnpm --filter @desiauction/ui typecheck
pnpm --filter @desiauction/ui lint
pnpm --filter @desiauction/web typecheck
pnpm --filter @desiauction/web lint
```

Verify generated token output against the intended tracked token changes; do not accept accidental drift. Add meaningful unit coverage for changed pure navigation/next-action policies and component interactions. Do not write tests that merely repeat styling implementation.

### Functional and boundary checks

Use named focused Vitest files for affected server/view models and actual browser journeys. Existing browser families include `scoring.spec.ts`, `scoring-offline.spec.ts`, `scoring-guest-claim.spec.ts`, `scoring-confirmation.spec.ts`, `scoring-rally.spec.ts`, `scoring-kabaddi.spec.ts`, `scoring-football.spec.ts`, `scoring-lobby.spec.ts`, `scoring-families.spec.ts`, `live-auction.spec.ts`, `organizer-workspace.spec.ts`, `team-entry.spec.ts`, `public-registration.spec.ts`, `public-experience.spec.ts`, `settlement-experience.spec.ts` and `seo.spec.ts` under `apps/web/e2e`.

Extend those journeys only for real changed behaviour and missing acceptance evidence. Assert served payloads and a permitted control case, not merely hidden buttons. Include direct-URL denied access, multi-role and cross-tenant cases, delayed/minor/public states, append/correction/idempotency and guest identity wherever applicable. Never replace safety assertions with new visual-only tests.

Full local gate:

```sh
TURBO_FORCE=true TURBO_ENV_MODE=loose pnpm verify
pnpm test:integration --force --concurrency=1
pnpm --filter @desiauction/web grants:verify
pnpm --filter @desiauction/web rls:verify
pnpm posture:verify
pnpm --filter @desiauction/web build
node scripts/check-bundle-budget.mjs --next-dir apps/web/.next-e2e
```

These commands require the validation environment described below before running. Full precompiled browser verification follows the fresh build. Record actual commands, exit codes and applicable skip reasons. Do not raise timeouts or add conditional skips to make a regression disappear.

### Browser visual and accessibility checks

From `apps/web`, after the approved production build:

```sh
PLAYWRIGHT_PRECOMPILED=1 pnpm exec playwright test --workers=1 --retries=0
```

Use the same command with named affected specs for focused runs. At E14, also run affected critical journeys serially with `E2E_WEBKIT=1` and `E2E_FIREFOX=1`, selecting their actual projects. Record browser-specific unsupported cases; Chromium-only WebAuthn simulation does not prove real Safari/Edge passkey behaviour.

Visual evidence covers Daylight/Floodlight; 320px reflow, 360/390px phones, laptop and applicable 768px-landscape cockpit/projector layouts; long English/Hindi text, large datasets, zoom, touch keyboard, focus, dialogs and reduced motion. Phone nav checks actual rendered targets and clipping. Run automated accessibility checks plus manual keyboard and screen-reader journeys; one cannot substitute for the other. Real iOS Safari/Android and in-app-browser cases remain explicitly tracked until actually tested.

Screenshot diffs require review of genuine before/after states, not blanket baseline regeneration. Changed states need approved references. Preserve existing reference coverage and document intentional differences.

### Performance checks

Use unchanged route budgets and measured before/after cold/warm loads with identical devices/network/data. Measure scoring/bidding responsiveness, visual stability, repeated-update work, memory and viewer latency. Include a modest Android device. Lab INP/task responsiveness and field Core Web Vitals are different evidence; field success remains pending until enough real traffic exists.

The acceptance pack must specify measurement conditions, run counts and observed variability. A faster local database response is not evidence that all public users load faster. No decorative dependency may silently increase shared scoring/auction cost.

## Validation environment and process safety

Use only database `ls1_c29_clean` at `127.0.0.1:15437`. Set all four URLs explicitly in the parent process: `DATABASE_URL`, `APP_DATABASE_URL`, `SYSTEM_DATABASE_URL` and `RUNNER_DATABASE_URL`, using the existing approved role credentials. Posture verification also needs the recorded owner/system posture aliases and host/port/name. Assert target identity before any database-touching command; unset or mismatched configuration is a stop condition. Do not rely on `.env.local` defaults or access the default/development database.

For the local production browser harness, use `PUBLIC_BASE_URL=http://localhost:3050`, `OTP_PROVIDER=dev`, `NEXT_DIST_DIR=.next-e2e`, `CSP_ENFORCE=1` and `ALLOW_INSECURE_LOCAL_PRODUCTION=1`. Preserve existing role grants; do not weaken database permissions for UI tests. Preflight confirms the approved test services and owned ports, avoiding duplicate execution.

Run heavy suites serially. Freeze source edits while a browser/build verification is active; wait for managed teardown before repairing it. Preserve failed logs and partial evidence. Inspect references in a background surface; do not take over the user's active browser. Keep synthetic fixtures scoped to the isolated database and use established cleanup paths.

## Failure handling and rollback

If a requirement contradicts accepted functionality, stop the affected package and record the exact evidence, impact and alternatives. Obtain a focused Astra resolution for an actual new architectural contradiction, then disposition it before continuing. Do not silently waive a gate, redefine a saved state or change a sport rule to fit the layout.

Keep an integration checkpoint before each package and a known working visual baseline. UI changes should be revertible without modifying domain history or introducing a database migration. Define which source/component changes to revert and which caches/generated assets to rebuild. Reverting the UI must not reverse accepted bids, payments or scoring events.

For an eventual authorised pilot, the primary implementer operates rollback and the product owner selects the participating organisations/users. The rollout unit is a complete versioned interface build plus its immutable assets and approved server-controlled cohort assignment. E03 must specify and implement the minimal assignment/kill-switch mechanism if the current deployment cannot provide it; do not assume a runtime flag already exists. E04 rehearses withdrawal of new assignments and restoration of the recorded prior build/assets before further waves.

Keep the selected treatment stable for an active scorer/bidder until a safe task boundary; a kill switch does not remount an active pad or transfer ownership. Permission, trust and privacy revocations still take effect immediately under current rules; treatment stability cannot freeze security decisions. If stable treatment cannot be guaranteed, block the live pilot until the mechanism is resolved.

The rollback artifact records source/tree, build/assets, cohort configuration and service-worker/cache compatibility. Prove forward/backward reading of retained queue/bootstrap data and old/new cached assets with interrupted connectivity. No database rollback or destructive local-store migration is permitted as a visual rollback. E04 tests rollback with pending work and a second tab; E09 repeats it during bidding/conduct without losing acknowledgements.

Pause new assignments for any critical money/scoring/privacy error, loss of recoverable work, inaccessible core task, duplicate accepted mutation or performance-budget breach. Record quantitative baseline-relative thresholds and measurement windows in E00 for noncritical latency/error metrics; no launch until they are defined. Restore the compatible known working interface, preserve accepted data and supported pending work, and collect the failure evidence. Production rollback execution remains subject to release authorisation.

## Review record and final handover

Each package handover includes a concise problem/change statement, approved designs, action-retention mapping, role/state coverage, tested journeys, before/after visuals, performance and accessibility evidence, unresolved limitations and checkpoint identity. The final record maps every inventory entry to a completed package and evidence.

Design approval, architecture review, local functional PASS, real-user usability evidence, field performance and release approval are separate statuses. Do not collapse them into “verified.” Estimate delivery effort after E00/E02 expose actual state/design scope; schedule in reviewable packages and report remaining gates throughout execution.

## Authorised build and acceptance amendment

Astra approved this amendment after the user authorised implementation. E02 BUILD-PASS requires six concrete interactive designs, phone/laptop/both themes, action/role/return mapping, engineering/design review and every available browser/keyboard/accessibility/performance check. Prepare genuine participant tasks and reporting; no agent walkthrough counts as a participant attempt. E04 uses synthetic isolated fixtures for its local pilot and rollback rehearsal. E06/E11/E13 complete available manager/finance/operator engineering gates while unavailable human role review remains Acceptance pending. E14 BUILD-PASS requires all local packages/gates and implementation evidence per applicable route/state, plus a named external acceptance register. It does not establish release readiness, full user validation or field performance.

Known critical scoring, bidding, money, privacy, accessibility or recoverability defects block the affected package. Available checks cannot be deferred as external acceptance; explain the precise participant/device/environment needed for unavailable checks. Later findings reopen affected packages and dependent evidence. Genuine human/device/product review remains pre-release acceptance where required; field outcomes remain post-release measurement. No PR/push/merge/deployment boundary changes.
