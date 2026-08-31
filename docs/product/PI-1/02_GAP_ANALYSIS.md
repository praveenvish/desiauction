# PI-1 · 02 — Gap Analysis: the brief vs. the codebase

## Every ask classified KEEP / EXTEND / REFACTOR / REPLACE / NEW — with why

Rule of engagement (brief §30): prefer the smallest safe architectural change
that gives the desired result. Two asks are **declined with reasons** rather
than classified; they open this document because everything else hangs off
them.

---

## 1 · The two declines

### 1.1 Email + password authentication — DECLINED

The brief asks for email+password as option A. The platform's constitution
says otherwise, and the constitution is right for this market:

- **C-24 is a founding decision, not an omission**: "phone-first OTP with no
  passwords — ever." A person *is* a verified Indian mobile. The entire
  identity chain (no-enumeration guarantees, open signup, threat model §1–2,
  DPDP inventory "Not collected: passwords (never — C-24)") is built on it,
  and the protecting test suites are declared tripwires requiring RC-4-grade
  review to weaken.
- Passwords would *reintroduce* the exact threat classes the threat model
  currently marks N/A: credential stuffing, password reuse, reset-token
  phishing, password-table exfiltration value.
- The audience reality: local cricket players and club organizers in India
  authenticate by phone everywhere; the brief's own UX goals (low-friction
  progressive onboarding) are better served by the existing OTP + passkey
  pair — passkeys already are the "structural OTP-cost reducer" after first
  login.
- What the brief actually needs from "email auth" is covered: email is a
  **verified contact channel** (0025) with code-based verification, used for
  documents/receipts. If a second *login* channel is ever wanted, the clean
  seam exists — `email_verifications` + a login-purpose extension — without
  ever minting a password. That is recorded as an explicit non-goal for PI-1,
  revisitable as founder product strategy, not engineering necessity.

Consequently: password reset, password hashing, password strength validation,
"password changed" audit events → **N/A by design**. The brief's security
intents behind them (recovery, session hygiene, audit) all exist via the
phone-change flow, session revocation, and security events.

### 1.2 Generic User/Role/Permission/UserRole/RolePermission tables — DECLINED

The brief itself says "do NOT hardcode a single role field **if the existing
system can support RBAC**." The existing system exceeds RBAC: grants
(person, scope, capability set) with exact-scope fail-closed evaluation,
four capability engines, RLS-backed write protection, audited issue/revoke,
and last-owner/last-controller guards. Business code asks about
*capabilities*, never role names (C-8). Introducing Role/Permission rows as
data would be a REPLACE of a stronger model with a weaker one and would
detonate the depcruise/authz regression suites. The brief's role list maps
onto existing capability sets — see the RBAC matrix in §3.

---

## 2 · The classification matrix

### Brief §1–2 · Product model, accounts, authentication

| Ask | Verdict | Why / what changes |
| --- | --- | --- |
| Auth identity separate from sports identity | **KEEP** (already constitutional) | Doc 38 "person ≠ participation" is the founding model. PI-1's job is to finish the *sports identity* half, not restructure identity. |
| Multiple roles per account | **KEEP** | A person already holds any mix of org grants, settlement/finops grants, paddle grants and registrations. Owner-player in one tournament is explicitly supported. |
| Email OTP login | **DECLINED for PI-1** (seam recorded) | §1.1. |
| Phone OTP architecture | **KEEP** | Exists, certified. |
| Session/device management, logout, logout-all | **KEEP** | Exists in full (`/account`, `revokeOtherSessions`). |
| Account recovery | **KEEP + note** | Phone-change flow exists; phone-*lost* recovery remains the named pre-GA design item — out of PI-1 scope, tracked. |
| Rate limiting, brute force, audit logging | **KEEP + EXTEND** | OTP throttles/lockouts exist and are tested. EXTEND: close four audit gaps (OTP requested, failed attempt terminal context, logout, passkey failure) — additive `SecurityAction` values only. |
| Registration captures full name | **KEEP** | Onboarding name step + wizard step 1. |
| … email | **KEEP** | Optional verified channel at `/account`; PI-1 adds a completeness nudge, not a signup gate. |
| … gender | **NEW** | §7 of the brief; modeled on the new person-level profile (03 §3), never on `people` row itself, never public by default. |
| … date of birth | **EXTEND** | Exists per-registration. PI-1 adds person-level DOB on the profile as the *source*, registration keeps its snapshot copy (immutable history + DPDP retention unchanged). |
| … country/state/city | **NEW (minimal)** | One optional `location` text field on the profile (city-level). No country/state taxonomy — India-first platform (C-24), competitions already carry location. |
| … account intent / role picker | **DECLINED as a signup step** | The platform derives intent from action (create org ⇒ organizer; open a registration link ⇒ player) — the shipped derived-state onboarding philosophy. A "what are you joining as?" interstitial adds friction and stored wizard state the house style refuses. The *capability* the brief wants (relevant next steps per intent) lands on `/home` (SetupLadder already does organizer; PI-1 adds the player rail). |
| Terms acceptance + privacy consent | **NEW (obligation already named)** | The DPDP-grade signup notice + consent record is an open pre-GA item. PI-1 implements it: login-step notice + `consent_records` row (`purpose: "terms.privacy"`, versioned) at first verify. |

