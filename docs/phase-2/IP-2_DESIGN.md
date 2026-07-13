# IP-2 — IDENTITY & TENANCY · DETAILED DESIGN
## DesiAuction NEXT · v1.0 · 2026-07-13 · CTO · Active phase artifact

> Governed by Blueprint v1.1 §IP-2, Canon C-8/C-13/C-14/C-24/C-25, ED-1 (ports), FR-01 (local-first), M0 conditions RC-1 (OTP provider = founder procurement; engineering uses the dev adapter) and RC-4 (independent auth review — the phase's one founder input: name the reviewer). Consumes `ui@0.1.0` frozen; IP-1 untouchable except genuine defects. Detailed design exists for IP-2 only.

## 1 · Executive summary

IP-2 answers "who is anyone, and what may they do" before any domain data exists. Production architecture, local adapters: phone-first OTP through an `OtpSender` port whose dev implementation is an inbox page (RC-1's real provider slots in later without touching auth logic); passkeys as the structural OTP-cost reducer (WebAuthn works fully on localhost); DB-backed revocable sessions; organizations with `org_id` on every tenant row and **RLS enforced as a tested fact, not a checkbox**; and the C-8 grants model — person × scope × capability set, enforced per-capability. Everything renders in frozen FLOODLIGHT. The phase freezes only after the RC-4 independent review.

## 2 · Scope

**In:** `packages/db` (new workspace: Drizzle schema + migrations + client factory, shared by web and engine); people, organizations, sessions, OTP, passkey credentials, grants, audit-log schema; login/logout (phone → OTP → session), passkey enroll + login, session management UI; org creation, member invite via shareable link (RC-3 pattern — the platform sends nothing), grant issuance/revocation; capability model in `core` (pure) + enforcement middleware in web; RLS policies + cross-tenant proof tests; rate limits, no-enumeration; audit substrate (append-only); DPDP data map incl. photo-consent design (fields + consent points; capture UX ships with IP-3 registration); dev inbox page (development-only).
**Out (recorded):** real SMS delivery (RC-1 adapter swap, pre-IP-5), engine WS auth (VA-6 ADR at IP-4 — sessions here are its input), team *entities* (IP-3; the grant machinery supports `team` scope now), password auth (never — phone-first C-24), MFA-beyond-passkey (post-GA), email channel (procured pre-IP-6).

## 3 · Architecture decisions (8-question self-challenged)

- **D1 · `packages/db` is added to the monorepo.** Schema is neither pure domain (`core`) nor wire shape (`contracts`); web and engine both need it; duplication would drift. Repository organization is CTO-delegated; dep rules extend: `db → {drizzle-orm, postgres} only`; `web|engine → db` allowed; nothing else touches it. Engine's existing `drizzle/` (spike-only) stays put until the spike drop at IP-0 freeze; real schema lives in `packages/db` from day one.
- **D2 · Sessions are DB-backed opaque tokens** (httpOnly + Secure + SameSite=Lax cookie; SHA-256 of token stored; 30-day sliding expiry; revocable individually). No JWTs for first-party surfaces: revocation and auditability beat statelessness at our scale (C-2 trust > convenience). The engine will validate the same session store at IP-4 (VA-6 input).
- **D3 · OTP behind the `OtpSender` port** (ED-1): `send(phone, code)` — `DevInboxSender` writes to an `otp_inbox` table rendered at `/dev/inbox` (NODE_ENV=development only, excluded from production builds). Codes: 6 digits, SHA-256 stored, 5-minute expiry, ≤5 verify attempts, resend throttle 30s / 5·hour·phone, per-IP limiter; **no-enumeration: identical response and timing envelope whether or not the phone exists**.
- **D4 · Passkeys via `@simplewebauthn`** (server + browser): enroll after first OTP login; discoverable-credential login thereafter. Every passkey login is a free login (ED-1 cost synergy) and phishing-resistant (C-24 posture).
- **D5 · Tenancy: `org_id` column + Postgres RLS as defense-in-depth** (C-13). App connects as a non-BYPASSRLS role; per-request `SET LOCAL app.person_id / app.org_id` inside a transaction; policies `USING (org_id = current_setting('app.org_id'))`. The app layer scopes queries anyway — RLS is the second lock, and it gets its own proof tests (attempted cross-tenant reads must return zero rows *at the SQL layer*).
- **D6 · Grants, not roles (C-8):** `grants(person_id, scope_type ∈ {org, tournament, team}, scope_id, capability_set, granted_by, revoked_at)`. Named capability sets live in `core` (pure, tested): `org:owner`, `org:staff`, `team:owner`, `viewer` → capability strings (`org.manage`, `tournament.create`, `player.verify`, `grant.issue`, …). **Enforcement is per-capability** — `requireCapability(session, scope, cap)` — sets are ergonomics only. The authz test matrix covers every capability × granted/not-granted/revoked.
- **D7 · Mutations are Next server actions** (internal RPC per C-14) with origin-checked POSTs; idempotency keys arrive with money-adjacent endpoints (IP-6). Public REST stays deferred (0A ruling).
- **D8 · Audit substrate:** append-only `audit_log(actor, action, scope_type, scope_id, subject, at, meta)`; writers cannot update/delete (no UPDATE/DELETE grants to the app role). Hash-chain remains cut per 0A; external anchoring is a post-GA decision.
- **D9 · Invites are shareable links** (RC-3): org invite = signed single-use token in URL; organizer forwards it via their own WhatsApp. Accepting = OTP login + grant issuance, audited.

## 4 · Schema (packages/db, migration 0001_identity)

`people(id ulid pk, phone text unique, name, photo_consent_at timestamptz null, photo_consent_via text null, created_at)` — phone is the identity anchor (C-24); photo-consent fields designed now (C-25 × DPDP, R-9), captured at IP-3 registration.
`organizations(id, name, slug unique, created_by, created_at)`
`org_members(org_id, person_id, joined_at, pk(org_id, person_id))` — membership ≠ permission; grants carry permission.
`sessions(id, person_id, token_hash unique, created_at, last_seen_at, expires_at, revoked_at, user_agent)`
`otp_codes(id, phone, code_hash, expires_at, attempts int, consumed_at, created_at)` + `otp_inbox(dev only: phone, code, created_at)`
`passkey_credentials(id, person_id, credential_id unique, public_key, counter, transports, created_at, last_used_at)`
`grants(id, person_id, scope_type, scope_id, capability_set, granted_by, created_at, revoked_at)`
`invites(id, org_id, capability_set, token_hash unique, created_by, expires_at, accepted_by, accepted_at)`
`audit_log(id, actor, action, scope_type, scope_id, subject, meta jsonb, at)`
RLS: enabled on every org-scoped table (`org_members`, `grants` org-scope, `invites`, `audit_log` org rows); `people/sessions/otp/passkeys` are person-scoped (policies on `app.person_id`).

## 5 · Verification strategy

Unit (`core`): capability model — set expansion, `hasCapability`, revocation semantics. Integration (`web` against real PG): full login flow (request → inbox → verify → session cookie), OTP limits (attempts/resend/expiry), no-enumeration (response equality), session revocation, passkey ceremony (simulated authenticator via @simplewebauthn test helpers), **authz matrix** (every capability × {granted, not granted, revoked} × {right scope, wrong scope}), **RLS proofs** (raw SQL as app role with foreign `app.org_id` → zero rows). E2E (real Chrome): login journey on the FLOODLIGHT screens, passkey enroll/login via CDP virtual authenticator, invite-link acceptance, session list + revoke, axe on all new pages, 360px, keyboard-only login.

## 6 · Security posture (this phase's heart)

Cookie flags (httpOnly/Secure/SameSite) · token + code storage hashed only · rate limits at phone and IP · no-enumeration verified by test · CSRF: server actions origin-checked + SameSite · session fixation: token rotated at login · open-redirect-free returns · headers already shipped (IP-0) · dev inbox structurally absent from production builds (env-gated route + build assertion). **RC-4 independent review of exactly this surface is the phase freeze gate** — review package = this doc §3/§4/§6 + the test evidence + a guided read of `apps/web/src/server/auth/`.

## 7 · Definition of Done

All §5 suites green incl. authz matrix + RLS proofs · login/passkey/invite/session journeys e2e-green in FLOODLIGHT with axe zero · guardrails still green (token purity, boundaries incl. new db rules) · DPDP data map section committed · dev-inbox exclusion proven · founder demo (phone login + passkey + two-org isolation) · **independent review (RC-4) verdict recorded** · GATES entry · tag `ip2-frozen`.

## 8 · Milestones (three-output closure package each)

| ID | Name | Scope | Complexity |
|---|---|---|---|
| M-IP2-1 | The Door | `packages/db` + schema + migrations + RLS bootstrap + phone→OTP→session login/logout + dev inbox, in FLOODLIGHT | **M · High** |
| M-IP2-2 | Keys | Passkey enroll + login (virtual-authenticator e2e), session management UI, rate-limit + no-enumeration hardening | **M · High** |
| M-IP2-3 | The House | Orgs + grants + capability middleware + invite links + audit substrate; authz matrix + RLS proofs | **M · High** |
| M-IP2-4 | Papers in Order | DPDP data map + photo-consent design + security sweep + RC-4 review package; DoD sweep → freeze (pending review verdict) | **S · High** |

*The one founder input:* **name the independent reviewer (RC-4)** — needed by M-IP2-4, not before. If unnamed at DoD, the phase closes "engineering complete · freeze pending review" (IP-0 pattern).

*IP-2_DESIGN.md v1.0 · CTO · 2026-07-13. Build starts at M-IP2-1 immediately; founder veto is async per the Delegation Charter.*
