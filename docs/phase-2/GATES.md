# PHASE GATE RECORDS
## Blueprint §4 universal checklist · one section per phase closure

## IP-2 — Identity & Tenancy · FROZEN 2026-07-14 · tag `ip2-frozen`

Milestone decisions: M-IP2-1 **APPROVED** · M-IP2-2 **APPROVED** · M-IP2-3 **APPROVED** · M-IP2-4 = this freeze.
**Freeze gate (RC-4) CLEARED.** The Blueprint's named exit — an independent security review of the auth/authz surface — is complete. Reviewer: **Fable** (founder-named). First pass returned APPROVE WITH CONDITIONS with two verified defects (RLS write-side self-escalation; OTP attempt-counter race); both were fixed in-milestone (commit `9559d9e`) and **independently re-proven** by the reviewer, who then returned **APPROVE WITH CONDITIONS — zero freeze blockers, `ip2-frozen` cleared to proceed**. Remaining conditions are all before-production / before-GA and recorded (see below + closure §6). Review package: [IP-2_RC4_REVIEW_PACKAGE.md](IP-2_RC4_REVIEW_PACKAGE.md) (v1.1).

| # | Gate | Evidence (2026-07-14, tree at freeze commit) |
|---|---|---|
| 1 | Type safety | `tsc --strict` clean, 7/7 workspaces, zero suppressions in source |
| 2 | Lint | 0 errors 7/7 workspaces |
| 3 | Unit tests | 76 — core **17** (capability engine 8: fail-closed sets, revocation, exact-scope) · contracts 2 · engine 5 · ui 52 (IP-1 suite untouched) |
| 4 | Integration | **29 vs live PG17** — auth 7 · security regression **8** (incl. **concurrency cap proof**) · authz regression **12** incl. **RLS PROOF** (read: cross-tenant 0 rows, no-context 0 rows), **RLS WRITE PROOF** (write: self-escalating grant on a foreign org rejected by `WITH CHECK`, active-tenant grant succeeds), and **AUDIT PROOF** (production grant recipe: UPDATE/DELETE on audit_log → permission denied); migrations 0000–0004 re-applied idempotent |
| 5 | Accessibility | axe **zero violations** on /login + /orgs and all IP-1 suites; keyboard-only login journey; 360px zero-overflow |
| 6 | Performance | First-load JS shared 102 kB; /login 113 · /account 114 · /orgs 113 · /org/[slug] 110 · /join 108 kB; /gallery 113 kB vs 112 kB at IP-1 freeze (<1%, chunk attribution) — **unchanged**; prod server verified serving HSTS/DENY/nosniff |
| 7 | Visual review | Founder approved the FLOODLIGHT identity journeys at M-IP2-1/-2/-3; demo script ready (closure §7) — a live founder demo of already-e2e-proven behavior remains available post-freeze |
| 8 | Founder review | M-IP2-1/2/3 decisions recorded above; the one founder input (name the RC-4 reviewer) satisfied — **Fable**; M-IP2-4 = this record |
| 9 | Documentation | Permanent set shipped: `docs/identity/` (AUTHENTICATION · SESSIONS · PASSKEYS · AUTHORIZATION · THREAT_MODEL · DPDP_DATA_INVENTORY · RUNBOOKS) + RC-4 package + closure report. Deviations recorded: NODE_ENV env-file build defect fixed (D-M4-1); local e2e workers=2 (D-M4-2); person-scoped + `organizations` RLS deliberately absent, justified (D-M4-4); `withTenant()` serving-path wiring = named pre-deploy item (D-M4-5); RC-4 remediation 0004 + atomic OTP (D-M4-6) |
| 10 | Architecture review | Boundaries 0 violations / 325 modules (`db → drizzle+postgres` only, intact); e2e-in-CI decision still parked at the IP-3 gate; **independent review = RC-4 CLEARED (verdict above)** |

**Security sweep (M-IP2-4):** five findings total, all fixed or dispositioned in-milestone, **zero product-code defects left open**. Three from the internal sweep (all test/build infra): production build corrupted by env-file NODE_ENV; e2e flake under parallel dev-server load; audit append-only previously untested (now AUDIT PROOF). Two from the RC-4 independent review (both genuine, both fixed + re-proven): RLS write-side self-escalation (migration 0004 `WITH CHECK`); OTP attempt-counter race (atomic guarded increment). Dev-inbox production exclusion **proven live** (404 on `next start`).

**RC-4 verdict (verbatim, Fable):** "On re-review of commit 9559d9e I independently confirmed that both defects my first pass flagged as blocking are fixed and re-proven, not merely asserted. Migration 0004 adds explicit `WITH CHECK` clauses that constrain every write to the caller's active tenant with no self-row escape; re-running my original exploits under the production non-superuser role recipe, the self-escalation to `org:owner` on a foreign org — which succeeded before — is now rejected by row-level security, while legitimate active-tenant writes and the unchanged read policies still behave correctly. The OTP attempt cap is now an atomic guarded increment that I verified ceilings at five under twelve-way concurrency. The decision to leave `organizations` without RLS is a reasonable, well-documented design choice (org names are deliberately semi-public via invite links; non-disclosure is delivered by the app-layer 404), which I accept for freeze with a membership-gated policy folded into the recorded pre-deploy `withTenant()` wiring. IP-2's identity foundation — fail-closed capabilities, per-capability enforcement on a single audited path, hashed rotating sessions, atomic invites, and now a genuine dual-layer read+write RLS lock — is sound; I approve the freeze with the remaining conditions scoped to before-production, and no blockers outstanding for the `ip2-frozen` tag."

