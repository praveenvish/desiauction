# FR-01 — FOUNDER EXECUTION RULING · ENGINEERING CONTINUITY
## Recorded 2026-07-13 · includes the IP-0→IP-1 Phase Transition Record

## 1 · The ruling

Issued by the Founder; accepted verbatim. **The one-active-phase rule applies to engineering implementation only.** Founder-owned operational work (accounts, domains, DNS, secrets, production infrastructure, legal, vendor/payment/messaging onboarding) runs as an independent workstream and never idles engineering. Local-first is mandatory: every capability is completed locally when technically possible (Docker PG, MinIO, mock payment/notification providers, dev OTP adapter); cloud services are introduced only to provide production validation. **Gates NOT waived:** Run 2 must pass before any IP-4 engine implementation; production infrastructure validation before Pilot; independent security and money-path reviews stand; no quality gate is removed. Before declaring engineering blocked, the CTO must prove no local equivalent exists (5-question protocol).

## 2 · Revised execution schedule (sequence unchanged)

| Phase | Cloud dependence | Start condition under FR-01 |
|---|---|---|
| IP-1 Design System | zero | **OPEN** (founder command, this record §3) |
| IP-2 Identity/Tenancy | ~zero (dev-inbox OTP, localhost passkeys, local RLS) | at IP-1 freeze |
| IP-3 Competition Core | ~zero (MinIO behind `ObjectStore` port) | at IP-2 freeze |
| IP-4 Auction Engine | **HARD GATE: Run 2 PASS first** | Run 2 during IP-1..IP-3 window |
| IP-5 Experience | staging + OTP provider by mock night | as sequenced |
| IP-6 Money/Messaging | Razorpay test + BSP templates + VA-3 entry gate | as sequenced |
| IP-7/IP-8 | inherently cloud | as sequenced |

Founder operational deadlines derived: ① BSP application = calendar-critical immediately (lead time burns IP-6 runway); ② GitHub+Neon(Mumbai check)+Fly before IP-4 start; ③ OTP provider + staging before the IP-5 mock night.

## 3 · Phase Transition Record

**2026-07-13 · Founder command `OPEN IP-1` executed.**
- **IP-0** archived: **Engineering Complete · Operations Continuing** (ops tail per IP-0_OPS_TRACKER.md; Run 2 gates IP-4; `ip0-frozen` tag follows Run 2 PASS).
- **IP-1 — FLOODLIGHT Design System = ACTIVE ENGINEERING PHASE.** Design: `IP-1_DESIGN.md` (CTO-authorized per Delegation Charter; WI-7 ruled in-phase). Execution: `IP-1_MILESTONE_PLAN.md` v1.1 (five milestones, three-output closure package, complexity-based estimates).
- Environment note (honest record): the transition was executed during a ~2h macOS TCC outage that revoked all Desktop file access; artifacts were drafted in session scratch space and committed here in historical order once access returned. The repository was relocated to `~/dev/desiauction-next` (outside TCC-protected folders) to permanently remove this failure class.
