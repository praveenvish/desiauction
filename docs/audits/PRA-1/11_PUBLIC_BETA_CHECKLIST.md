# PRA-1 · 11 — Public Beta Checklist

> Gate: every item checked, verified on production infrastructure, before any
> public invitation. Items marked ⚙ have partial code today; ⬜ are greenfield.

## A. Existence (can they reach it?)

- [ ] ⚙ Deployed to production domain with TLS (artifacts/workflows exist; never run)
- [ ] ⬜ Real landing page replaces the engineering placeholder at `/`
- [ ] ⬜ Pricing page (Free tier honest, public per invariant 27)
- [ ] ⬜ favicon, robots.txt, sitemap, OG image, web manifest (`public/` dir currently absent)
- [ ] ⚙ `/gallery` env-gated out of production; `/dev/inbox` verified 404 (already gated)

## B. Entry (can they get in?)

- [ ] ⬜ SMS OTP provider adapter live (+ circuit breaker) — **the #1 blocker**
- [ ] ⚙ Passkey RP_ID/RP_ORIGINS set to production domain (env exists; values founder-held)
- [ ] ⬜ Name captured at first sign-in; no nameless accounts possible
- [ ] ⬜ Account recovery path for lost phone documented (even if manual)

## C. Wayfinding (can they find anything?)

- [ ] ⬜ Global navigation shell; authenticated home replaces the `/account` dead end
- [ ] ⬜ `not-found.tsx`, `error.tsx`, `loading.tsx` at root (branded, with a way home)
- [ ] ⬜ Public competition page hosting register + spectate links

## D. Core loop (can they succeed?)

- [ ] ⚙ Org → competition → registration → fixtures → auction on production (built; must be smoke-run on prod infra)
- [ ] ⬜ Registration outcome notification (at minimum in-app + SMS)
- [ ] ⬜ Post-auction: organizer settlement console (record manual collections)
- [ ] ⬜ Owner "what I owe / receipts" page; receipt document downloadable
- [ ] ⬜ Mobile: live room, spectate, register pass a phone-device e2e project

## E. Trust & legal (can you defend it?)

- [ ] ⬜ Terms of Service, Privacy Policy, refund policy pages
- [ ] ⬜ Consent for SMS; data-deletion request path
- [ ] ⚙ Production RLS role flip executed + `rls:verify` on prod (certified locally only)
- [ ] ⚙ Backups verified on managed Postgres + one restore drill on staging (script exists: `db:restore-verify`)

## F. Operations (can you keep it alive?)

- [ ] ⚙ Sentry DSNs live on web+engine; alerts page a human (alerting ⬜)
- [ ] ⬜ Dashboards: engine health, bid-ack p95, runner tick age, DB connections (checklist §4 list)
- [ ] ⚙ Staging perf run at 100 bidders / 1000 spectators (scripts exist: `perf:*`; never run on prod-like hardware)
- [ ] ⬜ Support channel published (email/WhatsApp) + help center with ≥10 articles
- [ ] ⬜ Platform admin view: tenant list, usage, recent errors

## G. Measurement (will you learn anything?)

- [ ] ⬜ Product analytics on the activation funnel (signup → org → competition → registration open → auction complete)
- [ ] ⬜ Feedback affordance in-product

**Current state: 0 of 31 items fully done; 8 partially (⚙).**
The repo's own `docs/operations/PRODUCTION_CHECKLIST.md` corroborates sections A/B/E/F
from the infrastructure side; sections C, D(2–5), and G exist in no internal document —
they are the product gaps this audit adds.
