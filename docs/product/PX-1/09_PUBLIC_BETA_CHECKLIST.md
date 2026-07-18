# PX-1 · 09 — Public Beta Checklist (definitive)

> The gate for PX-12c. Every box verified on **production infrastructure**, not locally.
> Owner: E = engineering · F = founder · J = joint.

## Brand & Marketing
- [ ] E Wordmark/favicon/OG assets live (04 §2); link previews verified on WhatsApp + X
- [ ] E Landing (P-01) + pricing (P-02) live with 05 copy verbatim
- [ ] F One real product film/still set on landing (real auction footage or staged demo night)
- [ ] J Beta banner + "free during beta" promise consistent across landing/pricing/terms

## Legal
- [ ] F Terms, Privacy, Refunds ratified by counsel (skeletons: 05 §9)
- [ ] E Consent line on registration + login ("By continuing you agree…")
- [ ] E Data-deletion request path documented in privacy policy and /help
- [ ] F SMS sender ID + DLT registration (India) completed for the OTP/notification templates

## SEO
- [ ] E robots.txt, sitemap.xml, canonical URLs, per-page metadata; Lighthouse SEO ≥ 90
- [ ] E `/c/[slug]` public pages indexed (competition discoverability) — others noindex where private

## Authentication
- [ ] E SMS OTP delivery <15s p95 on production; circuit breaker drill passed (PX-3)
- [ ] E Passkeys verified on production domain (RP_ID/RP_ORIGINS)
- [ ] E Name gate: zero nameless sessions possible; legacy sessions migrated on next login
- [ ] J Lost-phone recovery runbook published in /help (manual process is acceptable; undocumented is not)

## Navigation & Shell
- [ ] E Every page in 02 reachable in ≤3 clicks from its shell; no dead ends (automated link crawl)
- [ ] E Branded 404/error/loading live; error page shows support digest id

## Organization / Competition / Registration / Fixtures
- [ ] E J1 + J3 e2e green on production build under `desiauction_app` role
- [ ] E Public competition page leaks no private data (test-asserted)
- [ ] E CSV import/export round-trip verified on production

## Auction
- [ ] E Live + conduct + ceremony e2e green on device projects (iPhone/Pixel) against production build
- [ ] E Recovery drill on staging: kill engine mid-lot, room recovers, ledger intact
- [ ] E Spectate public path load-tested (see Performance)

## Settlement & Receipts & Finance
- [ ] E Officer journey (P-26 AC) green on production; my-money reconciles to the paise
- [ ] E Receipt: issue → dispatch → inbox → download, end-to-end on production
- [ ] E Tally XML opened successfully in Tally once (manual, recorded)
- [ ] E Capability matrix test: every settlement action forbidden without its grant
- [ ] J Razorpay stays OFF (flag) unless one live staging transaction has passed (order→webhook→capture→discharge)

## Reports
- [ ] E Results page (P-28) public-safe and correct against demo seed

## Support & Help
- [ ] E 10 help articles live with production screenshots; Forbidden states deep-link articles
- [ ] F Support channel (email + WhatsApp) staffed; response SLA stated on /contact
- [ ] J Beta feedback loop: feedback link in shell footer → tracked queue

## Deployment
- [ ] F Fly/Vercel/Postgres(Mumbai, PITR)/S3/domains/TLS provisioned
- [ ] E Three services deployed (web/engine/runner); four-role DB recipe applied; `rls:verify` green **on production**
- [ ] E Durable artifact store (S3) wired for exports/documents (filesystem outbox is dev-only)
- [ ] E Rollback: previous-image redeploy drilled on staging

## Monitoring & Backups
- [ ] E Sentry DSNs live (web+engine); alert on silence: runner tick age, follower lag, missed backup, engine healthz (checklist §4)
- [ ] E Alert-validation drill: kill staging runner → page fires
- [ ] E PITR verified + one timed restore drill against RTO; `db:restore-verify` scheduled nightly

## Analytics
- [ ] E Privacy-sane product analytics on the activation funnel (signup→org→competition→registration_open→auction completed→case closed)
- [ ] E Error-rate and Web Vitals dashboards

## Accessibility
- [ ] E axe: zero serious violations on all shells + one page per section
- [ ] E Keyboard-only pass of J1/J4/J5; live announcer verified with VoiceOver once

## Performance
- [ ] E Staging perf at checklist-§6 scale (1000 players / 5000 registrations / 100 bidders / 1000 spectators) on production hardware, numbers recorded in reissued PRP-1
- [ ] E Web Vitals: LCP <2.5s on landing + /home at p75 (4G mid-tier device)

## Security
- [ ] E All ☐E items of docs/operations/PRODUCTION_CHECKLIST.md §1 closed (role flip done)
- [ ] E Secret rotation drill re-run on production credentials
- [ ] E OTP + settlement wrappers rate-limit/abuse review (limits already in `otp.ts`; verify under load)

## Mobile
- [ ] E 360px sweep: zero horizontal scroll product-wide (Cockpit exempt to 768px)
- [ ] E PWA manifest + icons; add-to-home-screen verified on Android

## The gate
- [ ] J Production smoke: one full founder scenario (login → org → competition → registration → auction night → settle → receipt in inbox → download) executed by someone **outside engineering**, unassisted, screen-recorded
- [ ] J PRP-1 reissued with measured production numbers and an explicit **GO**
