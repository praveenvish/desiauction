# IP-2 · RC-4 INDEPENDENT SECURITY REVIEW PACKAGE

## DesiAuction NEXT · v1.0 · 2026-07-14 · CTO · Prepared for the independent reviewer (M0 condition RC-4)

> **Mandate:** M0 approved the program blueprint with condition RC-4 — an independent
> review of the authentication/authorization surface before IP-2 freezes. This
> package is the entry point: it should let you understand and challenge the system
> **without reading the whole repository**. The reviewable surface is ≈ 1,700 lines
> of product code plus its permanent test suites. The phase freeze waits on your
> verdict.

## 1 · What you are reviewing

Identity & Tenancy for a multi-tenant cricket-auction platform (India-first, DPDP):
phone-first OTP login (no passwords, ever), WebAuthn passkeys, DB-backed revocable
sessions, organizations with **grants-not-roles** authorization (person × scope ×
capability set, enforced per-capability), slug-based tenant resolution, PostgreSQL
RLS as defense-in-depth, and an append-only audit substrate. Future phases
(Competition, Auction Engine, Money, Operations) consume this subsystem **without
redesigning it** — your review is the last gate before it becomes permanent.

## 2 · Read this in order (~90 minutes)

| # | Artifact                                                                    | Why                                                        |
| - | --------------------------------------------------------------------------- | ---------------------------------------------------------- |
| 1 | [IP-2_DESIGN.md](IP-2_DESIGN.md) §3–§6                                       | The 9 architecture decisions + security posture as designed |
| 2 | [identity/THREAT_MODEL.md](../identity/THREAT_MODEL.md)                      | The 7-stage trust chain, mitigations, tests, residuals      |
| 3 | [identity/AUTHENTICATION.md](../identity/AUTHENTICATION.md) · [SESSIONS.md](../identity/SESSIONS.md) · [PASSKEYS.md](../identity/PASSKEYS.md) · [AUTHORIZATION.md](../identity/AUTHORIZATION.md) | Implemented architecture, one subsystem each |
| 4 | Code, guided: `packages/core/src/capabilities.ts` (80 L, pure) → `packages/db/src/schema.ts` (149 L) + `migrations/0003_rls_org_isolation.sql` → `apps/web/src/server/auth/` (otp 144 · sessions 101 · passkeys 157 · actions 265 · otp-sender 17 · security-events 46) → `apps/web/src/server/orgs/` (authz 49 · orgs 167 · invites 156 · actions 160) | The entire product surface |
| 5 | The permanent suites: `security.regression.test.ts` (7) · `authz.regression.test.ts` (11, incl. RLS PROOF + AUDIT PROOF) · `auth.integration.test.ts` (7) · `e2e/{login,passkeys,orgs}.spec.ts` | The contract as executable claims |
| 6 | [identity/DPDP_DATA_INVENTORY.md](../identity/DPDP_DATA_INVENTORY.md) · [identity/RUNBOOKS.md](../identity/RUNBOOKS.md) | Data facts + operational recipes (R-1 grant recipe is load-bearing) |

## 3 · The claims we make (and where each is proven)

| Claim                                                                 | Proof                                                                     |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| OTP codes: hashed at rest, 5-min TTL, ≤5 attempts, replay-dead, rate-limited (30 s / 5·h·phone / 20·h·IP) | code `otp.ts`; SEC replay/lockout; INT cooldown/attempts               |
| No account-enumeration oracle (open signup; identical failure)         | SEC + INT enumeration tests (response equality)                            |
| Sessions: opaque 32-B tokens, SHA-256 at rest, rotation at every login, instant revocation, ownership-checked management | code `sessions.ts`/`actions.ts`; SEC rotation/isolation; INT revoke; E2E second-device revoke |
| Passkey ceremonies verify challenge+origin+rpID; single-use 300 s httpOnly challenge; unknown credentials fail closed | code `passkeys.ts`; SEC fail-closed ×2; E2E full ceremony via CDP virtual authenticator |
| Capabilities fail closed: unknown sets → ∅, revoked → ∅, exact scope only | CORE 8 unit tests; AUTHZ escalation/revocation tests                       |
| One enforcement path: session → tenant → capability → act → audit      | code `orgs/actions.ts` (all five actions); AUTHZ cross-tenant Forbidden    |
| Tenant resolution never discloses org existence (404, not 403)         | AUTHZ indistinguishability; E2E house journey                              |
| Invites: hashed one-time tokens, atomic claim, expiring, revocable, set-validated at creation | code `invites.ts`; AUTHZ lifecycle ×4                                |
| RLS independently blocks cross-tenant reads and fails closed with no context | **RLS PROOF** — non-superuser probe role, real SQL                     |
| `audit_log` is append-only under the production grant recipe           | **AUDIT PROOF** — `permission denied` on UPDATE/DELETE                     |
| Dev OTP inbox is absent from production                                | live check at M-IP2-4: `next start` → `/dev/inbox` 404, `/login` 200       |
| Open-redirect-free returns; security headers on every response         | code `safeNext()`; headers curl-verified (HSTS, DENY, nosniff)             |

