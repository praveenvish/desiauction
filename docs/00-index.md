# 00 — Index & Canon

> DesiAuction NEXT Product Operating System · v1.0 · 2026-07-11
> This document is the constitution's table of contents. Every other document must agree with the Canon below. Conflicts are resolved in favour of this file, then fixed at the source.

## The Canon

Ratified cross-cutting decisions. Every document cites these as `C-n`.

| ID | Decision |
|----|----------|
| **C-1** | Product name is **DesiAuction**; this rebuild program is **NEXT**. Brand voice and visual identity are new (06, 07); the name carries. |
| **C-2** | North Star metric: **Trusted Auctions Completed** — auctions run to completion with zero disputes and zero silent failures. Not signups, not MAU. |
| **C-3** | **One truth, five surfaces.** A single server-authoritative Engine feeds five read surfaces: **Console** (organizer), **Cockpit** (live conduct), **Owner Room** (team owners), **Stage** (public), **Overlay** (projector/stream). No surface ever computes money or outcomes. |
| **C-4** | Design language: **FLOODLIGHT** — "calm of the night stand, clarity of the lit pitch." Dark-first on live surfaces (Cockpit, Owner Room, Stage, Overlay); **Daylight** theme is default on Console. Both themes are token-complete; neither is a filter of the other. |
| **C-5** | Colour: **Ink** (dark neutrals) and **Chalk** (light neutrals) scales; **Volt** (electric green) is the single action/live accent; **Gold is earned** — reserved exclusively for the SOLD ceremony and champions, never decorative. |
| **C-6** | Type: **Clash Display** (display/moments), **Geist Sans** (UI/text), **Geist Mono** (money, IDs, ledger). All numerals in data contexts are tabular. |
| **C-7** | Money is stored as **integer paise**, displayed in **Indian notation** (₹1.2 L, ₹1.5 Cr) with exact value always inspectable. Money never renders in a non-tabular numeral. |
| **C-8** | Authorization is **grants, not roles**: a Grant = (person, scope, capability set). Named capability sets exist for ergonomics; enforcement is per-capability. |
| **C-9** | The auction domain is **event-sourced**: an append-only per-auction ledger with a monotonic `seq`, a pure deterministic reducer, and a **single writer per auction** (the Engine service). All read models are projections. |
| **C-10** | **AI never touches the money path** (constitutional, carries D-005). AI is an actor that holds grants, is rate-limited, and is audited like any human; its output is always visually and structurally distinct from engine truth. |
| **C-11** | Commercial model: **per-tournament Pass**, public pricing, no subscriptions for organizers, and **no data ransom** — entitlement loss locks capabilities, never data (carries D-006, D-007). |
| **C-12** | Monorepo: `apps/web` (Next.js — Console, Stage, Owner Room, registration), `apps/engine` (stateful Node service — auction runtime + realtime), `packages/core` (pure domain), `packages/ui` (FLOODLIGHT components), `packages/contracts` (API/event schemas). Workspaces never import each other. |
| **C-13** | Data: **PostgreSQL** (Mumbai region), Drizzle ORM, **ULID** identifiers, `org_id` on every tenant row with **RLS as defense-in-depth**. |
| **C-14** | APIs: internal typed RPC for first-party apps; **public REST `/v1`** described by OpenAPI; webhooks HMAC-signed with retries. Idempotency keys are mandatory on money-adjacent POSTs. |
| **C-15** | Accessibility floor: **WCAG 2.2 AA**, full keyboard operation of every surface including the Cockpit, and a first-class live-region strategy for auction events. |
| **C-16** | Background jobs run on a Postgres-backed queue and are **never on the money path**. Lot timers live inside the Engine process with a durable watchdog fallback. |
| **C-17** | Observability: OpenTelemetry traces/metrics, structured JSON logs, Sentry. Product SLOs include bid-ack p99 and SOLD→Stage latency; alert sensitivity escalates automatically while any auction is LIVE. |
| **C-18** | Payments: **Razorpay** (India-first). Payment state derives from provider truth; every charge has an immutable invoice; manual overrides are flagged forever. |
| **C-19** | Notifications are **WhatsApp-first** (then SMS, email, in-app), transactional in tone, with no dark patterns — structurally excluded, not discouraged. |
| **C-20** | The **35 product invariants** (40-business-rules.md) are carried from the reference implementation's ratified constitution. They are behaviour, not architecture, and they bind every document here. |
| **C-21** | Acceptance spine: **six Golden Journeys** (70-acceptance-criteria.md). A release is definable only in terms of journeys that pass end-to-end in a real browser. |
| **C-22** | **Live-aware operations**: no production deploy, migration, or risky maintenance while any auction is LIVE; the platform knows its own live windows and enforces the freeze. |
| **C-23** | **Dignity rules**: UNSOLD is a neutral fact, never a public list; rejection reasons are recorded but never public; contact and payment details of people are never public. The five emotional beats (04) are protected requirements, not aspirations. |
| **C-24** | **India-first**: DPDP Act 2023 compliance, Mumbai-region infrastructure, phone-first identity (OTP + passkeys), bilingual-ready copy (en → hi), Indian number notation. |
| **C-25** | **Player identity is a first-class product experience.** Every player has a premium visual identity: a real photograph where one exists, a **premium branded placeholder** where it does not — generic silhouettes are banned. Represented consistently across Auction Stage, Owner Room, SOLD Ceremony, Team Roster, Player Profile, and Search. (Founder executive decision 2026-07-12; provenance = informal organizer input recorded in `phase-0b/X1_EXECUTIVE_WAIVER.md` — executive input, not formal research.) |

