# SEO-1 — Search visibility programme

**Status:** Plan · 2026-09-30 · audited against `main` @ 2646461a and live https://desiauction.in · **re-validated 2026-09-30** (see §7)
**Goal:** An organizer anywhere in India who searches for a way to run a player auction finds DesiAuction, and every public season we host becomes a page that search engines can find.

---

## 0. Where we stand (audit)

The foundations are better than most products at this stage. The gaps are about **what we offer searchers**, **how the setup holds up as routes are added**, and **measurement**. The basic plumbing is mostly in place.

### Already right — keep it

| Area | Evidence |
|---|---|
| robots.txt | `app/robots.ts` — consoles disallowed, spectate share cards deliberately opened |
| Live sitemap | `app/sitemap.ts` — `force-dynamic`, derived from the help/legal registries and public seasons (41 URLs live) |
| Canonicals | Present on almost every public page; directory slices carry `noindex` + canonical `/c` |
| Share cards | File-based OG/Twitter images for home, pricing, directory, season, team, player, spectate |
| Structured data | `SportsEvent` on `/c/[slug]`, XSS-safe via `server/seo/json-ld.ts` (PX-11 F2) |
| Host hygiene | `www` → apex 301 (`ops/deploy/site.caddy`); `/contact` → `/support` 308; real 404 with `noindex` |
| Privacy-correct noindex | Player and team pages are `noindex` (minors' data, DPDP); coming-soon pages are `noindex, follow` |
| Speed | Production TTFB 5–70 ms (page-load audit, 2026-09-24) |

### Gaps found

| # | Gap | Severity | Where |
|---|---|---|---|
| G1 | **No content that matches what people search for.** Nothing targets "cricket auction app", "IPL-style player auction software", "kabaddi auction", "box cricket auction" and similar queries. There are 12 sport packs and none has its own page. | **P0** | none exist |
| G2 | **No site-level structured data.** Home has no `Organization`, `WebSite` or `SoftwareApplication`, so Google has no entity to build a knowledge panel or sitelinks from. | **P0** | `app/page.tsx` |
| G3 | **No Search Console or Bing Webmaster Tools, and no search analytics.** We can't tell whether anything is indexed, ranked or clicked. | **P0** | none |
| G4 | **Indexing rules are a hand-kept denylist.** `/tournaments`, `/players`, `/auctions`, `/reports` and `/me` are missing from robots.txt. They only stay out of the index because each one redirects. The next console route will leak. | P1 | `app/robots.ts` |
| G5 | `/login` is indexable with no canonical, and every `?next=…` redirect creates another crawlable login URL | P1 | `app/login/page.tsx` |
| G6 | Sitemap has **no `lastModified`**, the only freshness signal Google uses (it ignores `changefreq` and `priority`). `/about`, `/security`, `/rules-guidelines` and `/schedule-demo` are indexable live but missing from the sitemap. | P1 | `app/sitemap.ts` |
| G7 | No title template: every page hand-writes `· DesiAuction`. `/help/faq` has no canonical. The 404 title is bare. | P2 | per page |
| G8 | `SportsEvent` is thin (no `eventStatus`, `image`, `sport`, `offers`, or organizer `url`), so it doesn't qualify for event rich results | P1 | `app/c/[slug]/page.tsx` |
| G9 | The engine and media subdomains send no `X-Robots-Tag`. Uploaded player photos (which can include minors) can end up in Google Images. | P1 | `ops/deploy/site.caddy` |
| G10 | Every page is `Cache-Control: no-store`, which rules out the back/forward cache on public pages. We have no field data on Core Web Vitals. | P2 | root layout reads the session |
| G11 | No backlink plan. `/overlay`, `/board` and share cards appear in public streams and WhatsApp with no link back. | P1 | broadcast surfaces |
| G12 | No automated guardrail. A missing canonical, a duplicate title or a stray `noindex` would ship without anyone noticing. | P1 | CI |

---

## 1. Founder decisions needed (before Phase 2)

| Decision | Recommendation | Why |
|---|---|---|
| D1 Analytics tool | **Self-hosted Umami or Plausible** (no cookies) plus Search Console | Avoids a DPDP consent banner and keeps data on our side. GA4 would need a consent banner. |
| D2 AI crawlers | **Allow** the search/answer crawlers (OAI-SearchBot, PerplexityBot, Claude-SearchBot) on public pages only. Decide separately on the *training* controls (`GPTBot`, `ClaudeBot`, and the `Google-Extended` token, which is not a crawler but controls Gemini's use of pages Googlebot already fetched). | Queries like "best app for cricket auction" are moving to AI answers, and being cited there is free distribution. Opting out of training doesn't affect Google Search ranking. |
| D3 Team squad pages | Keep `noindex` by default, and add an **organizer opt-in** "List squads in search" that is ignored when a season has registered minors. `date_of_birth` is nullable free text, so an **unknown age counts as a minor** (fail closed). | Squad pages match "‹league› squads" searches. Minors' data wins over traffic. |
| D4 Who writes guides | Founder (or a contracted writer) writes; engineering provides the page system | Real knowledge of running auctions is the advantage. AI-generated filler hurts rankings. |
| D5 Hindi | **Defer** until English pages are ranking. Then serve `/hi/...` with `hreflang`. | Twice the pages to maintain is only worth it once there's demand to match |

---

## 2. Phases

Each phase is **one PR** against `main`, with a conventional-commit title. Phases 1–3 are engineering-only and can ship now. Phases 4–6 need content.

### Phase 0 — Measure first (founder, ~1 hour, no code)

1. Verify **Google Search Console** as a *Domain property* using a DNS TXT record at **Hostinger** (DNS lives there, not Cloudflare).
2. Verify **Bing Webmaster Tools** by importing from Search Console. Bing's index also feeds DuckDuckGo and Yahoo, and is widely reported to feed some AI search products.
3. Submit `https://desiauction.in/sitemap.xml` to both.
4. Record the baseline: indexed pages, impressions, clicks, and the top 20 queries (probably all brand queries today).
5. **Google Business Profile: only if eligible.** Google requires in-person contact with customers at an address or within a service area. Online-only businesses aren't eligible, and a listing made anyway risks suspension. Skip it unless you meet organizers in person.

**Done when:** both consoles show the sitemap as "Success" and the baseline is saved in `docs/seo/baseline-2026-10.md`.

---

### Phase 1 — `feat(seo): one route registry for indexability` (P1, fixes G4 G5 G6 G7 G9) — **BUILT 2026-09-30** (see §8)

**The structural fix.** Today robots.txt, the sitemap and page metadata each keep their own list of public URLs. Replace these with a single registry and derive everything else from it, the same approach as `demand-sports.ts` ("declared once").

```
apps/web/src/server/seo/
  routes.ts        PUBLIC_ROUTES: { path, indexable, sitemap, lastModified?, changeFrequency? }
  metadata.ts      pageMetadata({ title, description, path, image?, noindex? }) → Metadata
  json-ld.ts       (exists) serializeJsonLd + new schema builders (Phase 2)
```

1. **Indexable by allowlist, not denylist.** In `middleware.ts`, send `X-Robots-Tag: noindex, nofollow` on every response whose path doesn't match `PUBLIC_ROUTES`. New console routes then start out non-indexable without anyone remembering to add them. Keep robots.txt `Disallow` for crawl budget, but generate it from the same registry.
   - The middleware matcher already skips `api/`, `brand/`, `marketing/` and `_media/`. However, the file-based metadata routes (`sitemap.xml`, `robots.txt`, `manifest.webmanifest`, `*/opengraph-image`, `*/twitter-image`) **do** pass through it, so they must be in the allowlist.
   - Google can't see a `noindex` on a URL that robots.txt disallows. If a console URL is ever found in the index, **remove its `Disallow` temporarily** so the header is seen, then put the `Disallow` back.
2. **Title template.** In the root `metadata`, set `title: { default: "DesiAuction", template: "%s · DesiAuction" }`, then remove the hand-written suffix from every page. Otherwise every title becomes `X · DesiAuction · DesiAuction`. The home page sets `title: { absolute: "DesiAuction — Live player auctions for your league" }` so it never depends on how the template applies to the root segment.
3. **`pageMetadata()` helper.** One call sets an absolute canonical, `openGraph.url`, the Twitter card, and a description length check (70–160 characters, asserted in tests). Move every public page onto it.
4. **`/login`:** add `robots: { index: false, follow: true }` and canonical `/login`, so `?next=` variants collapse into one URL.
5. **`/help/faq`:** add a canonical. **404:** use the title "Page not found · DesiAuction".
6. **Sitemap:**
   - Build it from the registry.
   - Add `/about`, `/security`, `/rules-guidelines` and `/schedule-demo`.
   - Add `lastModified`: marketing pages from a per-entry `updatedOn` in the registry (**not** the latest release date, which would mark every page as changed on every deploy and teach Google to ignore our lastmod values), help/legal from an `updatedOn` field added to each content entry, and seasons carry **no** lastmod: `competitions` has no updated-at column (the §7 claim that it exists was wrong; see §8).
   - Remove `priority`, and keep `changeFrequency` only where it's accurate.
7. **Subdomains** (`site.caddy`):
   - `__ENGINE_DOMAIN__`: add `header X-Robots-Tag "noindex, nofollow"`.
   - `__S3_DOMAIN__`: add `header X-Robots-Tag "noindex, noimageindex"`, so photos only reach search through pages that are allowed to show them.
8. **IndexNow.** When a season is published or unpublished, ping `api.indexnow.org` (key file at `/‹key›.txt`) so Bing and Yandex recrawl within minutes. Send it from the existing publish action via `after()`, and make sure a failure can never block publishing.

**Acceptance:** Every console path returns `X-Robots-Tag: noindex`. Every sitemap URL returns 200, has no `noindex`, and has a self-referencing canonical. No page title contains `· DesiAuction · DesiAuction`.

---

### Phase 2 — `feat(seo): structured data for the brand and the season` (P0/P1, fixes G2 G8) — **BUILT 2026-09-30** (see §9)

Add builders to `server/seo/json-ld.ts`. All output goes through `serializeJsonLd`, and nothing is inlined.

| Page | Schema | Notes |
|---|---|---|
| `/` | `Organization` (name, url, logo `/brand/icon-512.png`, `sameAs` social profiles, `contactPoint` with support email) + `WebSite` | Gives Google an entity for knowledge panels and sitelinks. Add `SearchAction` only if `/c?q=` becomes a real public search. |
| `/`, `/pricing` | `SoftwareApplication` (`applicationCategory: "SportsApplication"`, `operatingSystem: "Web"`, since there's no native app to claim, `offers: { price: 0, priceCurrency: "INR" }`) | Helps Google and AI engines understand what the product is. **Won't earn a rich result yet:** Google's software-app rich result *requires* `aggregateRating` or `review`. Add those only once real reviews (FR-1) are shown on the page. Invented ratings are a manual-action offence. |
| `/c/[slug]` | Richer `SportsEvent`: `eventStatus`, `eventAttendanceMode`, `image` (the OG card), `sport`, `organizer.url`, `location` as a `Place` **with a `PostalAddress`**, `offers` (registration fee, `validThrough` = registration close), `competitor` (teams, names only) | Google event rich results *require* `location.address`. Today `location` is a free-text name, so fill the address from the season's **venue** (the club venues tab) and emit the event markup only when a real address exists. |
| `/help/[slug]` | `TechArticle` + `BreadcrumbList` | |
| `/help/faq`, `/pricing` FAQ | `FAQPage` | Google now shows FAQ rich results mainly for government and health sites, but AI answer engines read this markup heavily. It's cheap and does no harm. |
| `/help/*`, `/legal/*`, `/c/[slug]` | `BreadcrumbList` | Shows breadcrumb paths in search results |

**Not planned: a LIVE badge for the spectate room.** Google's livestream markup (`BroadcastEvent` + `isLiveBroadcast`) only applies to a `VideoObject`, and the spectate room isn't a video. Revisit this only if a season embeds a YouTube stream.

**Acceptance:** The Schema.org validator shows zero errors on home, one season, one help article and the FAQ. Google's Rich Results Test shows valid Breadcrumb markup, plus Event markup on a season that has a venue address.

---

### Phase 3 — `test(seo): guardrail suite in CI` (P1, fixes G12) — **BUILT 2026-09-30** (see §10)

A Playwright spec (`e2e/seo.spec.ts`) plus a unit test run against the registry. It runs in the existing precompiled e2e job.

- For every `PUBLIC_ROUTES` entry that is `indexable`, check:
  - status 200
  - exactly one `<title>`, unique across the set
  - description 70–160 characters
  - absolute self-canonical
  - no `noindex` meta or header
  - exactly one `<h1>`
  - every `<img>` has `alt`
  - every `ld+json` block parses and has an `@type`
- For a sample of console routes, check they return `X-Robots-Tag: noindex`.
- `sitemap.xml`: parses, every `<loc>` is in the registry or is a public season, and each one passes the checks above.
- `robots.txt` matches the snapshot built from the registry.
- A **unit test** that fails if a new `page.tsx` under `app/` is neither in `PUBLIC_ROUTES` nor under a known console prefix. This forces a deliberate decision on every new route.

Also run **Lighthouse CI** (SEO category must score 100; performance budgets from `docs/57-performance-budgets.md`) on `/`, `/pricing`, `/c`, one season and one help article.

---

### Phase 4 — `feat(marketing): sport and use-case landing pages` (P0, fixes G1) — **4a–4d BUILT 2026-09-30/10-01** (see §11–§14)

This is where the traffic comes from. Build pages from the **sport pack registry** in `packages/core/src/sports`, but write the copy by hand. Pages are templated for layout only.

**4a. Sport pages** at `/sports/[sport]`, starting with the six most requested sports according to `demo_requests.sport`:

| URL | Primary query cluster (to confirm in Phase 0 keyword research) |
|---|---|
| `/sports/cricket` | cricket player auction app · IPL style auction for local tournament · cricket auction software |
| `/sports/box-cricket` | box cricket auction · turf cricket league auction |
| `/sports/football` | football player auction · 5-a-side league auction |
| `/sports/kabaddi` | kabaddi player auction · pro kabaddi style auction |
| `/sports/badminton`, `/sports/volleyball`, `/sports/esports` (BGMI) | "‹sport› league auction", "‹sport› team auction" |

Each page contains:
- an H1 built on the query ("Run a cricket player auction, IPL-style")
- the roles the pack actually uses (batter, bowler, all-rounder…), taken from the pack
- a 60-second walkthrough using the real screens from `scripts/capture-marketing-screens.ts`
- a "Seasons running now" strip of public seasons in that sport (live internal links to `/c/…`)
- 5–8 FAQs specific to the sport
- a call to action for sign-up or `/schedule-demo?sport=…`

**Only ship a sport page when it has real, sport-specific content.** Thin copies of one template hurt the whole domain.

**4b. Use-case pages** at `/for/[audience]`: corporate leagues, housing-society / RWA premier leagues, college fests, village and district tournaments, turf and academy owners. Each one covers the audience's real constraints, such as WhatsApp registration, a projector in a hall, or collecting the purse in cash.

**4c. Comparison pages** where people are actually searching: `/compare/spreadsheet-vs-desiauction` (the main alternative is a WhatsApp group plus Excel) and `/compare/‹named competitor›` **only once each claim is checked and dated**.

**4d. Free tools** (link magnets, no login): purse and base-price calculator, team-balance / snake-draft helper, and a Google Form registration template that imports cleanly (this reuses the import-mapping work). Every tool leads into the product.

**Internal linking:** add the sport pages to the footer (`PublicShell footerGroups`), link them from `/features` and relevant help articles, and have every sport page link to its help guides.

---

### Phase 5 — `feat(seo): public seasons as the long-tail engine` (P1) — **BUILT 2026-10-01** (see §15)

Every public season can rank for "‹league name› auction 2026", "‹league› squads" and "‹league› points table", which are low-competition, high-intent searches.

1. **Title pattern:** `‹Season› auction ‹year› — teams, squads & results`. The description comes from real facts: organizer, location, number of teams, top buy.
2. **Content that stays useful after the auction:** a result summary (teams, total spend, top buys), a points table and results once fixtures are played, and a replay link. The page should grow with the season instead of going stale.
3. **Squad pages** (`/c/[slug]/t/[team]`) become indexable only under D3 (organizer opt-in, and never when minors are present).
4. **Clean slugs:** today every slug is `name-‹last 4 of the id›` (`server/competition/competitions.ts:53`). That suffix is also what guarantees uniqueness, and what stops a season from ever taking the slug `sport` or `city`. To drop it for new seasons (`vpl-2026`), add a uniqueness check that falls back to the suffix on a clash, and a **reserved-slug list** (`sport`, `city`, and every static segment under `/c`). Existing slugs stay as they are, because they're printed on QR codes. The ranking gain is small, so this is optional.
5. **Directory `/c`** gets crawlable facet pages *only* for sport and city (`/c/sport/cricket`, `/c/city/jaipur`), each with unique intro copy. Ship a city page only once it has at least 3 public seasons. Search and filter combinations stay `noindex` as they are now.
6. **Unpublishing** keeps returning 404 (Google treats 404 and 410 nearly the same, and a 410 would need a route handler outside Next's `notFound()`). IndexNow reports the removal.

---

### Phase 6 — `feat(content): guides that answer the question` (P1, ongoing) — **FIRST 10 BUILT 2026-10-01** (see §16)

1. Turn the `/blog` placeholder into `/guides` (keep `/blog` as a 301). It stays `noindex` **until at least 6 real articles exist**.
2. **The first 10 articles** target how-to searches organizers already make:
   - How to run an IPL-style auction for your local cricket tournament
   - How much purse and base price to set, with worked numbers
   - Auction rules template (RTM, icon players, captains, retained players)
   - Player registration form for a cricket tournament, with a free template
   - How to project a live auction on a big screen
   - Snake draft vs auction: which one suits your league
   - Running a society premier league, start to finish
   - Collecting auction money without chaos
   - Box cricket league: format, rules, auction
   - Kabaddi league auction: roles and budgets
3. Each guide has an author byline (a real person, which counts for E-E-A-T), a date, `Article` schema, screenshots from real auctions, and links into the product and the matching sport page.
4. Publish **2 guides a month**, and refresh the top 5 every quarter (update `dateModified` only when the content really changes).
5. The 17 help articles and 5 help categories are indexable already. Improve their titles to match the question an organizer would type.

---

### Phase 7 — Authority and backlinks (P1, founder + engineering) — **engineering half BUILT 2026-10-01** (see §17)

| Tactic | Owner | Detail |
|---|---|---|
| "Powered by DesiAuction" | Eng | A clickable link on public season pages and embeds (real backlinks). On `/overlay`, `/board` and share cards it's a visible wordmark: it builds the brand in streams and WhatsApp, but a video overlay can't pass link value. |
| Organizer embed | Eng | `<iframe>` or script snippet for live auction or squad widgets that organizers put on their own sites, with a link back |
| Stream kit | Founder | Suggested YouTube description text with a link to the season page, handed over when an organizer goes live |
| Directories | Founder | Product Hunt launch, G2, Capterra/GetApp India, SaaSworthy, Techjockey, AlternativeTo |
| Communities and PR | Founder | Local sports journalists (a city league's auction is a story), cricket academy and turf-owner associations, college fest sponsorships |
| Case studies | Founder | Each real season that agrees to it becomes a `/case-studies/‹league›` page (turning off that placeholder's `noindex`) |

---

### Phase 8 — Core Web Vitals in the field (P2, fixes G10) — **BUILT 2026-10-01** (see §18)

1. **RUM:** a `web-vitals` reporter sends LCP, INP and CLS to `/api/vitals` (sampled at 10%, no personal data), shown on `/admin/health`.
2. **Back/forward cache on public pages (investigate first):** `no-store` is what Next itself emits for a dynamically rendered page, and the root layout's session read makes every page dynamic. Overriding the header needs a proof-of-concept first, to confirm Next doesn't overwrite it and that no signed-in HTML can be cached. Treat it as a UX win (instant back navigation), not a ranking factor.
3. Audit the LCP element per public page: hero image `priority`, font `display: swap`, no layout shift from the shell.
4. **Targets (p75, mobile, 4G India):** LCP < 2.0 s, INP < 200 ms, CLS < 0.05.

---

## 3. Keyword map (to confirm in Phase 0)

Use Search Console, Google Keyword Planner (India, English + Hindi), and "People also ask" / autocomplete. Assign **one primary cluster per URL**, and never target the same cluster from two pages.

| Intent | Example queries | Target URL |
|---|---|---|
| Commercial, generic | player auction app · online auction for tournament · IPL auction software | `/` |
| Commercial, by sport | cricket / kabaddi / football auction app | `/sports/[sport]` |
| Commercial, by audience | corporate cricket league app · society premier league auction | `/for/[audience]` |
| Pricing | free cricket auction app · auction software price | `/pricing` |
| Informational | how to conduct a player auction · auction rules for local tournament | `/guides/*` |
| Tools | purse calculator · cricket registration form template | `/tools/*` |
| Navigational, long tail | ‹league› auction 2026 · ‹league› squad | `/c/[slug]` |
| Brand | desiauction · desi auction login | `/`, `/login` (noindex, brand sitelink) |

---

## 4. KPIs and cadence

**The targets below are placeholders.** Reset them from the Phase 0 baseline and the real keyword volumes; don't hold anyone to them before then.

| Metric (Search Console, unless noted) | Baseline | 90 days | 180 days |
|---|---|---|---|
| Indexed pages (valid) | ~41 | 100+ | 250+ (seasons + content) |
| Non-brand impressions / month | ≈0 | 20k | 100k |
| Non-brand clicks / month | ≈0 | 500 | 3,000 |
| Queries ranking top 10 | brand only | 30 | 150 |
| Sign-ups from organic search / month (analytics) | unknown | 20 | 100 |
| Valid structured data (Search Console enhancements) | SportsEvent only, no address | Breadcrumb + Event (seasons with a venue), 0 errors | + Article on guides, 0 errors |
| CWV "Good" URLs (field) | unknown | ≥ 90% | ≥ 95% |

**Cadence:**
- **Weekly:** check Search Console for coverage errors and failed rich results (15 min).
- **Monthly:** query review, including which new queries need a page and which pages have lost clicks.
- **Quarterly:** content refresh and a backlink audit.

---

## 5. Guardrails (non-negotiable)

1. **Privacy beats traffic.** Player pages stay `noindex`. Minors' squads are never indexed. Uploaded photos are `noimageindex`. Phone numbers never appear in any public HTML or JSON-LD. This follows the rule "gate the data, not the button".
2. **No invented signals.** No fake ratings, fake reviews, invented case studies or placeholder pages kept indexable. This matches the existing "honest placeholder" rule.
3. **No thin programmatic pages.** A sport, city or use-case page ships only with content unique to it.
4. **URLs that already exist never break.** Any rename uses a single-hop 301. `/c/[slug]` stays as it is.
5. **Every new route states its indexability.** The Phase 3 test enforces this.

---

## 6. Delivery order

| Order | PR | Size | Blocks on |
|---|---|---|---|
| 1 | Phase 0 (no PR) | 1 hr founder | — |
| 2 | Phase 1 — route registry + indexability | M | — |
| 3 | Phase 2 — structured data | S–M | Phase 1 helpers |
| 4 | Phase 3 — SEO guardrail suite + Lighthouse CI | M | Phase 1 registry |
| 5 | Phase 4a — cricket, box-cricket, football, kabaddi pages | L (content-heavy) | D4, keyword research |
| 6 | Phase 5 — season long-tail + facets | M | D3 |
| 7 | Phase 4b/4c/4d — use-case, comparison, tools | L | content |
| 8 | Phase 6 — guides (ongoing) | ongoing | D4 |
| 9 | Phase 7 — powered-by links + embed | S–M | — |
| 10 | Phase 8 — RUM + bfcache | S | — |

Phases 1–3 are pure engineering, roughly one focused week. Most of the ranking gains come from Phases 4–6, and those depend on content.

---

## 7. Validation log (2026-09-30)

Every factual claim was re-checked against the code, the live site and current search-engine documentation.

**Confirmed:**
- The robots.txt denylist is missing `/tournaments`, `/players`, `/auctions`, `/reports` and `/me`. Live, they 307 to `/login?next=…`.
- `/login` is live without `noindex` or a canonical. Its only metadata is `title: "Continue to DesiAuction"`.
- `/help/faq` has no canonical. The 404 title is a bare "DesiAuction".
- The live sitemap has 41 URLs and 0 `<lastmod>` entries.
- The home page has 0 `ld+json` blocks.
- `/about`, `/security`, `/rules-guidelines` and `/schedule-demo` are indexable but missing from the sitemap.
- The engine and media Caddy blocks send no `X-Robots-Tag`.
- `server/seo/json-ld.ts`, `src/middleware.ts`, `scripts/capture-marketing-screens.ts`, `/admin/health` and `PublicShell footerGroups` all exist. (`competitions.updated_at` does **not**. The match was a neighbouring table. Corrected in §8.)

**Corrected in this revision:**
1. `/schedule-demo` added to the sitemap gap (G6).
2. Help content is 17 articles + 5 categories, not 26.
3. `SoftwareApplication` markup alone can't earn a rich result, because Google requires ratings or reviews.
4. Event rich results require a postal address. Our `location` is free text, so event markup now depends on a venue address.
5. The livestream LIVE badge is removed: it applies only to `VideoObject`.
6. `Google-Extended` is a training-control token, not a crawler (D2).
7. Google Business Profile isn't available to online-only businesses.
8. Returning 410 on unpublish was dropped. 404 is equivalent for Google and native to Next.
9. The back/forward-cache header change fights Next's own `no-store`. It's now "investigate first" and not claimed as a ranking factor.
10. Readable slugs need a uniqueness fallback and a reserved list, because the id suffix is what currently prevents clashes.
11. `lastModified` must not be derived from release dates.
12. Overlay "powered by" is branding, not a backlink. The middleware allowlist must include file-based metadata routes. `noindex` is invisible on disallowed URLs. Unknown DOB counts as a minor. KPIs are placeholders until the baseline exists.

---

## 8. Phase 1 delivery log (2026-09-30)

**Shipped on `feat/seo-route-registry`:**

| Item | Where |
|---|---|
| Route registry: `INDEXABLE_PAGES`, public subtrees and patterns, `CONSOLE_SEGMENTS`, `isPublicPath` | `apps/web/src/server/seo/routes.ts` |
| `X-Robots-Tag: noindex, nofollow` on every page the registry doesn't claim | `apps/web/src/middleware.ts` |
| robots.txt generated from the registry, rendered per request | `apps/web/src/app/robots.ts` |
| Sitemap from the registry. Real `lastmod` on 44 URLs: pages, help categories, articles, legal. | `apps/web/src/app/sitemap.ts` |
| Help articles carry `updatedOn`, dated from `git blame` of each article's own lines | `apps/web/src/content/help.ts` |
| Title template `%s · DesiAuction`. The hand-written suffix removed from 101 titles in 93 files (AST edit; `openGraph`/`twitter` titles untouched). | root `layout.tsx` + pages |
| `/login`: `noindex, follow` + canonical `/login` (collapses `?next=` variants) | `app/login/page.tsx` |
| `/help/faq` canonical + real description. 404 title "Page not found". | `help/[slug]`, `not-found.tsx` |
| IndexNow ping on publish/unpublish (in `after()`, never throws, off without `INDEXNOW_KEY`), key served at `/indexnow-key.txt` | `server/seo/indexnow.ts`, `app/indexnow-key.txt/route.ts` |
| `INDEXNOW_KEY` generated for production only | `ops/deploy/init-env.sh`, `.env.example`, `env.ts` |
| `X-Robots-Tag` on the engine host (`noindex, nofollow`) and the media host (`noindex, noimageindex`) | `ops/deploy/site.caddy` |
| Tests:<br>• every top-level `app/` segment classified exactly once<br>• no Disallow prefix swallows a public page<br>• indexable pages exist and have valid dates<br>• robots and sitemap stay dynamic<br>• public/private path matrix<br>• IndexNow behaviour | `server/seo/routes.test.ts`, `server/seo/indexnow.test.ts` |

**Found while building:**
1. **Production bug:** live `robots.txt` announced `Sitemap: https://build.invalid/sitemap.xml`. `robots.ts` was prerendered during the image build, when the base URL is a placeholder. It's now `force-dynamic`, with a test to keep it that way.
2. `/seasons/[slug]/register` is a public, widely shared page whose own metadata says `noindex, follow`. It's now public in the registry (so the header can't add `nofollow`) and allowed in robots.txt, like the spectate room, so Twitterbot can read its card.
3. `competitions` has no updated-at column, so season URLs have no `lastmod`. Adding one is a Phase 5 item (a migration plus writers).

**Founder, after merge and deploy:**
1. `sudo set-secret production INDEXNOW_KEY web.env` (any 32 hex characters, e.g. `openssl rand -hex 16`), then restart web. Check that `https://desiauction.in/indexnow-key.txt` returns it.
2. The Caddy change ships with the next host deploy. Check it with `curl -sI https://engine.desiauction.in | grep -i x-robots`.
3. Resubmit the sitemap in Search Console and Bing, now that robots.txt names the real one.

---

## 9. Phase 2 delivery log (2026-09-30)

**Built on `feat/seo-structured-data`, stacked on Phase 1. Open its PR only after #173 merges, and against `main`.**

| Page | Markup |
|---|---|
| `/` | `Organization` (logo, support contact, `sameAs` only for real profile URLs), `WebSite`, `SoftwareApplication` (free, `operatingSystem: Web`, no ratings) |
| `/pricing` | `SoftwareApplication`, `FAQPage` (the 4 rendered questions), `BreadcrumbList` |
| `/help/faq` | `FAQPage` (the 7 rendered questions), `BreadcrumbList` |
| `/help/[slug]` | `TechArticle` (`dateModified` = `updatedOn`), `BreadcrumbList` (Home › Help › Category › Article) |
| `/help/category/[slug]`, `/legal/[slug]` | `BreadcrumbList` |
| `/c/[slug]` | `BreadcrumbList` always. `SportsEvent` **only** when the season has a start date and a single venue with an address or city. |

**How it works:**
- Builders are pure functions in `server/seo/json-ld.ts`.
- `<JsonLd>` (`components/seo/json-ld.tsx`) is the only renderer. It serializes XSS-safely and carries the request's CSP nonce.
- A builder returns `null` when a required field can't be filled honestly.

**Season venue:**
- `seasonVenueOf` (`server/competition/fixtures.ts`) returns the one venue that every public, uncancelled match is played at. It returns null for none, or for more than one.
- The venue (name, address, city, each part once) now shows in the season hero. The markup states nothing the page doesn't show.
- **Behaviour change:** a season with no matches at a venue loses the old address-less `SportsEvent`, which Google treated as invalid anyway. It keeps its breadcrumb.
- Organizers get event rich results by putting their matches on a venue that has an address.

**Found while building:**
- Every `<script>` must carry the CSP nonce, JSON-LD included. The old season-page block never had one; the CSP spec only checked `/`, so nobody noticed.
- The spec now also checks `/pricing`, `/help/faq`, a help article and a legal page.

**Not done, and why:**
- **`offers` on events:** there is no season-level entry fee (fees are per registration).
- **`organizer.url`:** a club has no public page.
- **`SearchAction`:** `/search` isn't a public results page.
- **LIVE badge:** livestream markup applies only to `VideoObject`.

**Tests:**
- `server/seo/schema.test.ts` (15 cases): no placeholder social profiles, no ratings, FAQ markup matches the rendered questions, and no event without an address.
- `fixture-ops.regression.test.ts`: `SEASON VENUE`, covering one venue, then two (in a rolled-back transaction).
- e2e: `public-registration` (breadcrumb, and no event without a venue) and `content-security-policy` (nonce on JSON-LD).

**After deploy:** run Google's Rich Results Test on `/`, `/pricing`, `/help/faq`, a help article, and a season with a venue address. Search Console › Enhancements should then list Breadcrumbs (and Events, once a season has a venue).

---

## 10. Phase 3 delivery log (2026-09-30)

**Built on `feat/seo-guardrails`, stacked on Phase 2 (#174). Its PR targets `main`.**

**`apps/web/e2e/seo.spec.ts`** runs in the existing precompiled e2e job and reads the route registry, not a list of its own. It checks:
- robots.txt names the **runtime** sitemap (never `build.invalid`) and disallows every console segment.
- The sitemap lists every `INDEXABLE_PAGES` entry.
- Every static sitemap URL, plus a sample of 3 public seasons, as a phone would fetch it:
  - status 200, and no noindex header or meta
  - exactly one `<title>` with the suffix once, unique across the set
  - description of 50–160 characters
  - absolute self-canonical
  - exactly one `<h1>`
  - no `<img>` without `alt`
  - every JSON-LD block parses with `@context`/`@type`
  - title, description and canonical **inside `<head>`**
- Head placement as a phone, Googlebot, GPTBot, ClaudeBot, PerplexityBot and facebookexternalhit.
- Consoles return `x-robots-tag: noindex, nofollow`. `/login`, `/login?next=…`, `/blog` and directory searches say `noindex, follow`, and `/login?next=…` canonicalises to `/login`.

Each check was shown to fail first:
- Tightening the description floor named the short pages.
- Disabling the head fix named every visitor type.

**Lighthouse CI** (`apps/web/lighthouserc.json`, CI e2e job, reports uploaded as the `lighthouse` artifact):
- SEO = 100 is enforced. Performance, accessibility and best practices are warnings (docs/57 updated to say so).

**Found and fixed:**
1. **Next 15 streamed `<title>`, description and canonical into `<body>` for phones, Googlebot and the AI crawlers.** Next's list of crawlers that get metadata in `<head>` omits GPTBot, OAI-SearchBot, ClaudeBot and PerplexityBot. Google only honours a canonical in `<head>`. Fixed with `htmlLimitedBots: /.*/` in `next.config.mjs`. This costs nothing here, because the root layout already awaits its reads before the first byte.
2. **Descriptions:**
   - The home page's was 186 characters, cut off in results. It's now 159.
   - Nine pages were under 50: About, Support, Releases, two help categories and three legal summaries. Each was rewritten from the page's own content. The help and legal ones also show as card copy.
3. **`/c`'s raw HTML carries two identical `<h1>`s:** the streamed loading skeleton keeps its own. That is **kept on purpose**. Removing it failed the axe scan (`page-has-heading-one`), because during a client-side navigation the skeleton is the whole page. The SEO spec's rule is therefore "at least one `<h1>`, and they all say the same thing".

**Baseline for Phase 8:** LCP is 3.6–3.9s on the reference mobile profile (budget 2.5s). Accessibility and best practices are 100; CLS and TBT are negligible.

---

## 11. Phase 4a delivery log (2026-09-30)

**Built on `feat/seo-sport-pages`, stacked on Phase 3 (#175). Its PR targets `main`.** Founder decisions: **publish on merge** (no draft stage), and **all twelve sports** rather than the first four.

**What shipped:**
- `/sports/[slug]` for all 12 sport packs, plus a `/sports` hub.
- A footer link (Product › Sports).
- Pages are in the route registry and the sitemap, with a real `lastmod` from `updatedOn`.

| URL | Sport |
|---|---|
| `/sports/cricket` | Cricket (IPL-style) |
| `/sports/box-cricket` | Box cricket |
| `/sports/football` | Football |
| `/sports/kabaddi` | Kabaddi |
| `/sports/volleyball` | Volleyball |
| `/sports/hockey` | Hockey |
| `/sports/basketball` | Basketball |
| `/sports/esports` | Esports (team titles) |
| `/sports/badminton` | Badminton (team ties) |
| `/sports/table-tennis` | Table tennis (team ties) |
| `/sports/pickleball` | Pickleball (team ties) |
| `/sports/battle-royale` | BGMI / battle royale (lobbies) |

**Written vs derived:**
- `content/sports.ts` holds only the words a person writes: title, headline, a 50–160 character description, lede, three angles specific to the sport, and 3–4 FAQs specific to the sport.
- Everything factual renders from the sport pack in `@desiauction/core`: roles, player attributes and their options, points per result, tiebreakers in words, what is entered after a match (entry labels, so cricket says "overs"), and lobby placement scoring. A page cannot contradict the engine.

**Honesty checks made while writing:** every claim was verified in code before shipping.
- The squad maximum and the reserve rule (`auction.ts:520–527`), base prices, points auctions, captains signed before the auction, icons kept out of the pool, and the purse board.
- One claim was found **untrue** and removed: an owner-facing count of players "left in each role" doesn't exist. Twelve angles were rewritten to say what is actually shown: the role on the auction card, and each team's remaining purse.

**Structured data:** `FAQPage` (the rendered questions) and `BreadcrumbList` (Home › Sports › Sport). The hub has `BreadcrumbList`.

**Tests:**
- `content/sports.test.ts`:
  - one page per pack, and every page a real pack
  - unique slugs, titles, headlines and descriptions
  - descriptions of 50–160 characters
  - every tiebreaker key has words
  - **no paragraph repeated across pages** (caught a pickleball FAQ copied from table tennis)
  - real dates
- `e2e/sport-pages.spec.ts`:
  - hub has 12 links
  - cricket, basketball and battle royale render their pack's own rule sentences
  - axe clean in both themes
  - unknown sport → 404
  - no overflow at 360px
- `/sports/cricket` added to the CSP spec's public list. `seo.spec.ts` now also covers all 13 new URLs through the sitemap.

**Follow-ups:**
- The "auction night" screenshots are from a *cricket* practice auction on every sport page. The caption is honest, but `scripts/capture-marketing-screens.ts` could capture one per sport.
- "Book a demo" can't pre-select the sport: `/schedule-demo` takes only a validated `from` source. Adding `sport` there means touching its closed list and the operator console.
- Real keyword volumes (Phase 0) should re-rank which pages get deeper content first.
- **4b–4d** are still to do: use-case pages (`/for/…`), comparison pages, and free tools.

---

## 12. Phase 4b delivery log (2026-09-30)

**Built on `feat/seo-audience-pages`, stacked on Phase 4a (#178). Its PR targets `main`.** Published on merge, as with 4a.

**What shipped:**
- `/for` (hub) and five audience pages: `/for/corporate-leagues`, `/for/housing-societies`, `/for/college-fests`, `/for/village-tournaments` and `/for/turfs-and-academies`.
- A footer link (Product › Who it's for).
- Pages are in the route registry and the sitemap. They carry `FAQPage` + `BreadcrumbList` markup.

Each page has:
- three points that belong to that audience, e.g. entry-fee tracking for societies, cash collections and numbered receipts for village tournaments, BGMI/esports and a streamable board for fests
- the season in that audience's own steps
- links to the sport pages that audience plays (internal links into 4a)
- its own FAQs

**Checked in code before being written:**
- WhatsApp **share links** exist (registration, spectate, owner invites). Automated WhatsApp **messages** depend on provider credentials, so they are not claimed.
- Other confirmed capabilities:
  - per-player entry-fee status (pending/paid/waived/refunded)
  - cash/UPI/bank collections and numbered receipts
  - points auctions
  - an appointed auctioneer (`server/auction/auctioneers.ts`)
  - seasons that recur under one tournament
  - open/men/women/mixed categories
  - no phone numbers on public pages
- One claim was narrowed: the category is said on the **public page** (confirmed), not "on the registration form" (not confirmed).

**Tests:**
- `content/audiences.test.ts`:
  - unique slugs, names, titles, headlines and descriptions
  - 50–160 character descriptions
  - sport links resolve
  - no paragraph repeated **across audience and sport pages**. It compares answers alone, which is stricter than the 4a test, and found three identical answers in the 4a sport pages (hockey/football, table tennis/badminton, pickleball/esports). All three were rewritten here.
- `e2e/audience-pages.spec.ts`:
  - hub has 5 links
  - corporate and village pages show their own words and steps
  - axe clean in both themes
  - a sport card lands on its sport page
  - unknown → 404
  - no overflow at 360px

---

## 13. Phase 4c delivery log (2026-09-30)

**Built on `feat/seo-compare-pages`, stacked on Phase 4b (#179). Its PR targets `main`.** Founder decision: **generic comparisons only**, with no named competitor. Nothing about anyone else's product needs verifying or can go stale.

**What shipped:**
- `/compare` (hub), `/compare/spreadsheet-and-whatsapp` and `/compare/manual-auction`.
- A footer link (Product › Compare), sitemap and route-registry entries, and `FAQPage` + `BreadcrumbList` markup.

**How the pages are built:**
- A real `<table>` (caption, column and row headers) on wide screens. On a phone the same rows render as **cards with both sides stacked**: at 360px the table's DesiAuction column had sat off-screen, so a phone visitor saw only the old way. Whichever form doesn't fit is `display: none`, so a screen reader meets exactly one.
- **Fair to the old way:** every page has a "When … is enough" section, saying plainly when a sheet and a group, or a manual auction, is the right tool.
- **Every "with DesiAuction" claim was checked in code:**
  - the bid checks in `auction.ts` (base, current, increment, purse, reserve)
  - one registration per player per season (unique index)
  - round-robin fixtures, with double-booking refused
  - undo as a recorded reopening
  - the night's replay
  - CSV exports for players and the schedule
- One over-strong claim was narrowed: squads get their own public team pages, not "on the season page as the gavel falls".

**Found while testing:**
- **Titles that already name the brand** ("… vs DesiAuction") had the suffix added a second time. The SEO guardrail caught it; these pages now use absolute titles.
- **Two landmarks shared one name** (the section and the table's scroll region). axe `landmark-unique` caught it, and the region now has its own label.
- **Lowercased names** produced "spreadsheet + whatsapp group". Each page now carries a written in-sentence name (`inSentence`) and its own `enoughTitle`.

**Tests:**
- `content/comparisons.test.ts`:
  - unique fields
  - 50–160 character descriptions
  - ≥ 5 rows filled on both sides
  - a substantive "enough" section
  - no paragraph repeated from any other landing page
- `e2e/compare-pages.spec.ts`:
  - the hub
  - the table's headers and the "enough" heading
  - axe in both themes
  - at 360px: no page overflow, table hidden, and both sides of a card visible on screen (plus axe)
  - unknown → 404
- E2E across all landing pages, seo, CSP, public pages and the shell: **38/38**.

---

## 14. Phase 4d delivery log (2026-10-01)

**Built on `feat/seo-free-tools`, stacked on Phase 4c (#181). Its PR targets `main`.**

**What shipped:**
- `/tools` (hub) and three tools that need no sign-in, each with `FAQPage` + `BreadcrumbList` markup.
- A footer link (Tournaments › Free tools), sitemap and route-registry entries.

| Tool | Built on |
|---|---|
| `/tools/purse-calculator` | the auction's own `maxAffordableBid` (the reserve rule), `DEFAULT_AUCTION_CONFIG` / `pointsSlabs` (increments) and `validateAuctionConfig`, in rupees or points |
| `/tools/registration-form` | the importer's own column labels (`IMPORT_FIELD_LABELS`) and each pack's roles. **`content/tools.test.ts` runs every sport's template through the real import** (`detectMapping` → `applyMapping` → `parseRegistrationRecords`) and expects zero errors. Rewording one heading fails 24 of 25 cases (checked). |
| `/tools/snake-draft` | a pick order that reverses every round. It says plainly that DesiAuction runs auctions, not drafts. |

**Found while building:**
1. **Sport attributes other than cricket's are not imported.** Packs declare `headerAliases` for preferred foot, grip, playing hand and spiking hand, but `import-mapping.ts` never reads them.
   - The Phase 4c FAQ claim ("matched to … the sport's attributes") was **narrowed** to name, phone, role, and batting/bowling style for cricket.
   - The template lists only fields the import reads.
   - Wiring the attributes into the import was flagged as its own engineering task.
2. **`template.tsx` is a reserved Next.js file name** (a route template). A component file with that name broke `/tools/registration-form` with a 500 ("Element type is invalid … got: object"). It was renamed `form-template.tsx`.
3. **Date tests compared UTC dates.** Between 00:00 and 05:30 IST, content dated "today" counted as the future and failed. All content-date tests now use `istCalendarDate()`, the product's calendar.
4. **Calculator copy:**
   - An unverified claim that organizers can set their own increment steps was removed. The steps are shown in the room; no setup screen edits them.
   - The phone note no longer says the phone is "how a player signs in", because sign-in is email-first.
5. axe `definition-list`: explanatory `<p>`s inside a `<dl>` became `<dd>`s. The build warning `align-items: end` became `flex-end`.

**Tests:**
- `content/tools.test.ts`: template through the importer for all 12 sports, plus tool entries.
- `app/tools/snake-draft/draft.test.ts`.
- `e2e/tools.spec.ts`:
  - hub
  - calculator: ₹80,000 first bid from the reserve rule, a purse-too-small warning, and a points ladder of +5 pts, with axe in both themes
  - template switches sport
  - draft reverses round 2
  - no overflow at 360px
- E2E across every landing page, seo, CSP, public pages and the shell: **43/43**.

---

## 15. Phase 5 delivery log (2026-10-01)

**Built on `feat/seo-season-pages`, stacked on Phase 4d (#182).** Founder decision D3: **organizer opt-in for squad pages, never with minors.**

**Migration `0099_season_search_listing`** (hand-authored; journal `when` = previous + 1 day, per the known skip trap; verified with `\d competitions`):
- `competitions.list_squads_in_search boolean not null default false`: the organizer's opt-in.
- `competitions.updated_at timestamptz not null default now()`, backfilled from `created_at` and kept by a `BEFORE UPDATE` trigger. It fires only when a value actually changes (`OLD.* IS DISTINCT FROM NEW.*`). This is the repo's first trigger, chosen because seasons are written from many places and a column a writer forgot to touch would lie.

**Squad pages in search:**
- The rule (`server/seo/squads.ts`, pure and tested) requires the opt-in **and** every *approved* registration in the season to have a date of birth that proves 18+.
- It fails closed like `mayPublishPhoto`: an unknown or unparseable date blocks. It's season-wide, so approving one minor takes every squad back out.
- The team page's `robots` follows the rule, and the sitemap lists squad URLs only for eligible seasons.
- The organizer switch "Squads in search" sits under "Public page" on the season overview (managers only). It explains exactly why squads aren't listed ("2 approved players have no date of birth or are under 18"). `setSquadListingAction` is gated by `competition.manage` and audited as `competition.squad_listing_changed`.

**Season titles and descriptions** (`server/seo/season-copy.ts`, pure and tested):
- Titles follow the season: "‹Name› ‹year› — player registration & auction" before the auction, and "‹Name› ‹year› auction — teams, squads & results" after. The year and "auction" are added only if the name lacks them.
- Descriptions are built from facts the page shows (organizer, sport, place, dates, team count, and the top buy's **team and price**, never a player's name). They use whole sentences and stay at 160 characters or fewer.

**Sitemap freshness:** each season's `lastmod` is the latest of its row, its public fixtures (published/completed/cancelled), its results and its auction's last event (`publicSeasonSitemap`).

**Found while building:** Drizzle renders a single-table select's columns unqualified, so `competitions.id` inside the lastmod subqueries became an ambiguous bare `"id"`. The typechecker accepted it; `season-search.regression.test.ts` caught it. The expression is now fully qualified.

**Not done, deliberately:**
- **Clean slugs:** the ranking gain is small and they need a reserved-slug list. Existing slugs are printed on QR codes.
- **City facets:** `location` is free text, and no city has 3 public seasons yet.
- **Sport facets:** the `/sports/[sport]` pages already list each sport's tournaments.

**Tests:**
- `server/seo/squads.test.ts` and `server/seo/season-copy.test.ts`.
- `server/competition/season-search.regression.test.ts`, against the database: the trigger (a real change moves it, the same values don't), the rule over real registrations (off → blocked by an unknown DOB → listed → a minor takes it back out), the sitemap, and the audit.
- The `public-registration` e2e now drives the toggle.
- E2E 24/24; unit and regression 211.

---

## 16. Phase 6 delivery log (2026-10-01)

**Built on `feat/seo-guides`, stacked on Phase 5.**

**What shipped:**
- `/guides` (index, newest first) and `/guides/[slug]`: the plan's first ten, each with `Article` (+ `datePublished`/`dateModified`) and `BreadcrumbList` markup.
- They are bylined "By the DesiAuction team". A guide is not attributed to a person who didn't write it.
- `/blog` and `/blog/*` now **308 to `/guides`**; the placeholder page is deleted.
- Links: footer (Help › Guides), the Resources menu, the sitemap and the route registry.

| Guide | Links into |
|---|---|
| How to run an IPL-style player auction for your local cricket tournament | form template, purse calculator, help, `/sports/cricket` |
| How much purse and base price to set | purse calculator (worked reserve-rule example) |
| Player auction rules: a template for your league | purse guide |
| What to ask on a player registration form | form template |
| Snake draft or auction | snake-draft tool |
| How to run a society premier league | fees guide, `/for/housing-societies` |
| Collecting entry fees and team dues | help › money |
| Box cricket league with a player auction | calculator, `/sports/box-cricket` |
| Kabaddi league auction | `/sports/kabaddi` |
| A live auction on a projector or TV | help › screens for the room |

**Accuracy:** product statements were checked against code and the help centre (config locked at creation, owner links sent by the organizer, paddles granted separately, board and overlay public on a published season, undo needs an owner-level grant, and more). One receipt claim was narrowed to "every receipt can be checked against the original record".

**Found and fixed: a bug from Phase 4.** A **signed-in** visitor opening `/sports`, `/for`, `/compare` or `/tools` got them framed in the **organizer console**, because `nav.ts`'s `shellKind` decides chrome from its own prefix list, and those prefixes were never added. The e2e runs were all signed out. They are now listed (with `/guides`), and `routes.test.ts` holds **every indexable route in the SEO registry to the public shell**. Removing `/sports` from the list fails it (checked).

**Tests:**
- `content/guides.test.ts`: at least six guides, unique fields, 50–160 character summaries, **every internal link resolves to a real page**, and sane dates.
- `e2e/guides.spec.ts`: index, a guide in both themes (axe), and `/blog` → 308 `/guides`.
- E2E across guides, seo, shell, public pages, CSP and all landing pages: **46/46**.

**Still for the founder:** real bylines (a named author with experience earns more trust than "the team"), two new guides a month, and a quarterly refresh of the top five.

---

## 17. Phase 7 delivery log, engineering half (2026-10-01)

**Built on `feat/seo-embed`, stacked on Phase 6.**

**Season embed:** `/embed/[slug]` is a small read-only card of a **published** season (status, name, organizer, sport, place, dates, team count). It has a link out to `/c/[slug]` ("Register" / "Watch live" / "View the season") and "Powered by DesiAuction". It is bare (no site chrome), `noindex` (it would duplicate the season page), and shows no player names.
- **Organizer:** "Embed on your website" on the season overview (public seasons, managers) copies an iframe **plus a plain `<a>` link to the season page**. The plain link is the actual backlink: a link inside an iframe belongs to us, not to the host page. The season name is HTML-escaped in the snippet.
- **Framing is allowed on `/embed/*` only.** The global security-header rule now skips `/embed` (a negative-lookahead source), and `/embed/*` gets the same headers minus `X-Frame-Options`, with `frame-ancestors *`. An embed page has no form and no session-bound action, so framing gives a clickjacker nothing to click.
- `embed` is classified in the route registry (noindex header, Disallow).
- The e2e asserts the season page itself **still** sends `X-Frame-Options: DENY` and `frame-ancestors 'none'`.

**Already true, no change needed:** the board and the overlay carry the DesiAuction wordmark, and share cards carry the brand.

**Founder half (not engineering):**
- directory listings (Product Hunt, G2, Capterra/GetApp India, SaaSworthy, Techjockey, AlternativeTo)
- a stream kit for organizers (YouTube description text with the season link)
- local sports press, academy and turf associations, college fests
- case studies from real seasons that agree to one

---

## 18. Phase 8 delivery log (2026-10-01)

**Built on `feat/seo-speed`, stacked on Phase 7.**

**Diagnosis first.** Lighthouse's 3.6–3.9s LCP on the public pages was examined before anything was changed:
- The LCP phases were almost all "render delay" (2.9–3.4s), with TTFB of about 10–130ms.
- **In the real, unthrottled trace, LCP equals first paint on every page (72–231ms).** The gap is Lantern's simulation, which charges every request made before LCP, JavaScript included. There is no late-appearing element to fix.
- **Experiment, rejected:** `experimental.inlineCss`, which removes 13–16 render-blocking stylesheets per page. Measured: FCP improved about 150ms, LCP was unchanged or worse, and it would add 50–70 KB of HTML to every load and lose CSS caching. Not shipped.

**Shipped: real-user monitoring**, so the budget in docs/57 is judged on real phones:
- `WebVitalsReporter` (in the root layout, beside `ClientErrorListener`) uses Next's built-in `useReportWebVitals`. It samples one page load in ten and sends via `sendBeacon`. No new dependency.
- `/api/vitals` mirrors `/api/client-error`: a 1 KB cap, only known fields (`lib/web-vitals-report.ts`, tested), a per-minute log cap, and 204 for everything. It writes a `web_vitals` log line with the metric, value, rating and redacted path, and no user, session or address.

**Not done, and why:**
- **The bfcache header change:** Next itself emits `no-store` for dynamic pages; the plan marked this "investigate first", and it isn't a ranking factor.
- **An `/admin/health` panel over the vitals:** it needs aggregation beyond log lines. It's a follow-up once there's field data to show.

**Tests:** `lib/web-vitals-report.test.ts` (10) and `e2e/web-vitals.spec.ts` (the endpoint's answers; the reporter loads without a policy violation).
