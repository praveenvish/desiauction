import type { MetadataRoute } from "next";

/**
 * WHICH ADDRESSES A SEARCH ENGINE MAY SEE — declared once (SEO-1 Phase 1).
 *
 * This used to live in three places that did not know about each other: a
 * hand-kept `Disallow` list in robots.ts, a hand-kept URL list in sitemap.ts,
 * and a `robots` field on whichever pages remembered one. They drifted exactly
 * the way lists do. `/tournaments`, `/players`, `/auctions`, `/reports` and
 * `/me` shipped after the Disallow list was written and never joined it, and
 * `/about`, `/security`, `/rules-guidelines` and `/schedule-demo` were
 * indexable pages the sitemap never announced.
 *
 * THE RULE IS NOW AN ALLOWLIST. `middleware.ts` stamps `X-Robots-Tag: noindex`
 * on every page that `isPublicPath` does not claim, so a console route added
 * tomorrow is kept out of search without anyone remembering to list it. A
 * public page is the one that has to be declared, and the classification test
 * (`routes.test.ts`) refuses a new top-level segment until someone decides
 * which side of the line it is on.
 *
 * Public is not the same as indexable. A public page (a player card, a
 * registration form, a coming-soon placeholder) still sets its own
 * `robots: { index: false }` when it is for sharing by link rather than for
 * search. The header only ever says "no"; it never overrides a page's own no.
 */

type ChangeFrequency = NonNullable<MetadataRoute.Sitemap[number]["changeFrequency"]>;

export interface IndexablePage {
  readonly path: string;
  /**
   * When the page's CONTENT last changed (ISO date). This is the sitemap's
   * `lastmod`, which is the only freshness signal Google reads. Bump it only
   * for a real change of words. A date that moves on every deploy teaches a
   * crawler to ignore it, and then it ignores the real changes too.
   */
  readonly updatedOn: string;
  readonly changeFrequency?: ChangeFrequency;
}

/**
 * Standalone marketing and hub pages that belong in search. Help articles,
 * legal documents, sport pages and public seasons are added by the sitemap from
 * their own registries (`content/help.ts`, `content/legal.ts`,
 * `content/sports.ts`, the database), so they
 * can never be listed here and missing there.
 */
export const INDEXABLE_PAGES: readonly IndexablePage[] = [
  { path: "/", updatedOn: "2026-09-30", changeFrequency: "weekly" },
  { path: "/features", updatedOn: "2026-09-26", changeFrequency: "monthly" },
  { path: "/pricing", updatedOn: "2026-09-27", changeFrequency: "monthly" },
  { path: "/about", updatedOn: "2026-09-26", changeFrequency: "monthly" },
  { path: "/security", updatedOn: "2026-09-26", changeFrequency: "monthly" },
  { path: "/rules-guidelines", updatedOn: "2026-09-26", changeFrequency: "monthly" },
  { path: "/schedule-demo", updatedOn: "2026-09-26", changeFrequency: "monthly" },
  { path: "/support", updatedOn: "2026-09-26", changeFrequency: "monthly" },
  { path: "/releases", updatedOn: "2026-09-26", changeFrequency: "monthly" },
  { path: "/c", updatedOn: "2026-09-26", changeFrequency: "daily" },
  { path: "/help", updatedOn: "2026-09-26", changeFrequency: "monthly" },
  { path: "/help/faq", updatedOn: "2026-09-26", changeFrequency: "monthly" },
  { path: "/legal", updatedOn: "2026-09-26", changeFrequency: "monthly" },
  { path: "/sports", updatedOn: "2026-09-30", changeFrequency: "monthly" },
];

/**
 * Public pages that are reachable without signing in but deliberately NOT in
 * the sitemap: each one sets its own `noindex`, or redirects to a page that is
 * listed. They are exempt from the header so their own metadata is what a
 * crawler reads.
 */
const PUBLIC_UNLISTED = [
  "/login",
  "/contact",
  "/blog",
  "/careers",
  "/case-studies",
  "/api-docs",
] as const;

/**
 * Whole public subtrees. `/c/…` holds seasons, squads and player cards; the
 * last two set their own `noindex` because they are for sharing, not search.
 */
