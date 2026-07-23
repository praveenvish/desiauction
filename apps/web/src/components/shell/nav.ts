/**
 * The one navigation model (PX-1 01; PX-2 scope §2). Pure data + pure
 * functions — the single source for shell selection, rail items, competition
 * tabs, section labels, and live-exit doors. Everything is unit-testable and
 * shared by ProductShell (client) and layouts (server).
 */

export type ShellKind = "public" | "console" | "live" | "bare";

const LIVE_SEGMENTS = new Set(["live", "cockpit", "spectate", "replay"]);

/** Chrome-free auction surfaces: the OBS overlay and the public live board. */
const BARE_AUCTION_RE = /^\/seasons\/[^/]+\/auction\/(overlay|board)(\/|$)/;

/** /seasons/{slug}/auction/{live|cockpit|spectate|replay}[/...] */
export function liveMatch(pathname: string): { slug: string; segment: string } | null {
  const match = /^\/seasons\/([^/]+)\/auction\/([^/]+)/.exec(pathname);
  if (match !== null && LIVE_SEGMENTS.has(match[2] as string)) {
    return { slug: match[1] as string, segment: match[2] as string };
  }
  return null;
}

export function shellKind(pathname: string): ShellKind {
  // The overlay and public board are bare, chrome-free surfaces — checked
  // before `liveMatch` so the auction segment never frames them in the Live shell.
  if (
    pathname.startsWith("/gallery") ||
    pathname.startsWith("/dev") ||
    BARE_AUCTION_RE.test(pathname)
  ) {
    return "bare";
  }
  if (liveMatch(pathname) !== null) {
    return "live";
  }
  if (
    pathname === "/" ||
    pathname === "/c" ||
    pathname.startsWith("/c/") ||
    pathname.startsWith("/login") ||
    pathname.startsWith("/join/") ||
    pathname.startsWith("/owner-join/") ||
    pathname.startsWith("/help") ||
    // PX-10 public content surfaces: marketing, legal, support, search.
    pathname.startsWith("/legal") ||
    pathname.startsWith("/pricing") ||
    pathname.startsWith("/features") ||
    pathname.startsWith("/contact") ||
    pathname.startsWith("/support") ||
    pathname.startsWith("/releases") ||
    pathname.startsWith("/search") ||
    // Marketing & company surfaces added with the mk- design layer. Without
    // these a signed-in visitor would see them framed in the console shell.
    pathname.startsWith("/about") ||
    pathname.startsWith("/security") ||
    pathname.startsWith("/rules-guidelines") ||
    pathname.startsWith("/schedule-demo") ||
    pathname.startsWith("/blog") ||
    pathname.startsWith("/careers") ||
    pathname.startsWith("/case-studies") ||
    pathname.startsWith("/api-docs") ||
    /^\/seasons\/[^/]+\/register/.test(pathname)
  ) {
    return "public";
  }
  return "console";
}

export interface RailTarget {
  key: string;
  label: string;
  href: string;
}

/** Exactly five, forever (canon docs/16; PX-1 01 §1). */
export const RAIL: RailTarget[] = [
  { key: "home", label: "Home", href: "/home" },
  { key: "seasons", label: "Seasons", href: "/seasons" },
  { key: "orgs", label: "Organizations", href: "/orgs" },
  { key: "money", label: "Money", href: "/money" },
  { key: "help", label: "Help", href: "/help" },
];

/** Rail active state: longest matching prefix wins; /org/* belongs to Organizations. */
export function activeRailKey(pathname: string): string | null {
  if (pathname.startsWith("/org/") || pathname.startsWith("/orgs")) {
    return "orgs";
  }
  if (pathname.startsWith("/seasons")) {
    return "seasons";
  }
  if (pathname.startsWith("/money")) {
    return "money";
  }
  if (pathname.startsWith("/help")) {
    return "help";
  }
  if (
    pathname.startsWith("/home") ||
    pathname.startsWith("/inbox") ||
    pathname.startsWith("/account")
  ) {
    return pathname.startsWith("/home") ? "home" : null;
  }
  return null;
}

export interface CompetitionTab {
  key: string;
  label: string;
  href: string;
}

/**
 * PX-10 §6: the public content destinations the command palette can reach
 * ("Extend Product Search" — navigation only, PX-2's ruling). A curated set, not
 * the whole search index, so the console bundle stays light; the full index
 * powers the public /search page. Every href is a route shipped in PX-10.
 */
export const PUBLIC_DESTINATIONS: readonly {
  key: string;
  label: string;
  href: string;
  keywords: string;
}[] = [
  {
    key: "help",
    label: "Help centre",
    href: "/help",
    keywords: "help guide docs documentation how to",
  },
  {
    key: "help-auction-night",
    label: "Help — running your first auction night",
    href: "/help/auction-night",
    keywords: "walkthrough end to end auction night",
  },
  {
    key: "help-finops",
    label: "Help — receipts, invoices and exports",
    href: "/help/receipts-and-exports",
    keywords: "finance financial operations receipt invoice tally export books",
  },
  {
    key: "help-settlement",
    label: "Help — money after the gavel",
    href: "/help/money-after-the-gavel",
    keywords: "settlement money collect waive close case",
  },
  { key: "faq", label: "Help — FAQ", href: "/help/faq", keywords: "faq questions answers" },
  {
    key: "features",
    label: "Features",
    href: "/features",
    keywords: "features capabilities product",
  },
  { key: "pricing", label: "Pricing", href: "/pricing", keywords: "pricing pass cost free tier" },
  {
    key: "support",
    label: "Support",
    href: "/support",
    keywords: "support contact bug help status",
  },
  {
    key: "releases",
    label: "Release notes",
    href: "/releases",
    keywords: "release notes changelog whats new version",
  },
  {
    key: "legal",
    label: "Legal centre",
    href: "/legal",
    keywords: "legal terms privacy refund policy",
  },
];

