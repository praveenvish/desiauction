import { expect, test, type APIRequestContext } from "@playwright/test";

import { CONSOLE_SEGMENTS, INDEXABLE_PAGES, NOINDEX_HEADER } from "../src/server/seo/routes";

/**
 * THE SEO GUARDRAIL (SEO-1 Phase 3).
 *
 * Every page the sitemap offers a search engine is held to what a search
 * engine needs. Every page it must not index is held to saying so. The suite
 * reads the route registry (server/seo/routes.ts) rather than a list of its
 * own, so a page added there is checked here without anyone remembering to.
 *
 * Plain HTTP, not a browser: a crawler reads the server's HTML, so that is
 * what is asserted. Failures are collected per page and reported together, so
 * one run names every broken page instead of stopping at the first.
 */

/** Past 160 a result's snippet is cut mid-sentence; under 50 it says nothing. */
const DESCRIPTION = { min: 50, max: 160 };
/** How many published seasons are checked in full. The rest share one template. */
const SEASON_SAMPLE = 3;

/**
 * Who reads the page. Next 15 decides by user agent whether metadata is in
 * <head> or streamed into <body> (next.config.mjs, htmlLimitedBots), so the
 * checks run as the visitors that matter rather than as Playwright.
 */
const USER_AGENTS = {
  phone:
    "Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
  googlebot: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  gptbot:
    "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.1; +https://openai.com/gptbot",
  claudebot:
    "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)",
  perplexitybot:
    "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)",
  facebook: "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
} as const;

interface Page {
  readonly path: string;
  readonly status: number;
  readonly robotsHeader: string | undefined;
  readonly html: string;
}

async function fetchPage(
  request: APIRequestContext,
  path: string,
  userAgent: string = USER_AGENTS.phone,
): Promise<Page> {
  const response = await request.get(path, {
    maxRedirects: 0,
    headers: { "user-agent": userAgent },
  });
  return {
    path,
    status: response.status(),
    robotsHeader: response.headers()["x-robots-tag"],
    html: await response.text(),
  };
}

const decode = (text: string): string =>
  text
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");

const titlesOf = (html: string): string[] =>
  [...html.matchAll(/<title>([^<]*)<\/title>/g)].map((m) => decode(m[1] ?? ""));
const metaOf = (html: string, name: string): string | undefined => {
  const match = new RegExp(`<meta name="${name}" content="([^"]*)"`).exec(html);
  return match?.[1] === undefined ? undefined : decode(match[1]);
};
const canonicalOf = (html: string): string | undefined =>
  /<link rel="canonical" href="([^"]*)"/.exec(html)?.[1];
/** The document's <head>, where a crawler that runs no JavaScript looks. */
const headOf = (html: string): string => html.slice(0, Math.max(0, html.indexOf("</head>")));

/** Title, description and canonical in <head>, not streamed into <body>. */
function headProblems(html: string): string[] {
  const head = headOf(html);
  return [
    ...(/<title>/.test(head) ? [] : ["<title> is not in <head>"]),
    ...(/<meta name="description"/.test(head) ? [] : ["description is not in <head>"]),
    ...(/<link rel="canonical"/.test(head) ? [] : ["canonical is not in <head>"]),
  ];
}

/** Where the site says it lives: the runtime base URL, as robots.txt states it. */
async function siteBase(request: APIRequestContext): Promise<string> {
  const robots = await (await request.get("/robots.txt")).text();
  const sitemap = /^Sitemap: (.+)$/m.exec(robots)?.[1]?.trim();
  if (sitemap === undefined) throw new Error("robots.txt names no sitemap");
  return new URL(sitemap).origin;
}

async function sitemapPaths(request: APIRequestContext, base: string): Promise<string[]> {
  const xml = await (await request.get("/sitemap.xml")).text();
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => {
    const url = m[1] ?? "";
    expect(url.startsWith(base), `sitemap URL on the site's own origin: ${url}`).toBe(true);
    return url.slice(base.length) || "/";
  });
}

