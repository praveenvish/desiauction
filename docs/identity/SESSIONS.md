# IDENTITY · SESSION LIFECYCLE

## DesiAuction NEXT · v1.0 · 2026-07-14 · CTO · Permanent subsystem document (IP-2)

> Documents the **implemented** system, frozen at IP-2. Source of truth:
> `apps/web/src/server/auth/sessions.ts` + the cookie/action glue in
> `auth/actions.ts`. Governed by IP-2_DESIGN D2 (DB-backed opaque tokens — no JWTs
> for first-party surfaces; revocation and auditability beat statelessness, C-2).
> The engine consumes this same store at IP-4 (VA-6 input).

## 1 · Token contract

| Property     | Value                                                                   |
| ------------ | ----------------------------------------------------------------------- |
| Token        | 32 random bytes (`crypto.randomBytes`), base64url — opaque, no claims    |
| Storage      | SHA-256 hex only (`sessions.token_hash`, unique) — a DB read never yields a usable token |
| Cookie       | `da_session` · httpOnly · Secure (production) · SameSite=Lax · path=/ · expires = session expiry |
| TTL          | 30 days                                                                  |
| Slide        | on lookup, if `last_seen_at` > 24 h old → `last_seen_at = now`, `expires_at = now + 30 d` (one write per day per session, not per request) |
| Rotation     | **every** login (OTP or passkey) mints a brand-new session — fixation defense; old sessions remain independently revocable |
| Metadata     | `person_id`, `user_agent`, `created_at`, `last_seen_at`, `revoked_at`    |

## 2 · Lifecycle

```
login (OTP §4 / passkey ceremony) ──► createSession ──► Set-Cookie da_session
        │
        ▼
getSessionByToken: hash match ∧ revoked_at IS NULL ∧ expires_at > now
        │  (join people → SessionInfo{sessionId, personId, phone, name})
        ▼
active use (slide ≤ 1×/24 h) ──► revocation, any of:
   · self-service: account page "Revoke" (ownership-checked against the caller's own list)
   · logout: server-side revoke of the presented token + cookie delete
   · operator: SQL runbook R-4 (RUNBOOKS.md)
        ▼
revoked/expired rows are RETAINED (auditability; no purge job exists — DPDP §4)
```

`currentSession()` is the single session gate every server action calls; a null result
redirects to `/login`. Garbage, revoked, and expired tokens are indistinguishable
(null). Revocation is **immediate** — the next lookup fails; there is no cached
session state anywhere.

## 3 · The account security surface (M-IP2-2)

`/account` lists every active session (device = `user_agent`, created, last seen,
current-session marker), with per-session revoke; each revoke writes
`auth.session.revoked` to the audit substrate. Listing and revoking are scoped to the
authenticated person — cross-account access is structurally absent (ownership check +
regression test).

## 4 · Boundary facts (deliberate, recorded)

- **Sessions are pre-identity infrastructure.** Token lookup happens _before_ a person
  context exists, so `sessions` (like `people`, `otp_codes`, `passkey_credentials`)
  carries **no RLS policy** — app-layer scoping is the lock, proven by the person-
  isolation regression test. Org-scoped tables carry the RLS second lock
  ([AUTHORIZATION.md](AUTHORIZATION.md) §5). Deviation from IP-2_DESIGN §4 recorded at
  closure.
- No JWTs, no refresh tokens, no client-readable session state. The cookie is the only
  artifact, and the server can kill it at any moment.

## 5 · Protecting tests

Security regression: _session rotation — distinct tokens, independently revocable_ ·
_person isolation — listings never cross accounts_. Integration: _create → fetch →
revoke → gone_ · _garbage tokens never resolve_. E2E `passkeys.spec.ts`: _second device
shows up and can be revoked_ (real browsers, two contexts, audit event asserted); E2E
`login.spec.ts`: logout journey + `/account` gate.
