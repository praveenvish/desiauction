import { existsSync, readdirSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  ADMIN_TABS,
  RAIL,
  activeAdminTab,
  activeCompetitionTab,
  activeOrgMoneyTab,
  activeRailKey,
  competitionTabs,
  liveExit,
  orgMoneyTabs,
  pageIdentity,
  sectionLabel,
  shellKind,
} from "./nav";

describe("shellKind", () => {
  it("routes every surface to its shell", () => {
    expect(shellKind("/")).toBe("public");
    // Login keeps the public chrome (2026-07-25 founder call); onboarding is
    // the one focused, chrome-free entry moment (2026-07-24 collapse).
    expect(shellKind("/login")).toBe("public");
    expect(shellKind("/onboarding")).toBe("bare");
    expect(shellKind("/help")).toBe("public");
    expect(shellKind("/join/tok123")).toBe("public");
    expect(shellKind("/owner-join/tok123")).toBe("public");
    expect(shellKind("/seasons/mpl-2026/register")).toBe("public");
    expect(shellKind("/home")).toBe("console");
    expect(shellKind("/account")).toBe("console");
    expect(shellKind("/seasons/mpl-2026/registrations")).toBe("console");
    expect(shellKind("/seasons/mpl-2026/auction")).toBe("console");
    expect(shellKind("/seasons/mpl-2026/auction/ledger")).toBe("console");
    expect(shellKind("/seasons/mpl-2026/auction/live")).toBe("live");
    expect(shellKind("/seasons/mpl-2026/auction/cockpit")).toBe("live");
    expect(shellKind("/seasons/mpl-2026/auction/spectate")).toBe("live");
    expect(shellKind("/seasons/mpl-2026/auction/replay")).toBe("live");
    expect(shellKind("/gallery")).toBe("bare");
    expect(shellKind("/dev/inbox")).toBe("bare");
    // The OBS overlay and public live board are chrome-free, never Live-framed.
    expect(shellKind("/seasons/mpl-2026/auction/overlay")).toBe("bare");
    expect(shellKind("/seasons/mpl-2026/auction/board")).toBe("bare");
  });
});

describe("rail", () => {
  it("has exactly four items, forever", () => {
    // Four since DA-18 retired the /money placeholder from the rail. A primary
    // nav item is a promise; that one led to "being built during the beta".
    expect(RAIL).toHaveLength(4);
    expect(RAIL.map((item) => item.key)).toEqual(["home", "tournaments", "orgs", "help"]);
  });

  it("maps paths to the owning rail item", () => {
    expect(activeRailKey("/home")).toBe("home");
    expect(activeRailKey("/tournaments")).toBe("tournaments");
    // A season is an edition OF a tournament: working inside one must not leave
    // the rail blank.
    expect(activeRailKey("/seasons/mpl/fixtures")).toBe("tournaments");
    expect(activeRailKey("/org/malad-cc/venues")).toBe("orgs");
    expect(activeRailKey("/orgs")).toBe("orgs");
    expect(activeRailKey("/money")).toBe("money");
    expect(activeRailKey("/help")).toBe("help");
    expect(activeRailKey("/account")).toBeNull();
    expect(activeRailKey("/inbox")).toBeNull();
  });
});

