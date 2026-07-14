# COMPETITION DPDP REVIEW

## DesiAuction NEXT · v1.0 · 2026-07-14 · CTO · **Permanent engineering asset** (IP-3, M-IP3-4)

> Extends the frozen [identity data inventory](../identity/DPDP_DATA_INVENTORY.md) with
> the Competition subsystem's personal-data touchpoints. Implemented reality only.

## 1 · What personal data Competition touches

| Data | Where | Why (purpose limitation) |
|---|---|---|
| Person link (`person_id`) | `registrations` | Participation is a relation to the ONE identity anchor — no name/phone duplicated onto competition rows |
| Name + phone (new **person stubs**) | `people` (via registration CSV import) | Organizer-supplied roster entry; phone is the identity anchor (C-24); stubs are unverified until first OTP login |
| Reviewer identity + timestamps | `registrations.reviewed_by/at`, `audit_log.actor` | Accountability for triage decisions (invariant 5: approval is human) |
| Private rejection reason + note | `registrations.rejection_reason/note`, notes in `audit_log.meta` | Organizer dignity rule (invariant 6): category is mandatory, **never rendered to players** |
| Registrations CSV export | generated on demand, not stored | Contains name + phone + role + status; gated by `registration.review`; competition-scoped |

**Not personal data**: venues, grounds, fixtures, schedules, the ScheduleSnapshot and
the fixtures CSV export carry team/ground/time data only — no person fields.

## 2 · Consent & notice

Registration is an affirmative act by an authenticated person (self-service) — the
submission itself is the participation consent. Import-created stubs are entered by the
organizer as data fiduciary for tournament administration; the stub carries no consent
flags (photo consent columns exist on `people` from IP-2 and remain unset until the
person acts). Players see their own status via the person-scoped read policy — access
without exposure of others' data.

## 3 · Access, correction, erasure

- **Access**: a player reads their own registration (status page; RLS person-read
  disjunct). Organizers read only their org's rows (tenancy + RLS).
- **Correction**: identity fields (name/phone) belong to the frozen identity subsystem
  and its processes; registration fields (role, team grouping) are organizer-editable
  and audited.
- **Erasure**: registrations reference — never copy — identity, so identity-level
  erasure procedures (identity inventory §erasure) automatically sever competition
  personal data; `withdraw`/`reject` end participation without destroying tournament
  integrity records. Audit rows keep actor ULIDs, not names/phones.

## 4 · Retention & minimization

Rejection notes are capped (500 chars) and category-first; the dashboard renders the
minimum fields for triage; exports are pull-only (no scheduled dumps, no external
services — everything local-first). No new long-lived personal-data stores were added
by IP-3 beyond `registrations` itself, which is the participation system of record.

## 5 · Open items (carried, not new)

The identity inventory's pre-production items (DPO contact surface, retention automation)
carry unchanged; Competition adds **no new** processors, cross-border transfers, or
external services (verified: zero external requests in any Competition path).