/**
 * PX-9: Platform Administration's own tab row. Administration is NOT a rail
 * item — the rail is five, forever (canon docs/16) — so it navigates itself,
 * reached from the avatar menu by the few who hold the grant.
 */
export const ADMIN_TABS: CompetitionTab[] = [
  { key: "overview", label: "Overview", href: "/admin" },
  { key: "orgs", label: "Organizations", href: "/admin/orgs" },
  { key: "users", label: "Users", href: "/admin/users" },
  { key: "audit", label: "Audit", href: "/admin/audit" },
  { key: "health", label: "Health", href: "/admin/health" },
];

export function activeAdminTab(pathname: string): string {
  if (pathname.startsWith("/admin/orgs")) {
    return "orgs";
  }
  if (pathname.startsWith("/admin/users")) {
    return "users";
  }
  if (pathname.startsWith("/admin/audit")) {
    return "audit";
  }
  if (pathname.startsWith("/admin/health")) {
    return "health";
  }
  return "overview";
}

/**
 * PX-7: Money appears only for holders of `settlement.view` (PX-1 01 §3). The
 * tab is not disabled for anyone else — it is ABSENT, matching the surface
 * itself, which 404s rather than admit the books exist.
 */
export function competitionTabs(slug: string, canSettle = false): CompetitionTab[] {
  const base = `/seasons/${slug}`;
  return [
    { key: "overview", label: "Overview", href: base },
    { key: "teams", label: "Teams", href: `${base}/teams` },
    { key: "registrations", label: "Registrations", href: `${base}/registrations` },
    { key: "fixtures", label: "Fixtures", href: `${base}/fixtures` },
    { key: "auction", label: "Auction", href: `${base}/auction` },
    ...(canSettle ? [{ key: "money", label: "Money", href: `${base}/money` }] : []),
  ];
}

export function activeCompetitionTab(pathname: string, slug: string): string {
  const base = `/seasons/${slug}`;
  if (pathname.startsWith(`${base}/money`)) {
    return "money";
  }
  if (pathname.startsWith(`${base}/teams`)) {
    return "teams";
  }
  if (pathname.startsWith(`${base}/registrations`)) {
    return "registrations";
  }
  if (pathname.startsWith(`${base}/fixtures`)) {
    return "fixtures";
  }
  if (pathname.startsWith(`${base}/auction`) || pathname.startsWith(`${base}/readiness`)) {
    return "auction";
  }
  return "overview";
}

const SECTION_LABELS: [RegExp, string][] = [
  // PX-9 admin, longest-first — the detail pages must not read "Organizations".
  [/^\/admin\/orgs\/[^/]+$/, "Organization"],
  [/^\/admin\/users\/[^/]+$/, "User"],
  [/^\/admin\/orgs$/, "Organizations"],
  [/^\/admin\/users$/, "Users"],
  [/^\/admin\/audit$/, "Audit"],
  [/^\/admin\/health$/, "Health"],
  // Longest-first: the case review must not be labelled "Money".
  [/\/money\/case\/[^/]+$/, "Case review"],
  // PX-8 finance (org-scoped) — also longest-first.
  [/\/money\/documents\/[^/]+$/, "Document"],
  [/\/money\/deliveries$/, "Deliveries"],
  [/\/money\/reconciliation$/, "Reconciliation"],
  [/\/money$/, "Money"],
  [/\/settlement$/, "Settlement"],
  [/\/teams$/, "Teams"],
  [/\/readiness$/, "Readiness"],
  [/\/registrations$/, "Registrations"],
  [/\/fixtures\/calendar$/, "Calendar"],
  [/\/fixtures\/match-day$/, "Match day"],
  [/\/fixtures$/, "Fixtures"],
  [/\/auction\/ledger$/, "Ledger"],
  [/\/auction\/engine$/, "Engine"],
  [/\/auction$/, "Auction"],
  [/\/register$/, "Register"],
];

export function sectionLabel(pathname: string): string | null {
  for (const [pattern, label] of SECTION_LABELS) {
    if (pattern.test(pathname)) {
      return label;
    }
  }
  return null;
}

/** The one labeled door out of a live surface (canon docs/16). */
export function liveExit(pathname: string, hasSession: boolean): { href: string; label: string } {
  const match = liveMatch(pathname);
  if (match === null) {
    return { href: "/home", label: "Leave" };
  }
  if (match.segment === "spectate" && !hasSession) {
    return { href: "/", label: "Leave auction" };
  }
  return { href: `/seasons/${match.slug}/auction`, label: "Leave auction" };
}
