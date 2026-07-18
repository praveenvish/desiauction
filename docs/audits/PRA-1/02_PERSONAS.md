# PRA-1 · 02 — Personas

> For each persona: what they want, what the repository actually gives them,
> and where their journey breaks. Verdicts derive from 01_PRODUCT_INVENTORY.md evidence.

## P1 · Visitor (prospective customer)

- **Goal**: understand what DesiAuction is, what it costs, and sign up.
- **Gets**: a page reading "DesiAuction NEXT — Engineering foundation · version dev" (`app/page.tsx`). No features page, no pricing, no screenshots, no sign-up call to action, no SEO surface (no robots/sitemap/OG tags/favicon).
- **Blocked at**: the very first pageview. **Journey: MISSING.**

## P2 · Founder / Platform Admin (you)

- **Goal**: see tenants, usage, revenue, health; intervene on support issues; comp a pass.
- **Gets**: nothing. No admin routes exist. Tenant counts require SQL. There is no billing to administer. Engine has diagnostics endpoints but no platform overview.
- **Blocked at**: everything. **Journey: MISSING.** The only "admin" tools are shell scripts (`pnpm health`, `rls:verify`, `seed:demo`).

## P3 · Organization Admin (club/association owner)

- **Goal**: create the org, bring in co-organizers, manage venues, run seasons.
- **Gets**: create org (`/orgs`), members + invite links with capability sets (`/org/[slug]`), venues/grounds (`/org/[slug]/venues`).
- **Missing**: org settings (rename, logo, delete), member removal/role change UI beyond grants shown, billing/pass management, org-level reporting, transfer of ownership.
- **Journey: PARTIAL** — creation and staffing work; administration and commerce don't exist.

## P4 · Organizer / Competition Manager

- **Goal**: set up a competition, open registration, triage players, build fixtures, run the season.
- **Gets**: the strongest slice of the product — competition lifecycle (`/competitions/[slug]`), a real registration ops console (search, bulk ops, CSV import/export, timeline, duplicate flags), a real fixtures console (generate/schedule/publish, conflicts, calendar, match-day).
- **Missing**: any way to *reach* these screens without typing URLs (no navigation shell); competition settings/edit after creation; comms to participants (zero email/SMS/WhatsApp); results/standings; reports.
- **Journey: PARTIAL→COMPLETE** for the operator loop, **BROKEN** for everything that touches the outside world (participants never hear from the platform).

## P5 · Auctioneer / Conductor

- **Goal**: run the auction night calmly.
- **Gets**: cockpit (queue, gavel, freeze, undo, pause/resume, recover, complete), owner invites, paddle grants, purse table; live room conduct panel; ledger; replay; engine diagnostics.
- **Missing**: nothing structural inside the room. This persona is genuinely served.
- **Journey: COMPLETE** (within the auction; getting the room's participants onboarded depends on broken personas below).

## P6 · Team Owner / Bidder

- **Goal**: accept ownership, know the budget, bid, and afterwards know what they owe and pay it.
- **Gets**: owner-join invite → live room, paddle claim, bidding with increments/custom amounts, purse visibility in cockpit views.
- **Missing**: **the entire post-gavel experience.** Obligations, invoices, receipts, and payment exist only as headless settlement/finops code (no screen, no webhook route, no delivery channel). An owner leaves auction night with no artifact: no "you owe ₹X", no receipt, no squad summary page they can revisit.
- **Journey: PARTIAL** — complete up to the gavel, **MISSING** after it.

## P7 · Player

- **Goal**: register, be visible with their name and photo, know their status, know their team.
- **Gets**: `/competitions/[slug]/register` — a role dropdown and a submit button.
- **Missing**: name capture (accounts are created phone-only at `otp.ts:146`; the registration form posts only `role`; only organizer CSV import ever sets a name — `registration-import.ts:40`). No photo upload. No status notifications (no channels exist). No "my competitions" view. No post-auction "you're on team X".
- **Journey: BROKEN** — a self-registered player is a nameless phone number on every screen, including the auction stage the vision doc calls "television" (`docs/01-vision.md`).

## P8 · Spectator

- **Goal**: watch auction night from a link.
- **Gets**: `/competitions/[slug]/auction/spectate` — public, no login required, live snapshot stream.
- **Missing**: any way to discover the link (no public competition page, no share affordances); no results/summary after the night.
- **Journey: PARTIAL** — works if someone pastes them a URL.

## P9 · Finance / Treasurer

- **Goal**: collect what teams owe, issue receipts/invoices, reconcile, export to the accountant.
- **Gets**: no screens. Settlement collections, journal, GST-aware documents, CSV register and Tally XML exporters all exist as code (`packages/settlement`, `packages/financial-operations`) reachable only from tests and seed scripts. Exports write to a filesystem outbox nobody can browse.
- **Journey: MISSING** despite being the pillar of the product's stated promise ("the money is beyond dispute").

## P10 · Auditor

- **Goal**: verify the record.
- **Gets**: the auction ledger page (read-only projection) — genuinely good; `audit_log` table exists but has no viewer.
- **Journey: PARTIAL.**

## P11 · Support Agent

- **Goal**: resolve customer issues.
- **Gets**: nothing — no support tooling, no impersonation, no help center, no contact channel anywhere in the product.
- **Journey: MISSING.**

## Summary table

| Persona | Verdict | First blocker |
|---------|---------|---------------|
| Visitor | MISSING | Placeholder landing page |
| Founder/Platform admin | MISSING | No admin surface |
| Org admin | PARTIAL | No org settings/billing |
| Organizer | PARTIAL | No navigation to reach consoles; no participant comms |
| Auctioneer | COMPLETE | — |
| Team owner | PARTIAL | Nothing exists after the gavel |
| Player | BROKEN | Nameless accounts; no notifications |
| Spectator | PARTIAL | No link discovery |
| Finance | MISSING | Settlement/finops headless |
| Auditor | PARTIAL | Ledger only |
| Support | MISSING | Nothing |