describe("competition tabs", () => {
  it("builds the six organizer tabs and resolves the active one", () => {
    const tabs = competitionTabs("mpl");
    expect(tabs.map((tab) => tab.key)).toEqual([
      "overview",
      "teams",
      "registrations",
      "fixtures",
      // The table sits beside the fixtures it is derived from.
      "standings",
      "auction",
    ]);
    expect(activeCompetitionTab("/seasons/mpl", "mpl")).toBe("overview");
    expect(activeCompetitionTab("/seasons/mpl/teams", "mpl")).toBe("teams");
    expect(activeCompetitionTab("/seasons/mpl/registrations", "mpl")).toBe("registrations");
    expect(activeCompetitionTab("/seasons/mpl/fixtures/calendar", "mpl")).toBe("fixtures");
    expect(activeCompetitionTab("/seasons/mpl/standings", "mpl")).toBe("standings");
    expect(activeCompetitionTab("/seasons/mpl/auction/ledger", "mpl")).toBe("auction");
    // Readiness lives with the auction preparation context.
    expect(activeCompetitionTab("/seasons/mpl/readiness", "mpl")).toBe("auction");
    // Posters and the public register form are reached from elsewhere and are
    // not tabs. They used to fall through to "overview", so the strip
    // underlined Overview over a page that was not the overview.
    expect(activeCompetitionTab("/seasons/mpl/posters", "mpl")).toBe("");
    expect(activeCompetitionTab("/seasons/mpl/register", "mpl")).toBe("");
  });

  // PX-7: Money is absent without settlement.view — never rendered-then-disabled.
  it("hides Money from anyone without a settlement grant", () => {
    expect(competitionTabs("mpl").map((tab) => tab.key)).not.toContain("money");
    expect(competitionTabs("mpl", false).map((tab) => tab.key)).not.toContain("money");
  });

  it("appends Money last for a settlement grant holder", () => {
    const tabs = competitionTabs("mpl", true);
    expect(tabs.map((tab) => tab.key)).toEqual([
      "overview",
      "teams",
      "registrations",
      "fixtures",
      "standings",
      "auction",
      "money",
    ]);
    expect(tabs.at(-1)?.href).toBe("/seasons/mpl/money");
  });

  it("keeps the money surfaces on the Money tab", () => {
    expect(activeCompetitionTab("/seasons/mpl/money", "mpl")).toBe("money");
    expect(activeCompetitionTab("/seasons/mpl/money/case/01ABC", "mpl")).toBe("money");
  });

  it("labels deep sections for the breadcrumb", () => {
    expect(sectionLabel("/seasons/mpl")).toBeNull();
    expect(sectionLabel("/seasons/mpl/teams")).toBe("Teams");
    expect(sectionLabel("/seasons/mpl/readiness")).toBe("Readiness");
    expect(sectionLabel("/seasons/mpl/registrations")).toBe("Registrations");
    expect(sectionLabel("/seasons/mpl/fixtures/match-day")).toBe("Match day");
    expect(sectionLabel("/seasons/mpl/auction/ledger")).toBe("Ledger");
    // PX-7: the case review is its own place, never just "Money".
    expect(sectionLabel("/seasons/mpl/money")).toBe("Money");
    expect(sectionLabel("/seasons/mpl/money/case/01ABC")).toBe("Case review");
    expect(sectionLabel("/org/demo-club/settlement")).toBe("Settlement");
    // PX-8: the finance segments are their own places, never just "Money".
    expect(sectionLabel("/org/demo-club/money")).toBe("Money");
    expect(sectionLabel("/org/demo-club/money/deliveries")).toBe("Deliveries");
    expect(sectionLabel("/org/demo-club/money/reconciliation")).toBe("Reconciliation");
    expect(sectionLabel("/org/demo-club/money/documents/01ABC")).toBe("Document");
  });
});

describe("org money desks", () => {
  it("navigates the four desks as one workspace", () => {
    expect(orgMoneyTabs("malad-cc").map((tab) => tab.key)).toEqual([
      "settlement",
      "finance",
      "deliveries",
      "reconciliation",
    ]);
    expect(activeOrgMoneyTab("/org/malad-cc/settlement", "malad-cc")).toBe("settlement");
    expect(activeOrgMoneyTab("/org/malad-cc/money", "malad-cc")).toBe("finance");
    // Longest-first: the sub-desks must not all read as Finance.
    expect(activeOrgMoneyTab("/org/malad-cc/money/deliveries", "malad-cc")).toBe("deliveries");
    expect(activeOrgMoneyTab("/org/malad-cc/money/reconciliation", "malad-cc")).toBe(
      "reconciliation",
    );
    expect(activeOrgMoneyTab("/org/malad-cc/venues", "malad-cc")).toBeNull();
  });
});

