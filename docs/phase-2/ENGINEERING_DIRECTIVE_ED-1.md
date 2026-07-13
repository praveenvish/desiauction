# ED-1 — FOUNDER ENGINEERING DIRECTIVE
## Enterprise Quality · Startup Infrastructure · Recorded 2026-07-13

## 1 · Directive record

Issued by the Founder as standing engineering philosophy for the remainder of the project. It changes **how infrastructure decisions are made**, not the roadmap, sequence, or architecture. Core rule: **enterprise-grade software, initially on startup-grade infrastructure; when cost and engineering excellence conflict, cost loses.** Non-negotiables (never traded for cost): product quality, UX, architecture, security, data integrity, event sourcing, auditability, performance, accessibility, testing, type safety, reliability, maintainability, DX, code quality, scalability. Optimized instead: cloud spend, operational complexity, vendor count, lock-in, deploy time, onboarding. Scaling ladder: config → vertical → managed → horizontal → architecture; rewrites last. Five-question test for every infrastructure decision (quality preserved? scales without logic rewrites? replaceable without app-code change? DX high? simplest that meets current production need?) — all five must be YES.

## 2 · Impact assessment

**The directive is already substantially encoded in frozen decisions** — no ACR needed, nothing frozen contradicts it:

- *Business logic never depends on a host*: `packages/core` imports **nothing** (lint + dependency-cruiser enforced) — the strongest possible form of the requirement, already live.
- *Deferred-until-evidence tech*: Blueprint §34.1 already rejects k8s, microservices, flag/secret SaaS, self-hosted observability; Canon C-16 already puts the queue on Postgres (no Kafka/Redis cluster); 0A already right-sized load targets; OTel already deferred to IP-4.
- *Scaling ladder*: engine = one Fly machine per env, vertical-first — already the design.
- *Vendor set*: six platforms (GitHub, Vercel, Fly, Neon, Sentry, AWS-S3). Each was re-tested against the five questions: all pass. Cutting any (e.g., engine on a VPS, S3→Fly-local storage) raises ops complexity or breaks DPDP residency — rejected under the directive's own rules.

**Genuine deltas the directive adds (binding henceforth):**
1. **Ports for infrastructure concerns.** Every new infra dependency enters behind an app-level interface with one adapter: `ObjectStore` (S3) in IP-3, `OtpSender`/`Mailer` in IP-2, `Notifier` (BSP) and `PaymentProvider` (Razorpay) in IP-6, `Cache`/`Queue` if/when introduced, `SearchIndex`/`AiProvider` post-GA. Adapters live in apps or a dedicated infra package — never in `core`/`contracts`. DB access stays behind Drizzle within apps.
2. **Five-question test recorded per decision.** Each future `IP-N_DESIGN.md` gets an "Infrastructure decisions" table running the test explicitly.
3. **Cost-tier defaults for account creation** (feeds the live ops tracker): GitHub Free · Vercel Hobby now → Pro at pilot (Hobby's non-commercial limit) · Fly shared-cpu-1x · Neon Free (scale-to-zero) → Launch at pilot · Sentry Free · S3 pay-as-you-go. Expected burn until pilot: **≈ $0–10/month.**

## 3 · Phase-by-phase operational optimizations (sequence unchanged)

| Phase | Recommendation (cost/ops down, quality intact) |
|---|---|
| IP-0 (ops tail) | Free/low tiers per §2.3; turbo remote cache optional (config-only, enable anytime); everything else already minimal |
| IP-1 | Component gallery on Vercel previews (free) — **no Chromatic/visual-regression SaaS** while team = founder+AI; a11y via axe in CI + measured contrast (already the gate) |
| IP-2 | OTP via India DLT-compliant provider chosen on per-SMS price at equal deliverability (MSG91-class ≈ ₹0.15–0.25 vs Twilio ≈ ₹0.5+); **passkeys (already C-24) are the structural OTP-cost reducer** — every passkey login is a free login |
| IP-3 | Image pipeline = S3 originals + Next/Image on-demand transforms (included in Vercel) — no Cloudinary-class service; CDN decision deferred until measured need (already the design) |
| IP-4 | Engine stays 1 machine, vertical-first; no Redis — in-process state + PG projections until a measured limit says otherwise; pg-boss on PG per C-16 |
| IP-5 | No realtime SaaS (Pusher/Ably) — engine ws is the plan; separate fan-out relay only if evidence (RC-5 at scale) demands |
| IP-6 | Razorpay standard rails, no payment-orchestration layer; BSP chosen inside VA-3 on live per-message quotes |
| IP-7 | Backups = Neon PITR + scheduled `pg_dump` to S3 (pennies) — no backup SaaS; status page = static page, not a paid service |
| IP-8 | Load tests with k6 OSS from a rented VM/hour — no load-testing cloud |

## 4 · Safely movable to later (all within-phase deferrals, no resequencing)
Turbo remote cache (whenever) · custom domain (IP-8, already P2) · Sentry paid tier + trace-sample tuning (pilot) · Vercel Pro upgrade (pilot) · Neon paid tier (pilot) · any CDN (IP-3 evidence) · visual-regression tooling (when a second engineer exists).

## 5 · Protected — must remain unchanged (cost pressure rejected here by rule)
TS strict + coverage bars + invariant suite · **independent reviews at IP-2/IP-4** (costs real money; it is a quality control, not an ops cost) · **mock auction night on real phones** (IP-5) · WCAG 2.2 AA · event-sourced ledger on real Postgres in every environment (never SQLite/NoSQL "to save cost") · **S3 `ap-south-1` residency** (DPDP is data-integrity/security — a cheaper non-compliant region is not an option) · staging environment exists (never collapsed into prod) · CI on every PR · backup/restore drills (IP-7) · distroless/non-root + gitleaks.

## 6 · Standing operational guidance for all future phases
Default to the free/lowest tier that passes the five-question test; upgrade on measured evidence, recorded in the phase's GATES entry. New external service ⇒ five-question table in the active phase's design doc + a port/adapter, or it doesn't enter. Scaling requests follow the ladder; the first response to load is configuration, the last is architecture. Cost decisions are logged; quality decisions are never framed as cost decisions.
