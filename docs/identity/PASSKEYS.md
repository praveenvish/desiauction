# IDENTITY · PASSKEY ARCHITECTURE

## DesiAuction NEXT · v1.0 · 2026-07-14 · CTO · Permanent subsystem document (IP-2)

> Documents the **implemented** system, frozen at IP-2. Source of truth:
> `apps/web/src/server/auth/passkeys.ts` + ceremony glue in `auth/actions.ts` +
> `@simplewebauthn/{server,browser}` v13. Governed by IP-2_DESIGN D4: every passkey
> login is a **free** login (ED-1 OTP-cost synergy) and phishing-resistant (C-24
> posture).

## 1 · Relying party

| Item       | Value                                                                       |
| ---------- | --------------------------------------------------------------------------- |
| RP name    | `DesiAuction`                                                                |
| `RP_ID`    | env, validated fail-closed; default `localhost` (dev/e2e). Must suffix-match the browser host — deployed environments set the real apex (RUNBOOKS R-7) |
| `RP_ORIGINS` | env, comma-separated full origins; default `http://localhost:3000,http://localhost:3050` |

## 2 · Challenge transport

Both ceremonies split into start/finish server actions. The challenge travels between
halves in **`da_pk_challenge`**: httpOnly · Secure (production) · SameSite=Lax ·
maxAge 300 s · **single-use** (`takeChallenge()` reads and deletes atomically). A
missing or already-consumed challenge fails the ceremony closed. Signature
verification against challenge + origin + rpID is simplewebauthn's, never ours.

## 3 · Enrollment (session required)

`startEnrollment` → `generateRegistrationOptions` with `attestationType: "none"`,
`residentKey: "preferred"`, `userVerification: "preferred"`, and `excludeCredentials`
= the person's existing credentials (no double-enrolling one authenticator).
`finishEnrollment` verifies, then stores: `credential_id` (unique), `public_key`
(base64url), signature `counter`, `transports`, and a human device **name** (trimmed,
≤ 60 chars, default "Passkey" — C-25 spirit: "Praveen's iPhone" beats a hash). Event:
`auth.passkey.enrolled`.

## 4 · Authentication (username-less)

`startAuthentication` issues options with **no credential allow-list** — discoverable
credentials let the authenticator pick the identity (one tap, no phone typed).
`finishAuthentication` looks up the credential by `response.id` — unknown credentials
fail closed before any cryptography — verifies the assertion, **updates the signature
counter** and `last_used_at`, logs `auth.login.passkey`, and mints a fresh session
([SESSIONS.md](SESSIONS.md) — rotation applies to passkey logins too).

## 5 · Management (`/account`)

Rename and remove are person-scoped at the SQL layer (`WHERE person_id = caller`) —
acting on another person's credential is structurally a no-op. Removal is a hard
delete of the credential row. Both write audit events. The panel shows name, created,
last used.

## 6 · Boundary facts (deliberate, recorded)

- `userVerification: "preferred"` (not `required`): possession-factor logins from
  authenticators without UV are accepted. Standard consumer posture; revisit if a
  future capability demands UV-required step-up.
- Counter regression (cloned-authenticator signal) is delegated to simplewebauthn's
  verification; we persist the new counter but take no additional action on anomaly —
  recorded residual ([THREAT_MODEL.md](THREAT_MODEL.md) §2).
- Passkeys never bypass authorization: a passkey login yields a session; every
  capability check still applies ([AUTHORIZATION.md](AUTHORIZATION.md)).

## 7 · Protecting tests

E2E `passkeys.spec.ts` with a **CDP virtual authenticator** (ctap2 / internal /
resident-key / UV): the founder journey — OTP in, enroll "Founder MacBook", sign out,
**passkey-only sign-in**, audit events asserted. Security regression: unknown
credential fails closed; forged enrollment challenge rejects. The WebAuthn ceremonies
themselves are covered end-to-end in a real browser, not simulated at unit level.
