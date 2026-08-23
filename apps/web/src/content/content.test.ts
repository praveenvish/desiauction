// PERMANENT PX-10 CONTENT-INTEGRITY & BROKEN-LINK REGRESSION SUITE.
//
// The customer-facing content is data (help, legal, marketing, support, search).
// This suite is the guarantee that the data is COHERENT and every link RESOLVES
// — the "broken-link detection" the milestone requires, run at the source rather
// than by crawling a live site. If any content link ever points at a route that
// does not exist, this fails before it ships.
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { plainTextOf } from "./blocks";
import { FAQS, HELP_ARTICLES, HELP_CATEGORIES, helpArticle, helpCategory } from "./help";
import { LEGAL_DOCUMENTS, legalDocument } from "./legal";
import { legalIdentityPublished, missingLegalIdentity, type LegalIdentity } from "./company";
import { FEATURE_GROUPS, LANDING, PRICING } from "./marketing";
import { RELEASES } from "./releases";
import { SEARCH_INDEX, allContentLinks, searchContent } from "./search";
import { SUPPORT } from "./support";

const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "app");

/**
 * Every STATIC route the app actually serves, walked off the filesystem.
 *
 * This was a hand-maintained set of 25 paths, which made the suite's central
 * promise — "if any content link points at a route that does not exist, this
 * fails before it ships" — untrue in the direction that matters: DELETE a route
 * and every link to it keeps passing, because the list said the route existed.
 * A list of routes maintained beside the routes is not evidence about the
 * routes. This reads `src/app`, so a deleted page fails the suite.
 *
 * Route groups `(x)` collapse, private folders `_x` are skipped, and dynamic
 * segments are left to the registry-derived set below — they are exactly what
 * the pages' own `generateStaticParams` enumerate.
 */
function staticRoutes(dir: string = APP_DIR, prefix = ""): Set<string> {
  const found = new Set<string>();
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isFile()) {
      if (/^(page|route)\.(tsx?|jsx?)$/.test(entry.name)) {
        found.add(prefix === "" ? "/" : prefix);
      }
      continue;
    }
    if (!entry.isDirectory() || entry.name.startsWith("_") || entry.name.startsWith("[")) {
      continue;
    }
    // A route group contributes no path segment.
    const next = /^\(.*\)$/.test(entry.name) ? prefix : `${prefix}/${entry.name}`;
    for (const route of staticRoutes(join(dir, entry.name), next)) {
      found.add(route);
    }
  }
  return found;
}

/**
 * The set of routes that actually exist: the static ones off disk, plus the
 * dynamic ones derived from the SAME registries the pages generate their params
 * from. A link is valid if it equals a known route or (for hashes/queries)
 * starts with one.
 */
function knownRoutes(): Set<string> {
  const routes = staticRoutes();
  for (const article of HELP_ARTICLES) {
    routes.add(`/help/${article.slug}`);
  }
  for (const category of HELP_CATEGORIES) {
    routes.add(`/help/category/${category.slug}`);
  }
  for (const doc of LEGAL_DOCUMENTS) {
    routes.add(`/legal/${doc.slug}`);
  }
  // "faq" is a RESERVED slug on /help/[slug] rather than an article, so the
  // filesystem walk cannot see it — it is enumerated in that route's own
  // generateStaticParams alongside the articles.
  routes.add("/help/faq");
  return routes;
}

