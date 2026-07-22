# Parity & Superiority — Program Architecture Blueprint

> Branch: `feat/parity-superiority`
> Status: **Design — for review before implementation**
> Goal: reach 100% feature parity with the incumbent (Super Player Auction),
> delivered the DesiAuction way — auditable, multi-tenant, accessible, premium.

This is the master architecture for the competitive-parity programme. It covers
**both back end and front end** for every remaining feature, at a consistent
altitude: data model → domain (core) → server module/port → contract → real-time
impact → FE routes/components/state → what existing code it reuses → tests.

It is deliberately design-first. No feature here should be built until its
section is reviewed and the open decisions (§8) are closed.

---

## 0. How to read this

Each feature uses the same compact template:

| Field | Meaning |
|---|---|
| **Status** | `Have` / `Partial` (exists, not surfaced) / `Build` (net-new) |
| **Data** | schema tables/columns touched (`packages/db/src/schema.ts` + migration) |
| **Core** | pure domain in `packages/core` / `packages/auction` (no IO) |
| **Server** | `apps/web/src/server/<domain>` module + any port/adapter |
| **Real-time** | impact on the auction snapshot / engine, if any |
| **FE** | Next.js routes + components + client state |
| **Reuses** | existing code this builds on (do not re-invent) |
| **Tests** | regression (`*.regression.test.ts`) + e2e + a11y |

---

## 1. Corrected baseline (verified on `main`, 2026-07-22)

The incumbent teardown assumed more was missing than actually is. Verified
against current code:

**Already built — do NOT rebuild:**

- Real-time auction engine + deterministic snapshot (`apps/engine`,
  `packages/core/src/auction-snapshot.ts`), incl. `pursePerTeam`, `committed`,
  `purseRemaining` per paddle.
- Cockpit auctioneer with **keyboard shortcuts** + gavel
  (`app/competitions/[slug]/auction/cockpit/`, `COCKPIT_SHORTCUTS`,
  unit-tested `resolveKeyDown/Up`).
- **Live board** with team standings, sold/unsold/top-buy tiles
  (`auction/board/board-panel.tsx`).
- **OBS stream overlay** (`auction/overlay/`).
- **Public spectate** (`auction/spectate/`), ledger, replay, engine views.
- **SOLD ceremony** + confetti (`auction/ceremony-stage.tsx`).
- Public competition **directory** (`app/c/`, `app/c/[slug]`) — but landing
  shows only teams + register CTA, no player pool.
- Engine base-price **bands** A/B/C (`packages/core/src/auction.ts` →
  `basePriceBands`, `registrations.basePriceBand`).
- **CSV substrate**: `packages/core/src/registration-csv.ts`
  (`parseRegistrationCsv`), `apps/web/src/server/competition/registration-import.ts`
  (`commitRegistrationImport`), plus fixtures CSV.
- Settlement, finops, multi-tenant capability grants, admin console — shipped.

**Genuinely missing (this programme):** media & player attributes; the
pre-auction public showcase; the rich category/tier config; the live "extras"
(booster/penalty/jodi/wheel/banner); distribution (exports, player bulk-import
UI, share links, notifications, notional-points); reach (PWA, multi-sport).

---

## 2. Architecture principles (inherited — non-negotiable)

These are the existing house rules (`docs/66-architecture-principles.md`,
`docs/51-event-architecture.md`). Every feature below obeys them.

1. **Hexagonal layering.** Pure domain in `packages/core` (no IO, no ambient
   time/randomness). IO lives behind **ports** in `apps/web/src/server`, with
   swappable adapters (the `otp-sender.ts` SMS port is the reference shape).
2. **Server modules, not fat actions.** Each domain folder splits into
   `actions.ts` (writes), read/`*-aggregate.ts`, `public.ts` (public read
   model), `authz.ts`, `*-import.ts`, and co-located `*.regression.test.ts`.
3. **Capability grants, not roles.** Authorization is `hasCapability(grants,
   scope, capability)` (`packages/core/src/capabilities.ts`). New writes add a
   capability, never an ad-hoc role check.
