# DEMO-1 — Schedule a demo, end to end

**Status:** BUILT — all phases. **Author:** engineering. **Planned:** 2026-08-29. **Delivered:** 2026-08-30.
**Supersedes:** the honest placeholder at `apps/web/src/app/schedule-demo/page.tsx`.

> Sections 1–16 are the plan as written. **§18 records what actually shipped,
> including the five places the plan was wrong** and what replaced them. Where
> the two disagree, §18 is the truth.

---

## 1. Why this does not exist today

It was a deliberate placeholder, not an oversight, and the file says so:

> `/** Honest pattern — no booking-calendar backend, same as /contact. Public, no auth. */`
> — `apps/web/src/app/schedule-demo/page.tsx:13`

It shipped in PX-10 (public content surfaces) when outbound email was still an
open founder decision. `apps/web/src/server/auth/email-sender.ts:10` records the
same constraint in the same words: *"the provider is a founder decision that is
still open (SES, Postmark, Brevo, MSG91's own)"*. Rather than draw a calendar
that could not send a confirmation, PX-10 printed a mailto and told the truth.

**That blocker is gone in code.** Two working HTTP mailers exist —
`HttpMailer` (`server/auth/email-sender.ts`) and `EmailHttpSender`
(`server/messaging/email-adapter.ts`, with a consecutive-failure breaker) —
both selected only when the `EMAIL_API_ENDPOINT` / `EMAIL_API_KEY` /
`EMAIL_FROM` trio is fully present, otherwise falling back visibly rather than
half-sending. What remains is a founder external: provider credentials.

**There is also an exact precedent to build on.** Pass upgrade requests
(migration `0028`, `server/admin/passes.ts`, `/admin/passes`) are the same
shape: somebody asks, it lands in a queue, an operator answers, the answer is
recorded against their name. A demo request is that, with an anonymous stranger
at the front instead of an authenticated organizer.

---

## 2. What we are building

The whole journey, in the order a person lives it:

```
   /  or  /pricing  or  /schedule-demo
          │  "See it run on your tournament"
          ▼
   [1] The request form            (Phase 1)
          │  name, phone, tournament, size, when their auction is
          ▼
   [2] Pick a time                 (Phase 2)
          │  real slots from real availability, IST, no double-booking
          ▼
   [3] Confirmed                   (Phase 2)
          │  on-screen + email + .ics attachment
          ▼
   [4] Reminders                   (Phase 2)
          │  24h and 1h before — SMS is legal here, consent was given at booking
          ▼
   [5] The call itself             (Phase 0, ops)
          │  runs against the seeded demo tenant: demo-club / demo-cup-settled
          ▼
   [6] Outcome recorded            (Phase 1)
             /admin/demos — showed | no-show | signed up | not a fit
```

Two things this is **not**: it is not a Calendly embed (the PX-11 CSP admits no
third-party scripts, and the lead data would leave the platform), and it is not
a payment or CRM surface.

---

## 3. Decisions taken

| # | Decision | Why |
|---|---|---|
| D1 | Build in-repo, no third-party booking embed | Strict CSP in `next.config.mjs`, asserted by `e2e/production-hardening.spec.ts`; twelve-dependency posture; lead PII stays in our DB under our retention rules |
| D2 | Phase 1 (request + queue) is independently shippable | It removes the dead-end mailto on its own. Phase 2 is additive, not a rewrite |
| D3 | `demo_requests` carries **no RLS** | Pre-tenant, anonymous, no `org_id` — same category as `newsletter_subscribers` (`schema.ts:1361`). The migration must state this explicitly, because every other table has RLS and a silent exception is how isolation rots |
| D4 | Acknowledgement is **email, never SMS**, at request time | The send gate (`server/messaging/consent.ts`) would correctly refuse: a stranger has no consent record, no notification prefs, and the OTP exemption does not extend to marketing |
| D5 | Reminders (Phase 2) **may** be SMS | Booking is the moment a consent record is written, with the category and scope named on the form |
| D6 | The on-screen confirmation is the contract | Email may be unconfigured or may bounce; the person must never be left unsure whether they asked |
| D7 | No captcha | No third-party script may load. Honeypot + per-IP throttle instead, mirroring `server/auth/otp.ts` |
| D8 | IST only, stated on the page | Single-market product, single founder. A calendar that silently guesses a timezone is worse than one that names its own |
| D9 | The demo runs on the seeded demo tenant | `pnpm seed:demo` already produces `demo-club` and the settled exemplar `demo-cup-settled`. The call should show a finished auction, not an empty one |

### Still open — founder externals, not engineering

- **F1.** Email provider + credentials for `EMAIL_API_*`. Phase 1 ships and works without it (on-screen confirmation + admin queue); the ack email lights up when it lands.
- **F2.** Real availability: which hours, which days, how far ahead. **Phase 2 must not be built until this is answered and will be maintained.** A calendar offering slots nobody attends is strictly worse than today's mailto.
- **F3.** What the demo actually shows — a script for the 20 minutes. Ops, not code, but it is the product.
- **F4.** Lead retention period (see §9.5).

---

## 4. Data model

Hand-authored SQL, like `0022`–`0030` (the drizzle snapshots stop at `0018`).
**Both migrations must bump `meta/_journal.json`'s `when` past the hand-spaced
future dates, or drizzle silently skips them.**

### 4.1 `0031_demo_requests.sql` (Phase 1)

```
demo_requests
  id                char(26) PK
  name              text not null
  phone             text not null          -- E.164, same normaliser as auth
  email             text                   -- optional; required for the ack
  org_name          text not null          -- their club/tournament, free text
  tournament_size   text not null          -- band, not a number: '<8' | '8-16' | '16-32' | '32+' | 'unsure'
  auction_on        date                   -- nullable: most people do not know yet
  preferred_window  text not null          -- 'weekday-evening' | 'weekend-morning' | 'weekend-evening' | 'any'
  note              text                   -- their words; the most useful column for whoever answers
  source            text not null          -- 'schedule-demo' | 'pricing' | 'landing' — funnel attribution
  request_ip        text                   -- throttling only, ages out with the row
  created_at        timestamptz not null default now()
  -- the answer
  contacted_at      timestamptz            -- null = still open
  contacted_by      char(26)
  outcome           text                   -- 'scheduled' | 'showed' | 'no_show' | 'signed_up' | 'not_a_fit' | 'no_response'
```

- `CHECK` constraints on the three enum-ish text columns, matching the `0028` style.
- `INDEX (created_at)` for the queue; `INDEX (request_ip, created_at)` for the throttle, mirroring `otp_codes_ip_idx` (`schema.ts:114`).
- **No RLS**, with the reasoning in a header comment (D3).
- **Explicit `GRANT`s for all four DB roles** (app / system / engine / runner). Local runs as the DB owner and hides missing grants; the role model has rotted behind before. The migration is the only place this can be got right.

### 4.2 `0032_demo_scheduling.sql` (Phase 2)

```
demo_availability                        -- what the founder is offering
  id, weekday smallint (0-6), start_minute int, end_minute int,   -- minutes past midnight IST
  slot_minutes int not null default 30,
  effective_from date, effective_to date,
  created_at, created_by

demo_blackouts                           -- "not this Thursday"
  id, blackout_on date not null, reason text, created_at, created_by

demo_bookings
  id, demo_request_id char(26) not null references demo_requests,
  slot_start timestamptz not null,        -- stored UTC, rendered IST
  slot_end   timestamptz not null,
  token_hash text not null,               -- sha256 of a base64url secret; never the secret
  confirmed_at, cancelled_at, cancelled_by, rescheduled_from char(26),
  reminder_24h_sent_at, reminder_1h_sent_at,
  created_at
```

- **Double-booking is a database invariant, not a code path:**
  `CREATE UNIQUE INDEX demo_bookings_slot_uq ON demo_bookings (slot_start) WHERE cancelled_at IS NULL;`
  — the same partial-unique idiom as `pass_upgrade_requests_open_uq`.
- Slots are **derived on read** from availability minus blackouts minus live bookings. Materialising a slot table would require a job to keep it true; the derivation cannot drift.
- `token_hash` only, never the token — the idiom in `sessions.ts:61`, `invites.ts`, `auction/owner-actions.ts:51`: `randomBytes(24).toString("base64url")` handed out, `createHash("sha256")` stored.

---

## 5. Server layer

### 5.1 The public write — `server/marketing/actions.ts`

Sits beside `subscribeNewsletterAction`, which already documents the rule this
follows: *"newsletter_subscribers carries no tenant data and no RLS, so a plain
pool write is correct here, the same way auth/actions.ts writes pre-session rows
directly through `db`."*

```ts
requestDemoAction(prev, formData) -> { error?, success?, requestId? }
```

Order of work: honeypot → shape validation → phone normalisation → throttle →
insert → fire-and-forget ack → return. The ack must never fail the submission;
a provider outage cannot lose a lead.

### 5.2 Validation

- Phone through the **same normaliser auth uses** — the `+91` prefix handling has bitten before; do not hand-roll a second one.
- Email is optional but pattern-checked, reusing the `EMAIL_PATTERN` already in `marketing/actions.ts`.
- `note` capped (2 000 chars) and stored raw; it is rendered as text, never as HTML — the `/c/[slug]` stored-XSS fix from PX-11 is the cautionary tale.
- `source` accepted only from a closed allow-list, never echoed from the query string unvalidated.

### 5.3 Throttle — `server/marketing/throttle.ts`

Modelled directly on `server/auth/otp.ts:12-13`, which is the house limiter:

```
MAX_PER_PHONE_PER_DAY = 3
MAX_PER_IP_PER_HOUR   = 10
```

Counted with a `count(*) where created_at > now() - interval` against the
existing indexes. Over the limit returns the **same success message** as a real
submission — a throttle that announces itself is an oracle for enumerating
which phones have already asked.

### 5.4 Notifications

| Event | To | Channel | Gate |
|---|---|---|---|
| Request received | the requester | email | only if `EMAIL_API_*` configured; else on-screen only |
| Request received | founder | email to `support@desiauction.in` | same |
| Booking confirmed (P2) | requester | email + `.ics` | same |
| 24h / 1h reminder (P2) | requester | SMS, else email | **through `consent.ts`** — consent written at booking |
| Cancelled / rescheduled (P2) | both | email | same |

The `.ics` is generated in-repo — RFC 5545 is a few dozen lines of string
building, and the email adapter's own comment makes the case: no new dependency
for something `fetch` and a template already do.

### 5.5 Admin reads — `server/admin/demo-views.ts`

Cross-tenant projection on the **system pool**, like every other admin
projection; `demo_requests` has no tenant to scope to. Read-only, so the runtime
read-only proof over `/admin` keeps holding.

### 5.6 Admin writes — `server/admin/demo-actions.ts`

A **separate module**, exactly as `pass-actions.ts` is separate from
`pass-views.ts`, so the read-only proof over the views is untouched. Marking an
outcome, editing availability, and cancelling on the requester's behalf all live
here, and all write an audit row.

---

## 6. Public UI

### 6.1 `/schedule-demo` — Phase 1

Replaces the mailto card. Fields in the order a person can answer them:
name → phone → tournament name → size band → when your auction is → preferred
window → anything else. Email last and optional, labelled *"if you'd rather we
mail than call"*.

- `useActionState`, the shape `components/marketing/newsletter-form.tsx` already
  uses.
- `Field` / `Button` / `Card` from `@desiauction/ui`.
- **Known trap, must not be repeated:** the `Field` primitive currently swallows
  `required` and renders errors that assistive tech never announces — and axe
  stays green through both, so no scan will catch it. Either fix `Field` (better,
  it fixes every form in the product) or handle `required` + `role="alert"`
  explicitly here. Fixing the primitive is the recommendation; it is a small
  change with product-wide payoff.
- Success replaces the form with what happens next and by when — not a toast
  that can be missed.
- Progressive enhancement: it is a server action on a real `<form>`, so it works
  with JS off.

### 6.2 `/schedule-demo/pick` — Phase 2

Slots grouped by day, IST labelled, next 14 days, empty state that falls back to
the Phase 1 behaviour ("nothing free this fortnight — leave your details and
we'll come back to you"). Selecting holds and confirms in one action; the DB
index is what actually prevents the double-book, and a lost race re-renders with
that slot gone and an apology.

### 6.3 `/demo/[token]` — Phase 2

Confirm / reschedule / cancel. Two landmines here, both already paid for once in
this repo:

- **No `loading.tsx` above this route.** A `loading.tsx` over a gated page
  commits a 200 before the gate runs, breaking `notFound()` and `redirect()`.
  Gate first, then stream.
- Any `next`-style redirect must go through `safeNext`; the backslash bypass was
  the PX-11 open-redirect fix.

### 6.4 Entry points — Phase 3

Today `/schedule-demo` is reachable only from the footer and the nav
(`components/shell/nav.ts:62`, `product-shell.tsx:616`). It needs a real CTA on
`/` and on `/pricing`, each passing its own `source`.

---

## 7. Admin UI

### 7.1 `/admin/demos`

Open requests first, answered below, the `note` shown in full — it is the column
whoever answers actually reads. Actions: mark contacted, set outcome, open the
booking, cancel on their behalf.

### 7.2 The capability question — a real decision

Four parallel partitions exist today, and `platform.admin` deliberately confers
**zero** write power; `platform.pass` was added as a second set rather than a
second word, on the argument that *"seeing every organization's money and
changing what a customer is entitled to are different acts of trust."*

The same argument applies here: a demo queue is a list of strangers' names and
phone numbers, and publishing your availability is speaking for the company.

- **Recommended:** a third platform capability, `platform.demo`, inheriting both
  structural locks — singleton scope, and `grants_tenant`'s `WITH CHECK` (which
  admits only `scope_type = 'org'` and so makes every platform grant
  uninsertable by the application role). Seeded out-of-band on the system pool,
  no UI issues it.
- **Cheaper fallback:** reuse `platform.pass`. Saves a day of seeding and gate
  work; costs the clean separation, and conflates "can change what a customer
  pays" with "can answer the sales queue". Acceptable while both are one person.

Reads go through the gate; `recordAdminAccess` gets a new `AdminSurface` value —
opening a list of strangers' phone numbers is exactly the read that deserves a
row.

### 7.3 `/admin/demos/availability` — Phase 2

Weekly windows, blackout dates, slot length. This screen is the honesty
mechanism for F2: if it is empty, the public picker says so instead of inventing
times.

---

## 8. Messaging, consent, and the law

- Request ack is **transactional**, sent to an address the person just typed on
  a form that says we will use it. It does not need marketing consent and must
  not be routed through the marketing gate.
- Reminders (P2) go **through `consent.ts`**, whose refusal reasons are
  `suppressed | opted_out | no_consent | org_disabled | quiet_hours`. Booking
  writes an append-only `consent_records` row naming the category and scope —
  the table is append-only by design because *"did they agree on the day we sent
  it?"* is a question about a moment in the past.
- STOP handling and suppression already exist and are inherited for free.
- Every outbound mail carries the support address and a one-line "you asked for
  a demo on ⟨date⟩" provenance.

---

## 9. Security, abuse, privacy

1. **Spam** — honeypot field, per-IP and per-phone throttles, silent on refusal (§5.3).
2. **Enumeration** — the form never reveals whether a phone or email is already known.
3. **Tokens** — 24 random bytes, base64url, sha256-stored, single-purpose, expiring at slot end + 24h. Never in a query string that could land in a referrer log; path segment only.
4. **XSS** — `note` and `org_name` are attacker-controlled and render in an admin surface. Text nodes only. No JSON-LD, no `dangerouslySetInnerHTML` — the `/c/[slug]` stored-XSS fix is the precedent.
5. **Retention (F4)** — leads are personal data under the DPDP Act. Needs a stated period (proposal: purge unbooked requests at 24 months, `request_ip` at 90 days) and a one-line entry in the privacy policy in `content/legal.ts`. **This must ship with Phase 1**, not after — collecting first and writing the policy later is the wrong order.
6. **CSP** — nothing new loads. `e2e/production-hardening.spec.ts` asserts the header and will fail if that changes.
7. **DB roles** — new tables need explicit grants for app / system / engine / runner in the migration (§4.1).

---

## 10. Accessibility and design

- Labelled fields, `aria-describedby` hints, `role="alert"` on the error summary, focus moved to it on failure — the `Field` gap in §6.1 is the blocker.
- Target size ≥ 44px on slot buttons. Axe does not check this; assert it with a computed-style test — every real defect in the UX-1 audit hid in exactly this kind of verification blind spot.
- Both themes. The dark theme has gone unscanned before.
- Motion: transform-only, per `check:motion`. Never animate the opacity of text — axe scans `aria-hidden` content for contrast and fails mid-frame.
- Slot grid: a real list at 360px, not a squeezed calendar.

---

## 11. Content, SEO, search

- `content/search.ts:156` already indexes "Schedule a demo" — update the summary.
- `content/content.test.ts:395` validates every content href; the new routes join it.
- `/schedule-demo` keeps its canonical; `/schedule-demo/pick` and `/demo/[token]` are `noindex`.
- `sitemap.ts` unchanged (and remember the build queries the DB, so it needs Postgres up).
- Copy is founder voice, not SaaS voice: what happens, by when, and what it costs (nothing, during beta).

---

## 12. Telemetry

Through `lib/telemetry.ts`, one event per funnel step: `demo_form_viewed`,
`demo_requested` (with `source`), `demo_slot_picked`, `demo_confirmed`,
`demo_cancelled`, `demo_outcome_recorded`. No PII in event payloads. Without
these the answer to "is this worth maintaining?" is a guess.

---

## 13. Testing

| Layer | What |
|---|---|
| Unit | validation, phone normalisation, throttle boundaries, slot derivation across a DST-free but blackout-riddled fortnight, `.ics` output |
| Regression (vitest, real DB) | the no-RLS decision is deliberate and asserted; the partial unique index actually refuses a second booking; grants exist for all four roles |
| E2E (Playwright) | `demo.spec.ts` — submit → confirmation; throttled submit still says success; pick a slot → confirm → cancel via token; admin queue shows and answers it |
| A11y | axe on all three public routes, both themes, plus the computed-style target-size assertion |
| Concurrency | two contexts confirming the same slot; exactly one wins, the loser gets a clean message |

E2E harness notes that have cost days before: the suite runs against the
**second database on :5433**, not the :5432 regression DB; use
`PLAYWRIGHT_PRECOMPILED=1`; and make no edits while a run is in flight —
mid-run recompiles hang server actions and the failures look like app bugs.

---

## 14. Rollout

1. Migrations `0031` (+ `0032`) with the journal `when` bumped.
2. `pnpm verify` — lint, typecheck, test, format, depcruise (no new cycles), motion.
3. `pnpm verify:local` — build, integration, env check, health.
4. Seed `platform.demo` for the founder's person id on the system pool (if D-recommended).
5. `pnpm preflight:production`; add `EMAIL_API_*` to its checked set as a **warning**, not a blocker — Phase 1 is correct without it.
6. Ship Phase 1. Watch `demo_requested` for two weeks before deciding on Phase 2.

**Rollback:** Phase 1 is two new tables and additive routes. Reverting the code
leaves the tables orphaned but harmless — no existing surface reads them.

---

## 15. Phasing

| Phase | Scope | Estimate |
|---|---|---|
| **1** | Migration `0031`, action + throttle, public form, ack email, `/admin/demos`, retention policy line, tests | **2–3 days** |
| **2** | Migration `0032`, availability + blackouts, slot derivation, picker, token page, `.ics`, reminders through consent, availability admin, concurrency tests | **8–10 days** |
| **3** | CTAs on `/` and `/pricing`, funnel telemetry dashboard, no-show follow-up | **2 days** |

---

## 16. Risks

| Risk | Mitigation |
|---|---|
| **Availability goes stale (F2)** — the highest risk in the document | Phase 2 gated on F2 being answered; empty availability degrades to the Phase 1 form rather than showing nothing |
| Email provider still unchosen (F1) | Phase 1 is fully correct without it — on-screen confirmation is the contract (D6) |
| Demo requests arrive and nobody answers | The queue makes the backlog visible; `no_response` is a recordable outcome, so the failure is measurable rather than invisible |
| A fifth capability partition is more governance than one founder needs | The `platform.pass` fallback is documented in §7.2 |
| Lead PII with no retention rule | §9.5 ships with Phase 1, not after |

---

## 17. Definition of done — Phase 1

- [x] `/schedule-demo` submits a real request; no mailto remains as the primary path
- [x] The request is in `demo_requests` with source attribution
- [x] The requester sees what happens next and by when, without email configured
- [x] With `EMAIL_API_*` set, requester and founder both get mail
- [x] Throttles hold and stay silent
- [x] `/admin/demos` lists, answers, and audits — behind a gate, `notFound()` for everyone else
- [x] The `/admin` runtime read-only proof still passes
- [x] Privacy policy names the retention period — **and code enforces it**
- [x] Axe clean; keyboard-complete; works with JS off
- [x] Verification pipeline and the DEMO-1 e2e suite green

---

## 18. What shipped, and where the plan was wrong

All three phases are built. Five things in §1–16 did not survive contact, and
each is worth recording, because in every case the plan was confidently wrong
rather than merely incomplete.

### 18.1 Phase 1b did not exist — the `Field` gap was already closed

The plan budgeted half a day to make `Field` pass `required` to the DOM and
announce its errors. Opening the file showed all three repairs already there and
documented at length: `required` reaches the control, the message is both
`aria-describedby` and a `role="alert"`, and focus moves to the first failing
field after a rejected submit. The phase was deleted rather than performed. The
form leans on all three, and the e2e suite asserts them.

### 18.2 Tokens are DERIVED, not random — because the reminder sweep needs them

The plan said 24 random bytes, SHA-256 stored, the idiom sessions and invites
use. Writing the reminder sweep exposed the flaw: a job running a day later must
rebuild the person's own manage link, and a random token is unrecoverable once
hashed. Keeping the plaintext in the row would have given a leaked backup a
working link to every booking.

So the token is an **HMAC of the request id** under `DEMO_TOKEN_SECRET` — the
key lives in the environment, never in the table. It keeps the property that
matters (a database leak yields no links), makes the link reproducible by the
application, and is stable across a reschedule, so the link already sitting in
somebody's mailbox keeps working. `DEMO_TOKEN_SECRET` has a development default
that is refused when actually serving, exactly as `ENGINE_SECRET` is.

One consequence had to be handled: a request that cancels and books again
collides with its own retired row, since `token_hash` is UNIQUE. The dead
booking surrenders the hash inside the same transaction. Without that,
re-booking after a cancellation reported the slot as taken by somebody else —
wrong, and unfalsifiable from the outside.

### 18.3 The write runs on the APP pool, and the capability is a third set

Two calls the plan left open:

- **Pool.** Every other cross-tenant admin write uses the system pool because a
  platform operator is not a member of the org whose row they change. There is
  no org here and no RLS, so there is nothing to bypass — the write runs on the
  app pool, and the system role's pinned write list stays at four tables.
  `pnpm grants:verify` passes with 245 expectations across 54 tables.
- **Capability.** `platform:demo` was added as a third platform set, taking the
  recommended option rather than the cheap one. It inherits both structural
  locks unchanged, and `seed:admin --set platform:demo` is the only way to issue
  it.

The demo tables needed **no GRANT statements at all** — the recipe's default
privileges already cover them. That is stated in the migration rather than left
to be rediscovered, and pinned in `verify-grants.ts` so a recipe rewrite that
drops those defaults fails there instead of on the public demo page.

### 18.4 Reminders are an endpoint, not a scheduler

The plan did not say where the sweep would run. The finops runner calls itself
"the platform's ONE home for scheduled work" and is a certified money process;
putting a marketing reminder inside it would widen its blast radius for no gain,
and a second always-on process for two messages a day is worse. So the work is a
function, `POST /api/jobs/demo-reminders` is a door onto it, and whatever cron
the host already has calls it — fail-closed on `DEMO_JOB_SECRET`, 404 without
it, and idempotent by a stamp on the row rather than by the clock.

The retention purge rides the same door, which closes a gap the plan created:
`/legal/data-retention` now promises deletion at twenty-four months and address
clearing at ninety days, and a promise with no scheduled enforcement is a
paragraph. `purgeExpiredDemoData` is asserted against a real database.

### 18.5 Two defects the tests found that reading did not

- **`aria-pressed` on a `<label>`** — a critical WCAG 4.1.2 violation, caught by
  the axe scan on the picker. The attribute is not allowed on that element and
  duplicated state the radio already carried. Selection is now styled from the
  input's own `:checked`; no ARIA is layered over a control that already says
  everything a listener needs.
- **The e2e fixture's cleanup mark never matched the org name it created**, so
  every run left its requests behind. After ten in an hour the per-IP throttle
  began silently swallowing submissions from localhost — which looks exactly
  like a broken form and is in fact the throttle working correctly. The fixture
  now stamps what it creates and clears residue before the run.

### 18.6 Verification

| Gate | Result |
|---|---|
| `pnpm lint` | green (11 tasks) |
| `pnpm typecheck` | green (11 tasks) |
| `pnpm format:check` | green |
| `pnpm depcruise` | green — no new cycles, `admin-is-read-only` intact |
| `pnpm check:motion` | green |
| DEMO-1 unit tests | **31 passed** — slot derivation, validation, ICS |
| DEMO-1 regression (real DB) | **10 passed** — no-RLS asserted, double-booking refused, throttle, retention |
| `admin-foundation.regression` | **26 passed** — the read-only source scan still holds |
| DEMO-1 e2e | **14 passed** — request → pick → confirm → move → cancel, plus a11y at 360px |
| `pnpm grants:verify` | 245 expectations, 54 tables, 4 roles |

**Known-unrelated failures, proven not caused by this work.** Three suites fail
in this environment and each was re-run with the DEMO-1 changes stashed,
reproducing identically:

- `financial-operations-delivery.regression` — 3 failures, dev-DB residue
  (11,844 `finops_jobs` rows).
- `financial-operations-foundation.regression` — passes in isolation; fails only
  under full-suite parallel load, the documented wall-clock condition.
- `shell.spec.ts` "search navigates" — `getByTestId("new-org")` resolves to two
  elements, the closed-dialog-still-in-DOM class of problem.

The precompiled e2e path (`PLAYWRIGHT_PRECOMPILED=1`) remains unusable locally:
it demands a production-valid environment, and `ENGINE_SECRET`, `RP_ID`,
`PUBLIC_BASE_URL` and `MEDIA_STORAGE` all refuse the local values. That is
pre-existing and unrelated.

### 18.7 What is still a founder decision

Unchanged from §3, and none of it is engineering:

- **F1 — an email provider.** Everything works without it; the on-screen
  confirmation is the contract, and mail lights up when `EMAIL_API_*` lands.
- **F2 — real availability.** Nothing is published, and that is a supported
  state: `/schedule-demo` promises a reply within a working day and the
  availability desk says so out loud. Publish windows only if they will be kept.
- **F3 — a script for the twenty minutes.**
- **F4 — retention.** Answered in code at 24 months / 90 days. Change the
  numbers if they are wrong; they are stated in the policy either way.
- **A cron caller** for `/api/jobs/demo-reminders`, and `DEMO_JOB_SECRET` set.
- **`DEMO_TOKEN_SECRET`** must be set in production — the preflight refuses to
  serve without it.