## 4 · Known assumptions (challenge these)

1. **CSRF** rides Next server actions' built-in Origin/Host check + SameSite=Lax —
   we add no token of our own.
2. **`x-forwarded-for`** is meaningful only behind the platform proxy; the IP cap is
   hardening, not a boundary.
3. **Production DB roles** will be provisioned exactly per RUNBOOKS R-1
   (NOBYPASSRLS; `audit_log` SELECT+INSERT only). The proofs assume the recipe.
4. **simplewebauthn v13** is trusted for all WebAuthn cryptography; we never
   hand-roll verification.
5. **Local-first:** no production environment exists yet (IP-0 founder tail); no
   remote CI has run. Every gate is locally executed and re-runnable (§8).

## 5 · Residual risks & open observations (our own list — verify we missed nothing)

- **RLS is proven but not yet load-bearing in the serving path:** app queries don't
  run through `withTenant()`; local superuser is RLS-exempt; under the production
  role, org pages fail **closed** (empty). Named pre-deploy work item.
- **`DevInboxSender` is the only OTP sender until RC-1** — production login is
  undeliverable by design until the provider swap; codes would sit unread (and
  plaintext) in `otp_inbox` if production booted early. R-1 denies the table to prod
  roles; R-3 governs the swap. Consider whether the sender itself should refuse
  `NODE_ENV=production` (we chose not to change login-path behavior in a freeze
  milestone — your call to make it a condition).
- No CSP yet (IP-3 per IP-0 decision) · no purge jobs (R-6 manual) · no account
  deletion path (DPDP §4, pre-GA) · timing-envelope equality asserted structurally,
  not measured · UV `preferred` not `required` · passkey counter anomalies not
  alarmed · no rate limit on org/invite creation · sliding 30-day sessions ·
  `listSecurityEvents` filters on `scope_id` alone (safe today via ULID uniqueness;
  a `scope_type='person'` refinement would be strictly tighter) · audit rows written
  non-transactionally after mutations.
- SIM recycling / SIM swap are inherent to phone-first identity; passkeys are the
  structural mitigation.

## 6 · What we ask of you

**Verdict:** APPROVE · APPROVE WITH CONDITIONS · REJECT — recorded verbatim in
GATES.md; conditions become the freeze blockers. Three questions we most want
answered:

1. Is the OTP + session design sound for an open-signup, phone-first system at
   Indian SMS-abuse economics (§4.2, §5)?
2. Do the RLS policies + the R-1 recipe + the two SQL-layer proofs constitute real
   defense-in-depth, given the recorded `withTenant()` gap?
3. Is the `session → tenant → capability → audit` action pattern hard enough to
   misuse as future engineers add capabilities (THREAT_MODEL §7)?

## 7 · Scope boundary

In scope: everything in §2 row 4 + migrations + env validation (`apps/web/src/env.ts`).
Out of scope: FLOODLIGHT UI internals (IP-1, frozen), the engine spike (drops at
IP-0 freeze), visual design, payment/notification code (none exists).

## 8 · Reproduce every gate (from repo root)

```bash
docker compose up -d db                      # PG17 on :5433
pnpm install
pnpm --filter @desiauction/db db:migrate     # idempotent baseline
pnpm verify                                  # lint + typecheck + unit + format + boundaries
pnpm test:integration                        # 27 tests vs real PG incl. RLS + AUDIT proofs
cd apps/web && npx playwright test           # 37 e2e in real Chrome (virtual authenticator, axe)
pnpm build                                   # production build; then: next start → /dev/inbox is 404
```
