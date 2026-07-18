# PX-1 · 03 — User Journeys

> Every journey, designed end-to-end. Notation: each step names the screen (from 02),
> the backend call, and the failure branch. Nothing here invents backend behavior —
> every arrow lands on an existing function or a ⚙ wrapper from 02.

## J1 · Visitor → Organizer with a live competition

```
/                     Landing. CTA "Run your auction" → /login
/login                Enter phone → requestOtpAction
                        ✗ cooldown/hourly-limit → inline error, retry timer copy (05 §11)
                      Enter code → verifyOtpAction
                        ✗ wrong/expired → inline error, 5-attempt ceiling honored
  [name gate]         session.name == null → name step → ⚙ updateProfileAction
/home                 Empty state: "Create your organization" → /orgs
/orgs                 createOrgAction → /org/[slug]
/org/[slug]           (optional) createInviteAction → copy /join/[token] link
/competitions         createCompetitionAction → /competitions/[slug]
/competitions/[slug]  advanceCompetitionAction: draft → setup → registration_open
                      createTeamAction ×N · copy registration link + /c/[slug] link
```
**Exit**: organizer has a shareable public page and open registration. Every screen exists in 02; the only new backend is the profile wrapper.

## J2 · Player → Registered, named, informed

```
/c/[slug]             Public page. "Register" → /competitions/[slug]/register
                        (anon → /login?next=…, name gate applies — player is NAMED)
register              registrationLanding → submitRegistrationAction (role select)
                        ✗ closed → registration-closed state with org contact line
Await                 Organizer triages (J3). Outcome dispatch → in-app row
/inbox                "You're approved for MPL 2026" (05 §7 templates)
                        (SMS mirror when PX-3 provider is live)
/c/[slug]             Auction night: "Watch live" → spectate; if sold, results show their team
```
**Failure branches**: invalid slug → branded 404; withdrawn/rejected → dispatch copy states reason category (existing `REJECTION_REASONS`), never free-text shaming (C-23).

## J3 · Organizer → Registration ops → Auction ready

```
/home                 Attention: "12 submitted registrations" → registrations tab
registrations         search/sort/bulk (existing actions) · CSV import round-trip
fixtures              generateFixturesAction → scheduleAllAction → publishAllAction
                        ✗ conflicts → conflict panel items link to offending fixtures
auction hub           createAuctionAction → issuePaddleAction / inviteOwnerAction
                      queueAllLotsAction → readiness list green → "Enter Cockpit"
```
All existing; journey's only delta is navigation (tabs + attention dots).

## J4 · Team owner → Auction night → Paid up

```
/owner-join/[token]   ownerJoinPreview → acceptOwnerJoin → /auction/live
live                  claim paddle (grantPaddleAction by organizer; claim in room)
                      bid → submitAuctionCommand (increments/custom)
                      SOLD ceremony (existing)
/money  (next day)    My money: obligation ₹X for Team Y (⚙ myMoneyView)
  [pays organizer cash/UPI off-app — recorded by treasurer in J5]
/inbox                "Receipt R-000123 issued" → document link
/money                Receipt listed, downloadable (F2 route)
```
**The loop the platform promised, closed with zero new truth.**

## J5 · Treasurer (settlement:officer) → Money beyond dispute

```
/competitions/[slug]/money
  Case stepper        openCase → verifyCase (against auction truth)
                        ✗ discrepant → banner + controller-only exit paths (reopen/void)
                      computeCaseObligations → obligations table renders
  Record collection   createPayment(method=manual:cash|manual:upi-direct|manual:bank)
                      → attestManualCapture (amount, payer, note)
                        ✗ over-collection → writer rejects; UI shows writer's reason verbatim
  Waive (controller)  waiveObligation(reason) — hold-to-confirm (existing useHoldGate)
  Close               readyForClosure → settleCase → closeCase → closureCeremony view
/org/[slug]/money     Documents tab: receipts auto-issued (issueDueReceipts / receiptCandidates)
                      Dispatches: requestDispatch(in-app) per party
                      Exports: requestExport → CSV register / Tally XML → download
```
**Every function named already exists in `server/settlement/writer.ts` and finops server. The journey is UI + capability-gated wrappers.**

## J6 · Finance close (fiscal, org-level) — P2 within beta

```
/org/[slug]/money → Fiscal close tab
  openPeriod → daily attestDay (checklist from operationalChecklistSnapshot)
  noteException (reason) → closePeriod → evidence (composeCloseEvidence)
    ✗ reopenPeriod (controller, audited)
```

## J7 · Spectator → The show

```
/c/[slug] → "Watch live" → /auction/spectate (public, existing)
  post-close → /competitions/[slug]/results (squads, spend)
```

## J8 · Admin (founder) → Platform health

```
/admin                orgs, activity, runner/follower/provider health snapshots
/admin/audit          audit_log filter (P2)
Weekly: /org/*/money health tabs are self-serve; admin only watches aggregates.
```

## J9 · Support agent (beta = founder)

```
Customer reports issue → /help article link (deflection)
  → /admin org lookup → audit trail → resolution
  → known-issue? update /help article (repo PR)
```
No impersonation tooling in beta (deliberate; audited SQL + admin read-views suffice at 10-tenant scale).

## J10 · Sign out / session hygiene

```
avatar → Sign out → logoutAction → /
/account: revoke other sessions (existing revokeSessionAction), passkey lifecycle
```

## Journey coverage matrix

| Directive journey step | Screen | Status after PX program |
|---|---|---|
| Landing | A1 | ★ new |
| Signup/OTP | B1 | Δ (name gate added) |
| Profile | B1/B2 | ⚙ one wrapper |
| Organization | C3/C4 | Δ shell only |
| Competition | C6/C7 | Δ shell only |
| Registration | C8 + A6 | Δ + ★ public page |
| Auction | C10 + D1–D4 | Δ shell only |
| Settlement | E1/E2 | ★ over existing writer |
| Receipts | F1/F2/F3 | ★ over existing finops |
| Reports | E3 | ★ read-only |
| Logout | B2 | ✅ |

Every journey lands only on screens specified in 02 and functions that exist today. No journey requires thawing the backend.
