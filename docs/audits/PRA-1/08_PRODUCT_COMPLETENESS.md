# PRA-1 · 08 — Product Completeness Scores

> 0–100 where 100 = a customer can use the capability end-to-end, unassisted, in production.
> Scores are for the **product**, not the code. Backend depth without a surface scores low by design.

| Capability | Score | Justification (evidence) |
|------------|-------|--------------------------|
| Identity & Auth | **55** | OTP+passkeys+sessions+revocation genuinely built; but OTP undeliverable outside dev (DevInboxSender hard-wired, `auth/actions.ts:77`), no profile/name, no account recovery for a lost phone, no account deletion. |
| Organization | **60** | Create/members/invites/venues work; no settings, rename, delete, member removal, billing, or org reporting. Invite delivery is copy-paste. |
| Competition | **65** | Lifecycle, teams, registration URL work; no edit-after-create, no settings, no delete/archive, no results. |
| Registration | **70** | Ops console is deep (bulk, CSV round-trip, timeline, duplicates); but the player-side form captures only a role, and applicants never hear outcomes (no channels). |
| Fixtures | **65** | Generate/schedule/publish/conflicts/calendar/match-day all real; no scores/results/standings; participant-facing schedule view requires login. |
| Auction | **80** | The deepest slice: cockpit, live bidding, ceremony, undo/freeze/recover, ledger, replay, spectate, owner onboarding — all e2e-tested. Docked for phone-form-factor uncertainty and nameless lots. |
| Settlement | **15** | Complete domain code (cases, obligations, collections, journal, closure) with **zero UI, zero HTTP surface**; Razorpay adapter unwired (no webhook route, no keys in `env.ts`); manual methods only via scripts. |
| Financial Operations | **15** | Documents/dispatch/exports/periods/runner exist as code + a deployable worker; nothing is visible, downloadable, or deliverable to a human. |
| Administration (platform) | **0** | No admin surface, no tenant overview, no support tooling. |
| Reports | **5** | CSV export buttons on two consoles; auction ledger. No reports, standings, or summaries. |
| Marketing website | **0** | Homepage is an engineering placeholder; no pricing/features/about/contact; no SEO assets (no public/ dir at all). |
| Onboarding | **5** | Good empty-state copy is the only onboarding. No welcome flow, no name capture, no guided setup, and a post-login dead end. |
| User Experience (cross-cutting) | **35** | Strong primitives and states inside screens; no navigation, no 404/error/loading routes, no confirmations, hardcoded theme. |
| Mobile | **20** | Two media queries on live surfaces; consoles are desktop tables; no mobile test evidence. |
| Documentation (customer) | **0** | 70+ internal docs; zero customer-facing help. |
| Support | **0** | No contact, help, or status surface. |
| Commercial (billing/passes) | **0** | Fully specified in `docs/45`; zero code, zero schema tables. |
| Notifications & comms | **0** | No SMS/email/WhatsApp integration; in-app dispatch rows have no reader. |
| Security & tenancy (as product trust) | **70** | RLS + roles + audit tables + security events exist and are exercised by tests; scored below 100 because none of it is *visible* to customers (no audit viewer, no security page) and prod posture is unproven (never deployed). |
| Deployment/operability | **40** | Images, workflows, runbooks, health endpoints exist; the product has never run anywhere but this machine (`docs/validation/GO_LIVE_REPORT.md` §1 — verified consistent with repo state). |

## Weighted read

The product is effectively **two products at different maturities**:

1. **Auction-night operator tool** (org → competition → registration → fixtures → auction): ~70/100.
   Usable today by a hand-held pilot customer whose organizer gets URLs from you and
   whose players are CSV-imported.
2. **The trust platform the vision sells** (money beyond dispute → receipts →
   books; discoverable, purchasable, supported): ~10/100. The pipeline dies at the
   gavel; commerce, comms, admin, and marketing are absent.

**Overall product completeness: ~35/100** against the "customer succeeds unassisted" bar.