## Reading order

**First-principles path** (new team member): 01 → 03 → 04 → 38 → 40 → 41 → 05 → 17 → 66 → then your specialty.

## Document map

### Foundation (01–04)
| # | Document | One line |
|---|----------|----------|
| 01 | [Vision](01-vision.md) | Why this product exists and what winning looks like |
| 02 | [Product Strategy](02-product-strategy.md) | Market, wedge, moat, sequencing |
| 03 | [Product Principles](03-product-principles.md) | The ten operating principles for product decisions |
| 04 | [Product Philosophy](04-product-philosophy.md) | Trust as physics; the five emotional beats |

### Design (05–18)
| # | Document | One line |
|---|----------|----------|
| 05 | [Design Language](05-design-language.md) | FLOODLIGHT: the aesthetic constitution |
| 06 | [Brand Guidelines](06-brand-guidelines.md) | Voice, personality, applications |
| 07 | [Logo Exploration](07-logo-exploration.md) | Marks, wordmark direction, usage |
| 08 | [Color System](08-color-system.md) | Ink, Chalk, Volt, Gold; semantic ramps; both themes |
| 09 | [Typography](09-typography.md) | Faces, scale, numeric rules |
| 10 | [Spacing System](10-spacing-system.md) | 4px grid, scale, density modes |
| 11 | [Motion System](11-motion-system.md) | Tokens, choreography, the SOLD ceremony |
| 12 | [Iconography](12-iconography.md) | Base set + auction glyphs |
| 13 | [Accessibility Standards](13-accessibility-standards.md) | WCAG 2.2 AA floor + live auction a11y |
| 14 | [Responsive Strategy](14-responsive-strategy.md) | Breakpoints, mobile-first surfaces |
| 15 | [Interaction Design](15-interaction-design.md) | States, feedback, input patterns |
| 16 | [Navigation System](16-navigation-system.md) | Shells, URL grammar, wayfinding |
| 17 | [Information Architecture](17-information-architecture.md) | Five surfaces + one engine, mapped |
| 18 | [Design Tokens](18-design-tokens.md) | The token contract (names, tiers, format) |

### Components & patterns (19–35)
| # | Document | One line |
|---|----------|----------|
| 19 | [Component Library](19-component-library.md) | `@da/ui` inventory and API rules |
| 20 | [UX Writing Guidelines](20-ux-writing-guidelines.md) | The scorer's voice |
| 21 | [Microcopy](21-microcopy.md) | Canonical strings and patterns |
| 22 | [Empty States](22-empty-states.md) | Every empty state teaches or invites |
| 23 | [Loading States](23-loading-states.md) | Skeletons, staleness, live catch-up |
| 24 | [Error States](24-error-states.md) | Honest failure; recovery-first |
| 25 | [Success States](25-success-states.md) | Confirmation tiers; ceremony rules |
| 26 | [Notifications](26-notifications.md) | In-product notification surfaces |
| 27 | [Toasts](27-toasts.md) | Rules for the ephemeral layer |
| 28 | [Dialog Standards](28-dialog-standards.md) | Modals, confirms, destructive gates |
| 29 | [Form Standards](29-form-standards.md) | Fields, validation, autosave |
| 30 | [Table Standards](30-table-standards.md) | Data tables and the ledger view |
| 31 | [Card Standards](31-card-standards.md) | Entity cards, stat cards, peeks |
| 32 | [Dashboard Standards](32-dashboard-standards.md) | Overviews that answer, not decorate |
| 33 | [Search Standards](33-search-standards.md) | Command palette + scoped search |
| 34 | [Filtering Standards](34-filtering-standards.md) | Filters, saved views, chips |
| 35 | [AI Interaction Standards](35-ai-interaction-standards.md) | Advisory UI; the AI constitution applied |