4. **Money is integer paise (bigint).** No floats. Notional "points" mode
   (§3.6) is a *presentation + config* concern, never a second money type.
5. **The snapshot is canonical.** Anything the board/overlay/spectate needs must
   flow through `AuctionSnapshot` (sorted-key canonical JSON) so every surface
   renders the same frame. No side-channel reads during a live auction.
6. **Migrations are append-only + journal-aware.** New migration =
   `packages/db/migrations/00NN_name.sql` **and** a `meta/_journal.json` entry
   whose `when` is **strictly greater** than the last (`0016` = `1785081600000`).
   Drizzle silently skips migrations whose `when` isn't advanced — this has
   bitten us before.
7. **Tenant isolation.** All new tables carry `org_id`; reads/writes go through
   the tenant-scoped db handle. RLS policies ship with the migration even though
   app-layer scoping is the runtime guard.
8. **Accessibility + reduced-motion are acceptance criteria**, not polish.
   Broadcast animations must be transform/opacity-safe and collapse under
   `prefers-reduced-motion` (see the ceremony stage for the pattern).

---

## 3. Cross-cutting foundations

These are shared substrates. Build them **once, first**; every feature in §4
consumes them. This is the real leverage in the programme.

### 3.1 Media & storage  ·  `Build`

The single highest-leverage gap: no image anywhere in the schema.

- **Data.** New nullable columns (all behind migration `0017_media`):
  - `people.photo_url text`, `people.photo_uploaded_at ts` (reuse existing
    `photo_consent_at` / `photo_consent_via` as the consent gate).
  - `teams.logo_url text`.
  - `competitions.logo_url text` (auction crest).
  - Store **keys/paths**, not signed URLs; sign at read time.
- **Core.** `packages/core/src/media.ts` — pure validators: allowed
  mime/type/size, deterministic object-key derivation
  (`org/{orgId}/player/{personId}/{hash}`), no IO.
- **Server (port).** `apps/web/src/server/media/storage-port.ts` — interface
  `StoragePort { presignPut(key, contentType): Url; publicUrl(key): Url;
  delete(key): void }`. Adapters: `s3-adapter.ts` (prod, S3/R2) and
  `local-adapter.ts` (dev/local, writes under `apps/web/public/_media`). Chosen
  by env, exactly like the SMS port. Direct-to-storage presigned upload so image
  bytes never touch the Next server.
  - `media/actions.ts`: `requestUpload(scope)` → returns presigned PUT +
    final key; `attachPhoto(personId, key)` / `attachLogo(teamId, key)` — each
    capability-checked and consent-gated.
- **FE.** `packages/ui` gains `<ImageUploader>` (drag/drop, crop-to-square,
  progress, a11y labels) and `<Avatar>` / `<Crest>` display primitives with
  token-colored fallbacks (reuse the current monogram/`primaryColor` fallback so
  nothing breaks pre-upload).
- **Reuses.** Consent columns already exist; `otp-sender.ts` is the port
  template; `packages/ui` fallback monogram already in the directory card.
- **Tests.** `media.test.ts` (key derivation, validation); e2e upload happy-path
  behind the local adapter.

> **Open decision D1:** storage backend (S3 vs Cloudflare R2 vs Supabase
> Storage). Port makes it swappable; pick the prod adapter in §8.

### 3.2 Player & team domain extensions  ·  `Build`

- **Data (migration `0018_player_profile`):** on `registrations` —
  `date_of_birth date` **or** `age int` (see D2), `batting_style text` (enum:
  right/left + opener/middle order), `bowling_style text` (enum: pace/spin
  variants), `father_name text`, `jersey_name text`, `jersey_number text`,
  `tshirt_size text`, `trouser_size text`. New tag booleans to complete the set:
  `is_retained boolean`, `is_owner boolean`, `is_co_owner boolean`,
  `is_vice_captain boolean` (we already have `is_icon`, `is_captain`).
  **Note (validation fix):** `owner` / `co-owner` are *ownership grants*
  (paddle/owner model), **not** registration flags — they are not columns here.
  Player-pool tags = icon / captain / vice-captain / retain only.
  **PII (R1):** `date_of_birth`, `father_name`, and the kit fields are personal
  data — they must be added to the DPDP data map (M-IP2-4, `schema.ts` header)
  with a retention note, and consented at registration. Not optional.
