# PRA-1 · 10 — Product Roadmap (repository → public beta → GA → enterprise)

> A product roadmap, not an engineering one. Each release is defined by the
> customer sentence it makes true. Durations assume the current build velocity
> evidenced by the repo (single team, deep slices).

## R0 · "It exists" — Production foundation (~2–3 weeks, mostly founder-external)

Sentence: *A real person on a real phone can sign in on a real domain.*

1. Founder externals: Fly/Vercel accounts, managed Postgres (Mumbai, PITR), domains/TLS, Sentry DSNs, SMS provider account (checklist §1–§3 already enumerates these).
2. SMS `OtpSender` adapter + send-rate circuit breaker (port exists; this is the one hard blocker in code).
3. First staging + production deploys; four-role DB flip; smoke: OTP login on a stranger's phone.
4. Kill `/gallery` in production (env-gate like `/dev/inbox`); add favicon/robots/basic meta so the domain doesn't look abandoned.

## R1 · "It's a product" — Shell, identity, safety (~3–4 weeks)

Sentence: *A signed-in organizer finds everything without being sent URLs, and every person has a name.*

1. Navigation shell + authenticated home (docs/16 spec → implementation).
2. Profile: name capture at first login (and photo later); backfill prompt for existing nameless accounts.
3. Route-level `not-found.tsx` / `error.tsx` / `loading.tsx`; confirmation dialogs on destructive ops.
4. Landing page, pricing page (Free tier honest), terms + privacy + refund policy, contact.
5. Mobile pass on login/register/join/live/spectate.
6. Product analytics (privacy-sane) + Sentry DSNs live.

## R2 · "The money closes" — Settlement & documents surfaces (~4–5 weeks)

Sentence: *An owner leaves auction night knowing what they owe, and gets a receipt when they pay.*

1. Settlement console for organizers: open cases post-auction, record manual collections (cash/UPI-direct), discharge obligations. (Domain code exists; this is UI + wiring.)
2. Owner money page: obligations, payments, receipts.
3. Documents viewer + downloads (receipts/invoices already generate); in-app inbox rendering dispatch rows.
4. Registration outcome + owner-invite notifications via SMS (channel from R0).
5. Razorpay end-to-end behind a flag: webhook `route.ts`, env keys, one live staging transaction.

## R3 · Private beta — 5–10 hand-picked tournaments (~4 weeks, overlapping R2)

Sentence: *Ten organizers run real auctions; we watch everything.*

- Founder-assisted onboarding; support via WhatsApp group; weekly defect triage.
- Staging perf certification at target scale (checklist §6) before the biggest tournament.
- Exit criteria: 10 completed auction nights, zero money disputes, activation funnel measured, all P0/P1 defects closed.

## R4 · **PUBLIC BETA** (gate: 11_PUBLIC_BETA_CHECKLIST.md all green)

Sentence: *A stranger discovers DesiAuction, signs up, and runs a free tournament unassisted.*

- Free tier only, pass purchase optional/flagged; public pricing visible.
- Help center (10 core articles), support inbox with an SLA you can honor.
- Platform admin console v1 (tenants, usage, health, audit viewer).

## R5 · GA — Commercial launch (~6–8 weeks after beta stabilizes)

Sentence: *Organizers pay for Pro Passes in the product, and the books close themselves.*

- Billing: passes, entitlement enforcement at readiness gate, immutable invoices (docs/45–46 specs), GST display.
- WhatsApp BSP notifications; branded exports; results/standings; season summaries.
- Reliability: alerting/dashboards live (checklist §4), quarterly PITR drill executed.

## R6 · Enterprise / Association (post-GA lane)

- Association bundles, delegation presets, multi-tournament reporting.
- Public API + outbound webhooks (docs/50), audit exports, white-label/sponsor slots (Pro/Association tiers per docs/45).
- SSO only if association procurement demands it — phone OTP is the market-correct default.

## Sequencing rationale

R1 before R2 because *discoverability multiplies everything already built* — it is
the cheapest 10x in the repo. R2 before public beta because the first public-beta
dispute ("I paid, where's my receipt?") attacks the exact promise the product is
named for. Billing last because a free, working, trusted beta earns the right to
charge — and the billing spec (docs/45) is strong enough to build quickly when pulled.
