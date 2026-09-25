import { sportLabel } from "@desiauction/core/sport-labels";

/* ===========================================================================
 * THE SEVEN NAVIGATION LAWS (RN-1)
 *
 * Everything below is a consequence of these. They are here, in the module
 * every shell and layout reads, so that the next change has to argue with them
 * rather than quietly contradict them — which is exactly how this file came to
 * hold two disagreeing navigation authorities.
 *
 *   1. ONE PRIMARY LIST. Exactly one, at most five items. Never three.
 *   2. RAIL = WHO YOU ARE. TABS = WHERE YOU ARE. ACTION = WHAT YOU CAN DO.
 *      Nothing appears in two of them.
 *   3. OFFER ONLY WHAT IS YOURS. A destination that would 404, or come up
 *      empty, is ABSENT — never disabled, never present-and-apologising.
 *   4. SAME MENU ON EVERY DEVICE. Same items, same order, same active state.
 *   5. ONE NAME PER SURFACE, drawn by the shell. No page titles itself.
 *   6. ONE PRIMARY ACTION PER SCREEN, always in the same place.
 *   7. LIVE OUTRANKS EVERYTHING. An auction you are in takes the top of the
 *      rail and the top of home, whatever else is true.
 *
 * And the rule that repairs the defect these laws were written for:
 *
 *   MEMBERSHIP IS NOT A ROLE. `memberOf` confers READ ACCESS and never a menu
 *   item. `acceptOwnerJoin` makes every team owner a viewer-level member of the
 *   host club, so a menu built from membership hands a player who accepted a
 *   team the whole organizer product. A menu is built from what you DO.
 * ======================================================================== */

/**
 * The one navigation model (PX-1 01; PX-2 scope §2). Pure data + pure
 * functions — the single source for shell selection, rail items, competition
 * tabs, section labels, and live-exit doors. Everything is unit-testable and
 * shared by ProductShell (client) and layouts (server).
 */

export type ShellKind = "public" | "console" | "live" | "bare";

// "plan" is the owner's private plan (WR-1): an Owner Room surface, framed like
// the room it belongs to, with the same one door out.
const LIVE_SEGMENTS = new Set(["live", "cockpit", "spectate", "replay", "plan"]);

/** Chrome-free auction surfaces: the OBS overlay and the public live board. */
const BARE_AUCTION_RE = /^\/seasons\/[^/]+\/auction\/(overlay|board)(\/|$)/;

/** /seasons/{slug}/auction/{live|cockpit|spectate|replay|plan}[/...] */
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
    // Onboarding is a focused, chrome-free moment (2026-07-24 collapse). The
    // login page keeps the public header/footer (2026-07-25 founder call) so a
    // visitor at the gate can still reach the rest of the site.
    pathname.startsWith("/onboarding") ||
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
    // A booking link opens in whatever browser the mail was read in, often
    // with a live session — without this the person's own demo would arrive
    // framed in the organizer console.
    pathname.startsWith("/demo/") ||
    // Same for a review link (FR-1): it is read in a mail client's browser,
    // signed in or not, and is a public page either way.
    pathname.startsWith("/review/") ||
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

