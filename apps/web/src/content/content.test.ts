// PERMANENT PX-10 CONTENT-INTEGRITY & BROKEN-LINK REGRESSION SUITE.
//
// The customer-facing content is data (help, legal, marketing, support, search).
// This suite is the guarantee that the data is COHERENT and every link RESOLVES
// — the "broken-link detection" the milestone requires, run at the source rather
// than by crawling a live site. If any content link ever points at a route that
// does not exist, this fails before it ships.
import { describe, expect, it } from "vitest";

import { plainTextOf } from "./blocks";
import { FAQS, HELP_ARTICLES, HELP_CATEGORIES, helpArticle, helpCategory } from "./help";
import { LEGAL_DOCUMENTS, legalDocument } from "./legal";
import { FEATURE_GROUPS, LANDING, PRICING } from "./marketing";
import { RELEASES } from "./releases";
import { SEARCH_INDEX, allContentLinks, searchContent } from "./search";
import { SUPPORT } from "./support";

/**
 * The set of routes that actually exist. Static ones are listed; dynamic ones
 * are derived from the SAME registries the pages generate their params from, so
 * this set is exactly what Next will serve. A link is valid if it equals a known
 * route or (for hashes/queries) starts with one.
 */
function knownRoutes(): Set<string> {
  const routes = new Set<string>([
    // PX-10 public content
    "/",
    "/features",
    "/pricing",
    "/help",
    "/help/faq",
    "/legal",
    "/support",
    "/contact",
    "/releases",
    "/search",
    // Home page rebuild (2026-07-18) — the shell's expanded nav/footer
    "/about",
    "/careers",
    "/security",
    "/rules-guidelines",
    "/schedule-demo",
    "/blog",
    "/case-studies",
    "/api-docs",
    // Existing app routes content may link to (PX-2…PX-9)
    "/c",
    "/home",
    // /seasons still answers — as a redirect to the merged index — so a link
    // to it is not dead; /tournaments is where content should point now.
    "/seasons",
    "/tournaments",
    "/orgs",
    "/money",
    "/inbox",
    "/account",
    "/login",
    "/healthz",
  ]);
  for (const article of HELP_ARTICLES) {
    routes.add(`/help/${article.slug}`);
  }
  for (const category of HELP_CATEGORIES) {
    routes.add(`/help/category/${category.slug}`);
  }
  for (const doc of LEGAL_DOCUMENTS) {
    routes.add(`/legal/${doc.slug}`);
  }
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

  it("is navigation only — every hit is a route, never a command", () => {
    for (const doc of SEARCH_INDEX) {
      expect(doc.href.startsWith("/")).toBe(true);
    }
  });
});