- **Core.** Extend the registration value object + `parseRegistrationCsv`
  columns; add style enums to a shared `packages/core/src/player-profile.ts`.
- **Server.** Extend `competition/registrations.ts` reads and
  `registration-aggregate.ts` to project the new fields; `actions.ts` write path.
- **FE.** Register flow (`app/competitions/[slug]/register/`) gains the optional
  profile step; showcase + cards render role · batting · bowling · age.
- **Reuses.** `isIcon`/`isCaptain` pattern; `basePriceBand` column;
  `registration-csv.ts` column mapping.
- **Tests.** Extend `registration-ops.regression.test.ts`.

> **Open decision D2:** store `date_of_birth` (correct, derive age — recommended)
> vs raw `age` (matches their form but rots). Recommend DOB + derived age view.

### 3.3 Public showcase read-model  ·  `Partial → Build`

The pre-auction browsable pool — the thing organizers judge us on.

- **Server.** New `competition/public-showcase.ts` (a **read model**, sibling to
  `public.ts`): `publicShowcase(slug)` returns teams (with crest, purse,
  squad-so-far) and the approved player pool (photo, role, batting/bowling, age,
  category, status Available/Sold/Unsold). Before the auction it reads approved
  registrations; **during/after** it prefers the live snapshot's resolved lots
  so status is truthful — one function, two sources, same shape.
- **FE.** `app/c/[slug]/page.tsx` gains a **Players** and **Teams** section with
  a client filter island `<ShowcaseGrid>` (All / Available / Sold / Unsold,
  category chips, age group, sort) — mirrors the on-screen board filters but
  public and SEO-safe (server-rendered list, client-filtered).
- **Real-time.** Optional: subscribe to the same socket as spectate so a public
  viewer sees sold/unsold flip live; degrade to static without JS.
- **Reuses.** `board-panel.tsx` filter logic; `packages/auction` projections;
  `public.ts` visibility gate; the `<Avatar>`/`<Crest>` primitives from §3.1.
- **Tests.** `public-showcase` unit + e2e (visibility, filters, pre/post-auction
  status).

### 3.4 Notification port  ·  `Partial → Build`

Generalize the existing SMS sender into a first-class notification port so
"WhatsApp/SMS on sold", registration receipts, and approval notices all reuse it.

- **Server.** `apps/web/src/server/notify/notify-port.ts` —
  `NotifyPort { send(channel, to, template, vars): Result }` with `sms`,
  `whatsapp`, (later) `push` channels; adapters behind env; **circuit-breaker +
  idempotency key** (reuse the OTP breaker learnings). Events (player sold,
  registration approved) enqueue a notification; delivery is a background job
  (mirror `apps/finops-runner`), never inline in the auction hot path.
- **Reuses.** `auth/otp-sender.ts` (promote to an adapter of this port);
  finops-runner job pattern.
- **Tests.** `notify.test.ts` (templating, breaker, idempotency).

### 3.5 Import / export substrate  ·  `Partial → Build`

- **Import.** The parse-in-core / commit-in-server pattern already exists
  (`parseRegistrationCsv` → `commitRegistrationImport`). Extend column set for
  §3.2 fields; add a **player bulk-import UI** (upload → dry-run preview with
  per-row errors → commit) at `app/competitions/[slug]/registrations/import/`.
- **Export.** New `competition/exports.ts`: server-streamed CSV/XLSX of teams,
  players, and results. Pure row-builders in core; streaming/formatting in
  server; capability-checked; tenant-scoped. No client-side data assembly.
- **Reuses.** `registration-import.ts`, `fixture-import.ts`, `registration-csv.ts`.
- **Tests.** Round-trip (export → re-import) regression.

