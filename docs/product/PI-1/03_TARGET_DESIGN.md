# PI-1 · 03 — Target Design

## Domain model, flows, eligibility, state machines, validation, modules, screens

Everything here is **additive**. No frozen boundary (auth hot path semantics,
auction aggregate, settlement/finops, capability engines) is modified; the
two auth touches (OTP purpose column, audit actions) are additive columns and
additive union members with their own regression tests.

---

## 1 · Target entity map (delta over doc 38)

```
people (identity anchor — phone, name, photo+consent, email)          [KEEP]
   │ 1:1
   ├── player_profiles (durable sports identity + prefill)            [NEW]
   │      gender · dob · location · default role/styles · jersey pref
   ├── sessions / passkey_credentials / email_verifications           [KEEP]
   ├── otp_codes (+ purpose)                                          [EXTEND]
   ├── consent_records (+ terms.privacy purpose)                      [EXTEND-data]
   └── registrations (participation + per-edition profile SNAPSHOT)   [KEEP]
          │ n:1                       │ n:1
          ▼                           ▼
     competitions (+ entry_category) teams (+ franchise_id, opt.)     [EXTEND]
          │ n:1                           │ n:1 (nullable)
          ▼                               ▼
     tournaments (durable name)      franchises (durable name)        [KEEP/NEW]
          │                               (Phase 6, optional)
          ▼
     auctions → lots/bids/paddles/auction_events                      [KEEP, read-only for PI-1]
```

ER notes (house conventions preserved):
- ULID `char(26)` keys, **no declared FK constraints**, bare reference
  columns + app/RLS discipline.
- `player_profiles` carries **no `org_id`** — it is platform-to-person data
  like `people`/`notification_preferences`, deliberately outside RLS, scoped
  by the app layer to the session's own `person_id` on every read/write
  (same recorded-boundary class as sessions; see 04 §1).
- Career history is a **projection, not a table**: registrations × teams ×
  competitions × tournaments (+ lots for prices). Nothing new to keep
  consistent, nothing new to migrate, nothing that can drift from the
  certified writers.

### `player_profiles` — column sheet

| Column | Type | Notes |
| --- | --- | --- |
| `id` | char(26) PK | ULID |
| `person_id` | char(26) NOT NULL, **UNIQUE** | 1:1 with `people`; created lazily on first profile write |
| `gender` | text NULL | CHECK `male\|female\|non_binary\|self_described\|unspecified`; NULL = never asked (distinct from `unspecified` = asked, declined) |
| `gender_self_described` | text NULL | ≤ 40 chars; only meaningful with `self_described` |
| `date_of_birth` | text NULL | ISO `yyyy-mm-dd` (house format); age always derived, never stored |
| `location` | text NULL | free city-level text, ≤ 80 chars |
| `default_role` | text NULL | CHECK against the four playing roles |
| `default_batting_style` / `default_bowling_style` | text NULL | same enums as core `player-profile.ts` |
| `preferred_jersey_name` / `preferred_jersey_number` | text NULL | prefill only |
| `created_at` / `updated_at` | timestamptz | `updated_at` maintained by the write path |

**Snapshot semantics (the load-bearing rule).** The profile is the *source
of defaults*; `registrations` remains the *record of fact* for each season.
At submit, the wizard prefills from the profile and the chosen values are
written to the registration as today. Editing the profile afterwards changes
**nothing** historical — exactly how the brief's "player changes
gender/profile information" and "auction entry after profile changes" edge
cases resolve: the auction and every past season saw the snapshot, the
career page annotates from the profile. One deliberate exception: gender is
**not** snapshotted onto registrations at all — eligibility reads the
profile at decision time, and historical records don't embed a fact whose
correction people are entitled to (DPDP correction right).

---

## 2 · Authentication & registration sequences (as-built + PI-1 delta)

### 2.1 Login (unchanged) + first-signup consent (NEW)

```
Visitor → /login: enter phone
  requestOtpAction: normalize → cooldown → phone 5/h → IP 20/h
      → mint(purpose='login') → hash → send (port; breaker)
  enter code
  verifyOtpAction: latest unconsumed login-purpose code → attempts<5
      → consume atomically
      → [first verify] INSERT people row
        └─ NEW: INSERT consent_records {purpose:'terms.privacy',
             source:'login', evidence:{noticeVersion}}   ← the pre-GA notice
      → logSecurityEvent(auth.login.otp)
        └─ NEW additive events elsewhere: auth.otp.requested,
           auth.logout, auth.passkey.failed
      → issueSessionCookie (new token every login)
      → name unset ? /onboarding : safeNext(next)
```