### Brief §3–4 · OTP design & login flow

| Ask | Verdict | Why |
| --- | --- | --- |
| OTP entity fields (hash, expiry, attempts, consumed, metadata, channel) | **KEEP** | All present across `otp_codes` + `email_verifications`; hashes only, atomic attempt caps, replay-dead consumption. |
| `purpose` on OTP | **EXTEND** | Real gap: phone-change reuses login codes. Add `purpose text NOT NULL DEFAULT 'login'` (`login \| phone_change`) to `otp_codes`; mint and consume by purpose. Additive migration; verify path filters by purpose. Email purposes stay in their own table (two tables that say what they are beat one that doesn't — 0025's own reasoning). |
| Throttling / cooldown / resend caps / invalidation / no-enumeration / replay | **KEEP** | Exists, regression-tested, documented. |
| Shared verification abstraction for email+SMS | **KEEP (as-is)** | Deliberately two purpose-specific tables with identical hygiene; unifying them is churn on the auth hot path for zero behavior. |
| Login UX states (resend timer, expired, invalid, too-many) | **KEEP** | Shipped (`/login` two-step, humane copy, generic verify error). |

### Brief §5 · Roles — see §1.2 (declined) and §3 (matrix)

### Brief §6, §12 · Player profile & progressive profiling

| Ask | Verdict | Why |
| --- | --- | --- |
| Dedicated player-profile domain | **NEW — the centerpiece** | `player_profiles` (person-scoped, 1:1 `people`): durable sports identity + prefill source. Registrations remain the per-edition snapshot (immutability, DPDP retention, zero auction impact). Design in 03 §3. |
| Identity fields (display name, photo, gender, DOB, location) | **EXTEND + NEW** | Name/photo stay on `people` (existing consent machinery). Gender/DOB/location land on `player_profiles`. |
| Sports fields (role, styles, jersey) | **EXTEND** | Same enums as `packages/core/player-profile.ts`; profile holds defaults, registration holds the per-season fact. |
| Secondary sports, height/weight, dominant hand | **DECLINED (v1)** | Cricket-only platform (roles enum, DLT templates, product copy). Multi-sport is a platform pivot, not a profile column. Height/weight fail DPDP data-minimalism with no consuming feature. |
| Auction fields on profile (base price, eligibility, sold history) | **KEEP where they are** | Base price is an organizer/auction-config concern (bands per season); sold history is a **read model** over `lots` (NEW reader, no new writes — §brief 13 below). Putting money columns on a profile would violate C-9 (derived money, never stored). |
| Profile completeness computed + "missing" list | **NEW** | Pure core function over people+profile (03 §5); surfaced on `/home` and `/account`. Derived every read — no stored percentage (house rule: derived state). |
| Don't block signup on history | **KEEP** | Already the shipped philosophy. |

### Brief §7 · Gender