### 3.6 Config & rules model — categories/tiers, increments, timer  ·  `Partial → Build`

Their most sophisticated setup piece. We already have the engine primitives;
this makes them first-class and configurable.

- **Data (migration `0019_auction_config`):** new `auction_categories` table
  (`id, org_id, competition_id, name, color, base_price paise, reserve paise,
  max_players_per_team int, min_players_per_team int, per_player_cap paise,
  total_cap paise, sort`). Increment slabs as `auction_increment_slabs`
  (`competition_id, from_amount, increment`) **or** JSON on the competition
  config — see D3. `registrations.category_id` FK (supersedes the freeform
  `base_price_band` string; migrate A/B/C bands into rows).
- **Core.** Extend `packages/core/src/auction.ts`: `decideBid` already takes
  `basePriceBands` + `roleQuotas`; add `categoryRules` (caps, reserve, slab
  increments). Keep it pure and unit-tested — this is where correctness lives.
- **Server.** `competition/auction-config.ts` (reads + writes), capability-gated.
- **FE.** Config UI under `app/competitions/[slug]/` (setup area): category
  editor (name/color/base/reserve/caps/quotas), increment-slab editor, timer
  mode (Off/Auto/Manual + anti-snipe seconds — we already have extensions).
- **Reuses.** `basePriceBands`, `roleQuotas`, `decideBid`, the extension timer.
- **Tests.** Heavy `auction.test.ts` additions (slab math, caps, quota
  interaction).

> **Open decision D3:** increment slabs as a table (queryable, per-competition
> history) vs JSON config column (simpler). Recommend a table for auditability.

### 3.7 Design-system & FE conventions  ·  `Have → extend`

- Everything renders through `packages/ui` tokens (light+dark), never per-screen
  gradients. New primitives this programme adds: `<Avatar>`, `<Crest>`,
  `<ImageUploader>`, `<ShowcaseGrid>`, `<StatusChip>` (Available/Sold/Unsold),
  `<BudgetMeter>`. Broadcast surfaces stay on the existing floodlight theme.
- **CRO instrumentation** is a cross-cutting concern: a thin `track(event)`
  helper feeds funnel events (land → view competition → start register →
  submit → owner join → run auction). Single clear primary CTA per screen.
- Reduced-motion + WCAG contrast checked in CI (axe) — note the existing gotcha:
  animate text with transform only, never opacity (fails contrast mid-frame).

---

## 4. Feature architecture by phase

Phases are unblock-ordered. Each leaves the product shippable. Foundations from
§3 are prerequisites, noted inline.

### Phase 0 — Foundation (media + attributes)
*Prereq: §3.1, §3.2. Gates every visual feature.*

| Feature | Status | Key BE | Key FE |
|---|---|---|---|
| Player photo upload + display | Build | §3.1 storage port; `attachPhoto` | `<ImageUploader>` in register + admin; `<Avatar>` everywhere |
| Team logo/crest | Build | `teams.logo_url`; `attachLogo` | `<Crest>` in directory/board/overlay |
| Player attributes (age, batting, bowling, kit, tags) | Build | §3.2 | register profile step; card rendering |
| Profile avatar | Partial | reuse `people.photo_url` | account page |

### Phase 1 — Public showcase & acquisition
*Prereq: §3.3.*

| Feature | Status | Key BE | Key FE |
|---|---|---|---|
| Pre-auction player/team showcase grid | Build | `public-showcase.ts` | `<ShowcaseGrid>` on `/c/[slug]` |
| Always-on public budget board | Have* | snapshot already has purse | reuse `board-panel`; expose to public spectate |
| Registration public share link + QR | Partial | tokenized no-login route | share sheet on competition page |
| Directory logos + richer cards | Partial | extend `public.ts` | directory card uses `<Crest>` |

\* board exists for the operator; P1 is exposing an equivalent public view + crests.

### Phase 2 — Config depth & broadcast polish
*Prereq: §3.6.*

