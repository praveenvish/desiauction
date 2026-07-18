# PRA-1 · 01 — Product Inventory

> Zero-assumption audit, 2026-07-16. Every entry verified against repository files.
> Milestone names, certification reports, and architecture documents were ignored;
> only code, routes, and assets count as evidence.

## 1. Web pages (apps/web/src/app)

The entire user-facing product is **20 routed pages**. There is no other UI.

| # | Route | What it actually is | Auth | Evidence |
|---|-------|--------------------|------|----------|
| 1 | `/` | **Engineering placeholder** — renders "DesiAuction NEXT / Engineering foundation · version dev". Not a landing page. | Public | `apps/web/src/app/page.tsx:5-13` |
| 2 | `/login` | Phone-OTP sign-in + passkey sign-in. Two-step form (phone → code). | Public | `login/page.tsx`, `login/login-form.tsx` |
| 3 | `/account` | Session card (phone, name, sign out) + passkey enrollment/rename/remove + active-session revocation. **Zero outbound links** — a signed-in dead end. | Session | `account/page.tsx` (no `href=` anywhere in it) |
| 4 | `/orgs` | List my organizations + create-org form. | Session (renders for anon but lists nothing) | `orgs/page.tsx` |
| 5 | `/org/[slug]` | Org home: members list, capability badges, invite-link creation. | Session + membership | `org/[slug]/page.tsx`, `members-panel.tsx` |
| 6 | `/org/[slug]/venues` | Venue + ground CRUD. | Session + membership | `org/[slug]/venues/venues-panel.tsx` |
| 7 | `/competitions` | My competitions grid + organizer schedule + create form. Redirects anon → `/login`. | Session | `competitions/page.tsx:22-24` |
| 8 | `/competitions/[slug]` | Competition console: lifecycle status advance, teams panel, registration triage, shareable registration URL. | Session | `[slug]/competition-panel.tsx:98-169` |
| 9 | `/competitions/[slug]/register` | Player self-registration. Captures **playing role only** — no name, no anything else. | Session (redirects with `next=`) | `register/page.tsx:14-16`, `register-form.tsx:25-36` |
| 10 | `/competitions/[slug]/registrations` | Registration ops console: stat row, search/sort, pagination, bulk approve/waitlist/reject, CSV import (paste + file) with preview/commit, CSV export, timeline, duplicate flags. | Session + capability | `registrations/dashboard-panel.tsx` (656 lines) |
| 11 | `/competitions/[slug]/fixtures` | Fixtures console: generate, schedule-all, publish-all, conflicts panel, manual add, search, CSV import/export, timeline. | Session + capability | `fixtures/fixtures-panel.tsx` (825 lines) |
| 12 | `/competitions/[slug]/fixtures/calendar` | Calendar view of fixtures. | Session | `fixtures/calendar/page.tsx` |
| 13 | `/competitions/[slug]/fixtures/match-day` | Match-day operations view. | Session | `fixtures/match-day/page.tsx` |
| 14 | `/competitions/[slug]/auction` | Auction hub: status, links to live/cockpit, readiness. | Session | `auction/page.tsx` |
| 15 | `/competitions/[slug]/auction/live` | Live room: current lot, countdown, bid buttons (next-increment + custom), bid history, paddle claim, inline conduct panel. | Session | `auction/live/live-panel.tsx` |
| 16 | `/competitions/[slug]/auction/cockpit` | Auctioneer console: open auction, queue lots, gavel, freeze, undo, pause/resume, recover, complete, owner invites, paddle grants, purse table. | Session + conduct capability | `auction/cockpit/cockpit-panel.tsx` (396 lines) |
| 17 | `/competitions/[slug]/auction/spectate` | Read-only spectator view over the snapshot WebSocket. **Public — no session gate.** | Public | `auction/spectate/page.tsx` (no `currentSession`) |
| 18 | `/competitions/[slug]/auction/replay` | Auction replay. | Session | `auction/replay/page.tsx` |
| 19 | `/competitions/[slug]/auction/ledger` | Read-only human-readable auction event ledger. | Session | `auction/ledger/page.tsx` |
| 20 | `/competitions/[slug]/auction/engine` | Engine diagnostics panel. | Session | `auction/engine/page.tsx` |
| 21 | `/join/[token]` | Accept org invite (preview + accept button). | Session (redirects with `next=`) | `join/[token]/page.tsx` |
| 22 | `/owner-join/[token]` | Accept team-owner invite → redirects to live room. | Session | `owner-join/[token]/page.tsx` |
| 23 | `/gallery` | Design-system demo (primitives, motion, identity). **Not environment-gated — reachable in production.** | Public | `gallery/page.tsx` (no `NODE_ENV` check) |
| 24 | `/dev/inbox` | Dev-only OTP inbox reading `otp_inbox` table. 404s outside development. | Public in dev only | `dev/inbox/page.tsx:20-22` |

## 2. Layouts, error and loading surfaces

- **One layout**: `apps/web/src/app/layout.tsx` — global CSS + `<title>DesiAuction</title>`. No nav, no header, no footer, no theme toggle.
- **Zero `error.tsx`, `not-found.tsx`, `loading.tsx` files anywhere** (verified by `find`). Unhandled failures and 404s render Next.js default screens.
- **No `middleware.ts`** — auth gating is per-page only.

## 3. API endpoints