| Ask | Verdict | Why |
| --- | --- | --- |
| Explicit, consistent gender model | **NEW** | `gender` on `player_profiles`: `male \| female \| non_binary \| self_described \| unspecified` + optional `gender_self_described` text. Optional always; never inferred; never an authz input; **not public by default** (DPDP minimalism; C-23 spirit; same suppression discipline as minors' ages). |
| Competition-level gender category | **NEW** | `competitions.entry_category`: `open \| men \| women \| mixed` (default `open` — matches every existing row). Terminology surfaces on public pages ("Women's", "Open"). |
| Centralized eligibility (no scattered `if gender===`) | **NEW** | The eligibility engine (03 §6) is the single evaluator; UI and server both call it. |

### Brief §8 · Team history

| Ask | Verdict | Why |
| --- | --- | --- |
| No comma-separated history | **KEEP** | Nothing of the sort exists; membership is relational already. |
| `TeamMembership` entity | **DECLINED as a write table → NEW read model** | Squad membership **is** `registrations.team_id`, written transactionally by the certified auction sale path and compensated on undo. A parallel membership table would be a second source of truth inside a frozen, certified boundary — the exact failure 0034's header warns about. Career team history = a **projection**: `registrations × teams × competitions (× tournaments)` per person — already immutable (withdrawn rows retained, reinstated not duplicated), already indexed (`registrations_person_idx`). |
| Roles (captain/vice/coach), jersey, dates | **KEEP** | `is_captain` (DB-unique per team), `is_vice_captain`, `jersey_*` exist per-registration; `coach_name` on teams; dates come from the competition. |
| Never delete historical memberships | **KEEP** | Registrations are never deleted; auction events are append-only. |
| Durable team identity across seasons | **NEW (small, optional phase)** | Mirror the proven 0019 pattern: `franchises` (org-scoped durable name) + nullable `teams.franchise_id`; `cloneCompetition` links clones. Enables "Team A 2021–present" grouping exactly as `tournaments` did for editions. Deferred to Phase 6 — the career page works without it (grouping by name+org as interim). |

### Brief §9 · Tournament history

| Ask | Verdict | Why |
| --- | --- | --- |
| Tournament entity | **KEEP** | `tournaments` (durable) ← `competitions` (editions) shipped in 0019. |
| `TournamentParticipation` entity | **KEEP — it's `registrations`** | Person × edition × role × status (`REGISTERED/PARTICIPATED/WITHDRAWN` map onto `submitted/approved/withdrawn`; `DISQUALIFIED` maps onto `rejected:ineligible`). Immutable/auditable already. NEW is only the career *reader*. |
| Sport/gender on tournament | **NEW (competition-level)** | `entry_category` above; sport stays implicit-cricket (see §6 decline). |

### Brief §10–11 · Profile UI & registration flow

| Ask | Verdict | Why |
| --- | --- | --- |
| Player profile page (header/summary/team/tournament/auction history/stats) | **NEW surface** | "My cricket" career page + organizer person-view + (consent-gated) public career section. Screen map in 03 §8. Uses existing card/table conventions; responsive per shipped 320–1920 certification. |
| Multi-step registration | **KEEP + EXTEND** | 3-step wizard with drafts exists. EXTEND: prefill from `player_profiles`; write-back on submit ("remember for next time"); photo step already exists. |
| "Have you played teams/tournaments before?" self-added history | **DEFERRED (explicit)** | Self-attested career entries are a different trust class from platform-recorded history. Mixing them un-labeled would corrupt the career page's honesty (house content rule: no unevidenced claims). If wanted later: separate `career_claims` table, always labeled "self-reported", never merged into recorded history. Not in PI-1's critical path. |
| Search existing entity / create if permitted | **KEEP (organizer-side)** | Import + add-by-phone already dedupe against `people` by verified phone (doc 38's "the hard problem, designed day one"). |

### Brief §13 · Auction domain

**KEEP, in totality.** Frozen, certified (IP-4), and it already exceeds the
brief: the brief's `PlayerAuctionEntry` ≙ `lots` (base price, category-via-
band, status, sold price, sold-to via paddle→team); statuses map
(`DRAFT/SUBMITTED/APPROVED` live on registrations; `ELIGIBLE` = approved ∧
¬icon ∧ intake closed; `IN_AUCTION` = on_block/closing_soon; `SOLD/UNSOLD/
WITHDRAWN` exact). History is preserved by construction (append-only events,
regenerated ledger). The only NEW is the cross-competition **auction history
reader** for the career page — a read model over
`lots × auctions(status≠abandoned) × registrations`, wearing the
already-documented abandoned-auction guard from `myRegistrations`.
**No writes to any auction table. No engine changes. No config changes.**

### Brief §14 · Eligibility engine

**NEW** — `packages/core/src/eligibility.ts`, pure, structured reasons
(house pattern: `auctionReady` checks, `publishBlockers`, bid gauntlet).
Registration-time checks: intake open, duplicate, minor-consent, gender
category vs profile, (optional per-competition) age bounds. One evaluator;
frontend displays, backend decides — enforced by calling it inside
`submitRegistration`. Detail in 03 §6.

### Brief §15–16 · Validation & database principles

| Ask | Verdict | Why |
| --- | --- | --- |
| Schema-based validation everywhere | **KEEP house style** | Env is zod; action input is manual + pure-core validators with ~1 400 tests. Retrofitting zod across 27 action modules is churn with no defect evidence. PI-1's new inputs get pure-core validators + tests in the established shape. |
| Date-range and duplicate rules | **KEEP + EXTEND** | Duplicates: DB-unique + reinstatement logic exist. EXTEND: DOB sanity bounds (not future, ≥1900) in the profile validator. |
| Normalized design, FKs, indexes | **KEEP conventions** | House deliberately declares no FK constraints (bare ULID columns + app/RLS discipline) — PI-1 follows suit. New indexes: `player_profiles.person_id` unique; the career reader rides existing `registrations_person_idx`. |
| Migrations, no destruction | **KEEP** | Hand-authored additive SQL, journal-`when` bump convention, forward-only (04 §2). |

### Brief §17–18 · Security & audit — **KEEP + EXTEND** (audit gaps; signup
consent record; threat-model delta in 04 §1). CSP script-src remains a
tracked platform follow-up outside PI-1's blast radius.