| Feature | Status | Key BE | Key FE |
|---|---|---|---|
| Category/tier system | Build | `auction-config.ts`, `auction_categories` | category editor |
| Increment slabs | Build | core `decideBid` slabs | slab editor |
| Timer config UI (Off/Auto/Manual) | Have (engine) | expose config | timer settings |
| Player-card shareable image | Build | server-rendered OG image route | share button |
| Stream overlays (extra themes) | Have | reuse `overlay/` | theme param |
| Second-screen mirror | Partial | read-only snapshot route | `/board?mirror` |

### Phase 3 — Live extras & distribution
*Prereq: §3.4, §3.5.*

| Feature | Status | Key BE | Key FE |
|---|---|---|---|
| Booster (credit purse) | Build | `live-actions.ts` audited adjustment; snapshot purse | cockpit control |
| Penalty (debit purse) | Build | same, opposite sign | cockpit control |
| Jodi (multi-player lot) | Build | core lot model → set lot; engine queue | cockpit + board |
| Reauction of unsold | **Have** | engine `requeue` + `UnsoldPolicy` already model it | cockpit **button only** |
| Rounds / set ordering | Build | queue ordering by round | setup |
| Fortune wheel | Build | seeded RNG in core (deterministic) | broadcast island |
| Sponsor banner | Build | `banner_url` config | board/overlay slot |
| Bulk player import UI | Partial | §3.5 | import wizard |
| Exports (CSV/XLSX) | Build | `exports.ts` | export buttons |
| WhatsApp/SMS on sold | Partial | §3.4 notify port + job | opt-in setting |
| Notional-points mode | Partial | presentation flag; format layer | setup toggle |
| Kit management | Build | §3.2 kit fields | player form |
| Pool transfer (copy from past auction) | Build | `actions.ts` copy | setup action |
| Remote owner bidding | Build | engine bid via owner socket + capability | owner workspace |

### Phase 4 — Reach & commercial

| Feature | Status | Key BE | Key FE |
|---|---|---|---|
| PWA (installable) | Build | manifest + service worker | offline shell |
| Multi-sport + seasons | Build | `competitions.sport/season` | setup selects |
| Support presence (phone/WhatsApp/status) | Partial | status probe exists (`/readyz`) | header + help |
| Video tutorials | Partial | content registry | help/gallery |
| Pricing tiers + CRO pass | Partial | plan model | pricing page + funnel A/B |

---

## 5. Migration sequencing

Append-only, journal-aware (§2.6). Planned order:

1. `0017_media` — image columns (people/teams/competitions).
2. `0018_player_profile` — attributes, kit, tag booleans.
3. `0019_auction_config` — `auction_categories`, increment slabs,
   `registrations.category_id` (+ backfill A/B/C bands → rows).
4. `0020_notifications` — outbox table for the notify port (idempotency keys).
5. `0021_broadcast_extras` — booster/penalty ledger entries, banner config,
   jodi/set-lot linkage.

Each: create the `.sql`, append a `_journal.json` entry with `when` strictly
greater than the previous, ship RLS policies, add `org_id`.

---

## 6. Testing & quality gates

- **Domain correctness** in `packages/core` — pure unit tests are the primary
  safety net (`auction.test.ts` grows most: slabs, caps, quotas, booster/penalty
  math, jodi lots, deterministic wheel).
- **Server regression** — `*.regression.test.ts` per module (import round-trips,
  showcase visibility, config writes).
- **e2e** (`apps/web/e2e`) — run hands-off (no edits mid-run; recompiles hang
  server actions). New specs: media upload, showcase filters, category setup,
  booster/penalty, export.
- **a11y** — axe in CI; reduced-motion; transform-only text animation.
- **CRO** — funnel events fire and are assertable; one primary CTA per screen.
- **Perf/scale** — showcase + board must hold at 300+ players (virtualize the
  grid; paginate the public list).

---

## 7. What we already lead on (keep the moat visible)

Deterministic engine (anti-snipe/hold/undo/recovery), settlement + finops,
multi-tenant capability isolation, admin console, accessibility, one design
system. None of these have an incumbent equivalent — every parity feature above
is delivered *through* these, which is the differentiation.