const PUBLIC_SUBTREES = [
  "/c",
  "/help",
  "/legal",
  "/schedule-demo",
  "/newsletter",
  "/sports",
] as const;

/** Next's file-based metadata routes. These are fetched by crawlers and share scrapers. */
const METADATA_FILES = ["/sitemap.xml", "/robots.txt", "/manifest.webmanifest"] as const;

const PUBLIC_PATTERNS: readonly RegExp[] = [
  // The live room's audience view is public by the season's own visibility;
  // everything else under a season is a console.
  /^\/seasons\/[^/]+\/auction\/spectate(?:\/|$)/,
  // The player registration form: public, shared by every organizer, and
  // `noindex, follow` by its own metadata. Left to the header it became
  // `nofollow` too (the stricter rule wins), and its link to the season page
  // stopped counting.
  /^\/seasons\/[^/]+\/register(?:\/|$)/,
  // Share cards, wherever they sit. The hash suffix is Next's (`opengraph-image-me1qvg`).
  /\/(?:opengraph|twitter)-image(?:-[\w]+)?$/,
];

const PUBLIC_EXACT: ReadonlySet<string> = new Set<string>([
  ...INDEXABLE_PAGES.map((page) => page.path),
  ...PUBLIC_UNLISTED,
  ...METADATA_FILES,
]);

/** True when `pathname` is a public page, whose own metadata decides indexing. */
export function isPublicPath(pathname: string): boolean {
  if (PUBLIC_EXACT.has(pathname)) return true;
  if (PUBLIC_SUBTREES.some((root) => pathname === root || pathname.startsWith(`${root}/`))) {
    return true;
  }
  return PUBLIC_PATTERNS.some((pattern) => pattern.test(pathname));
}

/** The header value for every page `isPublicPath` does not claim. */
export const NOINDEX_HEADER = "noindex, nofollow";

/**
 * Signed-in surfaces, plus the few public pages that must never be crawled:
 * search results (`search`) and one-person token links (`demo`, `email`,
 * `join`, `owner-join`). All of these are disallowed in robots.txt. This list only saves crawl
 * budget. The noindex header is what keeps these pages out of search, and it
 * does not depend on the list being complete. It still has to be complete for
 * the classification test to pass, so the two cannot drift.
 */
export const CONSOLE_SEGMENTS = [
  "home",
  "account",
  "inbox",
  "money",
  "onboarding",
  "orgs",
  "org",
  "seasons",
  "tournaments",
  "players",
  "auctions",
  "reports",
  "me",
  "join",
  "owner-join",
  "review",
  "admin",
  "search",
  "demo",
  "email",
  "dev",
  "gallery",
] as const;

/**
 * Paths robots.txt allows inside a disallowed segment. The more specific rule
 * wins over `Disallow: /seasons`, so the share cards of the spectate room and
 * the registration form can be fetched by Twitterbot, which honours robots.txt.
 */
export const ROBOTS_ALLOW_INSIDE_CONSOLE = [
  "/seasons/*/auction/spectate",
  "/seasons/*/register",
] as const;

/**
 * Top-level `app/` segments that are neither pages nor consoles: route
 * handlers and health probes. They serve no HTML, so there is nothing to index.
 */
export const INFRA_SEGMENTS = ["api", "healthz", "readyz", "indexnow-key.txt"] as const;

/** The first path segment of every public page, used by the classification test. */
export function publicTopSegments(): ReadonlySet<string> {
  const firstSegment = (path: string): string => path.split("/")[1] ?? "";
  return new Set(
    [...PUBLIC_EXACT, ...PUBLIC_SUBTREES].map(firstSegment).filter((segment) => segment !== ""),
  );
}

/**
 * A human date ("16 Jul 2026", how the legal documents state their effective
 * date) as an ISO calendar date. It is read as UTC, so the day never shifts
 * with the server's timezone.
 */
export function isoCalendarDate(human: string): string {
  const parsed = new Date(`${human} UTC`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Not a calendar date: ${human}`);
  }
  return parsed.toISOString().slice(0, 10);
}