The login form gains one sentence + links above the button (the DPDP notice);
the consent row is written once, keyed by person. No flow steps are added.

### 2.2 OTP purpose (EXTEND)

`requestOtp`/`verifyOtp` take `purpose: "login" | "phone_change"`
(default `login`); mint stamps it; verify filters candidates by it.
Phone-change stops being able to consume a login code and vice versa.
Cooldown/caps stay keyed per phone (unchanged blast radius). New regression:
cross-purpose consumption refused.

### 2.3 Registration wizard (EXTEND: prefill + write-back)

```
/seasons/[slug]/register (signed in, open, no row)
  load: session + player_profiles[person]           ← NEW read
  step 1 name       — skipped if set (as today)
  step 2 role/dob/styles — PREFILLED from profile   ← NEW
         + minor ⇒ guardian name + consent (as today)
  step 3 review + photo + publication consent (as today)
  submit:
    eligibility.evaluate(...)                        ← NEW single gate (§6)
    submitRegistration(...)  — unchanged writer, snapshot lands on the row
    profile write-back (role/dob/styles/jersey if changed & person agrees —
      one checkbox "remember for next time", default on)   ← NEW
    consent rows (as today)
```

Draft recovery, reinstatement, triage, notification: untouched.

---

## 3 · Progressive profile & completeness

Pure core: `profileCompleteness(input) → { score: 0..1, missing: MissingItem[] }`
over: name, photo(+consent), email verified, gender answered (any value incl.
`unspecified`), dob, location, default role, styles. Weights favor what the
product actually uses (photo, role, dob). Rendered:

- `/account` — replaces the 2-item computation; same
  `data-testid="profile-completion"` contract, now listing the missing items
  with deep links.
- `/home` — a "Complete your player profile" rail (shown when a person has
  ≥1 registration or a profile row, hidden for pure organizers), house
  EmptyState/Card conventions, no new layout primitives.

No stored percentage; recomputed per read (derived-state rule).

---

## 4 · Career read model (the brief's team/tournament/auction history)

`apps/web/src/server/player/career.ts` — one module, system-pool read
(documented PRP-1 class, same as `myRegistrations`), person-scoped:

```
playerCareer(personId) → {
  seasons: [{ competition, tournament?, org, role, status,
              team? {name, isCaptain, isViceCaptain, jerseyNumber},
              auction? {kind: icon|retained|sold|unsold|withdrawn,
                        soldPrice?, teamName?} }],
  totals: { seasons, teams, soldCount, highestPrice? }   // derived in-process
}
```

Rules baked in (all learned from existing code):
- join `auctions` with `status ≠ 'abandoned'` before touching `lots`
  (the documented double-count trap in `myRegistrations`);
- prices ride the viewer gate: the person always sees their own; the public
  career section shows only what the public player page already shows
  (sold price is already public on `/c/[slug]/p/[number]` for published
  seasons — parity, not expansion);
- minors: age suppressed everywhere public (existing discipline);
- withdrawn/rejected seasons render honestly, respectful copy
  (registration-rules canon: reasons never public).

---

## 5 · Gender & category model

- Profile field per §1 (optional, five values + self-describe, never
  inferred, never public by default, never an authz input).
- `competitions.entry_category text NOT NULL DEFAULT 'open'`
  CHECK `open|men|women|mixed`. Surfaces: create/overview form (organizer),
  `/c` directory badge + filter, landing page terminology ("Women's" etc.),
  registration preview ("This is a women's competition").
- Enforcement lives **only** in the eligibility engine (§6). No
  `if gender === …` anywhere else — the brief's §7 anti-pattern is
  structurally prevented by there being exactly one evaluator, unit-tested.