---

## 8. Open decisions (close before building the relevant section)

| # | Decision | Recommendation |
|---|---|---|
| D1 | Storage backend for media | Cloudflare R2 or S3; port keeps it swappable |
| D2 | Age vs date-of-birth | Store DOB, derive age |
| D3 | Increment slabs: table vs JSON | Table (auditable, per-competition) |
| D4 | Notional-points model | **Same integer column**; a competition `budget_unit` flag (`inr` \| `points`) changes only edge formatting + whether settlement/finops engages. Never a second money type. |
| D5 | Remote owner bidding in v1? | Defer to P3; needs auth-scoped socket design |
| D6 | Public showcase live-updates | Cached server render + poll for the *public* grid; reserve the socket for operator/owner (see R7). Not a raw fan-out. |
| D7 | Photo on `people` vs `registrations` | **`people.photo_url`** (person-level): one identity, reused across competitions, consent already lives on `people`. Trade-off: no per-competition photo — acceptable. |

---

## 8.5 Risk register (validation pass, 2026-07-22)

Surfaced by re-reading the code against the plan. Each has a mitigation baked
into sequencing — none is a blocker, but ignoring them is.

| # | Risk | Mitigation |
|---|---|---|
| **R1** | New PII (`date_of_birth`, `father_name`, kit, photo) added without DPDP treatment | Update the DPDP data map (M-IP2-4), add retention + consent at registration. Gate photo on existing consent columns. **Do in P0/P1, not later.** |
| **R2** | Categories replacing `basePriceBand` is a **live-engine input change** | Additive-first: keep `basePriceBand` working; add `auction_categories` + `category_id` alongside; migrate the engine's `basePriceBands` input **last**, behind expanded `auction.test.ts`. Never a big-bang swap. |
| **R3** | **Jodi** (multi-player lot) changes the core lot model (lot = 1 player today) → squad counts, settlement (who is charged), snapshot lot shape all shift | Treat as a **spike**, not a chip. Model as an explicit "grouped sale" with defined charge/squad semantics before any code. Candidate to defer past P3 if it destabilizes the engine. |
| **R4** | `LocalStorage` writes under `public/_media` at runtime — served by `next dev` but **NOT** by a built/standalone server (public/ is snapshotted at build) | LocalStorage is **dev/e2e only**. Production **must** use the bucket adapter. Documented in the port; env default is `local`, prod env sets `bucket`. |
| **R5** | "Random / Sequence" player pick vs the engine's **no-randomness** rule | Selection is seeded **at the edge** (server/cockpit), the chosen lot is recorded in the event log, so replay stays deterministic. Core stays pure. |
| **R6** | Presigned-upload seam could become an **open write** | Both the presign action *and* the local upload route must capability-check that the caller may attach to that subject (registrant-self or organizer). One shared authz guard. |
| **R7** | Public showcase live-updates = socket fan-out to many anonymous viewers | Public grid = cached SSR + light polling / revalidate; the real-time socket stays for operator/owner/spectate. Add an edge cache before opening the socket to the public. |
| **R8** | Presign (`requestMediaUpload`) has no rate limit → authenticated bucket storage-cost abuse | **ACCEPTED (Medium, P1)**: bounded by auth + 5 MB cap + real-PUT effort; a correct fix is a shared DB-backed per-actor/window limiter (mirror the OTP counter) — deferred, not a release blocker. |

---

## 9. Next step

Close **D1–D3** (gate P0/P2) and note **R1** (DPDP) as a P0 acceptance
criterion. Then the first PR is §3.1 + §3.2 — **already implemented on this
branch** (migrations `0017`/`0018`, `packages/core` `media.ts` + `player-profile.ts`
with tests, and the `media/storage-port.ts` seam). Remaining P0: capability-gated
`media/actions.ts` + upload route (**with the R6 guard**), the DPDP data-map
entry (**R1**), and the `<Avatar>`/`<Crest>`/`<ImageUploader>` primitives.