/** Everything a search engine needs from an indexable page. Empty when it has it. */
function indexableProblems(page: Page, base: string): string[] {
  const { html } = page;
  const problems: string[] = [...headProblems(html)];
  if (page.status !== 200) problems.push(`status ${String(page.status)}`);
  if (page.robotsHeader !== undefined) problems.push(`x-robots-tag "${page.robotsHeader}"`);
  if (/<meta name="robots" content="[^"]*noindex/.test(html)) problems.push("meta noindex");

  const titles = titlesOf(html);
  if (titles.length !== 1) problems.push(`${String(titles.length)} <title> elements`);
  if (titles.some((title) => title.includes("DesiAuction · DesiAuction"))) {
    problems.push("title carries the suffix twice");
  }

  const description = metaOf(html, "description");
  if (description === undefined) problems.push("no meta description");
  else if (description.length < DESCRIPTION.min || description.length > DESCRIPTION.max) {
    problems.push(
      `description is ${String(description.length)} chars (want ${String(DESCRIPTION.min)}–${String(DESCRIPTION.max)})`,
    );
  }

  const canonical = canonicalOf(html);
  const self = `${base}${page.path === "/" ? "" : page.path}`;
  if (canonical === undefined) problems.push("no canonical");
  else if (canonical.replace(/\/$/, "") !== self.replace(/\/$/, "")) {
    problems.push(`canonical is ${canonical}, not itself`);
  }

  /*
   * One heading, said once. The raw HTML can carry the same <h1> twice: a
   * route's loading skeleton is STREAMED ahead of the page it stands in for,
   * and the skeleton keeps its <h1> on purpose. During a client navigation it
   * is the whole page, and axe (rightly) fails a page with no level-one
   * heading. So the rule is: at least one, and every one says the same thing.
   * That still catches a page with none, and two headings that disagree.
   */
  const headings = [...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/g)].map((m) =>
    decode((m[1] ?? "").replace(/<[^>]+>/g, ""))
      .replace(/\s+/g, " ")
      .trim(),
  );
  if (headings.length === 0) problems.push("no <h1>");
  else if (new Set(headings).size > 1) problems.push(`<h1>s disagree: ${headings.join(" | ")}`);

  const unlabelled = (html.match(/<img\b[^>]*>/g) ?? []).filter((img) => !/\balt="/.test(img));
  if (unlabelled.length > 0) problems.push(`${String(unlabelled.length)} <img> without alt`);

  for (const block of html.matchAll(
    /<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g,
  )) {
    try {
      const data = JSON.parse(block[1] ?? "") as Record<string, unknown>;
      if (data["@context"] !== "https://schema.org" || typeof data["@type"] !== "string") {
        problems.push("JSON-LD block without @context/@type");
      }
    } catch {
      problems.push("JSON-LD block that does not parse");
    }
  }
  return problems;
}

test.describe("SEO guardrail", () => {
  test("robots.txt names the runtime sitemap and disallows every console", async ({ request }) => {
    const base = await siteBase(request);
    // Prerendered at image build, this once said https://build.invalid (SEO-1 Phase 1).
    expect(base).not.toContain("build.invalid");
    const robots = await (await request.get("/robots.txt")).text();
    for (const segment of CONSOLE_SEGMENTS) {
      expect(robots, `robots.txt disallows /${segment}`).toContain(`Disallow: /${segment}\n`);
    }
  });

  test("the sitemap lists every page the registry calls indexable", async ({ request }) => {
    const base = await siteBase(request);
    const listed = new Set(await sitemapPaths(request, base));
    const missing = INDEXABLE_PAGES.map((page) => page.path).filter((path) => !listed.has(path));
    expect(missing).toEqual([]);
  });

  test("every page in the sitemap is indexable, canonical, titled, described and headed", async ({
    request,
  }) => {
    test.setTimeout(120_000);
    const base = await siteBase(request);
    const paths = await sitemapPaths(request, base);
    const seasons = paths.filter((path) => path.startsWith("/c/"));
    const checked = [
      ...paths.filter((path) => !path.startsWith("/c/")),
      ...seasons.slice(0, SEASON_SAMPLE),
    ];
    const pages = await Promise.all(checked.map((path) => fetchPage(request, path)));

    const failures = pages.flatMap((page) =>
      indexableProblems(page, base).map((problem) => `${page.path}: ${problem}`),
    );
    expect(failures).toEqual([]);

    // One title per page, and no two pages share one: identical results are
    // indistinguishable in a search listing and compete with each other.
    const byTitle = new Map<string, string[]>();
    for (const page of pages) {
      const title = titlesOf(page.html)[0];
      if (title !== undefined) byTitle.set(title, [...(byTitle.get(title) ?? []), page.path]);
    }
    const shared = [...byTitle].filter(([, where]) => where.length > 1);
    expect(shared, "titles shared by more than one page").toEqual([]);
  });

  test("every kind of visitor gets the metadata in <head>", async ({ request }) => {
    // Googlebot and the AI crawlers are exactly the visitors Next 15 streamed
    // metadata to by default; Lighthouse caught it (SEO-1 Phase 3).
    const failures: string[] = [];
    for (const path of ["/", "/pricing", "/help/faq", "/c"]) {
      for (const [who, userAgent] of Object.entries(USER_AGENTS)) {
        const page = await fetchPage(request, path, userAgent);
        failures.push(...headProblems(page.html).map((problem) => `${path} as ${who}: ${problem}`));
      }
    }
    expect(failures).toEqual([]);
  });

  test("consoles send noindex, and public share-only pages say noindex themselves", async ({
    request,
  }) => {
    const consoles = [
      "/home",
      "/tournaments",
      "/players",
      "/auctions",
      "/reports",
      "/me",
      "/account",
      "/inbox",
      "/money",
      "/onboarding",
      "/admin",
      "/seasons/any-season",
      "/org/any-club",
    ];
    for (const path of consoles) {
      const page = await fetchPage(request, path);
      expect(page.robotsHeader, `${path} carries the noindex header`).toBe(NOINDEX_HEADER);
    }
    // Public by design, reachable without signing in, and not for search.
    for (const path of ["/login", "/login?next=/players", "/blog", "/c?q=cup"]) {
      const page = await fetchPage(request, path);
      expect(page.status, `${path} answers`).toBe(200);
      expect(page.html, `${path} says noindex`).toMatch(
        /<meta name="robots" content="noindex, follow"/,
      );
    }
    // Every ?next= variant of the login page collapses into one URL.
    const variant = await fetchPage(request, "/login?next=/players");
    expect(canonicalOf(variant.html)).toMatch(/\/login$/);
  });
});
