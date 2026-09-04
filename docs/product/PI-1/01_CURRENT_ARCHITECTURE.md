# PI-1 · 01 — Current Architecture Review

## What exists, verified against source on 2026-08-30 (branch `feat/ui-redesign`, clean at 78f7a1a)

Brief §31 outputs 1–3: current architecture review, existing auth review,
existing database/schema review. Facts only; verdicts live in 02.

---

## 1 · Stack and topology

pnpm + turbo monorepo. Node ≥ 24. Three apps, eight packages, one Postgres 17.

| Unit | Role |
| --- | --- |
| `apps/web` | Next.js App Router. All user surfaces. **No public REST auth API** — server actions are the RPC layer (C-14/D7). |
| `apps/engine` | The auction single-writer: Fastify, HTTP commands in, WebSocket snapshots out, Postgres advisory-lock lease. Certified at IP-4 (M-IP4-4: 31 integration drills — determinism, recovery, idempotency, security). |
| `apps/finops-runner` | "The platform's ONE home for scheduled work." Leased job queue (`finops_jobs`), dead-letter, no HTTP surface. |
| `packages/core` | Pure domain: state machines (competition, registration, auction, lot, bid), capabilities, phone normalization, player-profile enums, media validation, CSV import mapping. No IO, no ambient clock (depcruise-enforced `core-is-pure`). |
| `packages/auction` | The aggregate: decide (pure) → one transaction → one event → one audit row. |
| `packages/db` | Drizzle schema (55 tables, one file), `createDb`, `withTenantDb`, ULIDs, migrations 0000–0035. |
| `packages/settlement`, `packages/financial-operations` | Certified money machines over append-only event streams. Frozen (IP-5/IP-6). |
| `packages/ui` | Token-driven design system (DTCG JSON → generated CSS), two themes (daylight/floodlight), four shells (public/console/live/bare). |
| `packages/contracts` | Zod health/diagnostics schemas only (depcruise rule `contracts-zod-only`). |

Architecture is guarded by ~16 dependency-cruiser rules (`no-circular`,
`admin-is-read-only`, `only-apps-touch-db`, `core-is-pure`, …) that run in
`pnpm verify` and CI.

**Request chain** (every org-scoped server action, no exceptions found):

```
requireSession → resolveTenant(slug, membership) → withTenantDb(personId, orgId)
  → requireCapability → act → audit row (same transaction) → revalidatePath
```

There is **no middleware.ts** — protection is per-page/per-action, deliberate
(each route carries its own `?next=`).

---

## 2 · Authentication (implemented; frozen at IP-2; RC-4-reviewed)

Source of truth: `apps/web/src/server/auth/*`, `packages/core/src/phone.ts`,
docs/identity/{AUTHENTICATION,SESSIONS,PASSKEYS,THREAT_MODEL}.md.

- **Model: phone-first OTP, no passwords — ever (C-24).** A person *is* a
  verified Indian mobile. First successful OTP verify inserts the `people`
  row (open signup — request/verify behave identically for known and unknown
  phones: no account-existence oracle, asserted by test).
- **OTP hygiene**: 6-digit CSPRNG, SHA-256 stored, 5-min TTL, ≤5 verify
  attempts via atomic guarded increment (holds under 12-way concurrency —
  tested), consumed-at replay kill, 30 s resend cooldown, 5/phone/hour,
  20/IP/hour. Delivery behind the `OtpSender` port: `DevInboxSender` (dev)
  and `Msg91OtpSender` (MSG91 v5) with a 3-failure circuit breaker.
- **Passkeys** (simplewebauthn): second login door, phishing-resistant,
  challenge in single-use 300 s cookie, fail-closed on unknown credentials.
- **Sessions**: DB-backed opaque tokens (32 random bytes, SHA-256 stored),
  `da_session` httpOnly/Lax cookie, 30-day slide + 90-day hard ceiling,
  new token every login (fixation defense), immediate revocation. `/account`
  lists devices with per-session revoke **and** "sign out all other devices"
  (`revokeOtherSessions`). Brief §2 F/G/H exist in full.
- **Email**: a **verified contact channel, never a credential**
  (`people.email` + `email_verified_at`, migration 0025; person-scoped
  `email_verifications` codes, 15-min TTL, 5/person/hour, same atomic
  attempt cap; collision checked *after* consume — anti-enumeration).
- **Phone change**: OTP to the *new* number from a live session; outgoing
  number notified best-effort; `auth.phone.changed` audited. This is the
  account-recovery path as implemented; recovery-with-phone-lost is a named
  pre-GA design item (DPDP doc §4).
- **Onboarding**: one derived step (name), no stored wizard state
  (`requireOnboarded` gates 14 console segments on `people.name`).
