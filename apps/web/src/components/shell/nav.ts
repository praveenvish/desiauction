import { sportPack } from "@desiauction/core";

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

/**
 * FOUR items. The canon (docs/16; PX-1 01 §1) said "exactly five, forever", and
 * this comment went on asserting it two lines above a four-item array — while
 * the help centre, reading the same canon, told customers about "the five
 * places you'll work" and named a Money page that is not in the rail.
 *
 * The count stopped being five under DA-18 (see the note on the removed slot
 * below), and a comment that contradicts the array under it is how a false
 * claim survives a rewrite of the array. The canon here is the RULE — a short,
 * fixed, primary rail, every item a place a signed-in person actually works —
 * not the number. Adding a fifth needs a product ruling; so does the sixth.
 *
 * Slot 2 was "Seasons". It is now "Tournaments", by an explicit product ruling:
 * the recurring tournament is how organizers name their calendar ("BPL", then
 * "BPL 1", "BPL 2"), the schema has modelled it since IP-3, and the layer was
 * unreachable — no route, no create flow, every UI-made season a one-off.
 * Seasons have not moved: they live under their tournament. The /seasons INDEX
 * is gone — it was a second index over the same rows, kept alive only because
 * nobody retired it, and it is now the "All seasons" view of /tournaments
 * (`?view=seasons`) with the bare path redirecting there. What survives at
 * /seasons/{slug} is the season WORKSPACE, which is where organizers do the
 * bulk of their work, so the rail's active key still claims that whole prefix.
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
 * PX-9: Platform Administration's own tab row. Administration is NOT a rail
 * item — the rail is short and fixed (see RAIL above, which is FOUR; the
 * "five, forever" this comment used to assert was retracted there and the
 * retraction had not reached here) — so it navigates itself, reached from the
 * avatar menu by the few who hold the grant.
 *
 * Messaging was missing from this array while being linked from the admin
 * overview and shipped. One omission, three symptoms: no tab to click,
 * `activeAdminTab` falling through to "overview" so the strip lit the WRONG
 * tab, and `pageIdentity` finding no section so the title rendered "Platform
 * admin" directly under a breadcrumb reading "Platform admin".
 */
export const ADMIN_TABS: CompetitionTab[] = [
  { key: "overview", label: "Overview", href: "/admin" },
  // Second, because on an auction night it is the only tab that matters.
  { key: "live", label: "Live", href: "/admin/live" },
  { key: "orgs", label: "Organizations", href: "/admin/orgs" },
  { key: "users", label: "Users", href: "/admin/users" },
  { key: "audit", label: "Audit", href: "/admin/audit" },
  { key: "health", label: "Health", href: "/admin/health" },
  { key: "messaging", label: "Messaging", href: "/admin/messaging" },
  // Passes is the one admin surface gated on `platform:billing` rather than
  // `platform:admin`, so the tab is included for everyone and the PAGE returns
  // not-found to anyone without it — the same posture the console takes to its
  // own front door. A tab that appears only for some operators would leak who
  // holds which grant to anyone comparing screens.
  { key: "passes", label: "Passes", href: "/admin/passes" },
  // Demos sits behind `platform:demo` and follows the same rule as Passes: the
  // tab is present for everyone, the page 404s without the grant. Which tabs
  // you can SEE must not be a map of which grants you hold.
  { key: "demos", label: "Demos", href: "/admin/demos" },
  // Erasure sits behind `platform:privacy`, on the same rule as the two above.
  { key: "erasure", label: "Erasure", href: "/admin/erasure" },
  // Moderation sits behind `platform:moderation`, on the same rule again.
  { key: "moderation", label: "Moderation", href: "/admin/moderation" },
  { key: "newsletter", label: "Newsletter", href: "/admin/newsletter" },
  // Reports sits behind `platform:support`, same rule again: present for
  // everyone, 404 without the grant.
  { key: "reports", label: "Reports", href: "/admin/reports" },
  // Reviews shares `platform:support` with Reports — both are what people told
  // us — and follows the same present-for-everyone, 404-without-grant rule.
  { key: "reviews", label: "Reviews", href: "/admin/reviews" },
];

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
 * PX-7: Money appears only for holders of `settlement.view` (PX-1 01 §3). The
 * tab is not disabled for anyone else — it is ABSENT, matching the surface
 * itself, which 404s rather than admit the books exist.
 */
