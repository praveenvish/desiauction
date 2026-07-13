# IP-2 CLOSURE REPORT · IDENTITY & TENANCY

## M-IP2-4 "Papers in Order" · 2026-07-14 · CTO

> **Revision note (RC-4 complete):** the independent reviewer (Fable) first pass
> returned **APPROVE WITH CONDITIONS** with two verified defects (RLS write-side hole,
> OTP attempt-counter race). Both were **fixed and independently re-proven** (commit
> `9559d9e`, migration `0004` + atomic OTP guard + two new regression proofs); a third
> finding (organizations no RLS) was reclassified as intentional and documented. On
> re-review the reviewer returned **APPROVE WITH CONDITIONS — zero freeze blockers,
> `ip2-frozen` cleared**. This report reflects the frozen tree. See §3 D-M4-6, §8, and
> the verbatim verdict in GATES.md.

## 1 · What was completed

M-IP2-4 added **zero business functionality** by directive. Delivered: the permanent
identity documentation set (`docs/identity/` — [AUTHENTICATION](../identity/AUTHENTICATION.md),
[SESSIONS](../identity/SESSIONS.md), [PASSKEYS](../identity/PASSKEYS.md),
[AUTHORIZATION](../identity/AUTHORIZATION.md), [THREAT_MODEL](../identity/THREAT_MODEL.md),
[DPDP_DATA_INVENTORY](../identity/DPDP_DATA_INVENTORY.md), [RUNBOOKS](../identity/RUNBOOKS.md)),
the [RC-4 review package](IP-2_RC4_REVIEW_PACKAGE.md), one new permanent regression
test (**AUDIT PROOF** — the D8 append-only contract as a tested fact), the full
verification sweep, and this closure. Three defects found and fixed, all test/build
infrastructure, none in product code (§3).

## 2 · What was verified (all fresh, this closure, local — no remote CI exists yet)

| Gate                | Result                                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------------------------ |
| TypeScript          | ✓ `tsc --strict` 7/7 workspaces, zero suppressions in source                                                        |
| Lint                | ✓ 0 errors, 7/7 workspaces                                                                                          |
| Unit                | ✓ 76 — core 17 (capability engine 8) · contracts 2 · engine 5 · ui 52                                               |
| Integration (PG17)  | ✓ 29 — auth 7 · **security regression 8** (incl. concurrency proof) · **authz regression 12** (incl. RLS PROOF + RLS WRITE PROOF + AUDIT PROOF) · engine 2 |
| Playwright          | ✓ 37/37 real Chrome — OTP journey, **passkey ceremony via CDP virtual authenticator**, house journey (invite → accept → revoke → 404 isolation), session management |
| Security suite      | ✓ 8/8 (replay, enumeration, lockout+event, **concurrency cap**, rotation, isolation, passkey fail-closed ×2)         |
| Authz suite         | ✓ 12/12 (escalation, revocation, invites ×4, tenancy, RLS read, **RLS write**, audit immutability)                  |
| Passkey coverage    | ✓ e2e enroll + passkey-only login + server-side fail-closed tests                                                   |
| Boundaries          | ✓ dep-cruiser 0 violations / 325 modules / 566 deps (`db → drizzle+postgres` only, intact)                          |
| RLS                 | ✓ SQL-layer proof under non-superuser probe: cross-tenant 0 rows; no-context 0 rows (fail closed)                   |
| Axe                 | ✓ zero violations — /login, /orgs + all IP-1 gallery suites; keyboard-only login; 360 px                            |
| Performance         | ✓ first-load JS shared 102 kB; /login 113 · /account 114 · /orgs 113 · /org 110 · /join 108 kB; /gallery 113 kB vs 112 kB at IP-1 freeze (< 1%, chunk-attribution noise) |
| Build & migrations  | ✓ production build 3/3; migrations re-applied idempotent; generated tokens no-op; `pnpm audit --prod` zero known vulns |
| Dev-inbox exclusion | ✓ **proven live**: `next start` → `/dev/inbox` 404 while `/login` 200; HSTS/DENY/nosniff headers verified on the wire |

## 3 · Final engineering decisions (this milestone)

- **D-M4-1 · `NODE_ENV` removed from env files** (defect fix). `.env.local`'s
  `NODE_ENV=development` was injected into `next build` by `--env-file-if-exists`,
  corrupting prerender (`<Html>` /404 failure). CI never saw it (no env file). The
  runtime owns NODE_ENV; env.ts defaults cover bare node. `.env.example` documents
  the rule.
- **D-M4-2 · Local e2e workers capped at 2** (`playwright.config.ts`, CI untouched).
  >2 workers overload the single on-demand dev compiler into moving 30 s timeouts;
  at 2 workers the suite is deterministic and faster (27 s vs 44 s). Recorded as
  test-infrastructure deviation, IP-0 port-change pattern.
- **D-M4-3 · AUDIT PROOF added** to the permanent authz suite: a role on the R-1
  production grant recipe gets `permission denied` on UPDATE/DELETE of `audit_log` —
  D8's append-only contract is now grant-enforced *and* tested, not convention.
- **D-M4-4 · Person-scoped tables carry no RLS policies** — recorded as deliberate
  deviation from IP-2_DESIGN §4: authentication is pre-identity (token lookup
  precedes any person context), so `people/sessions/otp_codes/passkey_credentials`
  rely on app-layer scoping (tested); the org tables carry the RLS second lock.