| Endpoint | App | Purpose | Evidence |
|----------|-----|---------|----------|
| `GET /healthz` | web | Health check | `apps/web/src/app/healthz/route.ts` — **the only route handler in the web app** |
| `GET /healthz` | engine | Health check | `apps/engine/src/server.ts:159` |
| `POST /command` | engine | Auction commands (shared-secret) | `server.ts:172` |
| `GET /diagnostics/:auctionId` | engine | Diagnostics | `server.ts:203` |
| `GET /snapshot/:auctionId` | engine | Snapshot | `server.ts:222` |
| `POST /admin/reset` | engine | Dev-only reset (404s in production) | `server.ts:240-243` |
| `WS /ws` | engine | Snapshot fan-out | `server.ts:255-256` |

There is **no public REST API, no inbound webhook endpoint** (the Razorpay webhook verifier in `apps/web/src/server/settlement/webhook.ts` has no HTTP route), and no outbound webhooks. All web mutations are Next.js server actions.

## 4. Background jobs

- **finops-runner** (`apps/finops-runner/src/index.ts`): poll loop — event follower, job queue, daily reconciliation and year-end triggers. Deployable (Dockerfile + fly.toml) but consumes/produces data no screen displays.
- No other scheduled work exists (no cron in web or engine).

## 5. Forms

Login (phone, code), create org, invite member, create venue/ground, create competition, add team, player registration (role select only), registration verify/bulk actions, CSV import (registrations, fixtures), fixture generate/manual add, bid custom amount, owner invite, paddle grant/claim, passkey rename. **No form anywhere captures a person's display name** — see 06_CONTENT_AUDIT §4.

## 6. Emails, SMS, notifications

- **SMS**: interface only. The sole implementation writes codes to a DB table rendered at `/dev/inbox` (`apps/web/src/server/auth/otp-sender.ts:10-16`), and it is hard-wired: `const sender = new DevInboxSender(db)` (`auth/actions.ts:77`). **No real user can receive a login code.**
- **Email**: zero email code, zero templates in the entire repository.
- **WhatsApp**: none.
- **In-app notifications**: finops has an "in-app" delivery adapter that writes dispatch rows (`packages/financial-operations/src/server/adapters.ts:22`), but **no screen reads them**. There is no notification UI of any kind.

## 7. Design system (packages/ui)

10 primitives (Button/ButtonLink, Badge, Card, Money, Skeleton, EmptyState, Field/Select, Tabs, Dialog, Toast), identity components (PlayerImage, PlayerCard, branded placeholder generator), live announcer, hold-gate motion hook, two themes (daylight/floodlight), Clash Display font. Evidence: `packages/ui/src/index.ts`.
Notable: **Skeleton and Dialog are used only in `/gallery`** — no product screen uses either.

## 8. Assets and web presence

- **No `apps/web/public/` directory exists.** Therefore: no favicon, no logo file, no robots.txt, no sitemap, no web manifest, no OG/social-preview image, no touch icons. Verified by `find` (zero matches for `favicon|robots|sitemap|manifest|*.ico`).
- Global metadata is title + description only (`layout.tsx:9-12`). No OpenGraph, no twitter card, no canonical URLs.
- No analytics of any kind (zero matches for posthog/plausible/gtag/mixpanel/amplitude in `apps/web/src`).
- Sentry is wired for error tracking (`apps/web/src/instrumentation.ts`) — DSN unset by default.

## 9. Marketing / legal / help pages

**None exist.** No landing content, features, pricing, about, contact, FAQ, blog, careers, terms of service, privacy policy, cookie policy, or help documentation. The billing model and pricing tiers are fully *designed* in `docs/45-billing-model.md` but have **zero implementation** — no pass/entitlement/pricing tables in the schema (`packages/db/src/schema.ts` — 43 tables, none commercial-platform-side).

## 10. Backend capabilities with no product surface (headless)

| Capability | Code | UI | HTTP |
|------------|------|----|------|
| Settlement (cases, obligations, collections, payments, journal, checkpoints, closure ceremony, recovery) | `packages/settlement/*`, `apps/web/src/server/settlement/*` | **None** — consumed only by `scripts/seed-demo.ts`, perf scripts, and tests | None |
| Razorpay gateway adapter | `server/settlement/adapters/razorpay.ts` | None | **No webhook route; no API keys in `env.ts`** |
| FinOps (profiles, series, receipts/tax-invoices/corrections, dispatch, CSV register + Tally XML exports, fiscal periods, jobs) | `packages/financial-operations/*` | **None** | None (documents land in-app-table or filesystem outbox) |
| Audit log | `schema.ts:139` | None | None |

## 11. Database

43 tables (`packages/db/src/schema.ts`): identity (people, sessions, otp, passkeys), authz (grants, invites, audit), org (organizations, members, venues, grounds), competition (seasons, competitions, teams, registrations, fixtures), auction (auctions, paddles, lots, bids, events, owner invites, paddle grants), settlement (events, cases, obligations, journal postings/legs/checkpoints, payments), finops (events, profiles, series, documents, dispatches, exports, periods, period-days, cursors, jobs, schedules).

## 12. Test surface

15 Playwright e2e specs / 44 tests covering login, passkeys, orgs, competitions, registration ops, fixtures, auction foundation, live auction, conduct/ceremony, plus design-system specs. Settlement and finops have vitest regression suites only — consistent with having no UI to drive.
