import { sportPack } from "@desiauction/core";

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
