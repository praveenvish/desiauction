# PA-1R — Remediation Record

> The response to [PA-1](REPORT.md) (NO-GO, 6.2/10, `e6712df`).
> Branch `fix/pa1r-phase-0` · 2026-09-04 → 2026-09-05 · plan: [REMEDIATION_PLAN.md](REMEDIATION_PLAN.md)

PA-1 asked for a milestone with one organising principle rather than a list:
**nothing merges until it has been proven under the production role recipe.**
This records what that produced — what was fixed, what was descoped and by whose
decision, what remains, and the places where the plan itself turned out to be
wrong.

---

## 1 · The finding under the findings

PA-1's nine blockers were nine symptoms of one condition. Every unit, integration
and e2e process in this repository connects as the database **owner**, and
Postgres exempts the owner from row-level security and from every grant. So every
FORCE-RLS policy evaluated to "visible", the four-role recipe was a
deployment-config fact with no runtime assertion, and any path that reached a
pool without a tenant boundary — or wrote a table its role had no INSERT on —
behaved perfectly in every environment the team could observe and would fail for
the first time on real infrastructure.

Two of PA-1's three P0s were that. So was a defect PA-1 did not find and this
milestone did: **the entire finance workspace could not write**, because
`finops_events` was SELECT-only for the app role while every Issue receipt,
Declare profile and Open series click appended to it.

The remediation was therefore **gate-first**: build the instruments that make
this class visible, before fixing anything they would reveal.

| Instrument | What it answers |
|---|---|
| `pnpm check:posture` | *static* — does any DB-touching export reach a pool outside `withTenantDb` without being on a reasoned allowlist? A ratchet: a new bypass fails, and so does a stale allowlist entry |
| `pnpm posture:verify` | *runtime* — do the real handlers work when `DATABASE_URL` is `desiauction_app` and `SYSTEM_DATABASE_URL` is `desiauction_system`? |
| `pnpm --filter @desiauction/web rehearsal` | *systemic* — can a whole auction night run, from an empty database to an issued receipt, with the app, engine and runner roles each holding exactly what they hold in production and the owner nowhere on the write path? |
| `pnpm restore:drill` | *operational* — can a restored database run that night? |

The first three did not exist before this milestone. The fourth existed as a row
count comparison, which is a different question.

---

## 2 · Scorecard, diffed

| Dimension | PA-1 | Now | What moved |
|---|---:|---:|---|
| Architecture | 8 | 8 | The tenant boundary went from a convention with 133 unknown exceptions to an enumerated, classified, ratcheted set (34 by-design · 8 debt · **0 defect**). Shape unchanged; *knowability* changed. Business rules still in the action layer; the god modules are still god modules |
| Code Quality | 9 | 9 | Unchanged. Still zero `any`, zero `ts-ignore`, zero non-null assertions |
| Security | 5 | 7 | Both webhook tenant-boundary P0s closed **and proven under the roles**; grant issuance requires membership; sessions revoke on replace and on phone change; `acceptInvite` is one transaction; `x-real-ip` trusted only behind a declared proxy; settlement stops leaking journal digests. Still open: rate limiting, step-up, upload length signing, CSP nonce |
| API Quality | 6 | 7 | The webhook doors now do under the production roles what they always claimed to do. Still no request-schema validation, no rate limits, gate helpers still exported as endpoints |
| Database Design | 6 | **9** | The largest single move. 35 foreign keys (all validated) where there were 2; 77 CHECK constraints; index hygiene; `db:migrate` under an advisory lock with a 5s `lock_timeout`; a full suite run now leaves **zero** orphans where it left hundreds |
| Concurrency Safety | 7 | 8 | The finops lease is a fence, not a timer; settlement appends serialize per stream; the follower isolates per org; migrations cannot interleave. The purse check still reads outside the write transaction — mitigated by the single-writer engine, not fixed |
| Business Logic Correctness | 7 | 8 | Invariant 18 is enforced by a database constraint on the owner arm; the gavel cannot fall during a pause; bid intent ids no longer collapse; the invariant map in `docs/40` now tells the truth about all four invariants it misdescribed |
| Frontend Quality | 8 | 8 | The intent-id defect is fixed (and a second instance of it found). The four 1,000-line panels remain |
| UX | 7 | 7 | Purse visibility decided and made honest; the governance boundary stated. The seven stuck points, terminology and the a11y gaps are open product work |
| Performance | 7 | 7 | Index hygiene only. The O(n²) fold and `/home`'s unbounded aggregates are untouched and remain the structural risks |
| Reliability | 5 | 8 | The engine rehydrates live auctions at boot; `command_failed` split from `engine_halted` and rebuilds; the live-window deploy freeze exists and refuses; the runner reports its own silence; backups run on a schedule; a restore has been rehearsed |
| Observability | 2 | 5 | A logger, a request id and PII redaction in the web tier; a `beforeSend` scrub in all three services for the half that key-path redaction cannot reach; the five alerts specified against signals that exist. **No DSN, no metrics, no traces** — and a specified alert is not an alert |
| Testing | 6 | 8 | Integration green (engine 69, web 852) and no longer leaking residue; a posture suite that runs as the production roles; a rehearsal; a restore drill; two-runner and concurrent-append tests. Still no two-engine test |
| Deployment | 4 | 6 | Live-window freeze wired into both workflows; nightly off-host backup; migrate lock; `flyctl` action pinned; preflight made stricter. **Nothing is provisioned** |
| Documentation | 6 | 7 | The invariant enforcement map corrected, `KNOWN_LIMITATIONS` given the descoped boundary, `ALERTS` and the restore runbook written, README's migration count fixed. Most of PA-1 §23's fourteen contradictions are closed; some remain |
| Maintainability | 8 | 8 | Unchanged |