**RC-4 conditions carried forward (none freeze-blocking):** (1, before-production) wire `withTenant()` into the serving path, add a membership-gated `organizations` policy, and reconcile the two pre-tenant reads (invite-by-token, org-preview-before-membership); (2, before production signup) SMS-pumping circuit-breaker before RC-1 opens paid delivery; (3, advisory) wrap `acceptInvite`/`createOrg` in transactions; (4, advisory) `issueGrant` capability-set re-validation. All recorded in the closure report §6 and RC-4 package §5.

## IP-1 — FLOODLIGHT Design System · FROZEN 2026-07-13 · `ui@0.1.0` · tag `ip1-frozen`

Milestone decisions: M-IP1-1 **APPROVED** · M-IP1-2 **APPROVED** · M-IP1-3 **APPROVED** (founder: "premium feel achieved, cohesive, worthy of the brand; mobile consistent") · M-IP1-4 **APPROVED** · M-IP1-5 = this freeze.
**VA-8 rulings (final):** V1 ships silent — ceremony sound is a post-V1 organizer opt-in; Hindi copy register = formal-respectful **आप** (commentary energy lives in the visual ceremony, not the words).

| # | Gate | Evidence (2026-07-13, tree at freeze commit) |
|---|---|---|
| 1 | Type safety | `tsc --strict` clean, 6/6 workspaces, zero suppressions |
| 2 | Lint | 0 errors; token purity additionally enforced by guardrail test (no hex/rgb literal in component source — catches `rgb()` too) |
| 3 | Unit tests | ui **52/52**: keyboard contracts, aria wiring, hold-gate clock semantics, announcer queue, placeholder determinism (64-seed spread), grapheme segmentation, guardrails |
| 4 | Integration | engine suite unaffected/green; ui has no infra to integrate |
| 5 | Accessibility | **axe zero violations, both themes, whole gallery**; contrast MEASURED: daylight text pairs 5.22–17.33:1 (worst `text-on-accent` 5.28), floodlight 5.10–18.08:1; UI tokens ≥3:1; reduced-motion parity incl. **hold-gate full-duration proof under emulated reduced motion**; keyboard journeys (dialog Escape/confirm, tabs arrows, Space-hold) in real Chrome |
| 6 | Performance | `/gallery` first-load JS 112 kB (10.4 kB route); Clash woff2 40 K total, all faces self-hosted, **zero external requests** (tested); animations compositor-only |
| 7 | Visual review | Founder reviewed desktop + phone at M-IP1-1/-3; theme flip live; 360px zero-overflow (tested) |
| 8 | Founder review | All five milestone decisions recorded above |
| 9 | Documentation | doc 08 corrected with measured values (volt-600 2.35:1 finding); doc 09 amended — **WI-7 ruled: Anek Devanagari display companion**; ui README = maintainer contract; deviation recorded: doc 18's Tailwind preset deferred (no Tailwind consumer exists) |
| 10 | Architecture review | ui↛core boundary intact (dep-cruiser 0/226 modules); RTL explicitly out of V1 scope (hi is LTR); e2e-in-CI decision deferred to IP-3 gate as recorded at IP-0 acceptance |

**Freeze meaning:** `@desiauction/ui@0.1.0` public API is stable; regressions are defects, changes need codemods (doc 18). Watch items discharged in-phase: WI-7 (ruled) · WI-2 first checkpoint (founder five-second review passed at M-IP1-1/-3). Carried forward unchanged: WI-1/3/8/9-pilot instruments (IP-8), WI-4/5/6 (IP-5 mock night), WI-10 (IP-5).

## IP-0 — Engineering Foundation · engineering closure 2026-07-13

Status: **ENGINEERING CLOSED** (acceptance GO WITH CONDITIONS, both conditions applied and verified). The freeze tag `ip0-frozen` follows the founder tail: accounts → staging deploys → **gated tracer Run 2 (Fly bom + Neon Mumbai)** → onboarding measured on a clean machine → founder demo. This record is completed (gates 6 and 8 finalized) at freeze.

| # | Gate | Evidence (2026-07-13, tree at closure commit) |
|---|---|---|
| 1 | Type safety | `tsc --strict` clean, 6/6 workspaces, zero suppressions |
| 2 | Lint | 0 errors 6/6 workspaces incl. RC-A2 instrumentation exemption reviewed |
| 3 | Unit tests | core 7 · contracts 2 · engine 5 — green |
| 4 | Integration | 2/2 vs live PG17 (healthz over real connection; ws echo); migrations re-applied clean ("already applied" idempotence proven) |
| 5 | Accessibility | n/a this phase per design §26 (axe harness arrives with IP-1 components) |
| 6 | Performance | Tracer local baseline (Run 1) M1 p99 0.92ms · M2 8ms · M3 4000/4000 p95 4ms; **closure re-run** M1 p99 1.36ms · M2 9ms · M3 4000/4000 p95 6ms — all PASS; **gated Run 2 = freeze requirement** |
| 7 | Visual review | n/a this phase (foundation page only; Playwright renders it 2/2) |
| 8 | Founder review | GO WITH CONDITIONS recorded (IP-0_ACCEPTANCE_REVIEW.md); live demo at freeze |
| 9 | Documentation | IP-0_DESIGN reconciled; deviations recorded (semantic-PR-action for commitlint §20; Playwright port 3100→3050, local port collision) |
| 10 | Architecture review | Boundary audit 0 violations / 98 modules; hard-rules audit clean; independent review not required this phase (IP-2/IP-4 scope per RC-4) |

Conditions: **RC-A1** dependabot.yml (security-only) ✓ applied · **RC-A2** guarded @sentry/nextjs instrumentation ✓ applied (boots clean with no DSN — proven by Playwright run).