// The header's consistency guarantee: one function answers "where am I" for
// every console route, so no surface can invent its own answer.
describe("pageIdentity", () => {
  const ctx = {
    competitions: [{ slug: "mpl", name: "MPL 2026", orgName: "Malad CC", orgSlug: "malad-cc" }],
    orgs: [{ slug: "malad-cc", name: "Malad CC" }],
    isAdmin: true,
  };
  const trail = (pathname: string) =>
    pageIdentity(pathname, ctx).crumbs.map((crumb) => crumb.label);

  it("titles every rail destination and the two surfaces outside the rail", () => {
    for (const [pathname, title] of [
      ["/home", "Home"],
      ["/tournaments", "Tournaments"],
      ["/orgs", "Organizations"],
      ["/money", "Money"],
      ["/inbox", "Notifications"],
      ["/account", "Account"],
    ] as const) {
      const identity = pageIdentity(pathname, ctx);
      expect(identity.title).toBe(title);
      expect(identity.crumbs).toEqual([]);
    }
  });

  // A root has no ancestors, so line two of the header carries its lede instead.
  it("gives every ancestor-less surface a lede, and none to a page with a trail", () => {
    expect(pageIdentity("/tournaments", ctx).subtitle).toMatch(/recurring competitions/);
    expect(pageIdentity("/orgs", ctx).subtitle).toMatch(/clubs and academies/);
    expect(pageIdentity("/account", ctx).subtitle).toMatch(/sign-in/);
    // /home's lede is data (the portfolio line), published by the page itself.
    expect(pageIdentity("/home", ctx).subtitle).toBeUndefined();
    expect(pageIdentity("/seasons/mpl/teams", ctx).subtitle).toBeUndefined();
  });

  it("names the season itself on its overview and the section everywhere below", () => {
    expect(pageIdentity("/seasons/mpl", ctx)).toEqual({
      crumbs: [{ label: "Malad CC", href: "/org/malad-cc" }],
      title: "MPL 2026",
    });
    expect(pageIdentity("/seasons/mpl/teams", ctx)).toEqual({
      crumbs: [
        { label: "Malad CC", href: "/org/malad-cc" },
        { label: "MPL 2026", href: "/seasons/mpl" },
      ],
      title: "Teams",
    });
    expect(pageIdentity("/seasons/mpl/money/case/01ABC", ctx).title).toBe("Case review");
  });

  it("falls back to what the URL alone can prove for a non-member deep link", () => {
    expect(pageIdentity("/seasons/unknown-cup/teams", ctx)).toEqual({
      crumbs: [{ label: "Tournaments", href: "/tournaments" }],
      title: "Teams",
    });
  });

  it("names the org on its home and the desk on each money surface", () => {
    expect(pageIdentity("/org/malad-cc", ctx)).toEqual({
      crumbs: [{ label: "Organizations", href: "/orgs" }],
      title: "Malad CC",
    });
    expect(trail("/org/malad-cc/money/deliveries")).toEqual(["Organizations", "Malad CC"]);
    expect(pageIdentity("/org/malad-cc/money/deliveries", ctx).title).toBe("Deliveries");
    expect(pageIdentity("/org/malad-cc/venues", ctx).title).toBe("Venues");
    // Page data the shell does not hold — a true label the page then overrides.
    expect(pageIdentity("/org/malad-cc/t/bpl", ctx).title).toBe("Tournament");
  });

  it("puts administration under one root", () => {
    expect(pageIdentity("/admin", ctx)).toEqual({ crumbs: [], title: "Platform admin" });
    expect(pageIdentity("/admin/users", ctx)).toEqual({
      crumbs: [{ label: "Platform admin", href: "/admin" }],
      title: "Users",
    });
    expect(pageIdentity("/admin/users/01ABC", ctx).title).toBe("User");
  });

  // The 404 underneath must be the whole answer: no title, no trail, nothing
  // for the shell to confirm from.
  it("says nothing about administration to anyone without the grant", () => {
    const stranger = { ...ctx, isAdmin: false };
    expect(pageIdentity("/admin", stranger)).toEqual({ crumbs: [], title: null });
    expect(pageIdentity("/admin/audit", stranger)).toEqual({ crumbs: [], title: null });
  });

  it("frames no title for a route it cannot name", () => {
    expect(pageIdentity("/nowhere", ctx)).toEqual({ crumbs: [], title: null });
  });
});