**Overall: 6.2 → 7.5.**

The number is worth less than the shape of the change. Eleven of the sixteen
dimensions moved, and the three that moved most — Database Design, Reliability,
Testing — are the three that were preventing the others from being *checkable*.

---

## 3 · What landed, phase by phase

Detailed outcomes, including where each phase's plan was wrong, are in
[REMEDIATION_PLAN.md](REMEDIATION_PLAN.md). In brief:

**Phase 0 — the gates.** The static posture ratchet and the runtime posture suite;
the dependency audit green; the engine teardown FK; 2,988 accumulated orphan rows
purged in a fixed-point sweep.

**Phase 1 — auction integrity.** Invariant 18 enforced by migration 0042 on the
owner arm; the gavel refused during a pause; boot rehydration; `command_failed`
split from `engine_halted`; bid intent ids keyed on their payload; the go-live
guard surfaced before the click instead of after it.

**Phase 2 — the money path.** Both webhook tenant boundaries; the finance
workspace's write grant; the settlement stream lock; the finops lease fenced;
retry idempotency; follower isolation; the gateway pinned shut for beta.

**Phase 3 — data integrity.** Migrations 0043 and 0044: 21 foreign keys and 33
CHECKs, `NOT VALID` then `VALIDATE`, `ON DELETE RESTRICT` everywhere because
evidence never cascades. Sixteen hand-written teardowns replaced by one org purge.
The allowlist began burning down.

**Phase 4 — observability.** A logger with a request id and a redact superset;
`scrub` wired as Sentry `beforeSend` in all three services; the five alerts
specified; runner health made honest about silence.

**Phase 5 — security.** Grant, session and invite hygiene; proxy trust; error
detail; the `flyctl` action pinned. Rate limiting, step-up, upload signing and the
CSP nonce remain open.

**Phase 6 — product.** Purses public by decision; governance descoped and stated;
the invariant map truthed up.

**Phase 7 — operations.** The nightly off-host backup workflow and the live-window
deploy freeze. The rest is founder-held.

**Phase 8 — certification.** The rehearsal, the restore drill, the first
end-to-end run this repository has had in a long time, and this record.

The e2e run is worth its own paragraph, because getting to it found three things
and none of them was a test:

1. **The documented precompiled path did not work.** The build line omits the env
   file, so it dies collecting page data with `DATABASE_URL: Invalid input`;
   piped into `tail` that exits 0, and the suite then fails 60 seconds later with
   "Could not find a production build". Then `next start` boots as
   `NODE_ENV=production` and the env guard correctly refuses on twelve counts.
   Both are now handled by the config rather than by a comment. CI had never hit
   either — it supplies all of it as job-level env — so this was the local path
   catching up with the one that already worked.
