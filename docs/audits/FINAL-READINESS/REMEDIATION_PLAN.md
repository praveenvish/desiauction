# Final Readiness — Remediation Plan

> **Status: complete (2026-09-18).** Phases 0–12 are done and committed; the outcome, commit by commit, is [REPORT §0](REPORT.md#0--remediation-outcome-added-after-the-audit). Two plan items changed on contact with the evidence, and both are recorded there: `prototypes/va1` was kept, because its precondition "nothing references it" was false; and the demo-booking throttle was dropped as unnecessary once booking ids became signed handles that cannot be enumerated. One Phase 8 item is left open and recorded as such in REPORT §17: the three consecutive clean Firefox + WebKit runs required to return them to the nightly (one clean run exists; the check was stopped). The rest of what is left is founder- and counsel-owned, sequenced in [GO_LIVE_RUNBOOK](../../operations/GO_LIVE_RUNBOOK.md).

Companion to [REPORT.md](REPORT.md). Every finding from that audit is listed here, small ones included. Each has an owner, an approach, a verification step and a phase. Founder decisions taken on 2026-09-18:

| Decision | Choice |
|---|---|
| Newsletter | Keep it and make it honest: DB-backed throttle, retention sweep, unsubscribe, admin count/export. No sending yet. |
| Erasure | The person files a request; a platform admin reviews it and runs a one-click erasure per the published policy. |
| CSP | Ship the nonce policy **report-only** first, prove zero violations across e2e, keep a one-line switch to enforce. |
| Commits | One commit per phase on `ui/premium-foundation`, gates green before each commit, nothing pushed. |

**Rule for every phase:** `pnpm verify` + `pnpm build` + `pnpm test:integration` green before the commit. Phases that touch tenancy or the browser also run the production-role posture suites or the precompiled e2e suite. A test that fails on the pre-fix code is added wherever the defect is behavioural.

---

## Issue register

| ID | Sev | Issue | Owner | Phase |
|---|---|---|---|---|
| P0-1 | P0 | No SMS provider → nobody can sign in | Founder (+ runbook) | 12 |
| P0-2 | P0 | No production backups / PITR / restore drill | Founder (+ local drill proof) | 11, 12 |
| P0-3 | P0 | Production env, secrets, four-role DB not bootstrapped | Founder (+ runbook) | 12 |
| P1-L | P1 | Legal drafts unratified | Counsel | 12 |
| FR-01…08, 12, 14, 15 | — | Fixed in the audit pass | Engineering | 0 (commit) |
| FR-09 | P2 | 8 modules read tenant data on the RLS-exempt pool | Engineering | 1 |
| FR-10 | P2 | CSP has no `script-src` / `connect-src` | Engineering | 4 |
| FR-11 | P2 | Erasure has no mechanism; no request path | Engineering | 2 |
| FR-13 | P2 | Newsletter: in-memory throttle, write-only, no retention/unsubscribe | Engineering | 3 |
| P2-H | P2 | Single host, single engine process | Founder (infra) + measured RTO | 11, 12 |
| P2-R | P2 | Razorpay never run live | Founder | 12 |
| FR-16 | P3 | Daily-ops fan-out O(orgs) | **No code change** — `runSchedulesOnce` loops orgs BY DESIGN (IP-6 ADR-3, `IP-6_FREEZE.md` §10). Correct the doc note that proposed batching. | 10 |
| FR-17 | P3 | `bookSlotAction` trusts a raw `requestId`; no throttle | Engineering | 6 |
| FR-18 | P3 | Server actions carry no request id; authz refusals unlogged | Engineering | 4, 5 |
| FR-19 | P3 | React Compiler lint rules not adopted | Engineering | 7 |
| FR-20 | P3 | `packages/auction` has no unit test script | Engineering | 8 |
| FR-21 | P4 | `prototypes/va1` tracked dead prototype | Engineering | 10 |
| FR-22 | P4 | `/features` shows cricket-only sample players | Engineering | 10 |
| S-1 | P3 | `AuctionLab` sport buttons disabled until hydration | Engineering | 10 |
| S-2 | P3 | `audit_log` has no index on `actor` / `scope_id` alone | Engineering | 9 |
| S-3 | P3 | ~35 `*_by` columns without FK | Engineering (decide per column) | 9 |
| S-4 | P3 | Registration import inserts new people row by row | Engineering | 9 |
| S-5 | P3 | Firefox/WebKit live-auction e2e flakiness not understood | Engineering (investigate) | 8 |
| S-6 | P3 | Production perf never measured; engine restart RTO unmeasured | Engineering (measure locally), Founder (staging) | 11 |
| S-7 | P3 | DMARC `p=none` | Founder (DNS) | 12 |
| S-8 | P3 | No price for paid tiers | Founder | 12 |

---

## Phase 0 — Baseline commits

1. `feat(ui): premium landing and public shell`. This is your in-progress premium-UI work. It includes the three fixes that were needed inside those same files to make it green: the restored demo CTA, the type-scale corrections, and the `next/link` on `guest-home`.
2. `fix: final readiness audit remediation`. Everything else from the audit pass: the multi-sport attributes, the three lint rule sets plus the bugs they found, WebSocket jitter, the newsletter throttle, depcruise, the CI photo-journey step, docs, and the report.

## Phase 1 — Tenant isolation (FR-09)

**Problem.** Eight modules call `systemDb` (RLS-exempt) for reads that happen *after* membership is known.

**Approach.**
- Separate the one read that genuinely cannot be tenant-scoped (slug → org, before any org is known) from everything else.
- Move `resolveCompetition` / `competitionForRegistration` system-pool calls behind a single module, `server/competition/resolve.ts`. It is allowlisted as `by-design` with the reason stated.
- Every other read moves inside `withTenantDb(dbHandle, { personId, orgId })`.
- Cross-org reads (home dashboard money aggregates, tournament listings, organizer schedule, `competitionsForPerson`) open one boundary per org the person belongs to. `org_members` already has a person arm, so the org list itself is readable under a person-only boundary.

**Verification.**
- `check:posture` shows `debt 0`.
- Create the four production roles on the local DB (`ops/db/create-app-role.sql`, exactly as CI does).
- Then run `grants:verify`, `rls:verify` and `posture:verify` as `desiauction_app`.
- Full integration and e2e.

## Phase 2 — Erasure (FR-11)

**Migration 0064:**
- `people.erased_at timestamptz`.
- `people_reachable_check` relaxed to `phone IS NOT NULL OR email IS NOT NULL OR erased_at IS NOT NULL`.
- New table `erasure_requests (id, person_id FK RESTRICT, requested_at, reason, status requested|completed|declined, decided_by, decided_at, note)` with a partial unique index (one open request per person). The table is person-scoped platform data: no org, no RLS, the same posture as `consent_records`.
- Grants for the app role, plus a role manifest entry.

**Erasure (one transaction, one function, `server/admin/erasure.ts`), following the policy text exactly:**
- Delete what CASCADE already covers: sessions, passkeys, email verifications, notification preferences, player profiles and sport profiles.
- Delete OTP codes and inbox rows for the phone.
- Anonymize `people`: name → `null`, phone → `null`, email → `null`, photo removed from storage and the column cleared, consent timestamps cleared, `erased_at` set.
- Keep registrations, paddles, grants, bids and receipts. They now point at an anonymized person, and readers render "Erased player".
- Suppress the old phone and email in `suppressions` so an imported sheet cannot silently re-contact them.
- Write an audit row.
- Refuse while the person is in a live or paused auction, or holds the only `org:owner` grant of an org.

**Surfaces:**
- `/account` gets "Delete my account". It confirms, files a request, and shows the pending state.
- `/admin/erasure` is the queue, gated on `platform.admin`. It has a typed-confirmation erase action and a decline-with-note action, and every access is logged.

**Tests:**
- Unit: the anonymization plan.
- DB regression: cascade rows gone, shared records intact, `people` anonymized, the reachability check holds, and the person cannot sign in.
- Refusals: the live-auction and last-owner cases.
- e2e: request → admin erase → login refused.

## Phase 3 — Newsletter (FR-13)

- **Migration 0065.** `newsletter_subscribers.request_ip`, plus an index `(request_ip, created_at)`.
- **Throttle.** Replace the in-memory bucket with a DB count per IP per hour, the same shape as `isThrottled`.
- **Retention.** Purge addresses 24 months after signup, consistent with demo requests. Wire it into the existing retention door `/api/jobs/demo-reminders`, and state the rule on `/legal/data-retention`.
- **Unsubscribe.** A new page, `/newsletter/unsubscribe`, where anyone can remove an address. The response is identical whether or not the address was present.
- **Admin.** A subscriber count and CSV export in `/admin`, gated on `platform.admin`, with access logged.
- **Tests.** Throttle, purge, unsubscribe (no enumeration), and the export gate.

## Phase 4 — CSP nonce, report-only, and request ids (FR-10, FR-18 part 1)

`apps/web/src/middleware.ts` does two things only:
1. Mints a per-request nonce, sets `Content-Security-Policy-Report-Only`, and passes the nonce to rendering through the request header Next reads.
2. Stamps `x-request-id` when none was supplied.

The policy:
- `default-src 'self'`
- `script-src 'self' 'nonce-…' 'strict-dynamic'`
- `style-src 'self' 'unsafe-inline'` (React style attributes)
- `img-src 'self' data: blob:` + the media origin
- `connect-src 'self'` + the engine WS origin + the Sentry ingest origin
- `font-src 'self'`, `frame-src 'none'`, `worker-src 'self' blob:`
- `report-uri /api/csp-report`

The enforced header set stays exactly as today. The theme bootstrap and JSON-LD inline scripts take the nonce. `/api/csp-report` is size-capped and throttled, and logs structured violations.

**Verification:** a new e2e spec visits every public and console surface and fails on any report-only violation in the browser console. Switching to enforce is changing one header name, documented.

## Phase 5 — Server-action observability (FR-18 part 2)

- `actionLogger()` reads the middleware's `x-request-id`.
- The gateways that refuse (`ForbiddenError`, `liveGate` null, finance and settlement gates) log a structured `authz.refused` line with the request id, the person id and the surface. There is no PII.
- Unexpected action errors are logged before rethrow.

## Phase 6 — Demo booking (FR-17)

- `requestDemoAction` returns an HMAC-signed handle over `requestId`, using `DEMO_TOKEN_SECRET`, instead of the bare id.
- `bookSlotAction` verifies the handle with a constant-time comparison and refuses a raw id.
- Throttle bookings per IP (a column on `demo_bookings`, migration 0066).
- **Tests:** a forged handle is refused; the throttle holds.

## Phase 7 — React Compiler lint rules (FR-19)

- Enable the `react-hooks` v7 recommended set.
- Fix each violation properly: derive during render instead of set-state-in-effect, and move ref reads into effects and handlers.
- Where a pattern is deliberate and correct (the isolated 10 Hz auction clock), use a scoped suppression with its reason at that site, not config-level silence.
- Lint green with the full set.

## Phase 8 — Test depth (FR-20, S-5)

- `packages/auction` gets a `test` script and unit tests for its pure read models (`views.ts`, `live.ts`).
- Firefox and WebKit: run the live-auction specs repeatedly on both, classify each failure as harness or product, and fix at source. Return both engines to the nightly only if they are stable across three consecutive full runs; otherwise record the evidence.

## Phase 9 — Database (S-2, S-3, S-4)

- **Migration 0067.** Add `audit_log (actor, at)` and `(scope_id, at)` indexes.
- **`*_by` columns.** Inspect the live values per column. Columns only ever written with real person ids get a `NOT VALID` FK with RESTRICT, so new writes are checked without failing on historical residue. Columns that legitimately carry the system or engine actor are documented as intentionally unconstrained.
- **Import.** Batch the new-person inserts (one multi-row insert with `onConflictDoNothing … returning`). The existing import regression suite is the proof.

## Phase 10 — Content and cleanup (FR-16 doc, FR-21, FR-22, S-1)

- Correct the KNOWN_LIMITATIONS finops note to cite ADR-3 (by design).
- Delete `prototypes/va1` after confirming nothing references it.
- `/features` sample cards become multi-sport.
- `AuctionLab` buttons render enabled, since React 19 replays pre-hydration clicks.

## Phase 11 — Measurements (S-6, P0-2 proof, P2-H)

- **Engine restart RTO.** Kill the engine mid-lot on a seeded auction and time it to `/readyz` 200 and first snapshot.
- **Performance.** Run `perf:competition`, `perf:collections`, `perf:closure` and `perf:finops` against a production build.
- **Restore.** Run `pnpm restore:drill` locally.
- Record every number in REPORT.md.

## Phase 12 — Founder go-live runbook (P0-1..3, P1-L, P2-R, S-7, S-8, P2-H)

`docs/operations/GO_LIVE_RUNBOOK.md` gives the exact ordered steps and the commands to prove each:
- MSG91 + DLT;
- backups + PITR + drill;
- the four-role bootstrap;
- env + `preflight:production`;
- Sentry;
- the MinIO off-host backup;
- DMARC to `quarantine`;
- the Razorpay staging transaction;
- the price decision;
- legal ratification;
- the smoke scenario.

These cannot be done from the repository. The runbook makes each one a checkbox with a verifiable command.

## Final

Re-run every gate. Update REPORT.md: the scorecard, the counts, and the final block.
