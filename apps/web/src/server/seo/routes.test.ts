import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { istCalendarDate } from "../../lib/format-date";

import { shellKind } from "../../components/shell/nav";
import { HELP_ARTICLES } from "../../content/help";
import { LEGAL_DOCUMENTS } from "../../content/legal";
import {
  CONSOLE_SEGMENTS,
  INDEXABLE_PAGES,
  INFRA_SEGMENTS,
  isPublicPath,
  isoCalendarDate,
  publicTopSegments,
} from "./routes";

/**
 * SEO-1: the route registry is the one answer to "may a search engine see
 * this?". These tests hold it to the app directory it describes, so a new
 * route cannot ship without somebody deciding which side of the line it is on.
 */
const APP = join(__dirname, "..", "..", "app");
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Real top-level URL segments: not route groups, slots, dynamic or private folders. */
function topLevelSegments(): string[] {
  return readdirSync(APP).filter(
    (entry) => statSync(join(APP, entry)).isDirectory() && !/^[([@_]/.test(entry),
  );
}

describe("route registry", () => {
  it("classifies every top-level app segment exactly once", () => {
    const publicSegments = publicTopSegments();
    const consoles = new Set<string>(CONSOLE_SEGMENTS);
    const infra = new Set<string>(INFRA_SEGMENTS);
    const unclassified: string[] = [];
    const doubled: string[] = [];
    for (const segment of topLevelSegments()) {
      const homes = [publicSegments.has(segment), consoles.has(segment), infra.has(segment)];
      const count = homes.filter(Boolean).length;
      if (count === 0) unclassified.push(segment);
      if (count > 1) doubled.push(segment);
    }
    // A new route lands here until it is declared: public (routes.ts
    // INDEXABLE_PAGES / PUBLIC_UNLISTED / PUBLIC_SUBTREES), a console
    // (CONSOLE_SEGMENTS), or infrastructure (INFRA_SEGMENTS).
    expect(unclassified).toEqual([]);
    expect(doubled).toEqual([]);
  });

  it("lists no console segment that no longer exists", () => {
    const segments = new Set(topLevelSegments());
    expect(CONSOLE_SEGMENTS.filter((segment) => !segments.has(segment))).toEqual([]);
  });

  it("points every indexable page at a real page file", () => {
    const missing = INDEXABLE_PAGES.filter((page) => {
      if (page.path === "/") return !existsSync(join(APP, "page.tsx"));
      if (page.path === "/c") return !existsSync(join(APP, "c", "(directory)", "page.tsx"));
      if (page.path === "/help/faq") return !existsSync(join(APP, "help", "[slug]", "page.tsx"));
      return !existsSync(join(APP, ...page.path.split("/").filter(Boolean), "page.tsx"));
    });
    expect(missing.map((page) => page.path)).toEqual([]);
  });

  it("never lets a robots.txt Disallow prefix swallow a public page", () => {
    // robots.txt matches by prefix: `Disallow: /help` would also hide /helpful.
    const disallows = CONSOLE_SEGMENTS.map((segment) => `/${segment}`);
    const publicPaths = [
      ...INDEXABLE_PAGES.map((page) => page.path),
      ...[...publicTopSegments()].map((segment) => `/${segment}`),
    ].filter((path) => path !== "/");
    const swallowed = publicPaths.filter((path) =>
      disallows.some((prefix) => path.startsWith(prefix)),
    );
    expect(swallowed).toEqual([]);
  });

  it("renders robots.txt and the sitemap per request, never at build", () => {
    // Prerendered at image build, robots.txt shipped to production pointing at
    // `https://build.invalid/sitemap.xml`: the base URL is a runtime fact.
    for (const file of ["robots.ts", "sitemap.ts"]) {
      expect(readFileSync(join(APP, file), "utf8")).toContain(
        'export const dynamic = "force-dynamic";',
      );
    }
  });

  it("keeps every indexable path unique", () => {
    const paths = INDEXABLE_PAGES.map((page) => page.path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("dates every indexable page and help article with a real, past calendar date", () => {
    // The product's calendar is IST (lib/format-date): UTC would call a date
    // written this morning in India "the future" until 05:30.
    const today = istCalendarDate();
    const dates = [
      ...INDEXABLE_PAGES.map((page) => [page.path, page.updatedOn] as const),
      ...HELP_ARTICLES.map((article) => [`/help/${article.slug}`, article.updatedOn] as const),
    ];
    const bad = dates.filter(
      ([, date]) => !ISO_DATE.test(date) || Number.isNaN(Date.parse(date)) || date > today,
    );
    expect(bad).toEqual([]);
  });

  it("reads every legal document's effective date as a calendar date", () => {
    for (const doc of LEGAL_DOCUMENTS) {
      expect(isoCalendarDate(doc.effective)).toMatch(ISO_DATE);
    }
    expect(isoCalendarDate("16 Jul 2026")).toBe("2026-07-16");
    expect(() => isoCalendarDate("someday")).toThrow();
  });
});

describe("public routes wear the public shell", () => {
  it("frames every indexable page, signed in or not, as a public page", () => {
    // A signed-in visitor on /sports was shown the organizer console's chrome
    // (SEO-1 Phase 6 found it): the shell is decided by nav.ts, the indexing by
    // this registry, and nothing held the two together.
    const wrong = INDEXABLE_PAGES.map((page) => page.path)
      .concat([
        "/sports/cricket",
        "/for/corporate-leagues",
        "/compare/manual-auction",
        "/tools/snake-draft",
        "/guides/how-to-run-a-cricket-player-auction",
      ])
      .filter((path) => shellKind(path) !== "public");
    expect(wrong).toEqual([]);
  });
});

describe("isPublicPath", () => {
  it.each([
    "/",
    "/pricing",
    "/about",
    "/schedule-demo",
    "/schedule-demo/pick",
    "/c",
    "/c/vpl-1-513q",
    "/c/vpl-1-513q/t/strikers",
    "/help/faq",
    "/help/category/getting-started",
    "/legal/privacy",
    "/login",
    "/guides",
    "/newsletter/unsubscribe",
    "/sitemap.xml",
    "/robots.txt",
    "/manifest.webmanifest",
    "/opengraph-image",
    "/pricing/twitter-image",
    "/c/opengraph-image-me1qvg",
    "/seasons/vpl-1-513q/auction/spectate",
    "/seasons/vpl-1-513q/auction/spectate/opengraph-image",
    "/seasons/vpl-1-513q/register",
  ])("%s is public", (path) => {
    expect(isPublicPath(path)).toBe(true);
  });

  it.each([
    "/home",
    "/tournaments",
    "/players",
    "/auctions",
    "/reports",
    "/me",
    "/account",
    "/admin/health",
    "/seasons/vpl-1-513q",
    "/seasons/vpl-1-513q/auction/live",
    "/seasons/vpl-1-513q/registrations",
    "/org/demo-club",
    "/join/abc",
    "/search",
    "/demo/token",
    // Near misses: a public name as a prefix must not open a console.
    "/pricing-admin",
    "/cx",
    "/helpdesk",
    "/seasons/x/auction/spectator",
  ])("%s is not public", (path) => {
    expect(isPublicPath(path)).toBe(false);
  });
});