2. **A fixture invented a buyer.** `e2e/player-fixtures.ts` gave a sold lot a
   `soldToPaddleId` of `newId()`, referencing no paddle. Migration 0043 refuses
   it. The identical flaw was fixed in `career.regression.test.ts` during Phase
   3.1 and this copy was missed *because no suite that could see it had been
   run*.
3. **An assertion pinned a bug the UI had already fixed.** The registration desk
   used to lowercase the raw role enum — "all rounder" in a column of Title Case
   badges — and commit `4532c8f` on `main` unified the three copies of that map.
   The e2e assertion still demanded the old spelling, and had been stale on
   `main` ever since, because there was no CI e2e job and the local path was
   broken.

Finally, the CI e2e job ran 101 of 129 and reported success: `/gallery` does not
exist in a build, so the four design-system specs skip themselves with a reason.
Those 28 tests are the only measured proof of AA contrast on both themes,
self-hosted fonts, the 44px touch rung, focus trapping and the polite live
regions. A second step now runs them on the dev server.

---

## 4 · The three founder decisions

Each was a fork the engineering could not settle, and each is recorded where the
code can be read against it rather than only here.

| # | Question | Decision | Where it lives |
|---|---|---|---|
| D1 | Gateway or manual collection at beta? | **Manual only.** The gateway is pinned shut by a posture test, so enabling collection has to be deliberate and has to delete a test that explains why | `gateway-off.posture.test.ts` |
| D2 | Are team purses private? | **Public.** The seal never existed — purse is derivable from data already on every viewer's payload — so the omission theatre was removed and invariant 35 rewritten to describe the real rule | `docs/40`, `purse-visibility.test.ts` |
| D3 | Ship the fiscal-period lifecycle? | **Descoped for beta**, and stated as a boundary rather than left as an unreachable path a future audit rediscovers | `KNOWN_LIMITATIONS.md` |

Two smaller ones, taken the same way: invariant 18 is enforced on the **owner
arm** only, because a blanket constraint would have broken DA-02 — a shipped
feature letting a conductor hold several paddles for owners not in the room; and
the web tier holds **INSERT but never UPDATE or DELETE** on `finops_events`,
because the previous revoke was incoherent (the app role already held full DML on
every projection rebuilt from that log).

---

## 5 · What remains

### Engineering, open and known

| Item | Why it is not done |
|---|---|
| `dispatch.send` outbox (2.7) | The provider is still called before the `sent` transition commits, so a crash between them re-sends. Real work, not a tweak |
| Rate limiting (5.3) | A Postgres-backed token bucket; the OTP throttle is the proven pattern to copy |
| Upload content-length signing (5.2) | Sign the length on the presign, verify bytes on attach |
| Step-up on phone change (5.1) | Sessions are now evicted, but a session thief can still perform the change. The fix is a passkey assertion — a feature with UI, not a hardening tweak |
| CSP `script-src` nonce (5.10) | Deliberately last: it is the safety net, not a live hole, and it needs middleware and its own e2e pass |
| Gate helpers still exported (5.11) | Relocating authorization code late in a milestone, for a leak that is facts-about-yourself |
| `/home` tenant conversion (3.4) | Its money aggregates span every org a person belongs to; a boundary means N per-org round trips. A design change on the largest money read surface, deserving its own pass |
| Repo-wide `no-empty` (4.2) | 84 sites, of which review found most are legitimate fail-closed control flow. Its precondition — a logger — now exists, so it can be done file by file with judgement instead of 80 disable comments in one pass |
| The seven stuck points, terminology, locked rules, a11y, 21 `TODO(founder)` (6.4–6.8) | Product work, not remediation |
| Two-engine concurrency test | The lease is proven by construction and by a single-instance test; the ten seconds either side of a handover are not covered |

### Founder-held, and blocking

Nothing in this list is engineering. All of it is provisioning.

