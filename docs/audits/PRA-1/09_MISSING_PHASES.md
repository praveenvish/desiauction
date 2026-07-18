# PRA-1 · 09 — Missing Program Phases

> The engineering roadmap (IP-0…IP-6) built inward-facing capability layers.
> Entire *product* phases were never scheduled. Listed in dependency order.

## MP-1 · Provider Integration ("Make it real")
- **What**: SMS OTP adapter (the port exists — `otp-sender.ts`), email provider, WhatsApp BSP, Razorpay wired end-to-end (instantiate adapter from env, add the webhook `route.ts`, add keys to `env.ts`).
- **Why missing hurts**: login itself is impossible for a real user; every message and payment is fictional.
- **Priority**: P0 — nothing customer-facing works without it.
- **Depends on**: founder accounts/credentials (already itemized in `docs/operations/PRODUCTION_CHECKLIST.md` §3).

## MP-2 · Product Shell & Onboarding
- **What**: navigation system (docs/16 exists as spec), authenticated home/dashboard, profile (name/photo), 404/error/loading routes, welcome flow, confirmation dialogs.
- **Why**: 17 built features are currently undiscoverable; accounts are nameless.
- **Priority**: P0.
- **Depends on**: nothing — pure product work on existing foundations.

## MP-3 · Money Surfaces (Settlement & FinOps product)
- **What**: post-auction settlement console (obligations, record collections, discharge), owner "what I owe / my receipts" view, documents viewer + download, export delivery (the artifacts already generate).
- **Why**: the brand promise ("receipts are already done" — docs/01) is unfulfillable; money closes off-platform in WhatsApp, exactly the world the product claims to replace.
- **Priority**: P0 for beta credibility (manual methods first; Razorpay checkout can follow).
- **Depends on**: MP-2 (somewhere to put it), MP-1 for delivery channels.

## MP-4 · Communications & Notifications
- **What**: transactional messages (registration outcome, owner invite, auction start, receipt delivery), in-app inbox rendering the already-written dispatch rows, notification preferences/consent.
- **Priority**: P1 (beta can limp with in-app only; SMS/WhatsApp for GA).
- **Depends on**: MP-1.

## MP-5 · Public Web & Commercial
- **What**: landing, features, pricing (public per invariant 27), about/contact, terms/privacy/refund policy, SEO assets (favicon/robots/sitemap/OG), analytics + consent; then billing: pass purchase, entitlement enforcement, invoices (docs/45–46 are complete specs with zero code).
- **Priority**: P1 for public beta (site + legal + free tier); billing may be feature-flagged until GA.
- **Depends on**: MP-1 (Razorpay) for paid passes.

## MP-6 · Platform Administration & Support
- **What**: founder/admin console (tenants, usage, health, audit viewer), support playbooks, help center, contact channel, status page.
- **Priority**: P1 — you cannot invite 100 customers you cannot see or help.
- **Depends on**: MP-2 shell patterns.

## MP-7 · Mobile & Live-Room Hardening
- **What**: responsive pass on live/spectate/register/join, device-emulation e2e projects, phone-first ceremony QA; PWA/manifest.
- **Priority**: P1 — auction night is a phones event by the product's own vision.

## MP-8 · Reports & Season Outcomes
- **What**: results/standings, season summary, post-auction squad pages, org-level reporting.
- **Priority**: P2 (beta), P1 (GA).

## MP-9 · Customer Success & Lifecycle
- **What**: onboarding sequences, activation metrics, product analytics instrumentation (zero exists), feedback capture, churn/renewal loops (pass repurchase).
- **Priority**: P2.

## MP-10 · Enterprise/Association
- **What**: association bundles (docs/45), delegation presets, multi-tournament reporting, SSO story (today: phone OTP only), public API + outbound webhooks (docs/50 spec exists).
- **Priority**: P3 — post-GA lane.

## What was NOT missing (credit where verified)

Engineering-operations phases usually absent at this stage exist here: deploy
workflows, images, runbooks, backup/restore drills, RLS enforcement, nightly
verification. The missing phases are uniformly on the **product, commercial, and
communication** side — the roadmap optimized for "can it be true" and never
scheduled "can it be found, bought, and used."