### Domain (36–46)
| # | Document | One line |
|---|----------|----------|
| 36 | [Permission Model](36-permission-model.md) | Grants, scopes, capabilities, tokens |
| 37 | [User Roles](37-user-roles.md) | Personas and named capability sets |
| 38 | [Domain Model](38-domain-model.md) | Entities, relationships, ownership |
| 39 | [State Machines](39-state-machines.md) | Every lifecycle, exhaustively |
| 40 | [Business Rules](40-business-rules.md) | The 35 invariants (constitution) |
| 41 | [Auction Rules](41-auction-rules.md) | Bid validation, timers, close, undo |
| 42 | [Registration Rules](42-registration-rules.md) | Player intake, verification, approval |
| 43 | [Team Rules](43-team-rules.md) | Ownership, purse, squad composition |
| 44 | [Tournament Rules](44-tournament-rules.md) | Lifecycle, readiness gates, archival |
| 45 | [Billing Model](45-billing-model.md) | Passes, tiers, entitlements |
| 46 | [Payment Flow](46-payment-flow.md) | Razorpay integration, states, refunds |

### Platform (47–57)
| # | Document | One line |
|---|----------|----------|
| 47 | [Notification Strategy](47-notification-strategy.md) | Channels, catalog, preferences |
| 48 | [Audit Strategy](48-audit-strategy.md) | Append-only audit; what, how, who sees |
| 49 | [Security Model](49-security-model.md) | Threat model, authn/z, tenancy, DPDP |
| 50 | [API Standards](50-api-standards.md) | REST /v1, errors, idempotency, versioning |
| 51 | [Event Architecture](51-event-architecture.md) | Ledger events, realtime protocol, webhooks |
| 52 | [Database Design](52-database-design.md) | Schema conventions, RLS, migrations |
| 53 | [Background Jobs](53-background-jobs.md) | Queue, retries, idempotency, timers |
| 54 | [Caching Strategy](54-caching-strategy.md) | Layers; seq-tagged money reads |
| 55 | [Logging Strategy](55-logging-strategy.md) | Structured logs, correlation, redaction |
| 56 | [Monitoring](56-monitoring.md) | SLOs, alerting, live-window escalation |
| 57 | [Performance Budgets](57-performance-budgets.md) | Numbers per surface, CI-enforced |

### Engineering & operations (58–70)
| # | Document | One line |
|---|----------|----------|
| 58 | [Testing Strategy](58-testing-strategy.md) | Pyramid + engine determinism suite |
| 59 | [CI/CD](59-ci-cd.md) | Gates, previews, trunk-based flow |
| 60 | [Deployment Strategy](60-deployment-strategy.md) | Topology, canary engine, freeze windows |
| 61 | [Disaster Recovery](61-disaster-recovery.md) | RPO/RTO, ledger replay, runbooks |
| 62 | [Backup Strategy](62-backup-strategy.md) | PITR, rehearsal cadence, restore proof |
| 63 | [Release Strategy](63-release-strategy.md) | Flags, staged rollout, versioning |
| 64 | [Coding Standards](64-coding-standards.md) | TypeScript strict; style; review rules |
| 65 | [Folder Structure](65-folder-structure.md) | The monorepo map and boundary rules |
| 66 | [Architecture Principles](66-architecture-principles.md) | The system's first principles |
| 67 | [Engineering Principles](67-engineering-principles.md) | How we build and decide |
| 68 | [Documentation Standards](68-documentation-standards.md) | How docs stay true |
| 69 | [Definition of Done](69-definition-of-done.md) | The checklist nothing skips |
| 70 | [Acceptance Criteria](70-acceptance-criteria.md) | Golden Journeys + invariant mapping |

### Phase 1 gate
| Review | File |
|--------|------|
| Product Review | [reviews/product-review.md](reviews/product-review.md) |
| UX Review | [reviews/ux-review.md](reviews/ux-review.md) |
| Architecture Review | [reviews/architecture-review.md](reviews/architecture-review.md) |
| CTO Review | [reviews/cto-review.md](reviews/cto-review.md) |

## Glossary (canonical terms)

- **Engine** — the single server-authoritative auction runtime; the only writer of auction money and outcomes.
- **Surface** — one of the five read views (Console, Cockpit, Owner Room, Stage, Overlay).
- **Ledger** — the append-only event stream of an auction; `seq` is its monotonic sequence number.
- **Lot** — one player put up for bidding.
- **Purse** — a team's budget for one tournament's auction.
- **Pass** — the per-tournament entitlement an organizer buys.
- **Grant** — (person, scope, capability set); the unit of authorization.
- **Pool** — the set of approved players eligible for the auction.
- **Ceremony** — the choreographed SOLD moment, synchronized across surfaces.
- **Advisory** — any AI-produced content; visually distinct, never engine truth.