| # | Item | What waits on it |
|---|---|---|
| 7.1 | `desiauction.in` DNS — MX + SPF/DKIM/DMARC | The statutory grievance address (currently bouncing), passkeys (`RP_ID`), `PUBLIC_BASE_URL`. **The long pole** |
| 7.2 | Managed Postgres 17 + PITR + TCP keepalives | Without the keepalives an orphaned engine lease is never reaped |
| 7.3 | `BACKUP_DATABASE_URL` + `BACKUP_S3_URI` secrets | The nightly workflow exists and says plainly that **no backup was taken** until they do |
| 7.4 | One restore from a *stored production* backup | Rehearsed locally; the procedure is proven, the infrastructure is not |
| 7.5 | MSG91 live account | Nobody can log in without it, including the founder |
| 7.6 | S3-compatible storage | `MEDIA_STORAGE=bucket`, `FINOPS_ARTIFACT_STORE=bucket` |
| 7.7 | Fly + Vercel projects and secrets | The first deploy |
| 7.8 | `SENTRY_DSN` | Every alert in `ALERTS.md` §2 |

---

## 6 · The toolchain, re-run

PA-1 §52, executed again on this branch. Every row was run, not inferred.

| Command | PA-1 | Now |
|---|---|---|
| `pnpm lint` | ✅ | ✅ |
| `pnpm typecheck` | ✅ | ✅ |
| `pnpm test` (unit) | ✅ | ✅ |
| `pnpm format:check` | ✅ | ✅ |
| `pnpm depcruise` | ✅ 0 violations, 1,599 modules | ✅ 0 violations, 1,611 modules / 7,879 deps |
| `pnpm check:motion` | ✅ | ✅ |
| `pnpm build` | ✅ | ✅ |
| `pnpm env:check` | ✅ | ✅ all three apps |
| `pnpm test:integration` | ❌ **engine red** | ✅ engine 69 · web 852 / 65 files |
| `pnpm audit --prod --audit-level high` | ❌ 8 vulns (6 high) — **a CI gate** | ✅ no known vulnerabilities |
| `pnpm check:posture` | *did not exist* | ✅ 34 by-design · 8 debt · **0 defect** |
| `pnpm posture:verify` | *did not exist* | ✅ 13/13 under `desiauction_app` |
| `pnpm --filter @desiauction/web grants:verify` | ✅ | ✅ 286 grants |
| `pnpm --filter @desiauction/web rehearsal` | *did not exist* | ✅ 51 steps, four roles, two receipts |
| `pnpm restore:drill --rehearse` | *did not exist* | ✅ 60 tables identical, and a night ran on the restored copy |
| e2e — precompiled server | not run in PA-1 (no e2e job existed) | ✅ 101 passed · 29 skipped · **0 failed** |
| e2e — the `/gallery` family on `next dev` | *never run* | ✅ 28 passed |
| `pnpm preflight:production` | ❌ 16 blockers | ❌ **17** blockers |

**One measurement trap worth recording**, because it nearly went into this
table. `depcruise` reported 2,061 modules at one point in this session. It was
crawling a half-written `apps/web/.next-e2e` left by a build that had failed —
`doNotFollow` excludes `node_modules` and nothing else. The comparable figure is
1,611. A number taken while build output is on disk is not the same number twice.

**The preflight number went up, and that is correct.** `TRUSTED_PROXY_COUNT` is
now a required production variable (5.7), because leaving it at 0 is the safe
answer *and* silently disables every per-IP throttle — an operator must be told
that rather than discover it.

---

## 7 · The NO-GO conditions, one by one

PA-1 named nine blockers and four conditions for reconsideration.

| PA-1 blocker | State |
|---|---|
| 1. Gateway capture fails under the role recipe | **Closed.** Tenant boundary parameterised on the verified envelope; proven by removing it and reproducing the 404. The gateway is additionally pinned shut for beta (D1) |
| 2. Two webhooks write on a role without the grants | **Closed**, and it uncovered the larger finance-workspace defect |
| 3. Dependency audit gate red | **Closed.** No known vulnerabilities |
| 4. Engine integration red, leaking residue | **Closed.** Green, and a full run now leaves zero orphans |
| 5. Invariant 18 unenforced with live violations | **Closed** on the owner arm by database constraint; the conductor arm is DA-02 and deliberate |
| 6. Fiscal-period lifecycle unreachable | **Descoped and stated** (D3), not left inert |
| 7. No backups; no restore ever rehearsed | **Half closed.** The schedule exists and fails loudly; a restore is rehearsed and timed. **No production backup has ever been taken** — the secrets are founder-held |
| 8. No logs, metrics or alerts | **Half closed.** Logs and redaction exist; the alerts are specified against real signals; metrics, traces and the DSN do not exist |
| 9. Preflight refuses with 16 blockers | **Open**, now 17, and every one is provisioning |

