# IDENTITY · AUTHENTICATION ARCHITECTURE

## DesiAuction NEXT · v1.0 · 2026-07-14 · CTO · Permanent subsystem document (IP-2)

> Documents the **implemented** system, frozen at IP-2. Source of truth:
> `apps/web/src/server/auth/{otp,otp-sender,actions}.ts`, `packages/core/src/phone.ts`.
> Governed by C-24 (phone-first, India-first), IP-2_DESIGN D3/D7, ED-1 (ports), RC-1
> (real OTP provider = founder procurement). Companion docs: [SESSIONS.md](SESSIONS.md),
> [PASSKEYS.md](PASSKEYS.md), [THREAT_MODEL.md](THREAT_MODEL.md).

## 1 · Model

Authentication is **phone-first OTP with no passwords — ever** (C-24). A person _is_ a
verified Indian mobile number; the first successful OTP verification creates the
`people` row (open signup — request and verify behave identically whether or not the
person exists). Passkeys ([PASSKEYS.md](PASSKEYS.md)) are the structural OTP-cost
reducer after first login. All entry points are Next server actions (internal RPC,
C-14/D7) — no public auth REST exists.

## 2 · Phone normalization (`packages/core/src/phone.ts`)

One canonical shape enters the system: **E.164 `+91XXXXXXXXXX`**. `normalizePhone()`
strips separators, accepts `+91…` / `91…` (12 digits) / `0…` (11 digits) / bare
10-digit forms, and requires `[6-9]\d{9}` (plausible Indian mobile). Everything else is
refused before any DB or sender work.

## 3 · OTP request path (`requestOtp`)

```
normalize → cooldown check → per-phone hourly cap → per-IP hourly cap
        → mint code → store hash → sender.send(phone, code)
```

| Parameter          | Value                            | Notes                                                            |
| ------------------ | -------------------------------- | ---------------------------------------------------------------- |
| Code               | 6 digits, `randomInt(0, 10^6)`   | CSPRNG, uniform, zero-padded                                     |
| Storage            | SHA-256 hex only (`code_hash`)   | plaintext code never touches `otp_codes`                         |
| TTL                | 5 minutes                        | checked at verify                                                |
| Resend cooldown    | 30 s                             | only while an **unconsumed** code is pending — a consumed code never blocks a second-device sign-in |
| Per-phone cap      | 5 codes / rolling hour           | counts all codes created in the window                           |
| Per-IP cap         | 20 codes / rolling hour          | IP from `x-forwarded-for` (first hop) / `x-real-ip`; loopback → no IP context; IPs age out with the codes |
| Verify attempts    | ≤ 5 per code                     | 5th failure kills the code even for the right value              |

Failure reasons returned to the caller: `invalid-phone`, `cooldown`, `hourly-limit` —
all relate to the requester's **own** phone; since signup is open, the request path has
no account-existence oracle.

## 4 · OTP verify path (`verifyOtp`)

The candidate is the **latest unconsumed** code for the phone. Missing, expired, or
attempt-exhausted candidates and wrong codes all return the single generic
`{ ok: false, reason: "invalid" }` — unknown phones and known phones are
**indistinguishable by response** (no-enumeration, IP-2 §6; asserted by test). A wrong
code increments `attempts`; the 5th failure additionally writes an
`auth.otp.lockout` security event when the person exists. A correct code is consumed
atomically (`consumed_at`) — replay is dead forever. First successful verification
inserts the `people` row (phone-first signup); the caller then mints a session
([SESSIONS.md](SESSIONS.md)) — a **new token every login** (fixation defense).

## 5 · Delivery — the `OtpSender` port (ED-1, D3)

`OtpSender.send(phone, code)` is the single delivery seam. The sole implementation
today is **`DevInboxSender`**: codes land in the `otp_inbox` table, rendered at
`/dev/inbox` (`NODE_ENV === "development"` only; the route 404s on production servers —
proven live at M-IP2-4). RC-1's real SMS provider becomes a second implementation
swapped in at the single construction point (`auth/actions.ts`); auth logic never
changes. **Until RC-1 lands, production has no deliverable OTP channel** — recorded
residual, see [THREAT_MODEL.md](THREAT_MODEL.md) §2 and RUNBOOKS R-3.

## 6 · Form flow (`actions.ts`)

`requestOtpAction` / `verifyOtpAction` drive the two-step login form
(`/login`, FLOODLIGHT). Humane error copy maps the three request-failure reasons; the
verify path shows one generic message. `?next=` return targets pass through
`safeNext()` — **relative paths only** (`/…`, never `//…`): open-redirect-free by
construction. CSRF: server actions are origin-checked POSTs (Next platform behavior)
plus `SameSite=Lax` cookies.

## 7 · Security events

Auth writes to the append-only audit substrate (person scope):
`auth.login.otp` · `auth.otp.lockout` · `auth.login.passkey` ·
`auth.passkey.enrolled/renamed/removed` · `auth.session.revoked`. The account page
surfaces the last 10 to the person — self-service compromise visibility.

## 8 · Protecting tests

Integration `auth.integration.test.ts` (7): full journey, consumed-code replay,
cooldown, attempt lockout, no-enumeration equality, session revoke, garbage token.
Security regression `security.regression.test.ts` (7): replay, enumeration, lockout +
event, rotation, person isolation, passkey fail-closed ×2. E2E `login.spec.ts` (5):
real-browser journey, wrong code, gated `/account`, invalid phone, axe + keyboard.
These suites are permanent assets — weakening them requires an RC-4-grade review.