- **D-M4-5 · `withTenant()` wiring deferred to first deploy** — the RLS primitive
  exists and is proven; routing the serving path through it lands with the first
  production role (IP-3/IP-4), tracked as a named pre-deploy work item (§6.1). A
  freeze-scope rewrite of every query path would have violated this directive's
  "no new functionality" and shipped untested plumbing.
- **D-M4-6 · RC-4 remediation applied in-milestone** (commit `9559d9e`). The
  independent review found the RLS second lock protected reads but not writes
  (`USING`-only policies → self-escalation to `org:owner` on any org) and an OTP
  attempt-counter race. Both are genuine defects, not new functionality, so they were
  fixed inside the freeze milestone: migration `0004` adds `WITH CHECK` (writes
  constrained to the active tenant, no self-row escape; audit rows require
  `actor = app.person_id`); OTP verify uses an atomic guarded increment. Two new
  permanent proofs (RLS WRITE PROOF, concurrency cap) pin them. `organizations`
  remaining un-RLS'd was reclassified as intentional (org name is invite-link-public)
  rather than patched with a policy that would break invite previews — documented, not
  silently deferred.

## 4 · Security decisions (standing, from IP-2 as built)

No passwords, ever (C-24) · every stored secret is hashed (OTP SHA-256, session
SHA-256, invite SHA-256) · every login mints a fresh session · one generic failure
for verify (no enumeration oracle) · capability evaluation fails closed (unknown →
∅, revoked → ∅, exact scope) · one action shape: session → tenant → capability →
act → audit · tenant misses are 404 never 403 · RLS FORCE'd + fail-closed on org
tables · audit append-only by grant · dev surfaces structurally absent from
production · platform origin-check + SameSite for CSRF · open-redirect-free returns.

## 5 · Threat model summary

[THREAT_MODEL.md](../identity/THREAT_MODEL.md) covers the seven-stage chain
(Identity → Authentication → Session → Authorization → Tenant Resolution → RLS →
Business Capability), each with boundary, assets, threats, vectors, implemented
mitigations, named tripwire tests, and residuals. The RLS stage now documents both
the read lock (`USING`) and the write lock (`WITH CHECK`, added in remediation).
Headline residuals: SIM-channel risks inherent to phone-first (passkeys are the
mitigation path) · RLS proven for reads and writes but not yet load-bearing in the
serving path (fail-closed, §3 D-M4-5) · DevInboxSender is the only sender until RC-1
(production login undeliverable by design) · no CSP until IP-3 · convention-enforced
action pattern (RC-4 Q3 asks the reviewer to pressure-test it).

## 6 · Remaining risks & work items

1. **Pre-deploy (blocking first production traffic):** route org-scoped queries
   through `withTenant()` (reconciling the invite-by-token and org-preview pre-tenant
   reads); provision roles per R-1; RC-1 sender swap; set real `RP_ID`/`RP_ORIGINS`;
   SMS-send circuit-breaker before paid delivery (RC-4 advisory).
2. **Pre-GA (DPDP):** consent notice + record at signup; account deletion/anonymize
   path; grievance surface; data purge jobs (R-6 automates); phone-change flow.
3. **Watching (RC-4 advisories + carried):** wrap `acceptInvite`/`createOrg` in
   transactions; `issueGrant` capability-set re-validation; membership-gated
   `organizations` RLS option; CSP at IP-3 · UV step-up when money arrives (IP-6) ·
   audit write transactionality with IP-6 idempotency · org/invite creation rate
   limits · counter-anomaly alarming.
4. **Program:** no git remote/CI-on-push yet (IP-0 founder tail) — all gates local.

## 7 · Founder demonstration (ready to run, ~5 minutes)

`docker compose up -d db && pnpm dev` → phone login via `/dev/inbox` on your real
number format → `/account`: enroll a passkey named "Founder phone", sign out, sign
back in with **only the passkey** → create org A; in a second browser, second phone,
accept A's invite link as staff; see the staff member appear, revoke the set →
create org B as the second user and watch user A get a **404** on B's URL → point at
the events panel: every step you just did is in the audit trail. (This is exactly
e2e `login → passkeys → orgs`, 37/37 green — the demo cannot surprise us.)

## 8 · CTO recommendation

Engineering for IP-2 is **complete and verified**; the surface is documented to the
standard the directive demanded (a new team could build Competition, Auction Engine,
Money, and Operations on these docs without redesigning identity). The one gate the
Blueprint named for freeze — the RC-4 independent review — is **cleared**: reviewer
Fable returned APPROVE WITH CONDITIONS with **zero freeze blockers**, having
independently re-proven that both defects the first pass flagged (RLS write-side
self-escalation, OTP race) are fixed. The remaining conditions are all
before-production / before-GA and recorded (§6). **Recommendation: FREEZE — cut
`ip2-frozen`.** The `withTenant()` serving-path wiring (with the membership-gated
`organizations` policy and pre-tenant-read reconciliation folded in) is the first
task of the production-deploy tail, not a freeze blocker; the live founder demo of
§7 exercises behavior already proven by 37 green e2e tests and can run any time
post-freeze without affecting the tag.

## 9 · Phase readiness assessment

**FROZEN** — tag `ip2-frozen` cut at this commit. All ten gates green; RC-4 cleared
with the verdict recorded verbatim in GATES.md; zero open engineering items and zero
open product-code defects. IP-2 is now a permanent, consumable, documented, tested
identity subsystem: fail-closed capabilities, per-capability enforcement on one
audited path, hashed rotating sessions, atomic invites, and a genuine dual-layer
read+write RLS lock. **IP-3 ("Competition") is unblocked for design the moment the
founder issues OPEN IP-3.** Engineering stops here per the directive.