- **Security events** (append-only `audit_log`, person scope):
  `auth.login.otp/passkey`, `auth.otp.lockout`, `auth.passkey.*`,
  `auth.session.revoked`, `auth.phone.changed`, `profile.*`. Last events
  surfaced to the person at `/account` and `/inbox`.
- **CSRF**: origin-checked server-action POSTs + SameSite=Lax. Headers: HSTS,
  XFO DENY, nosniff, referrer policy, permissions policy, CSP
  (`base-uri/object-src/frame-ancestors/form-action` — **no script-src**;
  nonces need middleware; tracked follow-up). Open redirect: `safeNext()`
  allowlist, unit-tested.
- **Protecting tests** (tripwires; weakening needs RC-4-grade review):
  `auth.integration.test.ts` (7), `security.regression.test.ts` (8),
  e2e `login/passkeys/auth-onboarding` specs.

**Known auth seams found in this review**
1. `otp_codes` has **no `purpose` column** — the phone-change flow reuses
   login codes (deliberate, commented); a code minted for one purpose is
   structurally usable for the other on the same phone.
2. Audit gaps: OTP *requests* unlogged; individual failed attempts unlogged;
   lockout on unregistered numbers leaves no row; logout unlogged; failed
   passkey ceremonies unlogged.
3. No rate limiting beyond OTP/demo throttles (no per-route limiter).

---

## 3 · Authorization (grants, not roles — C-8)

- **One substrate** (`grants`: person, scope_type ∈ org|tournament|team|platform,
  scope_id, capability_set, revoked_at) — **four parallel capability engines**,
  mutually fail-closed:
  org (`org:owner` 16 caps / `org:staff` 6 / `viewer` ∅),
  settlement (`settlement:officer|controller`),
  finops (`finops:clerk|accountant|controller`),
  platform (`platform:admin|billing|demo`, nil-ULID singleton scope,
  **uninsertable by the app role** — RLS WITH CHECK admits `scope_type='org'`
  only; seeded via system pool script).
- `org_members` is belonging only (no role column, no history). "Owner/Staff/
  Member" labels are display derivations of held sets.
- **RLS second lock**: ~39 tenant tables ENABLE+FORCE, fail-closed GUC
  policies; write-side WITH CHECK added after RC-4 found self-escalation via
  read-predicate reuse. Four DB roles (`app` NOBYPASSRLS, `system`/`engine`/
  `runner` BYPASSRLS with enumerated writes); `assertTenantIsolation()`
  refuses production boot on a bypassing app role. Known tracked item: ~130
  org-scoped reads still run on the system pool.
- **"Gate the data, not the button" is largely remediated** (DA-13/DA-30):
  live-room payloads, teams money/roster, registration lists, member
  directories, home money/activity all gate server-side; WS purse scope is
  inside the HMAC ticket.

---

## 4 · Identity & profile — the data as it stands

**`people`** (no `users` table): `id, phone (unique), name (nullable!),
photo_url + photo_uploaded_at + photo_consent_at/via, email +
email_verified_at, created_at`. **No gender, no DOB, no location, no
password — nothing else.**

**`registrations`** is simultaneously three things:
1. participation record (person × competition, status machine
   `draft|submitted|approved|rejected|waitlisted|withdrawn`, triage fields,
   `registrations_competition_person_uq` total-unique with withdrawn-
   reinstatement),
2. **the entire player profile** (role, `date_of_birth` [text ISO],
   batting/bowling styles, father_name, jersey/kit fields, base_price_band —
   migration 0018 "player_profile"),
3. desk bookkeeping (fee_status/amount/reference, note — 0034; explicitly
   NOT settlement money).

Squad membership **is** `registrations.team_id`, written transactionally by
the certified sale path (and compensated on reopen); `backfill:squads`
repairs pre-fix residue.

**Cross-competition identity exists structurally and is barely surfaced**:
`registrations.person_id → people`, `registrations_person_idx`, and
`tournaments` (durable name) ← `competitions.tournament_id` (editions,
0019). The only person-scoped cross-org read is `myRegistrations(personId)`
on `/home` — it deliberately selects `lotStatus` only (for `posterReady`),
never `soldPrice`. **No career surface, no cross-season profile, no
sold-price history reader exists.**

**Profile completeness**: exactly one computation —
`(name?1:0)+(passkey?1:0)` on `/account`. Nothing server-side, nothing
including email/photo/DOB/styles.

**Media**: full presign→direct-PUT→attach pipeline (player/team/competition
subjects), magic-byte sniffing, traversal-safe key grammar, DPDP consent gate
(no photo renders without `photo_consent_at`; withdrawal deletes object +
nulls consent), minors' age and photo suppressed on all public surfaces.
**Defect (D1)**: `BucketStorage` is designed but no SigV4 signer is
constructed — `MEDIA_STORAGE=bucket` (required when serving production)
throws at first import of `server/media`. Only the local adapter is wired.