### Brief §19–20 · Admin & search

| Ask | Verdict | Why |
| --- | --- | --- |
| Admin users/players/teams/tournaments/auctions/roles/audit | **KEEP** | All exist read-only with URL-driven search/filter/cursor pagination; read-only is machine-enforced. |
| Player filters (gender, completeness, team, status…) | **EXTEND (small)** | Add profile-aware filters to `/admin/users` and the organizer registration dashboard's existing filter set. Server-side, URL-driven, as shipped. |
| Public player search | **DECLINED** | C-23 + noindex player pages: people are not a public directory. Search stays scoped to organizer (their competitions) and platform admin. |
| Composable filters, server-side | **KEEP** | The `/c` directory and admin panels already model this. |

### Brief §21–27 · UX, a11y, API, notifications, state machines, edge cases, performance

**KEEP.** Every enumerated principle is already house law with enforcement:
list/form states (primitives + e2e), a11y (axe in 20 specs, 44 px targets,
contrast measured in-browser, reduced-motion grammar), API boundaries
(server-action modules per domain ≙ the brief's service list), notification
abstraction (ports + 4-layer gate), explicit state machines with guarded
transitions (registration/competition/auction/lot/bid), soft-delete-by-
status + append-only history, derived-not-stored aggregates, server-side
pagination. PI-1 adds its pieces *inside* these conventions. The edge-case
list in brief §26 maps almost one-to-one onto existing tested behavior
(duplicate registration → reinstate; deleted-team history → teams are never
deleted, auction events immutable; suspended player ≙ rejected/withdrawn;
profile changes after auction entry → snapshot semantics make this a
non-event). New edge cases PI-1 owns: profile edit vs. historical snapshot
(03 §3), gender category mismatch (03 §6), career page across abandoned
auctions (handled), erasure vs. career history (04 §1).

### Brief §28 · Testing — **KEEP + EXTEND**: each phase lands with core unit
tests, web regression (real PG), and e2e journeys in the existing harness
(04 §3).

---

## 3 · RBAC matrix (brief roles → existing model)

Enforcement never references role names (C-8); this maps the brief's
vocabulary onto what grants/gates actually decide.

| Brief role | Existing mechanism | Capabilities that decide |
| --- | --- | --- |
| VISITOR | No session; public shell | Public read models only (`visibility="public"`, spectate/board) |
| USER | Session (`people` row) | Own account, own registrations, own inbox |
| PLAYER | Session + `registrations` rows (self-scoped) | Own registration status page, own career (NEW), self photo upload |
| TEAM_MANAGER | Org grant `org:staff` | `team.manage`, `registration.review`, `fixture.manage`, … |
| TEAM_OWNER | `auction_owner_invites` → `paddle_grants` → `paddles` (+ viewer membership) | Bid via held paddle; own-team money/roster sight |
| TOURNAMENT_ORGANIZER | Org grant `org:owner` | All 16 org capabilities incl. `competition.create`, `grant.issue` |
| AUCTION_ADMIN | `auction.conduct` / `auction.override` (held via owner or bespoke set) | Cockpit, gavel, overrides, ledger, replay |
| (money officers) | `settlement:officer/controller`, `finops:clerk/accountant/controller` | Settlement console, finance desks |
| ADMIN / SUPER_ADMIN | `platform:admin` (+ `platform:billing`, `platform:demo`) — singleton scope, system-pool-seeded, unforgeable via RLS | Read-only platform console; pass desk is the one write |

PI-1 adds **no new capability sets**. The player's surfaces are self-scoped
by identity (doc 37: "players are subjects with a window, not operators");
the career page needs a session, not a grant.
