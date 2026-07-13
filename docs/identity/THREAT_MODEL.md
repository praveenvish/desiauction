# IDENTITY THREAT MODEL

## DesiAuction NEXT · v1.0 · 2026-07-14 · CTO · **Permanent engineering asset** (IP-2, M-IP2-4)

> The seven-stage trust chain every request crosses. For each stage: trust boundary,
> assets, threats, attack vectors, mitigations **as implemented**, the regression
> tests protecting it, and residual risks. Changes to any mitigation here require an
> RC-4-grade review; the named tests are the tripwires. Companions:
> [AUTHENTICATION.md](AUTHENTICATION.md) · [SESSIONS.md](SESSIONS.md) ·
> [PASSKEYS.md](PASSKEYS.md) · [AUTHORIZATION.md](AUTHORIZATION.md) ·
> [RUNBOOKS.md](RUNBOOKS.md).

```
Identity → Authentication → Session → Authorization → Tenant Resolution → RLS → Business Capability
```

Test-suite shorthand: **SEC** = `auth/security.regression.test.ts` (8) ·
**AUTHZ** = `orgs/authz.regression.test.ts` (12) · **INT** =
`auth/auth.integration.test.ts` (7) · **CORE** = `core/capabilities.test.ts` (8) ·
**E2E** = `e2e/{login,passkeys,orgs}.spec.ts` (real Chrome).

---

## 1 · Identity

**Trust boundary:** the outside world → a `people` row. A person _is_ a verified
Indian mobile (C-24); creation happens only through OTP verification.
**Assets:** `people` (phone, name, future photo-consent), the phone-as-anchor
invariant, account-existence information.
**Threats:** fake/foreign identities at scale, account-existence disclosure
(enumeration), identity squatting on recycled numbers.
**Attack vectors:** bulk signup via scripted OTP requests; probing request/verify
responses to map registered numbers; malformed phone shapes.
**Mitigations:** `normalizePhone` admits only plausible Indian mobiles in one
canonical E.164 shape; signup is open so request/verify behave identically for known
and unknown phones (no oracle); per-phone (5/h) + per-IP (20/h) request caps price out
bulk creation; ULID ids are non-sequential (no id-walking).
**Regression tests:** SEC _enumeration resistance_; INT _no-enumeration_; E2E _invalid
phone refused before any code is sent_.
**Residual risks:** SIM recycling — a re-issued mobile number inherits the account
(no dormancy policy yet; revisit pre-GA). Response **timing** equality is asserted
only via identical code paths, not measured. No CAPTCHA/proof-of-work if an attacker
rotates IPs faster than 20/h — bounded by SMS cost once RC-1 lands.

## 2 · Authentication

**Trust boundary:** an unauthenticated HTTP request → a verified `personId`.
**Assets:** OTP codes (`code_hash`), the OTP delivery channel, passkey credentials
(public keys, counters), the login server actions.
**Threats:** code brute force, code replay, code interception, credential stuffing
(N/A — no passwords), phishing, forged WebAuthn ceremonies, SMS-pumping cost abuse.
**Attack vectors:** hammering `verifyOtp`; replaying a consumed code; requesting codes
for victims' phones (harassment/cost); forged challenges or unknown credential ids in
passkey finish actions; man-in-the-middle on the ceremony origin.
**Mitigations:** codes are 6-digit CSPRNG, SHA-256-stored, 5-min TTL, ≤ 5 verify
attempts enforced by an **atomic guarded increment** (`UPDATE … WHERE attempts < 5` —
concurrent wrong guesses serialize on the row lock and cannot exceed the cap; RC-4
Finding 3), 5th kills the code even for the right value (logging `auth.otp.lockout`),
consumed atomically (replay dead); resend cooldown 30 s + hourly caps; one generic
failure response; passkeys verify challenge + origin + rpID via simplewebauthn with
the challenge in a single-use 300 s httpOnly cookie; unknown credentials fail closed
before any cryptography; passkey logins are phishing-resistant by construction
(origin binding); all entry points are origin-checked server actions (CSRF).
**Regression tests:** SEC _OTP replay_, _lockout + security event_, _**attempt cap
holds under concurrency** (12 parallel wrong guesses ceiling at 5)_, _passkey fails
closed (unknown credential)_, _enrollment rejects forged challenge_; INT _consumed
code cannot be replayed_, _cooldown_, _attempts lockout survives right code_; E2E
_full OTP journey_, _wrong code rejected_, _passkey-only sign-in via CDP virtual
authenticator_.
**Residual risks:** **Until RC-1, `DevInboxSender` is the only sender** — a
hypothetical production boot would write plaintext codes to `otp_inbox` with no
reader (login undeliverable; codes inert but present in the DB). Recorded; R-1 grants
production roles nothing on `otp_inbox`, R-3 governs the swap. SMS-channel risks
(SIM swap, SS7) are inherent to phone-first identity — passkeys are the mitigation
path. UV "preferred" accepts possession-only passkey logins. Signature-counter
anomalies are verified but not alarmed on.

