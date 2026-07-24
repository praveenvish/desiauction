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

/**
 * Exactly five, forever (canon docs/16; PX-1 01 §1) — the COUNT is the canon,
 * and it still holds.
 *
 * Slot 2 was "Seasons". It is now "Tournaments", by an explicit product ruling:
 * the recurring tournament is how organizers name their calendar ("BPL", then
 * "BPL 1", "BPL 2"), the schema has modelled it since IP-3, and the layer was
 * unreachable — no route, no create flow, every UI-made season a one-off.
 * Seasons have not moved: they live under their tournament, and /seasons still
 * answers, so the rail's active key claims both.
 */
export const RAIL: RailTarget[] = [
  { key: "home", label: "Home", href: "/home" },
  { key: "tournaments", label: "Tournaments", href: "/tournaments" },
  { key: "orgs", label: "Organizations", href: "/orgs" },
  // DA-18: /money is a placeholder that tells the user so ("being built during
  // the beta"). A primary navigation item is a promise; this one led to an
  // apology. It comes back when the surface behind it does — the season's own
  // Money tab, which IS built, is unaffected.
  { key: "help", label: "Help", href: "/help" },
];

/** Rail active state: longest matching prefix wins; /org/* belongs to Organizations. */
export function activeRailKey(pathname: string): string | null {
  if (pathname.startsWith("/org/") || pathname.startsWith("/orgs")) {
    return "orgs";
  }
  // A season IS an edition of a tournament, so every /seasons/* surface lights
  // the Tournaments rail item rather than leaving the rail blank while an
  // organizer does the bulk of their work.
  if (pathname.startsWith("/tournaments") || pathname.startsWith("/seasons")) {
    return "tournaments";
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
  /** Test hook, for when the tab IS the navigation affordance a suite drives. */
  testId?: string;
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
  // These tabs ARE the season workspace's navigation, so they carry the
  // navigation test hooks. They used to hang off buttons on the overview, which
  // is now a read-only dashboard.
  return [
    { key: "overview", label: "Overview", href: base },
    { key: "teams", label: "Teams", href: `${base}/teams`, testId: "open-teams" },
    {
      key: "registrations",
      label: "Registrations",
      href: `${base}/registrations`,
      testId: "open-dashboard",
    },
    { key: "fixtures", label: "Fixtures", href: `${base}/fixtures`, testId: "open-fixtures" },
    { key: "auction", label: "Auction", href: `${base}/auction`, testId: "open-auction" },
    ...(canSettle ? [{ key: "money", label: "Money", href: `${base}/money` }] : []),
  ];
}

/**
 * The org's money desks read as one workspace with four sections, so they
 * navigate like every other sectioned surface — through the shell's tab strip,
 * not a bar each page draws for itself.
 */
export function orgMoneyTabs(slug: string): CompetitionTab[] {
  return [
    { key: "settlement", label: "Settlement", href: `/org/${slug}/settlement` },
    { key: "finance", label: "Finance", href: `/org/${slug}/money` },
    { key: "deliveries", label: "Deliveries", href: `/org/${slug}/money/deliveries` },
    { key: "reconciliation", label: "Reconciliation", href: `/org/${slug}/money/reconciliation` },
  ];
}

/** null when the path is not one of the money desks. */
export function activeOrgMoneyTab(pathname: string, slug: string): string | null {
  const base = `/org/${slug}`;
  if (pathname.startsWith(`${base}/settlement`)) {
    return "settlement";
  }
  if (pathname.startsWith(`${base}/money/deliveries`)) {
    return "deliveries";
  }
  if (pathname.startsWith(`${base}/money/reconciliation`)) {
    return "reconciliation";
  }
  if (pathname.startsWith(`${base}/money`)) {
    return "finance";
  }
  return null;
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
  [/^\/org\/[^/]+\/t\/[^/]+$/, "Tournament"],
  [/^\/org\/[^/]+\/venues$/, "Venues"],
  [/^\/tournaments\/[^/]+$/, "Tournament"],
  [/^\/tournaments$/, "Tournaments"],
];

export function sectionLabel(pathname: string): string | null {
  for (const [pattern, label] of SECTION_LABELS) {
    if (pattern.test(pathname)) {
      return label;
    }
  }
  return null;
}

/**
 * Where the identity bar's title comes from on a rail destination. The rail
 * label names a place in the navigation; these name the surface you land on.
 */
const RAIL_TITLES: Record<string, string> = {
  home: "Home",
  tournaments: "Tournaments",
  orgs: "Organizations",
  money: "Money",
  help: "Help",
};

/** The two console surfaces that sit outside the five-item rail. */
const OUTSIDE_RAIL: [string, string][] = [
  ["/inbox", "Notifications"],
  ["/account", "Account"],
];

/**
 * The one line that says what a surface is for. It rides the identity bar under
 * the title, in the slot a breadcrumb takes on a nested page — so line two of
 * the header always answers "and what is this?", by trail or by sentence, and
 * the page below opens with content instead of a lede.
 *
 * Only surfaces with no ancestors need one; inside a season the trail is the
 * better answer. Pages whose lede is data (the /home headline) publish it
 * through `<PageTitle subtitle=…>` instead.
 */
const SURFACE_SUBTITLES: [string, string][] = [
  ["/tournaments", "Your recurring competitions, and the seasons that run under them."],
  ["/orgs", "The clubs and academies you run tournaments under."],
  ["/money", "Your purses, dues and receipts across every season."],
  ["/inbox", "Account activity now; approvals, receipts and auction updates join during the beta."],
  ["/account", "Your sign-in, profile and security."],
];

export interface IdentityCrumb {
  label: string;
  href?: string;
}

export interface PageIdentity {
  /** The current page's ANCESTORS. Empty on a rail destination. */
  crumbs: IdentityCrumb[];
  /**
   * The page's name — rendered as the document's one h1, in the shell header.
   * null where the URL proves nothing (the route 404s underneath), so the shell
   * frames no title rather than announcing a surface that is not there.
   */
  title: string | null;
  /** What the surface is for, when it has no trail to show instead. */
  subtitle?: string;
}

export interface IdentityContext {
  competitions: { slug: string; name: string; orgName: string; orgSlug: string }[];
  orgs: { slug: string; name: string }[];
  /** Administration exists for its grant holders only — for everyone else /admin 404s. */
  isAdmin?: boolean;
}

/**
 * Every console route's breadcrumb + title, decided in ONE place.
 *
 * This is what makes the header consistent: no page chooses where its name is
 * drawn or what shape it takes, so no page can drift. Names the shell already
 * holds (the viewer's orgs and seasons) resolve here; the handful of titles that
 * are page data — a tournament, an admin record, a finance document — get a
 * generic-but-true label here and are overridden by `<PageTitle>` on the page.
 */
export function pageIdentity(pathname: string, ctx: IdentityContext): PageIdentity {
  const section = sectionLabel(pathname);

  // Administration: a flat surface with its own tabs, reached from the avatar.
  // Titled only for grant holders — for anyone else the page underneath is a
  // 404, and naming the surface would be the shell admitting it exists.
  if (pathname.startsWith("/admin")) {
    if (ctx.isAdmin !== true) {
      return { crumbs: [], title: null };
    }
    return pathname === "/admin"
      ? { crumbs: [], title: "Platform admin" }
      : {
          crumbs: [{ label: "Platform admin", href: "/admin" }],
          title: section ?? "Platform admin",
        };
  }

  // Inside a season: org / season / section.
  const seasonMatch = /^\/seasons\/([^/]+)/.exec(pathname);
  if (seasonMatch !== null) {
    const slug = seasonMatch[1] as string;
    const season = ctx.competitions.find((entry) => entry.slug === slug);
    if (season === undefined) {
      // A non-member deep link: the page underneath 404s, so the trail says only
      // what is true from the URL.
      return {
        crumbs: [{ label: "Tournaments", href: "/tournaments" }],
        title: section ?? "Season",
      };
    }
    return {
      crumbs: [
        { label: season.orgName, href: `/org/${season.orgSlug}` },
        ...(section !== null ? [{ label: season.name, href: `/seasons/${slug}` }] : []),
      ],
      title: section ?? season.name,
    };
  }

  // Inside an org: Organizations / org / section.
  const orgMatch = /^\/org\/([^/]+)/.exec(pathname);
  if (orgMatch !== null) {
    const slug = orgMatch[1] as string;
    const org = ctx.orgs.find((entry) => entry.slug === slug);
    const label = org?.name ?? "Organization";
    return {
      crumbs: [
        { label: "Organizations", href: "/orgs" },
        ...(section !== null ? [{ label, href: `/org/${slug}` }] : []),
      ],
      title: section ?? label,
    };
  }

  // The season list and a single tournament both hang off the Tournaments rail.
  if (pathname.startsWith("/seasons")) {
    return { crumbs: [{ label: "Tournaments", href: "/tournaments" }], title: "Seasons" };
  }
  if (/^\/tournaments\/[^/]+/.test(pathname)) {
    return { crumbs: [{ label: "Tournaments", href: "/tournaments" }], title: "Tournament" };
  }

  // A root surface has no ancestors, so line two of the header carries its lede.
  const subtitle = SURFACE_SUBTITLES.find(([prefix]) => pathname === prefix)?.[1];
  const withLede = (title: string): PageIdentity => ({
    crumbs: [],
    title,
    ...(subtitle !== undefined ? { subtitle } : {}),
  });

  const railKey = activeRailKey(pathname);
  const railTitle = railKey !== null ? RAIL_TITLES[railKey] : undefined;
  if (railTitle !== undefined) {
    return withLede(railTitle);
  }
  const outside = OUTSIDE_RAIL.find(([prefix]) => pathname.startsWith(prefix));
  if (outside !== undefined) {
    return withLede(outside[1]);
  }
  return { crumbs: [], title: section };
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