function isKnown(href: string, routes: Set<string>): boolean {
  // Strip a hash or query, then require an exact route match.
  const path = href.split(/[?#]/)[0] ?? href;
  return routes.has(path);
}

describe("PX-10 · Broken-link detection", () => {
  const routes = knownRoutes();

  it("every internal link in the content tree resolves to a real route", () => {
    const broken = allContentLinks().filter((href) => !isKnown(href, routes));
    expect(broken, `broken internal links: ${broken.join(", ")}`).toEqual([]);
  });

  it("the route set is read off disk, not remembered", () => {
    // Guards the guard: if this ever stops seeing the app directory it would
    // pass everything, which is the failure mode the hardcoded set had.
    const routes = knownRoutes();
    expect(routes.size).toBeGreaterThan(25);
    expect(routes.has("/")).toBe(true);
    expect(routes.has("/security")).toBe(true);
    expect(routes.has("/this-route-does-not-exist")).toBe(false);
  });

  it("every search-index href resolves to a real route", () => {
    const broken = SEARCH_INDEX.map((doc) => doc.href).filter((href) => !isKnown(href, routes));
    expect(broken, `broken search hrefs: ${broken.join(", ")}`).toEqual([]);
  });

  it("every marketing CTA and support channel link resolves", () => {
    const internal = [
      LANDING.hero.ctaPrimary.href,
      // Was exempt while hero.ctaSecondary was an in-page anchor (#demo). It is
      // a real route now, so it is held to the same no-dead-links rule as every
      // other CTA rather than being trusted to the e2e DOM check alone.
      LANDING.hero.ctaSecondary.href,
      LANDING.beta.ctaPrimary.href,
      LANDING.beta.ctaSecondary.href,
      // /pricing carries links this suite never saw: three tier CTAs, the
      // procurement route out, the closing band, and the FAQ's link to the
      // policy it paraphrases. A pricing page is where a dead link costs the
      // most, so it is held to the same rule as everything else.
      ...PRICING.tiers.map((tier) => tier.cta.href),
      ...PRICING.faqs.flatMap((faq) => (faq.link === undefined ? [] : [faq.link.href])),
      PRICING.procurement.cta.href,
      PRICING.closing.ctaPrimary.href,
      PRICING.closing.ctaSecondary.href,
      ...SUPPORT.issueCategories.map((issue) => issue.link.href),
    ].filter((href) => href.startsWith("/"));
    const broken = internal.filter((href) => !isKnown(href, routes));
    expect(broken, `broken CTA/support links: ${broken.join(", ")}`).toEqual([]);
  });
});

describe("PX-10 · Content integrity", () => {
  it("help article and category slugs are unique", () => {
    const articleSlugs = HELP_ARTICLES.map((a) => a.slug);
    expect(new Set(articleSlugs).size).toBe(articleSlugs.length);
    const categorySlugs = HELP_CATEGORIES.map((c) => c.slug);
    expect(new Set(categorySlugs).size).toBe(categorySlugs.length);
    // "faq" is a reserved article route, not an article slug.
    expect(articleSlugs).not.toContain("faq");
  });

  it("every help article belongs to a real category, and every category has articles", () => {
    for (const article of HELP_ARTICLES) {
      expect(helpCategory(article.category), `${article.slug} → ${article.category}`).toBeDefined();
    }
    for (const category of HELP_CATEGORIES) {
      expect(
        HELP_ARTICLES.some((article) => article.category === category.slug),
        `category ${category.slug} has no articles`,
      ).toBe(true);
    }
  });

  it("the ten launch articles from the content guide are all present", () => {
    // PX-1 05 §8 — the required launch set, by the topic each covers.
    const required = [
      "auction-night",
      "competition-setup",
      "registration-desk",
      "fixtures",
      "auction-setup",
      "conducting-the-auction",
      "for-owners",
      "money-after-the-gavel",
      "receipts-and-exports",
      "signing-in",
    ];
    for (const slug of required) {
      expect(helpArticle(slug), `missing launch article ${slug}`).toBeDefined();
    }
  });

  it("every article has a title, a summary, headings and a contact footer", () => {
    for (const article of HELP_ARTICLES) {
      expect(article.title.length).toBeGreaterThan(0);
      expect(article.summary.length).toBeGreaterThan(0);
      expect(article.blocks.some((b) => b.kind === "heading")).toBe(true);
      // The content guide requires a "Still stuck? Contact us" footer on each.
      expect(plainTextOf(article.blocks).toLowerCase()).toContain("support@desiauction.in");
    }
  });

  it("the contact footer is a LINK on every article, not printed text", () => {
    // It was plain text on all twelve articles, because the `callout` block had
    // no links field at all — the content model could not express the one link
    // the help centre most needed. A reader who is stuck should not have to
    // select an address with their thumb and paste it into a mail app.
    for (const article of HELP_ARTICLES) {
      const mailtos = article.blocks.flatMap((block) =>
        block.kind === "callout" || block.kind === "paragraph"
          ? (block.links ?? []).map((link) => link.href)
          : [],
      );
      expect(mailtos, `${article.slug} has no mailto: in a callout or paragraph`).toContain(
        "mailto:support@desiauction.in",
      );
    }
  });

  it("names the AUCTION NIGHT subject line it tells readers to use", () => {
    // The footer said "put THAT in the subject line" and named no string. The
    // string is defined once, on the support channel, and the footer must use
    // the same words or the instruction is unfollowable.
    const channel = SUPPORT.channels.find((entry) => entry.title === "Auction-night help");
    expect(channel?.detail).toContain("AUCTION NIGHT");
    const footer = plainTextOf(HELP_ARTICLES[0]?.blocks ?? []);
    expect(footer).toContain("AUCTION NIGHT");
  });

  it("claims no capability the product cannot perform from a screen", () => {
    // Each phrase below shipped on a public page and was disproved by the code:
    // the exporter is reachable from no screen, the issuance lane refuses to
    // issue an invoice, /inbox has no finance writer, there is no fiscal close,
    // and the rail has four items. This is the regression net — a rewrite that
    // reintroduces any of them fails here rather than in front of a customer.
    // Marketing, pricing, /features and the release notes SELL. Nothing here
    // may name a capability as delivered.
    const selling = JSON.stringify({
      landing: LANDING,
      pricing: PRICING,
      features: FEATURE_GROUPS,
      releases: RELEASES,
    }).toLowerCase();
    for (const banned of [
      "tally-compatible",
      "tally-ready",
      "readable and exportable",
      "receipts, invoices and corrections",
      "settlement, receipts and invoices",
      "delivered to the recipient",
      "year-end close",
      "fiscal periods and a year-end",
    ]) {
      expect(selling, `disproved claim back on a selling page: ${banned}`).not.toContain(banned);
    }

    // Help and legal DESCRIBE, so they are allowed — required, even — to name
    // Tally and invoices as things we do not do. What they may not do is
    // describe a place or a flow that isn't there.
    const describing = JSON.stringify({
      help: HELP_ARTICLES.map((article) => plainTextOf(article.blocks)),
      faqs: FAQS,
      legal: LEGAL_DOCUMENTS.map((doc) => plainTextOf(doc.blocks)),
    }).toLowerCase();
    for (const banned of [
      "the five places you'll work",
      "what you owe and every receipt",
      "account → security",
      "registration lists are never exposed",
      "resuming shortly",
      "readable and exportable",
    ]) {
      expect(describing, `disproved claim back in help or legal: ${banned}`).not.toContain(banned);
    }
  });

  it("all eight legal documents exist, each with a version and effective date", () => {
    const required = [
      "terms",
      "privacy",
      "refunds",
      "code-of-conduct",
      "cookies",
      "data-retention",
      "disclaimer",
      "competition-terms",
    ];
    for (const slug of required) {
      const doc = legalDocument(slug);
      expect(doc, `missing legal document ${slug}`).toBeDefined();
      expect(doc?.versions.length).toBeGreaterThan(0);
      expect(doc?.effective.length).toBeGreaterThan(0);
      // Honesty: each is marked a beta draft (PX-1 05 §9).
      expect(plainTextOf(doc?.blocks ?? []).toLowerCase()).toContain("beta draft");
    }
  });

  it("pricing shows no checkout affordance and keeps the beta banner", () => {
    expect(PRICING.betaBanner.toLowerCase()).toContain("free");
    expect(PRICING.tiers.length).toBe(3);
    // No tier claims a live purchase price beyond Free — paid tiers say "at GA".
    const paid = PRICING.tiers.filter((t) => t.name !== "Free");
    for (const tier of paid) {
      expect(tier.price.toLowerCase()).toContain("ga");
    }
  });

  it("the comparison table has one cell per tier and quotes no price of its own", () => {
    // A row with the wrong cell count silently shifts every answer one tier to
    // the left — the most expensive off-by-one this page could ship. The price
    // row is rendered from `tiers`, so no row here may carry a currency figure.
    for (const row of PRICING.comparison.rows) {
      expect(row.cells.length, `row "${row.label}"`).toBe(PRICING.tiers.length);
      for (const cell of row.cells) {
        expect(typeof cell === "string" ? cell : "", `row "${row.label}"`).not.toMatch(/[₹$]/);
      }
    }
  });

  it("pricing keeps the platform-fault refund clause verbatim from the policy", () => {
    // The FAQ paraphrases /legal/refunds. Paraphrasing away the clause most in
    // the reader's favour is how a summary becomes a misrepresentation, so the
    // sentence is pinned to the policy's own words.
    const clause = plainTextOf(legalDocument("refunds")?.blocks ?? []);
    const sentence =
      "If an auction has to be abandoned because of a fault on our side, we refund the pass — always, regardless of timing.";
    expect(clause).toContain(sentence);
    const refundFaq = PRICING.faqs.find((faq) => faq.question === "Refunds?");
    expect(refundFaq?.answer).toContain(sentence);
    expect(refundFaq?.link?.href).toBe("/legal/refunds");
  });

  it("marketing capability content is present", () => {
    expect(FEATURE_GROUPS.length).toBeGreaterThan(0);
    expect(RELEASES.length).toBeGreaterThan(0);
    expect(FAQS.length).toBeGreaterThan(0);
  });

  it("the landing page is uniformly no-fabrication (2026-07-24 council ruling)", () => {
    // The former testimonials' "explicit exception" is retired. The landing
    // may not carry invented customers, unverifiable superlatives or
    // operational stats we cannot evidence, nor any real person's name.
    const landingText = JSON.stringify(LANDING).toLowerCase();
    for (const banned of [
      "most trusted",
      "bank-grade",
      "99.9",
      "24×7",
      "rohit sharma",
      "rpsg",
      "testimonial",
    ]) {
      expect(landingText, `banned fabrication marker: ${banned}`).not.toContain(banned);
    }
    // Candor is load-bearing: the beta truth stays at the CTA, and the
    // simulated stage must say it is simulated, with fictional players only.
    expect(LANDING.hero.ctaNote.toLowerCase()).toContain("free during beta");
    expect(LANDING.hero.demoLabel.toLowerCase()).toContain("simulated");
    expect(LANDING.hero.script.length).toBeGreaterThan(0);
  });
});

describe("PX-10 · Search (navigation only)", () => {
  it("finds every help article by an exact title query", () => {
    for (const article of HELP_ARTICLES) {
      const hits = searchContent(article.title);
      expect(
        hits.some((hit) => hit.href === `/help/${article.slug}`),
        `search missed "${article.title}"`,
      ).toBe(true);
    }
  });

  it("finds legal documents and pricing by keyword", () => {
    expect(searchContent("refund").some((h) => h.href === "/legal/refunds")).toBe(true);
    expect(searchContent("privacy").some((h) => h.href === "/legal/privacy")).toBe(true);
    expect(searchContent("pricing").some((h) => h.href === "/pricing")).toBe(true);
    expect(searchContent("tally export").some((h) => h.href === "/help/receipts-and-exports")).toBe(
      true,
    );
  });

  it("reaches every public section (the founder-demo requirement)", () => {
    const sections = new Set(SEARCH_INDEX.map((doc) => doc.section));
    expect(sections).toEqual(new Set(["Marketing", "Help", "Legal", "Support", "Release notes"]));
  });

  it("is AND across terms and needs at least two characters", () => {
    expect(searchContent("a")).toEqual([]);
    // Both terms must appear somewhere; a nonsense second term yields nothing.
    expect(searchContent("receipt zzzznotaword")).toEqual([]);
    // Every returned hit points at a real route.
    for (const hit of searchContent("auction")) {
      expect(hit.href.startsWith("/")).toBe(true);
    }
  });

  it("reaches the eleven public pages it used to omit", () => {
    // The release notes claimed "search that reaches every public destination"
    // while these were absent from the index. The worst was /security:
    // searching "security" returned a sign-in help article and never the page
    // named Security.
    const hrefs = new Set(SEARCH_INDEX.map((doc) => doc.href));
    for (const href of [
      "/security",
      "/about",
      "/careers",
      "/rules-guidelines",
      "/schedule-demo",
      "/blog",
      "/case-studies",
      "/api-docs",
      "/legal",
      "/help",
      "/c",
      "/tournaments",
    ]) {
      expect(hrefs, `search cannot reach ${href}`).toContain(href);
    }
    expect(searchContent("security").some((hit) => hit.href === "/security")).toBe(true);
  });

  it("finds what people actually type", () => {
    // Every query below returned ZERO results before the synonym map.
    const expectations: [string, string][] = [
      ["otp", "/help/signing-in"],
      ["log in", "/help/signing-in"],
      ["captain", "/help/icons-captains-and-coaches"],
      ["icon", "/help/icons-captains-and-coaches"],
      ["coach", "/help/icons-captains-and-coaches"],
      ["overlay", "/help/screens-for-the-room"],
      ["api", "/api-docs"],
      ["gdpr", "/legal/privacy"],
      ["delete my account", "/legal/data-retention"],
    ];
    for (const [query, href] of expectations) {
      expect(
        searchContent(query).some((hit) => hit.href === href),
        `"${query}" did not find ${href}`,
      ).toBe(true);
    }
  });

  it("spells organiser the way this market spells it", () => {
    // `organizer` returned ten results and `organiser` returned none — the most
    // damaging single miss on an Indian-market product.
    const american = searchContent("organizer").map((hit) => hit.href);
    const british = searchContent("organiser").map((hit) => hit.href);
    expect(american.length).toBeGreaterThan(0);
    expect(new Set(british)).toEqual(new Set(american));
  });

  it("ranks a whole-word title hit above the product's own name", () => {
    // `titleLc.includes(word)` scored a full title hit for "auction" on every
    // title containing "DesiAuction", so "A tour of DesiAuction" outranked the
    // auction guides on a site about auctions.
    const hits = searchContent("auction").map((hit) => hit.title);
    const tour = hits.indexOf("A tour of DesiAuction");
    const guide = hits.indexOf("Auction guide");
    expect(guide).toBeGreaterThanOrEqual(0);
    expect(guide, "the product's own name outranked a real title match").toBeLessThan(tour);
  });

  it("returns every match, so a caller can report a true count", () => {
    // The page printed `results.length` from a list capped at twelve: "auction"
    // matched far more and reported "12 results", with no route to the rest.
    const hits = searchContent("auction");
    expect(hits.length).toBeGreaterThan(12);
    expect(searchContent("auction", 12).length).toBe(12);
  });

  it("finds a word that appears only inside a link label", () => {
    // plainTextOf pushed the raw "{0}" placeholder and dropped link text, so a
    // word carried only by a link was unsearchable on the page that said it.
    expect(searchContent("tournaments").length).toBeGreaterThan(0);
    expect(searchContent("roles guide").length).toBeGreaterThan(0);
  });

  it("is navigation only — every hit is a route, never a command", () => {
    for (const doc of SEARCH_INDEX) {
      expect(doc.href.startsWith("/")).toBe(true);
    }
  });
});

describe("legal identity — the gap the Legal Centre had, and its gate", () => {
  /*
   * Eight legal documents named no legal entity, no registered address and no
   * grievance officer. An India-facing platform that processes personal data
   * and takes payments must publish all three (IT Rules 2021 Rule 3(2), DPDP
   * Act 2023 s.13, Consumer Protection (E-Commerce) Rules 2020 Rule 4(3)).
   * None of it is derivable from this repository, so the slots exist, the
   * pages say plainly when they are empty, and `preflight:production` refuses
   * a deploy while they are.
   */
  const FILLED: LegalIdentity = {
    legalName: "Example Sports Technologies Private Limited",
    tradingName: "DesiAuction",
    registrationNumber: "U72900MH2026PTC000000",
    registeredAddress: "1 Example Road, Andheri East, Mumbai 400069, Maharashtra, India",
    gstin: "27AAAAA0000A1Z5",
    grievanceOfficerName: "A. Example",
    grievanceOfficerEmail: "grievances@example.invalid",
    grievanceOfficerPhone: "+91 22 0000 0000",
    dataProtectionContactName: "A. Example",
    dataProtectionContactEmail: "privacy@example.invalid",
  };

  it("reports exactly which required fields are unset, today", () => {
    expect(missingLegalIdentity()).toEqual([
      "legalName",
      "registeredAddress",
      "grievanceOfficerName",
      "grievanceOfficerEmail",
    ]);
    expect(legalIdentityPublished()).toBe(false);
  });

  it("counts a filled identity as publishable", () => {
    expect(missingLegalIdentity(FILLED)).toEqual([]);
    expect(legalIdentityPublished(FILLED)).toBe(true);
  });

  it("treats whitespace as unset — a space is not an address", () => {
    expect(missingLegalIdentity({ ...FILLED, registeredAddress: "   " })).toEqual([
      "registeredAddress",
    ]);
  });

  it("does not gate on the optional fields", () => {
    expect(
      missingLegalIdentity({
        ...FILLED,
        registrationNumber: null,
        gstin: null,
        grievanceOfficerPhone: null,
        dataProtectionContactName: null,
      }),
    ).toEqual([]);
  });

  it("publishes a Grievance Redressal document with the statutory commitments", () => {
    const doc = legalDocument("grievances");
    expect(doc).toBeDefined();
    const text = plainTextOf(doc?.blocks ?? []);
    // Rule 3(2): acknowledge in 24h, resolve in 15 days, and a route onward.
    expect(text).toContain("24 hours");
    expect(text).toContain("15 days");
    expect(text).toContain("Data Protection Board of India");
  });

  it("states the DPDP rights in the privacy policy, not just deletion", () => {
    const text = plainTextOf(legalDocument("privacy")?.blocks ?? []);
    for (const right of ["Know what we hold", "Correct it", "Erase it", "Nominate someone"]) {
      expect(text).toContain(right);
    }
  });

  it("says plainly that the identity is unpublished rather than rendering a blank", () => {
    const text = plainTextOf(legalDocument("grievances")?.blocks ?? []);
    expect(text).toContain("registered details are not published here yet");
  });
});

describe("pricing — the page may not promise a ceiling the product has no idea about", () => {
  /*
   * "Free · Up to 4 teams and 40 players" reads as a limit a reader will hit.
   * There is no tier column, no plan, no entitlement and no billing code
   * anywhere in this repository, so nothing stops a free organizer running
   * sixteen teams. The tier table is a description of the Passes that arrive at
   * GA, and the beta banner is the only thing that says so.
   *
   * When enforcement lands, this test should fail — and the sentence should
   * change at the same time, which is the point of pinning it.
   */
  it("says plainly that no limit is enforced during beta", () => {
    expect(PRICING.betaBanner).toContain("no limit enforced");
  });

  it("still quotes the tier numbers, so the promise itself is unchanged", () => {
    const plain = `${PRICING.betaBanner} ${PRICING.tiers.map((tier) => `${tier.name} ${tier.limits}`).join(" ")}`;
    expect(plain).toContain("Up to 4 teams and 40 players");
    expect(plain).toContain("Up to 16 teams and 400 players");
  });
});