## 3 · Session

**Trust boundary:** a bearer cookie → an authenticated request context.
**Assets:** session tokens (cookie side), `sessions` rows (hash side), the
`da_session` cookie itself.
**Threats:** token theft (XSS, network, device), session fixation, session
prediction/forgery, zombie sessions after revocation, cross-account session access.
**Attack vectors:** script access to cookies; downgrade/plain-HTTP interception;
reusing a pre-login token; brute-forcing token space; using a revoked/expired token;
listing or revoking another person's sessions.
**Mitigations:** 32-byte CSPRNG opaque tokens (no claims to forge); DB stores SHA-256
only — a DB leak yields no usable tokens; cookie httpOnly + Secure (production) +
SameSite=Lax; **new session minted at every login** (fixation); lookup requires
unrevoked ∧ unexpired; revocation is immediate (no cached session state anywhere);
logout revokes server-side and clears the cookie; session listing/revocation is
ownership-checked; HSTS + nosniff + DENY frame headers served on every response
(verified live at M-IP2-4).
**Regression tests:** SEC _session rotation (distinct tokens, independently
revocable)_, _person isolation (listings never cross accounts)_; INT _create → fetch →
revoke → gone_, _garbage tokens never resolve_; E2E _second device revoked from the
account page (audit event asserted)_, _`/account` gated to `/login`_.
**Residual risks:** 30-day sliding lifetime is deliberately long for auction-night
ergonomics — compromise window is bounded by self-service visibility (last-10 events
panel) + instant revocation, not by short expiry. No device-binding/IP-pinning. No
CSP yet (arrives with IP-3 per the IP-0 header decision) — XSS remains mitigated by
React escaping + httpOnly, not by policy.

## 4 · Authorization

**Trust boundary:** an authenticated `personId` → permission to act on a scope.
**Assets:** `grants` rows, the capability evaluation engine (`core/capabilities.ts`),
`requireCapability` enforcement, the invite machinery that mints grants.
**Threats:** privilege escalation (set-name forgery, unknown sets, revoked-grant
reuse), confused-deputy server actions, invite abuse (replay, forgery, escalation).
**Attack vectors:** calling `issueGrantAction`/`createInviteAction` without the
capability; crafting invites with invented capability sets; replaying a consumed
invite link; acting on org B with org A's grant; acting after revocation.
**Mitigations:** pure fail-closed evaluation — unknown sets expand to ∅, revoked
grants confer nothing, scope must match exactly (type + id); enforcement is
per-capability at every mutating action, `ForbiddenError` on failure; capability sets
validated at invite **creation** (nothing mints an unexpandable grant); invite tokens
24-byte CSPRNG, SHA-256-stored, 7-day TTL, revocable, **atomic one-time claim**;
grant issue/revoke require `grant.issue`/`grant.revoke` and write audit rows with
actor + subject + set; revocation is effective at the next check (no permission
caching).
**Regression tests:** CORE all 8 (expansion, fail-closed, revocation, exact-scope,
empty); AUTHZ _cross-tenant Forbidden_, _staff cannot escalate_, _unknown set refused
at creation_, _revocation immediate_, _invite lifecycle: accept once, replay fails_,
_expired/revoked invites rejected_; E2E _staff sees no invite/grant controls; owner
revokes staff set live_.
**Residual risks:** grant issuance targets a raw `personId` without verifying org
membership — a grant to a non-member is inert until they join but visible in
`membersOf` only if membership exists (cosmetic, not a leak). No rate limit on invite
creation or org creation (spam surface, not an escalation). `viewer` set is
deliberately empty — read access rides membership, not capabilities, in IP-2.

## 5 · Tenant Resolution

**Trust boundary:** a URL slug in an authenticated request → an org context the
caller may see.
**Assets:** the slug → org mapping, org existence information, the resolved `orgId`
every downstream check keys on.
**Threats:** cross-tenant probing (mapping which orgs exist), operating on an org via
a stale/forged slug, tenant confusion between resolution and action.
**Attack vectors:** guessing slugs (`/org/<slug>`); hitting another org's URL with a
valid session; invoking org actions with a slug the caller doesn't belong to.
**Mitigations:** `resolveTenant` requires **membership in the same joined query** —
non-members and nonexistent orgs both yield `null` → 404 (existence never disclosed;
never 403); every org server action resolves the tenant fresh from the slug before
any capability check (no client-supplied orgId is ever trusted); slugs carry a ULID
suffix (not guessable from names).
**Regression tests:** AUTHZ _non-members and unknown slugs indistinguishable_; E2E
_the house journey: A cannot reach B's org — 404, not 403_.
**Residual risks:** slug enumeration is rate-unlimited (404 either way; discloses
nothing). Membership without any grant still resolves the tenant (member sees the
members panel — by design: membership = belonging).

## 6 · Row-Level Security