---

## 5 · Sports entities

- **Organizations** → **tournaments** (durable names) → **competitions**
  (editions; the unit that runs: status `draft→setup→registration_open⇄closed`,
  tier, visibility, dates/location as text ISO). No sport, no gender/category,
  no format column — cricket is implicit (roles `batter|bowler|all_rounder|
  wicket_keeper`).
- **Teams are per-competition** (unique name per competition, coach_name,
  colors, logo). No durable franchise entity — "run it again"
  (`cloneCompetition`) copies name/color/coach into new rows; players not
  copied. V1 deliberately refused the franchise abstraction (doc 38: H2).
- **Auction**: certified event-sourced machine — 29 event types, per-auction
  `seq` total order, projections (`lots/bids/paddles`) verified and healed
  against the log; `AuctionConfig` (purse, squads, slabs, timer, bands,
  quotas) locked at creation; owner invite→accept→grant→claim paddle chain;
  purse always derived, never stored. Registration→lot gateway:
  `approved && !isIcon` after `registration_closed`, ≥2 teams; go-live guard
  ≥2 distinct-team paddles + ≥1 queued lot.
- **Fixtures/venues/standings** exist; standings derived on read.
- Noted in passing during this review: `isRetained` is rendered as
  pre-signed squad but **not** excluded from the auction pool
  (`auction-ready.ts` filters `!isIcon` only) — a real inconsistency,
  independent of PI-1 (flagged for its own fix).

---

## 6 · Registration flow (as shipped)

Public path `/seasons/[slug]/register` (public shell): anonymous preview →
login (`?next=` preserved) → 3-step wizard (`profile`=name → `role`=role/DOB/
styles [+ guardian name & consent when minor — server-re-derived] → `review`
+ self photo upload + required publication-consent) → `submitted` → organizer
triage (approve/reject-with-reason/waitlist) → SMS notice + person-scoped
audit row. localStorage draft recovery (consent deliberately not persisted).
Organizer paths: single add-by-phone (creates `people` stub) and CSV/Google-
Form import (synonym detection → confirm-always mapping → diff preview →
one-transaction commit into `submitted`; saved mappings per org/season).
Consent evidence: append-only `consent_records` (publication,
sms.transactional, guardian.consent).

---

## 7 · Platform services relevant to the brief

- **Messaging**: 4-layer send gate (suppressions → person prefs → org switch →
  category+quiet-hours+consent), DLT-pinned SMS templates (renderer refuses
  over-length slots), email HTTP adapter, in-app via person-scoped audit rows
  read by `/inbox`; OTP exempt by construction. WhatsApp/webhook are
  type-only (founder externals).
- **Admin**: read-only console (depcruise-enforced) over certified
  projections; users/orgs/audit/health/messaging surfaces with URL-driven
  search/filter/cursor pagination; every page-gate failure is a 404, and
  page views write `admin.accessed`.
- **Jobs**: finops runner is the one scheduled-work home; demo/settlement
  sweeps are secret-gated HTTP crons; engine timers are in-process.
- **Validation**: zod for env only. Action input is manual + pure-core
  validators (`normalizePhone`, `validateName`, profile enums with CSV
  aliases, media grammar). No schema layer for form input — house style.
- **Testing**: ~1 400 unit/regression call sites; web integration suite
  (53 files, real PG, `fileParallelism:false`); 127 Playwright tests in 28
  specs (axe inline in 20, contrast measured in-browser, 320–1920 px
  responsive certification, precompiled-server mode; CI: quality +
  integration + RLS/grants proofs + e2e + gitleaks + nightly restore-verify).
- **Docs**: identity subsystem docs are accurate but frozen at IP-2 (they
  under-describe today's staff capabilities and omit the settlement/finops/
  platform engines); docs 36/37/53 are aspirational canon whose vocabulary
  (`tournament:conduct`, pg-boss) never shipped. `packages/core/src/
  capabilities.ts` is the enforcement truth.

---

## 8 · DPDP Act 2023 posture (constrains this brief directly)

Inventoried in docs/identity/DPDP_DATA_INVENTORY.md: phone is the identity
anchor; DOB is self-declared, optional, **per-registration** (age derived,
never stored); photos consent-gated with working withdrawal; minors'
age/photo suppressed publicly; guardian consent captured and evidenced.
Named pre-GA obligations, still open: DPDP-grade signup notice + consent
record; erasure/anonymization path; data-principal access export; grievance
channel. C-23: contact details of people are never public; player pages are
`noindex`. **Not collected today: gender, person-level DOB, address,
location.** Any new personal-data column PI-1 adds must extend this
inventory and its retention row.