/** Rail active state: longest matching prefix wins; /org/* belongs to Organizations. */
export function activeRailKey(pathname: string): string | null {
  if (pathname.startsWith("/org/") || pathname.startsWith("/orgs")) {
    return "orgs";
  }
  // A season IS an edition of a tournament, so every /seasons/{slug} surface
  // lights the Tournaments rail item rather than leaving the rail blank while
  // an organizer does the bulk of their work. The bare /seasons index no longer
  // exists (it redirects), but the prefix has to stay for the workspace.
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
  /**
   * Extra path suffixes this tab owns, beyond its own href.
   *
   * A consolidated tab needs them: "Players" is Registrations AND Lineups, so
   * standing on /lineups must still light Players rather than leaving the strip
   * blank or falling through to Overview — a strip that cannot say where you
   * are is worse than a longer one (LAW 2).
   */
  claims?: string[];
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
    label: "Help — receipts and your document register",
    href: "/help/receipts-and-exports",
    // "invoice", "tally" and "export" stay in the keywords deliberately: people
    // WILL search for them, and the topic now answers those searches honestly
    // by naming them under "What isn't here yet". Dropping the keywords would
    // send that reader to an empty result instead of a straight answer.
    keywords: "finance financial operations receipt invoice tally export books register seal",
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
 * PLATFORM ADMINISTRATION'S OWN SECTIONS (PX-9, regrouped by RN-1 Phase 5).
 *
 * Administration is NOT a rail item — the rail is short and every slot is a
 * place this person works — so it navigates itself, reached from a door in the
 * utility group by the few who hold a platform grant.
 *
 * THE RULE CHANGED, DELIBERATELY. Every section used to be shown to every
 * operator, with the PAGE returning not-found without the grant, so that
 * comparing two screens could never reveal who holds what. That bought
 * leak-prevention BETWEEN COLLEAGUES WHO ARE ALL STAFF OF THIS COMPANY, and
 * charged for it in eight dead clicks per visit, forever, levied on exactly the
 * operators with the fewest grants: somebody holding only `platform:support`
 * met twelve tabs, ten of which said "This page doesn't exist".
 *
 * So a section now appears only for a capability its reader holds. THE 404 IS
 * UNTOUCHED — every page still gates itself on a direct URL, which is the real
 * boundary and keeps every property the capability engine proves. What changed
 * is only what the chrome OFFERS, which is LAW 3 applied to the same surface as
 * everywhere else.
 */
export type AdminGroup = "platform" | "trust" | "commercial";

export interface AdminSection extends CompetitionTab {
  /** The one capability that reveals this section. */
  capability: PlatformDoorCapability;
  group: AdminGroup;
  /** First of its group — the strip draws a divider before it. */
  dividerBefore?: boolean;
}

/**
 * Ordered by group. The groups are not labelled in the strip: with the
 * filtering above, most operators see three or four sections, and a heading
 * over a pair of links is chrome explaining chrome. The order and a divider
 * carry it.
 *
 *   platform    — what the whole platform is doing right now
 *   trust       — the sections that act on PEOPLE, and can end an account
 *   commercial  — customers: what they pay, ask for, and tell us
 */
const ADMIN_SECTIONS: readonly Omit<AdminSection, "dividerBefore">[] = [
  {
    key: "overview",
    label: "Overview",
    href: "/admin",
    capability: "platform.admin",
    group: "platform",
  },
  // Second, because on an auction night it is the only one that matters.
  {
    key: "live",
    label: "Live",
    href: "/admin/live",
    capability: "platform.admin",
    group: "platform",
  },
  {
    key: "health",
    label: "Health",
    href: "/admin/health",
    capability: "platform.admin",
    group: "platform",
  },
  {
    key: "audit",
    label: "Audit",
    href: "/admin/audit",
    capability: "platform.admin",
    group: "platform",
  },

  {
    key: "orgs",
    label: "Organizations",
    href: "/admin/orgs",
    capability: "platform.admin",
    group: "trust",
  },
  {
    key: "users",
    label: "Users",
    href: "/admin/users",
    capability: "platform.admin",
    group: "trust",
  },
  // Can take a public page down, overriding an organizer's own decision.
  {
    key: "moderation",
    label: "Moderation",
    href: "/admin/moderation",
    capability: "platform.moderate",
    group: "trust",
  },
  // Can END somebody's account, across every club they were ever in.
  {
    key: "erasure",
    label: "Erasure",
    href: "/admin/erasure",
    capability: "platform.privacy",
    group: "trust",
  },

  {
    key: "passes",
    label: "Passes",
    href: "/admin/passes",
    capability: "platform.pass",
    group: "commercial",
  },
  {
    key: "demos",
    label: "Demos",
    href: "/admin/demos",
    capability: "platform.demo",
    group: "commercial",
  },
  {
    key: "reports",
    label: "Reports",
    href: "/admin/reports",
    capability: "platform.support",
    group: "commercial",
  },
  {
    key: "reviews",
    label: "Reviews",
    href: "/admin/reviews",
    capability: "platform.support",
    group: "commercial",
  },
  {
    key: "newsletter",
    label: "Newsletter",
    href: "/admin/newsletter",
    capability: "platform.admin",
    group: "commercial",
  },
  {
    key: "messaging",
    label: "Messaging",
    href: "/admin/messaging",
    capability: "platform.admin",
    group: "commercial",
  },
  // Switches every message the platform sends — so its own door, beside the
  // read-only messaging view rather than inside it.
  {
    key: "notifications",
    label: "Notifications",
    href: "/admin/notifications",
    capability: "platform.admin",
    group: "commercial",
  },
];

/** The sections this operator holds a key to, with group dividers marked. */
export function adminSectionsFor(held: readonly PlatformDoorCapability[]): AdminSection[] {
  const visible = ADMIN_SECTIONS.filter((section) => held.includes(section.capability));
  let previous: AdminGroup | null = null;
  return visible.map((section) => {
    const first = previous !== null && previous !== section.group;
    previous = section.group;
    return first ? { ...section, dividerBefore: true } : { ...section };
  });
}

export function activeAdminTab(pathname: string): string {
  // An auction is reached from the live board, so it lights the board's tab.
  if (pathname.startsWith("/admin/live") || pathname.startsWith("/admin/auctions")) {
    return "live";
  }
  if (pathname.startsWith("/admin/moderation")) {
    return "moderation";
  }
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
  if (pathname.startsWith("/admin/messaging")) {
    return "messaging";
  }
  if (pathname.startsWith("/admin/notifications")) {
    return "notifications";
  }
  if (pathname.startsWith("/admin/passes")) {
    return "passes";
  }
  if (pathname.startsWith("/admin/demos")) {
    return "demos";
  }
  if (pathname.startsWith("/admin/erasure")) {
    return "erasure";
  }
  if (pathname.startsWith("/admin/newsletter")) {
    return "newsletter";
  }
  if (pathname.startsWith("/admin/reports")) {
    return "reports";
  }
  if (pathname.startsWith("/admin/reviews")) {
    return "reviews";
  }
  return "overview";
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

const SECTION_LABELS: [RegExp, string][] = [
  // PX-9 admin, longest-first — the detail pages must not read "Organizations".
  [/^\/admin\/orgs\/[^/]+$/, "Organization"],
  [/^\/admin\/users\/[^/]+$/, "User"],
  [/^\/admin\/orgs$/, "Organizations"],
  [/^\/admin\/users$/, "Users"],
  [/^\/admin\/audit$/, "Audit"],
  [/^\/admin\/health$/, "Health"],
  // Messaging was missing from BOTH admin lists — this one and ADMIN_TABS. The
  // tab strip was the visible half; this is why the identity bar rendered the
  // title "Platform admin" directly beneath a breadcrumb reading "Platform
  // admin", since `pageIdentity` falls back to the surface name when a section
  // has no label.
  [/^\/admin\/messaging$/, "Messaging"],
  [/^\/admin\/notifications\/suppressions$/, "Suppressions"],
  [/^\/admin\/notifications\/analytics$/, "Delivery analytics"],
  [/^\/admin\/notifications\/[^/]+\/email$/, "Email wording"],
  [/^\/admin\/notifications$/, "Notifications"],
  [/^\/admin\/passes$/, "Passes"],
  // Longest-first: availability must not be labelled "Demos".
  [/^\/admin\/demos\/availability$/, "Demo availability"],
  [/^\/admin\/demos$/, "Demos"],
  [/^\/admin\/erasure$/, "Erasure requests"],
  [/^\/admin\/newsletter$/, "Newsletter"],
  [/^\/admin\/reports$/, "Reports"],
  [/^\/admin\/reviews$/, "Reviews"],
  [/^\/admin\/live$/, "Live"],
  [/^\/admin\/auctions\/[^/]+$/, "Auction"],
  [/^\/admin\/moderation$/, "Moderation"],
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
  /*
   * "Players", not "Registrations" — the tab that leads here is called Players
   * (RN-1 Phase 4 consolidated Registrations + Lineups under it), and a tab
   * whose page announces a different name is the shell contradicting itself
   * one line apart. The CHILD keeps its own name: Lineups is Lineups, under a
   * Players tab that stays lit. Same reasoning for Schedule below.
   */
  [/\/registrations$/, "Players"],
  [/\/fixtures\/calendar$/, "Calendar"],
  [/\/fixtures\/match-day$/, "Match day"],
  [/\/fixtures$/, "Schedule"],
  [/\/lineups$/, "Lineups"],
  [/\/reviews$/, "Reviews"],
  [/\/standings$/, "Table"],
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
  players: "Players",
  auctions: "Auctions",
  reports: "Reports",
  help: "Help",
};

/** The console surfaces that sit outside the five-item rail. */
const OUTSIDE_RAIL: [string, string][] = [
  ["/inbox", "Notifications"],
  ["/account", "Account"],
  // PI-1: the player's own career — self-scoped by identity, not by grant.
  // Its sport comes from the PATH, not from this list — see `careerTitle`.
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
  // One line for both views of this page: the recurring competition, and the
  // edition that actually runs. /home's ladder framing, compressed.
  [
    "/tournaments",
    "Your recurring competitions, and every edition that runs under them — grouped, or all at once.",
  ],
  ["/orgs", "The clubs and academies you run tournaments under."],
  // What the page ships, not more: /money renders receipts (it computes no
  // balance and no due), and /inbox already carries approvals, auction results
  // and receipts — the old line undersold a launch product as unfinished.
  ["/money", "Receipts issued to your teams, across every season."],
  ["/inbox", "Approvals, auction results, receipts and account activity."],
  ["/account", "Your sign-in, profile and security."],
  ["/players", "Every player across the seasons you run — search, filter, open their sheet."],
  ["/auctions", "Every auction night you run, conduct, bid in or can watch."],
  ["/reports", "Registrations, fees and auction spend for each season you run."],
  ["/me", "Every tournament, match and sport you've played — in one place."],
  ["/me/cricket", "Every season you've played, in one place."],
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
  /**
   * Where this operator's administration STARTS.
   *
   * The trail used to point at /admin unconditionally, which 404s for an
   * operator who holds only `platform:support` — so the one breadcrumb on their
   * only two pages was a dead link. `operatorDoorHref` already computes the
   * right landing for each set; this carries it in.
   */
  adminHome?: string;
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
    const home = ctx.adminHome ?? "/admin";
    return pathname === home
      ? { crumbs: [], title: section ?? "Platform admin" }
      : {
          crumbs: [{ label: "Platform admin", href: home }],
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
      // The overview's hero banner is its one <h1> — the season's name over its
      // cover — so the shell names nothing there and keeps only the trail up to
      // the club. Decided HERE, from the URL, so the server renders one heading:
      // a client-side stand-down left two in the HTML until hydration, which
      // crawlers, no-JS readers and a slow CI all saw.
      title: section,
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

  // A single tournament hangs off the Tournaments rail. There is no branch for
  // a bare /seasons any more: the index merged into /tournaments and the path
  // redirects, so the shell never frames it. `/seasons/{slug}` is handled above.
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
  const career = careerTitle(pathname);
  if (career !== null) {
    return withLede(career);
  }
  return { crumbs: [], title: section };
}

/**
 * "My cricket", "My football" — the career page names its own sport.
 *
 * This used to be one static entry, `/me/cricket`, which was correct while the
 * platform ran one sport. SP-1 Phase 3 made the route `/me/[sport]`, and every
 * other sport then fell through this lookup to the generic fallback and lost
 * its title in the identity bar — a football player's career page was headed by
 * whatever the section happened to be called.
 *
 * Derived from the PATH rather than the session, which is the whole reason it
 * can live in a pure module: the sport is already in the URL, so the shell
 * needs no query to know which one it is showing. An unknown segment returns
 * null and falls through, because a URL naming a sport this platform has no
 * pack for should not be given a confident title.
 */
export function careerTitle(pathname: string): string | null {
  // The all-sports hub (launch polish, Phase 3).
  if (pathname === "/me") {
    return "My sports";
  }
  const match = /^\/me\/([^/?#]+)/.exec(pathname);
  if (match === null) {
    return null;
  }
  // The label map, not `sportPack`: this module ships in every page's bundle.
  const label = sportLabel(decodeURIComponent(match[1] ?? ""));
  return label === null ? null : `My ${label.toLowerCase()}`;
}

/** The one labeled door out of a live surface (canon docs/16). */
export function liveExit(pathname: string, hasSession: boolean): { href: string; label: string } {
  const match = liveMatch(pathname);
  if (match === null) {
    return { href: "/home", label: "Leave" };
  }
  // An anonymous spectator did not come from the marketing home — they came
  // from `/c/<slug>` (the landing page and the public directory both funnel
  // there, and there is where the rest of this tournament is). Sending them to
  // "/" was an exit that landed them somewhere they had never been.
  if (match.segment === "spectate" && !hasSession) {
    // …and the door says where it goes: "Leave auction" on a finished night
    // read as walking out of something still running. The season's name is
    // not known from a pathname, so the label names the place, not the season.
    return { href: `/c/${match.slug}`, label: "Back to the season" };
  }
  return { href: `/seasons/${match.slug}/auction`, label: "Leave auction" };
}

/* ===========================================================================
 * RN-1 — THE ONE NAVIGATION MODEL
 *
 * Everything above this line is the PX-2 model, still wired to the shell. This
 * section is its replacement: one pure function that answers "what is in this
 * person's menu", for every device, from role facts alone.
 *
 * Phase 1 ships the model and its test matrix and changes no UI. Phase 2 swaps
 * `ProductShell` onto it and deletes `RAIL`, `railFor`, `roleNavGroups` and
 * `activeRailKey`, which are the three-lists-in-one-sidebar defect (LAW 1).
 *
 * WHY A UNION AND NOT A MODE. The first draft of RN-1 proposed a "lens" — one
 * role the product assumes you are in, with a switcher and a cookie. A mode is
 * a power-user concept: hidden state, a control that has to be taught, and a
 * new question ("why am I seeing this?") added to a product whose whole
 * complaint is that it is confusing. So the menu is simply the UNION of what is
 * yours, ordered by urgency, capped at five — deterministic, teachable by
 * looking at it, and testable as a table.
 *
 * THE CAP CAN BE HARD BECAUSE HOME IS THE UNION SURFACE. Every role's summary
 * lives on /home, so an item dropped by the cap is always exactly one tap away.
 * That is what lets this refuse a "More…" menu, which is a fourth list wearing
 * a disguise.
 * ======================================================================== */

/**
 * Rail and utility icons. Named, not imported: this module is pure data shared
 * by a server layout and a client shell, and the moment it imports a component
 * it stops being either.
 */
export type NavIcon =
  | "home"
  | "room"
  | "cockpit"
  | "team"
  | "nights"
  | "trophy"
  | "org"
  | "money"
  | "sports"
  | "find"
  | "player"
  | "gavel"
  | "chart"
  | "help"
  | "bell"
  | "account"
  | "admin";

/** One entry of a multi-scope item's popover (two teams, three auction nights). */
export interface NavChoice {
  key: string;
  label: string;
  /** The season this one belongs to — the popover's second line. */
  hint: string;
  href: string;
  live?: boolean;
}

export interface NavItem {
  key: string;
  label: string;
  /**
   * What the phone's bottom bar calls this.
   *
   * LAW 4 wants the same word on every device, so this differs from `label`
   * only where it must: five columns at 320px is ~64px each, and a team's name
   * or "Find tournaments" cannot be read in that. Where a short form is needed
   * it is a synonym the product already uses out loud ("Clubs" is the word
   * /home's own setup ladder uses for an organization), never an abbreviation
   * invented for the bar — "tourns" is not a word in any register.
   */
  shortLabel: string;
  href: string;
  icon: NavIcon;
  /** An auction under this item is running right now (LAW 7). */
  live?: boolean;
  active?: boolean;
  /** Present only when the person holds more than one of this thing. */
  choices?: NavChoice[];
  /**
   * Absent from the PHONE's bar (premium-flow's ruling, 2026-09-19, kept).
   *
   * Organizations and Reports are desk surfaces — a laptop job — and the bar
   * has five columns to spend. LAW 4 wants the same menu everywhere and still
   * gets it: nothing here is a destination the phone cannot reach (the drawer
   * and Home both carry them), it is a question of which five earn the bar.
   */
  mobile?: false;
}

export interface NavModel {
  /** LAW 1: the one primary list, at most `RAIL_CAP` items. */
  rail: NavItem[];
  /** Site-wide services. The rail is WORK; this is everything else. */
  utility: NavItem[];
}

/**
 * The six platform capability sets, as bare strings.
 *
 * Declared here rather than imported from `server/admin/capabilities`: this
 * module is bundled into the client, and a type-only import that someone later
 * "tidies" into a value import would drag the platform vocabulary — and
 * whatever it grows to import — into every visitor's browser. The pairing is
 * pinned by a test instead.
 */
export type PlatformDoorCapability =
  | "platform.admin"
  | "platform.support"
  | "platform.moderate"
  | "platform.privacy"
  | "platform.pass"
  | "platform.demo";

/** A team this person owns, or a season they were appointed to run. */
export interface NavScope {
  /** The team's name, or the season's. */
  label: string;
  seasonSlug: string;
  /** The season's name — what a popover row says underneath the label. */
  seasonName: string;
  /** Its auction is `live` or `paused`. */
  live: boolean;
}

/**
 * WHO THIS PERSON IS, reduced to what a menu needs.
 *
 * Every field is a FACT, derived in `server/roles/roles.ts`. There is
 * deliberately no `memberOf` and no `onlyPlays`: membership is not a role, and
 * `onlyPlays` was a single fragile branch standing in for a model.
 */
export interface NavRoles {
  /** Holds `org:owner` or `org:staff` anywhere. */
  organizes: boolean;
  /** Teams owned — an accepted owner invite or a live paddle grant. */
  teams: NavScope[];
  /** Seasons held under an `auction:conductor` grant. */
  conducts: NavScope[];
  /** A registration anywhere, or a player profile. */
  plays: boolean;
  /** Holds `settlement.view` or finops on at least one org. */
  hasBooks: boolean;
  /** Platform capabilities actually held — not "is an admin". */
  platform: readonly PlatformDoorCapability[];
}

/**
 * FIVE COLUMNS — the PHONE's constraint, which is where the number came from.
 *
 * The desktop rail is vertical and has room, so it shows everything a person is
 * offered; the bar has five columns and spends them on the five that earn it
 * (`mobile: false` opts a desk surface out first). That is the synthesis of two
 * rulings: RN-1's "a short primary list, built from what you do", and the
 * founder's 2026-09-19 sidebar mockups, which asked for seven items on a laptop
 * and five on a phone.
 */
export const RAIL_CAP = 5;

/**
 * What the phone's bottom bar carries, from the same one model (LAW 4).
 *
 * THE PAGE YOU ARE ON ALWAYS HAS A SEAT. The cap binds here now, so the rule
 * that used to guard the rail belongs here: an organizer standing on /reports
 * — the sixth item, and `mobile: false` besides — would otherwise get a bar
 * that lights nothing, and a menu that cannot say where you are is worse than
 * a short one. The claiming item displaces the last, and Home keeps slot one.
 */
export function phoneBar(rail: NavItem[]): NavItem[] {
  const eligible = rail.filter((item) => item.mobile !== false);
  const bar = eligible.slice(0, RAIL_CAP);
  if (bar.some((item) => item.active === true)) {
    return bar;
  }
  const claiming = rail.find((item) => item.active === true);
  return claiming === undefined ? bar : [...bar.slice(0, RAIL_CAP - 1), claiming];
}

/**
 * Where an operator's one door leads.
 *
 * `platform.admin` opens the overview; every other set opens the ONE section it
 * licenses. Before RN-1 the door was rendered on `platform.admin` alone, so an
 * operator holding only support, moderation, privacy, billing or demo had no
 * door anywhere and had to type the URL — while the pages behind it worked.
 * Ordered most-general first: an operator holding two sets lands on the wider.
 */
const PLATFORM_DOORS: [PlatformDoorCapability, string][] = [
  ["platform.admin", "/admin"],
  ["platform.support", "/admin/reports"],
  ["platform.moderate", "/admin/moderation"],
  ["platform.privacy", "/admin/erasure"],
  ["platform.pass", "/admin/passes"],
  ["platform.demo", "/admin/demos"],
];

export function operatorDoorHref(held: readonly PlatformDoorCapability[]): string | null {
  for (const [capability, href] of PLATFORM_DOORS) {
    if (held.includes(capability)) {
      return href;
    }
  }
  return null;
}

/**
 * LAW 7 — the one item that outranks everything, or null.
 *
 * Conducting beats owning when (rarely) both are live: without the auctioneer
 * the whole room is stopped, whereas an owner's absence costs only that owner.
 */
function liveDoor(roles: NavRoles): NavItem | null {
  const night = roles.conducts.find((scope) => scope.live);
  if (night !== undefined) {
    return {
      key: "cockpit",
      label: "Cockpit",
      shortLabel: "Cockpit",
      href: `/seasons/${night.seasonSlug}/auction/cockpit`,
      icon: "cockpit",
      live: true,
    };
  }
  const team = roles.teams.find((scope) => scope.live);
  if (team !== undefined) {
    return {
      key: "room",
      label: "Auction room",
      shortLabel: "Room",
      href: `/seasons/${team.seasonSlug}/auction/live`,
      icon: "room",
      live: true,
    };
  }
  return null;
}

/**
 * One scope → a named link. Several → the same link plus a popover.
 *
 * `currentTeam()` used to answer this by returning ONE team, so an owner with
 * teams in two seasons silently lost one. The href still points at the first
 * scope so the item works as a plain link when the popover cannot open.
 */
function scopeItem(
  key: string,
  scopes: NavScope[],
  plural: string,
  /** The bar's word for this, whether there is one scope or five. */
  shortLabel: string,
  icon: NavIcon,
  href: (scope: NavScope) => string,
): NavItem | null {
  const first = scopes[0];
  if (first === undefined) {
    return null;
  }
  if (scopes.length === 1) {
    return {
      key,
      label: first.label,
      shortLabel,
      href: href(first),
      icon,
      ...(first.live ? { live: true } : {}),
    };
  }
  return {
    key,
    label: plural,
    shortLabel,
    href: href(first),
    icon,
    ...(scopes.some((scope) => scope.live) ? { live: true } : {}),
    choices: scopes.map((scope, index) => ({
      key: `${key}-${String(index)}`,
      label: scope.label,
      hint: scope.seasonName,
      href: href(scope),
      ...(scope.live ? { live: true } : {}),
    })),
  };
}

/**
 * Does this path belong to this rail item?
 *
 * Ordered evaluation, not longest-prefix: `navigationFor` marks the FIRST
 * matching item and no other, so an organizer standing on their own team's page
 * lights "My team" rather than "Tournaments". Exactly one item is ever active,
 * which is a property the test matrix asserts for every row.
 */
function claims(item: NavItem, pathname: string): boolean {
  switch (item.key) {
    case "home":
      return pathname === "/home" || pathname.startsWith("/home/");
    case "tournaments":
      return pathname.startsWith("/tournaments") || pathname.startsWith("/seasons");
    case "orgs":
      return pathname.startsWith("/orgs") || pathname.startsWith("/org/");
    case "money":
      return pathname.startsWith("/money");
    case "players":
      return pathname === "/players" || pathname.startsWith("/players/");
    case "auctions":
      return pathname === "/auctions" || pathname.startsWith("/auctions/");
    case "reports":
      return pathname === "/reports" || pathname.startsWith("/reports/");
    case "sports":
      return pathname === "/me" || pathname.startsWith("/me/");
    case "find":
      return pathname === "/c" || pathname.startsWith("/c/");
    case "help":
      return pathname.startsWith("/help");
    case "bell":
      return pathname.startsWith("/inbox");
    case "account":
      return pathname.startsWith("/account");
    case "admin":
      return pathname.startsWith("/admin");
    default:
      // Scope items (team, nights, room, cockpit) own their own subtree, and a
      // popover's item owns every one of its choices.
      return [item.href, ...(item.choices ?? []).map((choice) => choice.href)].some(
        (href) => pathname === href || pathname.startsWith(`${href}/`),
      );
  }
}

/**
 * THE MENU. One function, every device, from facts alone.
 *
 * The candidate order below IS the product ruling from RN-1 §3.1 — urgency
 * first, then how much of this product the person has invested in. Read it as
 * the answer to "if this person may only have five doors, which five?".
 */
export function navigationFor(input: { roles: NavRoles | null; pathname: string }): NavModel {
  const { roles, pathname } = input;
  if (roles === null) {
    // Signed out. The public shell draws its own header; there is no rail.
    return { rail: [], utility: [] };
  }

  const candidates: (NavItem | null)[] = [
    { key: "home", label: "Home", shortLabel: "Home", href: "/home", icon: "home" },
    liveDoor(roles),
    scopeItem(
      "team",
      roles.teams,
      "My teams",
      "My team",
      "team",
      (scope) => `/seasons/${scope.seasonSlug}/teams`,
    ),
    scopeItem(
      "nights",
      roles.conducts,
      "Auction nights",
      "Nights",
      "nights",
      (scope) => `/seasons/${scope.seasonSlug}/auction`,
    ),
    roles.organizes
      ? {
          key: "tournaments",
          label: "Tournaments",
          shortLabel: "Tournaments",
          href: "/tournaments",
          icon: "trophy",
        }
      : null,
    roles.organizes
      ? {
          key: "orgs",
          label: "Organizations",
          shortLabel: "Clubs",
          href: "/orgs",
          icon: "org",
          mobile: false,
        }
      : null,
    /*
     * THE THREE CROSS-SEASON INDEXES from the founder's sidebar mockups
     * (2026-09-19, ui/premium-flow). They were a FIXED rail of seven there;
     * here they are candidates like everything else, offered to the people who
     * run seasons and absent for everyone else — a player has no cross-season
     * player index, and /reports of seasons you do not run is an empty page.
     * That is LAW 3 applied to three real surfaces, not a demotion of them.
     */
    roles.organizes
      ? {
          key: "players",
          label: "Players",
          shortLabel: "Players",
          href: "/players",
          icon: "player",
        }
      : null,
    roles.organizes
      ? {
          key: "auctions",
          label: "Auctions",
          shortLabel: "Auctions",
          href: "/auctions",
          icon: "gavel",
        }
      : null,
    roles.organizes
      ? {
          key: "reports",
          label: "Reports",
          shortLabel: "Reports",
          href: "/reports",
          icon: "chart",
          mobile: false,
        }
      : null,
    // DA-18 removed Money because it led to an apology. It comes back for the
    // people who have books — and stays absent for everyone else (LAW 3).
    roles.hasBooks
      ? { key: "money", label: "Money", shortLabel: "Money", href: "/money", icon: "money" }
      : null,
    roles.plays
      ? { key: "sports", label: "My sports", shortLabel: "My sports", href: "/me", icon: "sports" }
      : null,
    /*
     * An organizer already has three doors into competitions; the public
     * directory is for people who need to FIND one.
     *
     * A RAIL ITEM THAT LEAVES THE SHELL, AND WHY IT STAYS THAT WAY.
     *
     * `/c` is PUBLIC by `shellKind`, so this item hands a player from the
     * console to the public shell and the chrome changes under them. Phase 2
     * tried the obvious fix — make `shellKind` session-aware, the way
     * `liveExit` already is — and reverted it: `/c` and `/c/{slug}` each render
     * their OWN `<h1>`, so console framing puts two of them on every page and
     * breaks LAW 5, and converting two SEO surfaces off the public kit to
     * repair a chrome discontinuity is a bad trade.
     *
     * It is also a smaller problem than it looked: `PublicShell` already gives
     * a signed-in visitor a "Home" door back into the console. The item stays,
     * the directory stays public, and no test asserts an active item there
     * because the rail is not rendered on that path at all.
     */
    roles.organizes
      ? null
      : { key: "find", label: "Find tournaments", shortLabel: "Find", href: "/c", icon: "find" },
  ];

  const rail = candidates.filter((item): item is NavItem => item !== null);

  /*
   * NO CAP ON THE DESKTOP RAIL. The five was always the PHONE's number — five
   * columns across a 320px bar — and a vertical rail has room, which is what
   * the founder's 2026-09-19 mockups assumed when they asked for seven items.
   * `phoneBar()` applies the five where it actually binds.
   *
   * The rail still cannot run away: every item here is gated on a role fact,
   * so the longest possible list belongs to somebody who genuinely organizes,
   * owns a team, conducts a night AND plays — and that person has earned every
   * one of them.
   */

  const doorHref = operatorDoorHref(roles.platform);
  const utility: NavItem[] = [
    { key: "bell", label: "Notifications", shortLabel: "Alerts", href: "/inbox", icon: "bell" },
    { key: "account", label: "Account", shortLabel: "Account", href: "/account", icon: "account" },
    // Help left the rail under RN-1: the rail is WORK, utility is SERVICES.
    // That is what frees the four slots beside Home.
    { key: "help", label: "Help", shortLabel: "Help", href: "/help", icon: "help" },
    ...(doorHref !== null
      ? [
          {
            key: "admin",
            label: "Platform admin",
            shortLabel: "Admin",
            href: doorHref,
            icon: "admin" as const,
          },
        ]
      : []),
  ];

  // Exactly one active item across BOTH lists, first match wins.
  let claimed = false;
  const mark = (item: NavItem): NavItem => {
    if (claimed || !claims(item, pathname)) {
      return item;
    }
    claimed = true;
    return { ...item, active: true };
  };
  return { rail: rail.map(mark), utility: utility.map(mark) };
}

/* ---------------------------------------------------------------------------
 * THE SEASON WORKSPACE
 *
 * A person's role is not global — they organize club A, own a team in season B
 * and play in season C. `competitionTabs` asked one and a half booleans
 * (`canManage`, `canSettle`), so a team owner got six tabs and not one of them
 * was "My plan" or "My squad", the only two they came for.
 * ------------------------------------------------------------------------ */

export type SeasonRole =
  "organizer" | "staff" | "auctioneer" | "owner" | "player" | "member" | "public";

export interface SeasonRoleFacts {
  /** `org:owner` / `org:staff` on the club that owns this season. */
  manages: "owner" | "staff" | null;
  /** An `auction:conductor` grant on THIS season. */
  conducts: boolean;
  /** Owns a team in this season. */
  ownsTeam: boolean;
  /** Has a registration in this season. */
  registered: boolean;
  /** Belongs to the club with no capability — read access, never a role. */
  member: boolean;
}

/**
 * Highest authority wins. An org owner who also owns a team in their own season
 * is an ORGANIZER here: they can already see everything, and demoting them to
 * the owner's four tabs would hide their own workspace from them.
 */
export function seasonRoleFor(facts: SeasonRoleFacts): SeasonRole {
  if (facts.manages === "owner") return "organizer";
  if (facts.manages === "staff") return "staff";
  if (facts.conducts) return "auctioneer";
  if (facts.ownsTeam) return "owner";
  if (facts.registered) return "player";
  if (facts.member) return "member";
  return "public";
}

/**
 * The tab strip, by role in THIS season.
 *
 * Two consolidations take the organizer from nine tabs to seven, each joining
 * surfaces that answer one question:
 *   · PLAYERS  = Registrations + Lineups — "who is in this season"
 *   · SCHEDULE = Fixtures + Table        — "when, and how it went"
 *
 * The `testId`s are carried forward from `competitionTabs` unchanged: these
 * tabs ARE the navigation the e2e suite drives, and renaming a hook during a
 * navigation change is how a suite starts failing for the wrong reason.
 */
export function seasonTabs(
  slug: string,
  role: SeasonRole,
  options: { canSettle?: boolean } = {},
): CompetitionTab[] {
  const base = `/seasons/${slug}`;
  const overview: CompetitionTab = { key: "overview", label: "Overview", href: base };
  const table: CompetitionTab = {
    key: "standings",
    label: "Table",
    href: `${base}/standings`,
    testId: "open-standings",
  };
  const auction: CompetitionTab = {
    key: "auction",
    label: "Auction",
    href: `${base}/auction`,
    testId: "open-auction",
    // Readiness is reached from the auction page and is not a tab of its own.
    claims: ["/readiness"],
  };
  const teams: CompetitionTab = {
    key: "teams",
    label: "Teams",
    href: `${base}/teams`,
    testId: "open-teams",
  };

  switch (role) {
    case "organizer":
    case "staff":
      return [
        overview,
        {
          key: "players",
          label: "Players",
          href: `${base}/registrations`,
          testId: "open-dashboard",
          // Who is IN this season: who applied and was approved, and who
          // actually took the field. Lineups is reached from Registrations.
          claims: ["/lineups"],
        },
        teams,
        {
          key: "schedule",
          label: "Schedule",
          href: `${base}/fixtures`,
          testId: "open-fixtures",
          // When it is played, and how it went — the table is derived from the
          // fixtures beside it, so the two are one question.
          claims: ["/standings"],
        },
        auction,
        // Absent without `settlement.view`, never disabled — the surface itself
        // 404s rather than admit the books exist, and the tab must agree.
        ...(options.canSettle === true
          ? [{ key: "money", label: "Money", href: `${base}/money` }]
          : []),
        { key: "reviews", label: "Reviews", href: `${base}/reviews`, testId: "open-reviews" },
      ];
    case "auctioneer":
      // Conduct is narrow on purpose (core/capabilities): run the night, see
      // who is bidding. No registrations, no money, no reviews.
      return [overview, teams, auction];
    case "owner":
      return [
        { key: "my-team", label: "My team", href: `${base}/teams`, testId: "open-teams" },
        { key: "my-plan", label: "My plan", href: `${base}/auction/plan` },
        { key: "room", label: "Auction room", href: `${base}/auction/live` },
        table,
      ];
    case "player":
      return [
        overview,
        { key: "my-entry", label: "My entry", href: `${base}/register` },
        table,
        auction,
      ];
    case "member":
    case "public":
      return [overview, table, auction];
  }
}

/**
 * Which tab owns the current path — by the TAB LIST, not by a fixed table.
 *
 * `activeCompetitionTab` hard-coded one mapping of path to key, which cannot be
 * right for two roles at once: an organizer's /standings belongs to "Schedule"
 * and a team owner's belongs to their own "Table" tab. Matching against the
 * list this person was actually given answers both, and consolidations
 * (`claims`) come along for free.
 *
 * Longest href wins, so `/auction/plan` beats `/auction` for an owner. Overview
 * is the fallback because its href is the bare season and would otherwise
 * prefix-match everything.
 */
export function activeSeasonTab(pathname: string, slug: string, tabs: CompetitionTab[]): string {
  const base = `/seasons/${slug}`;
  const owns = (href: string): boolean => pathname === href || pathname.startsWith(`${href}/`);
  let best: { key: string; length: number } | null = null;
  for (const tab of tabs) {
    if (tab.key === "overview") continue;
    const paths = [tab.href, ...(tab.claims ?? []).map((suffix) => `${base}${suffix}`)];
    for (const href of paths) {
      if (owns(href) && (best === null || href.length > best.length)) {
        best = { key: tab.key, length: href.length };
      }
    }
  }
  if (best !== null) return best.key;
  /*
   * Posters and the registration form are reached from elsewhere and are not
   * tabs, so nothing is lit rather than underlining a page you are not on.
   * `my-entry` IS /register for a player, and is caught by the loop above.
   */
  if (pathname.startsWith(`${base}/posters`) || pathname.startsWith(`${base}/register`)) {
    return "";
  }
  return "overview";
}