export function competitionTabs(
  slug: string,
  canSettle = false,
  /**
   * Manages the season's club (org:owner / org:staff). Registrations and
   * Lineups are rosters: a plain member or a team owner used to be offered
   * Registrations and shown a one-line refusal behind it. Defaults to true so
   * callers that predate the flag keep their tabs.
   */
  canManage = true,
): CompetitionTab[] {
  const base = `/seasons/${slug}`;
  // These tabs ARE the season workspace's navigation, so they carry the
  // navigation test hooks. They used to hang off buttons on the overview, which
  // is now a read-only dashboard.
  return [
    { key: "overview", label: "Overview", href: base },
    { key: "teams", label: "Teams", href: `${base}/teams`, testId: "open-teams" },
    ...(canManage
      ? [
          {
            key: "registrations",
            label: "Registrations",
            href: `${base}/registrations`,
            testId: "open-dashboard",
          },
        ]
      : []),
    { key: "fixtures", label: "Fixtures", href: `${base}/fixtures`, testId: "open-fixtures" },
    // Who played each match — what a player's career counts as a match played.
    ...(canManage
      ? [{ key: "lineups", label: "Lineups", href: `${base}/lineups`, testId: "open-lineups" }]
      : []),
    // The table sits beside the fixtures it is derived from. It reads for
    // everyone who can see the season, not just officers — a league table only
    // officers can open is not a league table.
    { key: "standings", label: "Table", href: `${base}/standings`, testId: "open-standings" },
    { key: "auction", label: "Auction", href: `${base}/auction`, testId: "open-auction" },
    // FR-1: what players and owners said. For everyone who can see the season,
    // like the Table — published reviews are public anyway; only the club's
    // owners get the reply and ask controls, and nobody here sees an unread one.
    { key: "reviews", label: "Reviews", href: `${base}/reviews`, testId: "open-reviews" },
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
  if (pathname.startsWith(`${base}/lineups`)) {
    return "lineups";
  }
  if (pathname.startsWith(`${base}/standings`)) {
    return "standings";
  }
  if (pathname.startsWith(`${base}/reviews`)) {
    return "reviews";
  }
  if (pathname.startsWith(`${base}/auction`) || pathname.startsWith(`${base}/readiness`)) {
    return "auction";
  }
  // Posters is reached from /home and the auction page but is not a tab; the
  // fall-through underlined "Overview" over a page that wasn't the overview.
  if (pathname.startsWith(`${base}/posters`) || pathname.startsWith(`${base}/register`)) {
    return "";
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
  // Messaging was missing from BOTH admin lists — this one and ADMIN_TABS. The
  // tab strip was the visible half; this is why the identity bar rendered the
  // title "Platform admin" directly beneath a breadcrumb reading "Platform
  // admin", since `pageIdentity` falls back to the surface name when a section
  // has no label.
  [/^\/admin\/messaging$/, "Messaging"],
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
  [/\/registrations$/, "Registrations"],
  [/\/fixtures\/calendar$/, "Calendar"],
  [/\/fixtures\/match-day$/, "Match day"],
  [/\/fixtures$/, "Fixtures"],
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
  const pack = sportPack(decodeURIComponent(match[1] ?? ""));
  return pack === null ? null : `My ${pack.label.toLowerCase()}`;
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
    return { href: `/c/${match.slug}`, label: "Leave auction" };
  }
  return { href: `/seasons/${match.slug}/auction`, label: "Leave auction" };
}

/**
 * WHAT THE RAIL OFFERS, BY ROLE (launch polish, Phase 2).
 *
 * The facts come from `server/roles/roles.ts`; this only decides what to show.
 * Offering is not allowing — every surface still gates itself — but a rail that
 * offers a player "Tournaments" and "Organizations" (both empty for them) and
 * nothing about the season they are actually in reads as "not for you".
 */
export interface ShellRoles {
  /** The team this person owns and should see first, if any. */
  team: { name: string; seasonSlug: string; live: boolean } | null;
  /** Plays anywhere: a registration or a player profile. */
  plays: boolean;
  /** Plays and does NOTHING else — no club membership, no team. */
  onlyPlays: boolean;
  /** A season whose auction this person was appointed to run, if any. */
  conducting?: { name: string; seasonSlug: string; live: boolean } | null;
}

export interface RoleNavItem {
  key: string;
  label: string;
  href: string;
  icon: "team" | "plan" | "room" | "sports" | "find" | "cockpit";
  live?: boolean;
  active?: boolean;
}

export interface RoleNavGroup {
  key: string;
  label: string;
  items: RoleNavItem[];
}

/**
 * The primary rail for this person. Someone who only plays has no use for the
 * organizer's index pages; everyone else — including a brand-new account, who
 * may be an organizer about to start — keeps the four.
 */
export function railFor(roles: ShellRoles | null): RailTarget[] {
  if (roles?.onlyPlays === true) {
    return RAIL.filter((item) => item.key === "home" || item.key === "help");
  }
  return RAIL;
}

export function roleNavGroups(roles: ShellRoles | null, pathname: string): RoleNavGroup[] {
  if (roles === null) return [];
  const groups: RoleNavGroup[] = [];
  if (roles.team !== null) {
    const base = `/seasons/${roles.team.seasonSlug}`;
    groups.push({
      key: "team",
      label: "My team",
      items: [
        { key: "team", label: roles.team.name, href: `${base}/teams`, icon: "team" },
        { key: "plan", label: "My plan", href: `${base}/auction/plan`, icon: "plan" },
        {
          key: "room",
          label: "Auction room",
          href: `${base}/auction/live`,
          icon: "room",
          live: roles.team.live,
        },
      ],
    });
  }
  if (roles.conducting !== undefined && roles.conducting !== null) {
    const base = `/seasons/${roles.conducting.seasonSlug}/auction`;
    groups.push({
      key: "auction",
      label: "Auction night",
      items: [
        { key: "season-auction", label: roles.conducting.name, href: base, icon: "room" },
        {
          key: "cockpit",
          label: "Cockpit",
          href: `${base}/cockpit`,
          icon: "cockpit",
          live: roles.conducting.live,
        },
      ],
    });
  }
  if (roles.plays) {
    groups.push({
      key: "play",
      label: "Play",
      items: [
        { key: "sports", label: "My sports", href: "/me", icon: "sports" },
        { key: "find", label: "Find tournaments", href: "/c", icon: "find" },
      ],
    });
  }
  // Active state by exact section: the team items are all under /seasons/{slug},
  // so a prefix match would light all three at once.
  return groups.map((group) => ({
    ...group,
    items: group.items.map((item) => ({
      ...item,
      active:
        item.key === "sports"
          ? pathname === "/me" || pathname.startsWith("/me/")
          : pathname === item.href || pathname.startsWith(`${item.href}/`),
    })),
  }));
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
  href: string;
  icon: NavIcon;
  /** An auction under this item is running right now (LAW 7). */
  live?: boolean;
  active?: boolean;
  /** Present only when the person holds more than one of this thing. */
  choices?: NavChoice[];
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

/** LAW 1. Five is the cap, and §RN-1 3.1 explains why it can be hard. */
export const RAIL_CAP = 5;

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
      href: href(first),
      icon,
      ...(first.live ? { live: true } : {}),
    };
  }
  return {
    key,
    label: plural,
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
    { key: "home", label: "Home", href: "/home", icon: "home" },
    liveDoor(roles),
    scopeItem(
      "team",
      roles.teams,
      "My teams",
      "team",
      (scope) => `/seasons/${scope.seasonSlug}/teams`,
    ),
    scopeItem(
      "nights",
      roles.conducts,
      "Auction nights",
      "nights",
      (scope) => `/seasons/${scope.seasonSlug}/auction`,
    ),
    roles.organizes
      ? { key: "tournaments", label: "Tournaments", href: "/tournaments", icon: "trophy" }
      : null,
    roles.organizes ? { key: "orgs", label: "Organizations", href: "/orgs", icon: "org" } : null,
    // DA-18 removed Money because it led to an apology. It comes back for the
    // people who have books — and stays absent for everyone else (LAW 3).
    roles.hasBooks ? { key: "money", label: "Money", href: "/money", icon: "money" } : null,
    roles.plays ? { key: "sports", label: "My sports", href: "/me", icon: "sports" } : null,
    /*
     * An organizer already has three doors into competitions; the public
     * directory is for people who need to FIND one.
     *
     * KNOWN, AND FIXED IN PHASE 2: `/c` is a PUBLIC surface by `shellKind`, so
     * this — a player's most-used rail item — currently navigates them out of
     * the shell that drew it, and the whole chrome changes under them. Phase 2
     * makes `shellKind` session-aware for `/c` and `/c/{slug}`, the way
     * `liveExit` is already session-aware, so a signed-in visitor keeps their
     * menu while browsing. Until then the rail simply never renders there,
     * which is why no test asserts an active item on that path.
     */
    roles.organizes ? null : { key: "find", label: "Find tournaments", href: "/c", icon: "find" },
  ];

  const offered = candidates.filter((item): item is NavItem => item !== null);

  /*
   * THE PAGE YOU ARE ON ALWAYS HAS A SEAT.
   *
   * The cap is hard (LAW 1), so a busy organizer who also plays loses "My
   * sports" to it. Without this, walking to /me — reachable from their home,
   * which is the whole justification for a hard cap — lit NOTHING in the menu,
   * and a menu that cannot say where you are is worse than a long one.
   *
   * So the item claiming the current path displaces the lowest-precedence one
   * instead of vanishing. Home keeps slot 1 always; the cap still holds.
   */
  const claimant = offered.findIndex((item) => claims(item, pathname));
  const rail =
    claimant >= RAIL_CAP
      ? [...offered.slice(0, RAIL_CAP - 1), offered[claimant] as NavItem]
      : offered.slice(0, RAIL_CAP);

  const doorHref = operatorDoorHref(roles.platform);
  const utility: NavItem[] = [
    { key: "bell", label: "Notifications", href: "/inbox", icon: "bell" },
    { key: "account", label: "Account", href: "/account", icon: "account" },
    // Help left the rail under RN-1: the rail is WORK, utility is SERVICES.
    // That is what frees the four slots beside Home.
    { key: "help", label: "Help", href: "/help", icon: "help" },
    ...(doorHref !== null
      ? [{ key: "admin", label: "Platform admin", href: doorHref, icon: "admin" as const }]
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
        },
        teams,
        { key: "schedule", label: "Schedule", href: `${base}/fixtures`, testId: "open-fixtures" },
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