/**
 * THE OMISSION THIS GUARDS AGAINST ALREADY HAPPENED.
 *
 * `/admin/messaging` shipped, was linked from the admin overview, and was in
 * NEITHER admin list — not ADMIN_TABS and not SECTION_LABELS. One omission, three
 * symptoms: no tab to click, `activeAdminTab` falling through to "overview" so
 * the strip lit the wrong tab, and `pageIdentity` finding no section so the
 * title rendered "Platform admin" directly beneath a breadcrumb that also read
 * "Platform admin".
 *
 * None of that is visible to a type checker, and none of it failed a test —
 * every list was internally consistent, they just did not agree with each other
 * or with the routes on disk. So the invariant is asserted directly: every tab
 * lights itself, and every tab can name itself.
 */
describe("the admin tab strip agrees with the routes on disk", () => {
  /**
   * READ FROM THE FILESYSTEM, NOT FROM THE ARRAY.
   *
   * The first draft of this test looped over ADMIN_TABS and asserted each entry
   * lit itself — which passes trivially, because a route MISSING from the array
   * is also missing from the loop. It was checked against the original bug and
   * did not catch it. The defect was never an inconsistency inside the model; it
   * was the model disagreeing with the app directory, so the app directory is
   * what the model has to be compared against.
   */
  const adminDir = new URL("../../app/admin/", import.meta.url);
  const routes = readdirSync(adminDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("["))
    .filter((entry) => existsSync(new URL(`${entry.name}/page.tsx`, adminDir)))
    .map((entry) => `/admin/${entry.name}`);

  it("finds the admin routes it is meant to be checking", () => {
    // A guard that silently checks nothing is worse than no guard.
    expect(routes.length).toBeGreaterThan(3);
    expect(routes).toContain("/admin/messaging");
  });

  it("gives every admin route a tab", () => {
    for (const route of routes) {
      expect(
        ADMIN_TABS.some((tab) => tab.href === route),
        `${route} ships but has no tab in ADMIN_TABS`,
      ).toBe(true);
    }
  });

  it("lights the tab you are actually on", () => {
    for (const route of routes) {
      const tab = ADMIN_TABS.find((entry) => entry.href === route);
      expect(activeAdminTab(route), `${route} lights the wrong tab`).toBe(tab?.key);
    }
  });

  it("names every route, so no title repeats its own breadcrumb", () => {
    const ctx = { orgs: [], competitions: [], isAdmin: true };
    for (const route of routes) {
      expect(sectionLabel(route), `${route} has no section label`).not.toBeNull();
      expect(
        pageIdentity(route, ctx).title,
        `${route} renders "Platform admin" beneath a "Platform admin" crumb`,
      ).not.toBe("Platform admin");
    }
  });
});

describe("liveExit", () => {
  it("exits to the auction hub for members and to the tournament for anonymous spectators", () => {
    expect(liveExit("/seasons/mpl/auction/cockpit", true).href).toBe("/seasons/mpl/auction");
    // A guest reached the stage from /c/<slug>; the door back is the same one.
    expect(liveExit("/seasons/mpl/auction/spectate", false).href).toBe("/c/mpl");
    expect(liveExit("/seasons/mpl/auction/spectate", true).href).toBe("/seasons/mpl/auction");
  });
});