- Category mismatch UX: preview states the category; submit returns a
  structured refusal ("This competition is listed as women's — your profile
  doesn't match. If that's wrong, update your profile or contact the
  organizer."); organizer add/import paths get the same evaluation as a
  **warning, not a block** (human-approval invariant 5 — the organizer is
  the gate and may know better; the override is audited via the existing
  `registration.submitted` meta).

---

## 6 · Eligibility engine

`packages/core/src/eligibility.ts` — pure, structured, exhaustive:

```ts
type EligibilityReason =
  | "intake_closed"            // competition not registration_open (self-serve only)
  | "already_registered"       // active row exists (withdrawn ⇒ reinstate path, not a refusal)
  | "minor_missing_guardian"   // dob<18 ∧ no guardian consent
  | "category_mismatch"        // entry_category vs profile.gender (unknown ⇒ eligible + advisory)
  | "invalid_role";

evaluateRegistration(input): { eligible: boolean; reasons: EligibilityReason[];
                               advisories: EligibilityAdvisory[] }
```

- Unknown gender vs. gendered category ⇒ **eligible + advisory** ("category
  is women's; add your profile gender to confirm") — refusing on absent
  optional data would make the optional field mandatory by the back door.
- Consumed by: wizard (display), `submitRegistrationAction` (enforcement),
  organizer add/import (advisory), readiness surfaces (aggregate counts).
- The existing scattered checks (`not_open`, duplicate handling, minor
  consent) **move behind** this facade in place — REFACTOR-in-place of call
  sites, zero behavior change, then the category check lands as the first
  new rule. Frontend displays; backend decides; both call the same function.

---

## 7 · State machines (delta: none changed, one added)

Existing, untouched: registration (6 states), competition (4), auction (6),
lot (8), bid (3) — all with guarded `EDGES` tables in core.

Added: **profile has no state machine on purpose** — it is a document, not a
process (no draft/active/suspended; absence of a row is the empty state;
DPDP erasure nulls it with `people` anonymization). The brief's §25 player
states (`DRAFT/ACTIVE/SUSPENDED/ARCHIVED`) map onto registration status per
season — a person is not globally "suspended"; a participation is.

---

## 8 · Module & screen map

### Modules (server)

| Module | Kind | Contents |
| --- | --- | --- |
| `packages/core/src/eligibility.ts` | NEW pure | §6 + tests |
| `packages/core/src/profile-completeness.ts` | NEW pure | §3 + tests |
| `packages/core/src/player-profile.ts` | EXTEND | gender values, DOB bounds, location/jersey validators |
| `apps/web/src/server/player/profile.ts` | NEW | read/upsert `player_profiles` (self-scoped), audit `profile.player.updated` |
| `apps/web/src/server/player/career.ts` | NEW | §4 read model |
| `apps/web/src/server/auth/otp.ts` | EXTEND | purpose param (additive) |
| `apps/web/src/server/auth/security-events.ts` | EXTEND | four new actions |
| `apps/web/src/server/competition/actions.ts` | EXTEND | wizard prefill/write-back; eligibility call |
| `apps/web/src/server/competition/competitions.ts` | EXTEND | entry_category set/read |
| `apps/web/src/server/admin/views.ts` | EXTEND | profile-aware user filters |

### Screens

| Route | Change |
| --- | --- |
| `/login` | + consent notice sentence (copy + one consent write) |
| `/account` | profile panel grows: gender/DOB/location/defaults editors (house Field/Select), richer completeness list |
| `/home` | + "Complete your profile" rail; "My registrations" rail links to career page |
| `/me/cricket` (NEW, console shell, self-scoped) | career page: header (photo/name/role/location) · summary · seasons list (team, role, badges) · auction history (own prices) · completeness |
| `/seasons/[slug]/register` | prefill + write-back + eligibility messaging |
| `/seasons/[slug]/registrations` | organizer person-drawer gains "seen before in your org" line (career-lite, org-scoped) + category advisory column |
| `/c` + `/c/[slug]` | category badge/filter/terminology |
| `/c/[slug]/p/[number]` | + "Also played in" section — **published seasons of the same org only**, consent-gated by the existing publication consent, noindex unchanged |
| `/admin/users/[personId]` | + read-only profile/career panel (existing admin conventions) |

Shell/nav: `/me/cricket` joins `pageIdentity` + rail under Home's section;
no new shell kinds; all four list/form state conventions apply as shipped.

---

## 9 · Validation rules (new inputs, house style — pure validators + tests)

| Field | Rule |
| --- | --- |
| gender | enum membership; `self_described` text ≤ 40, required iff that value; anything else refused |
| date_of_birth | ISO date, not future, ≥ 1900-01-01; minor derivation reuses `isMinor` (single source) |
| location | trimmed, ≤ 80, no control chars |
| default role/styles | existing core enums (aliases stay import-only) |
| jersey prefs | name ≤ 30, number 1–3 chars numeric-ish (matches import tolerance) |
| entry_category | enum membership; only `competition.manage` may set; audited `competition.updated` meta |
| profile writes | session-self only; length caps enforced server-side; every write audited |

All refusals return the discriminated `{error, field}` form-state shape the
14 `useActionState` call sites already use.