| PA-1 condition | State |
|---|---|
| Every P0 closed and evidenced | ✅ |
| One green pipeline including e2e, `grants:verify`, `rls:verify` | ✅ **run [33920713730](https://github.com/praveenvish/desiauction/actions/runs/33920713730)** — quality, integration, e2e, secrets-scan and pr-title, all green on `b66f571`. The first green run this repository has had; §9 records what the first RED one found |
| One complete rehearsal auction under the four-role recipe, through settlement to an issued receipt, no manual intervention | ✅ — and it is now a **command**, not an event |
| One restore with the RTO in the runbook | ✅ locally, with the number and its caveat recorded. ❌ from stored production infrastructure |
| A decision on purse visibility | ✅ D2 — public |

---

## 8 · Verdict

### 🟡 GO WITH CONDITIONS — and every condition is founder-held infrastructure

**The engineering blockers are closed.** All three P0s, the red pipeline, the red
suite, the unenforced invariant and the inert governance layer are resolved,
evidenced, and — this is the part that matters more than any individual fix —
**held in place by gates that fail rather than by discipline that might not.**

This must not be read as "safe to ship today", because there is nothing to ship
onto. No DNS, no managed database, no SMS provider, no object storage, no error
tracker; `preflight:production` refuses on seventeen counts, and it is right to.
The single most consequential remaining line is item 7.4: **no production backup
has ever been taken.** A rehearsed restore procedure and a scheduled workflow are
not backups; the secrets are.

### Why this milestone should be the last of its kind

PA-1 ended by predicting that without one change to the test harness, this would
be the third such audit rather than the last. That change is made. The defect
class that produced two of three P0s — and the finance-workspace defect nobody
had found — now fails four different ways before it can merge: statically, at
runtime per handler, across a whole night under all four roles, and again on a
restored database.

That is the difference between "found by an audit" and "cannot merge", and it is
the only durable answer to a finding whose root cause was that **nothing local
ran as a role that could notice.**

---

## 9 · The first CI run, and why it is in this record

An earlier draft of this document said the pipeline had never been observed —
`gh` is not installed on the machine this work was done on, so every job's
*commands* were run locally and the *run* was not. That has since been closed
through the API, and the sentence is worth replacing rather than deleting,
because of how it closed.

**The first CI run of this branch failed, on `posture:verify`** — the one suite
in this repository whose entire purpose is to catch code that works on a
developer machine and not in production. It was doing exactly that itself.

`webFinopsDeps` installs the email delivery adapter only when
`EMAIL_API_ENDPOINT`, `EMAIL_API_KEY` and `EMAIL_FROM` are all set. That
condition is deliberate: a half-configured mailer that accepts documents and
drops them is worse than none. Developer machines have all three in
`.env.local`. CI has none. Without them `delivery("email")` is undefined, the
delivery-status route cannot verify the provider reference, and it answers
`dispatch_unknown` with a **200** having written nothing — and the test asserted
`status < 500`, which that satisfies. Green locally, for ever, for a reason
nothing local could see.

It is the **second** time that test passed for the wrong reason; its own comment
records the first, when it posted a bounce for a dispatch that did not exist and
checked only that the response was not a 5xx. The pattern is identical both
times: asserting on the answer the route *gives* rather than on the effect it is
supposed to *have*. A route that answers 200 to every refusal — correctly, since
providers retry anything else — cannot be verified by its status code.

Fixed on both sides. The test reads the body and requires `{status:"ok"}`, and
names the cause in its failure message. The posture config supplies the three
variables with the same reasoning it already supplies the three webhook secrets:
the door has to be open, or the test passes by never reaching the code. Proven
by stripping them and watching it fail, rather than by reasoning that it would.

The lesson is not about email. It is that **a gate is only as good as the
environment it has been run in**, and this milestone's central gate had been run
in exactly one.

---

*Every command reported here was executed on this branch and its output
inspected. Where something was not done, this record says so rather than
reporting the intent.*
