# PI-1 · Player Identity, Profile & History

## Architecture review + implementation plan · v1.0 · 2026-08-30 · pre-code deliverable

The brief: a production-grade registration, authentication, player-profile,
tournament-history, team-history, and auction-participation architecture.
Per the engineering rule that governs the brief (its §30), nothing here was
implemented blind — the whole codebase was inspected first, and every proposed
change is classified **KEEP / EXTEND / REFACTOR / REPLACE / NEW** against what
actually exists.

The headline finding: **most of the brief already exists, certified and
frozen.** Authentication, sessions, device management, OTP hygiene, RBAC
(exceeded by grants-not-roles), team/tournament/auction record-keeping,
audit logging, notifications, admin, and the registration wizard are all
built and test-protected. The real gaps are narrow and specific:

1. **No person-level player profile** — sports identity lives per-registration.
2. **No gender model** — zero columns, zero rules, anywhere.
3. **No career read model** — the data for "this person, across seasons" is
   fully present (`registrations_person_idx` exists for exactly this) and no
   surface renders it beyond the private `/home` rail.
4. **No eligibility engine** — the structured-reasons pattern exists in four
   places (auction readiness, publish blockers, bid gauntlet, competition
   transitions) but not for registration eligibility.
5. **No profile-completeness computation** beyond `name + passkey` on /account.
6. Small, named seams: `otp_codes` lacks a `purpose` column; four auth audit
   gaps; the production media signer (D1) is unimplemented.

And one headline refusal: **email + password is declined** (with reasons, not
reflexes) — see 02 §1.

| Doc | Contents (brief §31 outputs) |
| --- | --- |
| [01_CURRENT_ARCHITECTURE.md](01_CURRENT_ARCHITECTURE.md) | Current architecture review · auth review · schema review (outputs 1–3) |
| [02_GAP_ANALYSIS.md](02_GAP_ANALYSIS.md) | Spec-to-reality matrix with KEEP/EXTEND/REFACTOR/REPLACE/NEW verdicts · RBAC matrix (outputs 4, 10) |
| [03_TARGET_DESIGN.md](03_TARGET_DESIGN.md) | Domain model · ERD · auth/registration/OTP flows · profile architecture · team/tournament/auction relationship models · API/module architecture · screen map · state machines · validation rules (outputs 5–9, 11–17) |
| [04_IMPLEMENTATION_PLAN.md](04_IMPLEMENTATION_PLAN.md) | Threat-model delta · migration strategy · testing strategy · phased plan · risks/tradeoffs · definition of done (outputs 18–23) |

Governing decisions honoured throughout: C-24 (phone-first, no passwords —
ever), C-8 (grants, not roles), C-9 (ledger-derived money), C-13 (org_id +
RLS), C-23 (contact details of people are never public), doc 38 ("person ≠
participation"), the IP-4 auction freeze, and the DPDP Act 2023 inventory
(docs/identity/DPDP_DATA_INVENTORY.md).
