import { existsSync, readdirSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  adminSectionsFor,
  activeAdminTab,
  activeOrgMoneyTab,
  activeRailKey,
  liveExit,
  orgMoneyTabs,
  pageIdentity,
  sectionLabel,
  shellKind,
  careerTitle,
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
    // WR-1: the owner's plan is an Owner Room surface.
    expect(shellKind("/seasons/mpl-2026/auction/plan")).toBe("live");
    expect(shellKind("/gallery")).toBe("bare");
    expect(shellKind("/dev/inbox")).toBe("bare");
    // The OBS overlay and public live board are chrome-free, never Live-framed.
    expect(shellKind("/seasons/mpl-2026/auction/overlay")).toBe("bare");
    expect(shellKind("/seasons/mpl-2026/auction/board")).toBe("bare");
  });
});

/**
 * The fixed `RAIL` array is gone (RN-1): the menu is composed per person by
 * `navigationFor`, and navigation.test.ts is the ruling on what it contains.
 * `activeRailKey` survives for a DIFFERENT job — it tells the identity bar
 * which surface a path belongs to, which is "where am I" (LAW 2), not a menu.
 */
describe("path ownership, for the identity bar's title", () => {
  it("maps paths to the owning surface", () => {
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

  it("leaves the overview's name to its hero and names the section everywhere below", () => {
    // The hero banner carries the overview's one <h1>; the shell keeps only the
    // trail, decided server-side so the HTML never holds two.
    expect(pageIdentity("/seasons/mpl", ctx)).toEqual({
      crumbs: [{ label: "Malad CC", href: "/org/malad-cc" }],
      title: null,
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

  // Every capability, so the catalogue is complete regardless of who holds what.
  const ALL = adminSectionsFor([
    "platform.admin",
    "platform.pass",
    "platform.demo",
    "platform.privacy",
    "platform.support",
    "platform.moderate",
  ]);

  it("gives every admin route a section", () => {
    for (const route of routes) {
      expect(
        ALL.some((section) => section.href === route),
        `${route} ships but has no section in ADMIN_SECTIONS`,
      ).toBe(true);
    }
  });

  it("lights the section you are actually on", () => {
    for (const route of routes) {
      const section = ALL.find((entry) => entry.href === route);
      expect(activeAdminTab(route), `${route} lights the wrong section`).toBe(section?.key);
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

/*
 * SP-1: the career page names its own sport.
 *
 * `/me/cricket` was a static entry in OUTSIDE_RAIL, correct while the platform
 * ran one sport. Phase 3 made the route `/me/[sport]`, and every other sport
 * fell through to the generic fallback — a football player's career page went
 * out under whatever the section happened to be called.
 */
describe("careerTitle", () => {
  it("names the sport in the path", () => {
    expect(careerTitle("/me/cricket")).toBe("My cricket");
    expect(careerTitle("/me/football")).toBe("My football");
    expect(careerTitle("/me/kabaddi")).toBe("My kabaddi");
    expect(careerTitle("/me/volleyball")).toBe("My volleyball");
  });

  it("refuses a sport this platform has no pack for", () => {
    // Rather than confidently titling a page for a sport that cannot exist.
    expect(careerTitle("/me/quidditch")).toBeNull();
  });

  it("titles the all-sports hub", () => {
    // /me used to be a 404 with no index; it is the "My sports" hub now.
    expect(careerTitle("/me")).toBe("My sports");
  });

  it("ignores paths that are not a career page", () => {
    expect(careerTitle("/home")).toBeNull();
    expect(careerTitle("/account")).toBeNull();
  });

  it("reads the segment, not the rest of the URL", () => {
    expect(careerTitle("/me/football/")).toBe("My football");
    expect(careerTitle("/me/football?from=home")).toBe("My football");
  });
});