**Trust boundary:** application code → the database. The last line: even buggy or
compromised app code must not read another tenant's rows.
**Assets:** org-scoped rows (`org_members`, `invites`, `grants`, `audit_log`), the
policies of migration `0003`, the append-only property of `audit_log`.
**Threats:** app-layer scoping bug leaking cross-tenant rows; SQL injection reaching
raw table access; audit-trail tampering; policy bypass via connection-role privilege.
**Attack vectors:** a future query missing its `WHERE org_id`; injected SQL (drizzle
is parameterized throughout — no string SQL in product code); UPDATE/DELETE on
`audit_log`; connecting with a role that has BYPASSRLS.
**Mitigations:** `ENABLE` + **`FORCE`** RLS on all four tables; **read** policies
(`USING`) keyed to `current_setting(..., true)` → NULL when unset → **fail closed,
zero rows**; **write** policies (`WITH CHECK`, migration 0004) constrain every INSERT/
UPDATE to the active tenant with **no self-row escape** — closing the RC-4 finding
that `USING`-only policies let a caller self-grant `org:owner` on any org;
`withTenant()` primitive for per-request `SET LOCAL` context; production role recipe
is `NOSUPERUSER NOBYPASSRLS` with `audit_log` at SELECT + INSERT only (R-1) — audit
immutability is enforced by grants, not convention.
**Regression tests:** AUTHZ **RLS PROOF** — a dedicated non-superuser probe role sees
org X's rows with X's context, **zero rows** cross-tenant, **zero rows** with no
context; AUTHZ **RLS WRITE PROOF** — the same role's self-escalating grant on a
foreign org is rejected by `WITH CHECK`, a grant on the active org succeeds; AUTHZ
**AUDIT PROOF** — the production grant recipe gets `permission denied` on UPDATE and
DELETE of `audit_log` at the SQL layer.
**Residual risks (recorded, pre-deploy):** the app does not yet route queries through
`withTenant()` — locally the superuser connection is RLS-exempt, so the second lock
is **proven under the production role in tests but not yet load-bearing in the serving
path**; under the production role, org pages would fail closed (empty/rejected, not
leaky) until wired, and the two pre-tenant read patterns (invite-by-token,
org-preview-before-membership) need reconciling at that time. Named work item for
first deploy (closure report §6). Person-scoped tables carry no policies by design
(pre-identity — [SESSIONS.md](SESSIONS.md) §4); `organizations` is intentionally
readable (org name is exposed to non-members via invite links by design —
[AUTHORIZATION.md](AUTHORIZATION.md) §5), with app-layer 404 delivering
non-disclosure and a membership-gated policy recorded as a pre-deploy option.
`audit_log` has no hash chain (0A ruling; post-GA).

## 7 · Business Capability

**Trust boundary:** a permitted request → an actual state change in the product.
The stage future phases (Competition, Auction Engine, Money, Operations) build on.
**Assets:** the integrity of every audited mutation; the invariant that **no state
change bypasses the chain above**; the audit trail as evidence.
**Threats:** new code paths that skip `requireCapability`; mutations without audit
rows; ambient authority creeping in ("is admin?" checks); the engine (IP-4+) trusting
identities it didn't verify.
**Attack vectors:** future server actions or engine RPCs that query `db` directly
without the chain; capability checks against client-supplied scope ids; audit writes
made optional.
**Mitigations:** one enforced shape — `requireSession → resolveTenant →
requireCapability → act → audit` — with no alternative path in the codebase today;
capability strings are a closed union type (adding one is a reviewed schema change);
mutations and their audit writes live in the same module functions; the engine will
validate the **same session store** at IP-4 (VA-6) rather than minting its own trust.
**Regression tests:** the entire AUTHZ suite exercises the full chain end-to-end
against real Postgres; E2E journeys assert audit events appear in the UI after each
sensitive action (enroll, login, revoke, invite, grant).
**Residual risks:** the chain is convention enforced by review + tests, not by types —
a future `"use server"` function _could_ skip it; the RC-4 reviewer is asked to
confirm the pattern is hard to misuse (review package Q3). Audit rows are written
after the mutation, non-transactionally — a crash between mutation and audit write
loses the audit row (no money path exists yet; revisit with IP-6 idempotency work).

---

## Cross-cutting assumptions

1. **Platform origin checks:** Next server actions enforce Origin/Host matching on
   POSTs — CSRF defense rides the framework plus SameSite=Lax.
2. **`x-forwarded-for` is trustworthy only behind the deployment platform's proxy**
   (Vercel sets it); the IP rate limit is advisory hardening, not a security boundary.
3. **Production DB roles follow R-1** (NOBYPASSRLS, audit append-only) — the proofs
   assume the recipe is applied verbatim.
4. **Local-first program:** no remote CI has run (no git remote yet — IP-0 founder
   tail); every gate in this document was executed locally and is re-runnable with
   the commands in the RC-4 package §8.
