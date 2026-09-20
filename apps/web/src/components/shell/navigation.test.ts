import { describe, expect, it } from "vitest";

import { PLATFORM_CAPABILITY_SETS, platformCapabilitiesOf } from "../../server/admin/capabilities";
import {
  navigationFor,
  operatorDoorHref,
  seasonRoleFor,
  activeSeasonTab,
  adminSectionsFor,
  phoneBar,
  seasonTabs,
  shellKind,
  RAIL_CAP,
  type NavRoles,
  type NavScope,
  type PlatformDoorCapability,
  type SeasonRole,
  type SeasonRoleFacts,
} from "./nav";

/**
 * RN-1 PHASE 1 — THE PRODUCT RULING.
 *
 * Which doors a person is offered is a product decision, and a product decision
 * belongs where a test can pin it. This file IS the ruling: if the menu is
 * wrong, this table is wrong, and both are in one place.
 */

const NOBODY: NavRoles = {
  organizes: false,
  teams: [],
  conducts: [],
  plays: false,
  hasBooks: false,
  platform: [],
};

function scope(label: string, seasonSlug: string, live = false): NavScope {
  return { label, seasonSlug, seasonName: `${seasonSlug} season`, live };
}

function keys(roles: NavRoles, pathname = "/home"): string[] {
  return navigationFor({ roles, pathname }).rail.map((item) => item.key);
}

describe("the rail is the union of what is yours (RN-1 §3.2)", () => {
  it("a newcomer is offered two doors, and neither is an organizer's", () => {
    expect(keys(NOBODY)).toEqual(["home", "find"]);
  });

  it("a player gets their record and the directory — never /orgs or /tournaments", () => {
    expect(keys({ ...NOBODY, plays: true })).toEqual(["home", "sports", "find"]);
  });

  it("a team owner gets their team, not the organizer's indexes", () => {
    const owner = { ...NOBODY, teams: [scope("Demo Panthers", "demo-pl")] };
    expect(keys(owner)).toEqual(["home", "team", "find"]);
    expect(navigationFor({ roles: owner, pathname: "/home" }).rail[1]?.label).toBe("Demo Panthers");
  });

  it("LAW 7: a live auction takes the slot right under Home", () => {
    const owner = { ...NOBODY, teams: [scope("Demo Panthers", "demo-pl", true)] };
    const rail = navigationFor({ roles: owner, pathname: "/home" }).rail;
    expect(rail.map((item) => item.key)).toEqual(["home", "room", "team", "find"]);
    expect(rail[1]).toMatchObject({
      label: "Auction room",
      href: "/seasons/demo-pl/auction/live",
      live: true,
    });
  });

  it("an auctioneer gets the night; live, the cockpit leads", () => {
    const idle = { ...NOBODY, conducts: [scope("Demo PL", "demo-pl")] };
    expect(keys(idle)).toEqual(["home", "nights", "find"]);
    const live = { ...NOBODY, conducts: [scope("Demo PL", "demo-pl", true)] };
    expect(keys(live)).toEqual(["home", "cockpit", "nights", "find"]);
    expect(navigationFor({ roles: live, pathname: "/home" }).rail[1]?.href).toBe(
      "/seasons/demo-pl/auction/cockpit",
    );
  });

  it("the room is blocked without the auctioneer, so conducting outranks owning", () => {
    const both: NavRoles = {
      ...NOBODY,
      teams: [scope("Demo Panthers", "other-pl", true)],
      conducts: [scope("Demo PL", "demo-pl", true)],
    };
    expect(navigationFor({ roles: both, pathname: "/home" }).rail[1]?.key).toBe("cockpit");
  });

  it("an organizer gets the indexes and the three desks, and no 'find'", () => {
    /*
     * Players, Auctions and Reports are the founder's 2026-09-19 sidebar
     * mockups (ui/premium-flow), which asked for a FIXED rail of seven. Here
     * they are candidates like everything else — offered to people who run
     * seasons, absent for everyone else, because a cross-season player index of
     * seasons you do not run is an empty page (LAW 3).
     */
    expect(keys({ ...NOBODY, organizes: true })).toEqual([
      "home",
      "tournaments",
      "orgs",
      "players",
      "auctions",
      "reports",
    ]);
  });

  it("Money returns only for the people who have books (DA-18 reversed, narrowly)", () => {
    expect(keys({ ...NOBODY, organizes: true, hasBooks: true })).toContain("money");
    expect(keys({ ...NOBODY, organizes: true, hasBooks: false })).not.toContain("money");
  });

  it("an organizer who owns a team is offered both — the union, not a mode", () => {
    expect(
      keys({ ...NOBODY, organizes: true, teams: [scope("Demo Panthers", "demo-pl")] }),
    ).toEqual(["home", "team", "tournaments", "orgs", "players", "auctions", "reports"]);
  });

  it("membership is not a role: there is no field for it and no door from it", () => {
    // The whole `memberOf` concept is absent from NavRoles by design — the
    // regression this prevents is a player who accepted a team being handed
    // the organizer product because `acceptOwnerJoin` made them a club member.
    expect(Object.keys(NOBODY)).not.toContain("memberOf");
    expect(keys({ ...NOBODY, plays: true, teams: [scope("Demo Panthers", "demo-pl")] })).toEqual([
      "home",
      "team",
      "sports",
      "find",
    ]);
  });
});

describe("LAW 1: one list — and five is the PHONE's number", () => {
  it("holds under every role combination", () => {
    const flags = [true, false];
    for (const organizes of flags) {
      for (const plays of flags) {
        for (const hasBooks of flags) {
          for (const teamCount of [0, 1, 2]) {
            for (const conductCount of [0, 1, 2]) {
              for (const live of flags) {
                const roles: NavRoles = {
                  organizes,
                  plays,
                  hasBooks,
                  platform: [],
                  teams: Array.from({ length: teamCount }, (_, i) =>
                    scope(`Team ${String(i)}`, `s${String(i)}`, live),
                  ),
                  conducts: Array.from({ length: conductCount }, (_, i) =>
                    scope(`Season ${String(i)}`, `c${String(i)}`, live),
                  ),
                };
                const model = navigationFor({ roles, pathname: "/home" });
                /*
                 * The five was always the BAR's constraint — five columns
                 * across 320px. A vertical rail has room, which is what the
                 * founder's mockups assumed in asking for seven on a laptop.
                 * Both lists still come from one model (LAW 4).
                 */
                expect(phoneBar(model.rail).length).toBeLessThanOrEqual(RAIL_CAP);
                expect(model.rail[0]?.key).toBe("home");
                expect(phoneBar(model.rail)[0]?.key).toBe("home");
                // LAW 1 again: no duplicate destinations inside the one list.
                expect(new Set(model.rail.map((i) => i.key)).size).toBe(model.rail.length);
              }
            }
          }
        }
      }
    }
  });
});

describe("several teams collapse into a popover, never into silence", () => {
  const twoTeams: NavRoles = {
    ...NOBODY,
    teams: [scope("Demo Panthers", "demo-pl"), scope("City Kings", "city-cup", true)],
  };

  it("names the plural and lists every one", () => {
    // Not rail[1]: City Kings is live, so LAW 7 puts the room in that slot.
    const item = navigationFor({ roles: twoTeams, pathname: "/home" }).rail.find(
      (entry) => entry.key === "team",
    );
    expect(item?.label).toBe("My teams");
    expect(item?.choices?.map((choice) => choice.label)).toEqual(["Demo Panthers", "City Kings"]);
    // The item is still a plain link when the popover cannot open.
    expect(item?.href).toBe("/seasons/demo-pl/teams");
    // One of them is live, so the item carries the dot.
    expect(item?.live).toBe(true);
  });

  it("a choice's own page lights the parent item", () => {
    const model = navigationFor({ roles: twoTeams, pathname: "/seasons/city-cup/teams" });
    expect(model.rail.find((item) => item.active)?.key).toBe("team");
  });
});

describe("exactly one item is ever active", () => {
  const busy: NavRoles = {
    organizes: true,
    plays: true,
    hasBooks: true,
    teams: [scope("Demo Panthers", "demo-pl")],
    conducts: [],
    platform: ["platform.admin"],
  };

  const paths = [
    "/home",
    "/tournaments",
    "/orgs",
    "/org/malad-cc",
    "/money",
    "/me",
    "/me/cricket",
    "/inbox",
    "/account",
    "/help",
    "/admin",
    "/admin/users",
    "/seasons/demo-pl/teams",
  ];

  for (const pathname of paths) {
    it(`${pathname} lights one item and one only`, () => {
      const model = navigationFor({ roles: busy, pathname });
      const active = [...model.rail, ...model.utility].filter((item) => item.active === true);
      expect(active).toHaveLength(1);
    });
  }

  it("the BAR gives the page you are on a seat, even past its five", () => {
    /*
     * The rail keeps everything this person is offered; the bar has five
     * columns. So the seat rule moved to where the cap actually binds — an
     * organizer standing on /reports (sixth, and a desk surface besides) would
     * otherwise get a bar lighting nothing, and a menu that cannot say where
     * you are is worse than a short one.
     */
    const onReports = navigationFor({ roles: busy, pathname: "/reports" });
    expect(onReports.rail.find((item) => item.active)?.key).toBe("reports");
    const bar = phoneBar(onReports.rail);
    expect(bar).toHaveLength(RAIL_CAP);
    expect(bar[0]?.key).toBe("home");
    expect(bar.find((item) => item.active)?.key).toBe("reports");
  });

  it("desk surfaces ride the drawer, not the bar", () => {
    // premium-flow's ruling, kept: Organizations and Reports are laptop jobs.
    const bar = phoneBar(navigationFor({ roles: busy, pathname: "/home" }).rail);
    expect(bar.map((item) => item.key)).not.toContain("orgs");
    expect(bar.map((item) => item.key)).not.toContain("reports");
  });

  it("an unknown path lights nothing rather than guessing", () => {
    const model = navigationFor({ roles: busy, pathname: "/schedule-demo" });
    expect([...model.rail, ...model.utility].filter((item) => item.active === true)).toHaveLength(
      0,
    );
  });

  it("standing on your own team's page lights My team, not Tournaments", () => {
    const model = navigationFor({ roles: busy, pathname: "/seasons/demo-pl/teams" });
    expect(model.rail.find((item) => item.active)?.key).toBe("team");
  });

  it("but any other season still lights Tournaments", () => {
    const model = navigationFor({ roles: busy, pathname: "/seasons/other-cup/registrations" });
    expect(model.rail.find((item) => item.active)?.key).toBe("tournaments");
  });
});

describe("utility: services, not work", () => {
  it("Help left the rail — that is what frees the slots beside Home", () => {
    const model = navigationFor({ roles: { ...NOBODY, organizes: true }, pathname: "/home" });
    expect(model.rail.map((item) => item.key)).not.toContain("help");
    expect(model.utility.map((item) => item.key)).toEqual(["bell", "account", "help"]);
  });

  it("signed out has no menu at all", () => {
    expect(navigationFor({ roles: null, pathname: "/" })).toEqual({ rail: [], utility: [] });
  });
});

describe("every operator gets a door, and it opens on something they hold", () => {
  const cases: [PlatformDoorCapability, string][] = [
    ["platform.admin", "/admin"],
    ["platform.support", "/admin/reports"],
    ["platform.moderate", "/admin/moderation"],
    ["platform.privacy", "/admin/erasure"],
    ["platform.pass", "/admin/passes"],
    ["platform.demo", "/admin/demos"],
  ];

  for (const [capability, href] of cases) {
    it(`${capability} alone opens ${href}`, () => {
      expect(operatorDoorHref([capability])).toBe(href);
      const model = navigationFor({
        roles: { ...NOBODY, platform: [capability] },
        pathname: "/home",
      });
      expect(model.utility.find((item) => item.key === "admin")?.href).toBe(href);
    });
  }

  it("the locally-declared vocabulary cannot drift from the server's", () => {
    // `nav.ts` redeclares the six capabilities rather than importing them, so
    // that the platform vocabulary never reaches a visitor's bundle. This is
    // the pin that comment promises: every capability the six sets confer must
    // have a door, and every door must name a real capability.
    const real = new Set(PLATFORM_CAPABILITY_SETS.flatMap((set) => platformCapabilitiesOf(set)));
    const doored = new Set(cases.map(([capability]) => capability));
    expect([...doored].sort()).toEqual([...real].sort());
  });

  it("holding two, the wider one wins", () => {
    expect(operatorDoorHref(["platform.support", "platform.admin"])).toBe("/admin");
  });

  it("no platform grant, no door — administration is absent, not locked", () => {
    expect(operatorDoorHref([])).toBeNull();
    expect(
      navigationFor({ roles: NOBODY, pathname: "/home" }).utility.map((item) => item.key),
    ).not.toContain("admin");
  });

  it("the door is utility, never a rail item: administration is not an identity", () => {
    const model = navigationFor({
      roles: { ...NOBODY, plays: true, platform: ["platform.admin"] },
      pathname: "/home",
    });
    expect(model.rail.map((item) => item.key)).toEqual(["home", "sports", "find"]);
  });
});

describe("role in a season is resolved per season, highest authority first", () => {
  const none: SeasonRoleFacts = {
    manages: null,
    conducts: false,
    ownsTeam: false,
    registered: false,
    member: false,
  };

  it("ranks the whole ladder", () => {
    expect(seasonRoleFor({ ...none, manages: "owner" })).toBe("organizer");
    expect(seasonRoleFor({ ...none, manages: "staff" })).toBe("staff");
    expect(seasonRoleFor({ ...none, conducts: true })).toBe("auctioneer");
    expect(seasonRoleFor({ ...none, ownsTeam: true })).toBe("owner");
    expect(seasonRoleFor({ ...none, registered: true })).toBe("player");
    expect(seasonRoleFor({ ...none, member: true })).toBe("member");
    expect(seasonRoleFor(none)).toBe("public");
  });

  it("an organizer who owns a team in their own season stays the organizer", () => {
    expect(seasonRoleFor({ ...none, manages: "owner", ownsTeam: true })).toBe("organizer");
  });

  it("a club member who also plays is a player — the stronger fact wins", () => {
    expect(seasonRoleFor({ ...none, member: true, registered: true })).toBe("player");
  });
});

describe("the season's tabs, by role", () => {
  const labels = (role: SeasonRole, canSettle = false): string[] =>
    seasonTabs("demo-pl", role, { canSettle }).map((tab) => tab.label);

  it("an organizer gets seven, not nine — Players and Schedule each answer one question", () => {
    expect(labels("organizer", true)).toEqual([
      "Overview",
      "Players",
      "Teams",
      "Schedule",
      "Auction",
      "Money",
      "Reviews",
    ]);
  });

  it("Money is absent without the books, never disabled", () => {
    expect(labels("organizer", false)).not.toContain("Money");
  });

  it("staff read the same workspace as the owner", () => {
    expect(labels("staff", true)).toEqual(labels("organizer", true));
  });

  it("conduct is narrow: the auctioneer sees who is bidding and nothing else", () => {
    expect(labels("auctioneer")).toEqual(["Overview", "Teams", "Auction"]);
    expect(labels("auctioneer")).not.toContain("Players");
    expect(labels("auctioneer", true)).not.toContain("Money");
  });

  it("a team owner finally gets the two surfaces they came for", () => {
    expect(labels("owner")).toEqual(["My team", "My plan", "Auction room", "Table"]);
    expect(seasonTabs("demo-pl", "owner").map((tab) => tab.href)).toEqual([
      "/seasons/demo-pl/teams",
      "/seasons/demo-pl/auction/plan",
      "/seasons/demo-pl/auction/live",
      "/seasons/demo-pl/standings",
    ]);
  });

  it("a player gets their own entry, not the registrant table", () => {
    expect(labels("player")).toEqual(["Overview", "My entry", "Table", "Auction"]);
  });

  it("a member sees what the public sees — belonging is not permission", () => {
    expect(labels("member")).toEqual(labels("public"));
    expect(labels("member")).toEqual(["Overview", "Table", "Auction"]);
  });

  it("no role is offered a tab it cannot open", () => {
    const privileged = ["Players", "Money", "Reviews"];
    for (const role of ["player", "member", "public"] as SeasonRole[]) {
      for (const label of labels(role, true)) {
        expect(privileged).not.toContain(label);
      }
    }
  });
});

describe("the phone's bar can read every label (LAW 4)", () => {
  /**
   * Five columns at 320px is ~64px each, and the bar's label is pinned to 11px
   * (`.tab-label`, app-shell.module.css) rather than the 12px xs token for
   * exactly this reason. Eleven characters is what fits in that cell.
   *
   * MEASURED, not guessed: at 11px Geist Sans "Tournaments" is 66.6px against
   * a 64px cell, so `.bottom-tabs:has(> :nth-child(5)) .tab-label` steps the
   * five-tab case down to 10px, where it is 60.5px. Eleven characters is
   * therefore the real bound, and the CSS moved rather than the product's word.
   * A twelfth character would clip even at 10px.
   */
  const BAR_LABEL_MAX = 11;

  const everyone: NavRoles[] = [
    NOBODY,
    { ...NOBODY, plays: true },
    { ...NOBODY, teams: [scope("Demo Panthers Reloaded", "demo-pl", true)] },
    { ...NOBODY, conducts: [scope("Bandra Premier League", "bpl-3")] },
    { ...NOBODY, organizes: true, hasBooks: true },
    { ...NOBODY, organizes: true, plays: true, teams: [scope("City Kings", "city-cup")] },
  ];

  it("no short label overflows the bar", () => {
    for (const roles of everyone) {
      for (const item of navigationFor({ roles, pathname: "/home" }).rail) {
        expect(item.shortLabel.length).toBeLessThanOrEqual(BAR_LABEL_MAX);
      }
    }
  });

  it("a team's NAME rides the rail; the bar says what kind of thing it is", () => {
    const owner = { ...NOBODY, teams: [scope("Demo Panthers Reloaded", "demo-pl")] };
    const item = navigationFor({ roles: owner, pathname: "/home" }).rail[1];
    expect(item?.label).toBe("Demo Panthers Reloaded");
    expect(item?.shortLabel).toBe("My team");
  });

  it("product vocabulary is not abbreviated — only shortened to a word we already say", () => {
    const organizer = navigationFor({ roles: { ...NOBODY, organizes: true }, pathname: "/home" });
    const byKey = new Map(organizer.rail.map((item) => [item.key, item]));
    // "Tournaments" survives intact: it is the word the whole product uses.
    expect(byKey.get("tournaments")?.shortLabel).toBe("Tournaments");
    // "Clubs" is /home's own setup-ladder word for an organization.
    expect(byKey.get("orgs")?.shortLabel).toBe("Clubs");
  });
});

describe("the directory stays public, and the rail item that leads there stays", () => {
  /**
   * The obvious fix — `shellKind(pathname, hasSession)` — was built and
   * reverted: `/c` and `/c/{slug}` each render their own `<h1>`, so console
   * framing puts two on every page (LAW 5). This pins the decision so the next
   * person does not rediscover it by shipping it.
   */
  it("is public whoever is reading", () => {
    expect(shellKind("/c")).toBe("public");
    expect(shellKind("/c/malad-premier-league")).toBe("public");
  });

  it("but every player is still offered it", () => {
    const player: NavRoles = { ...NOBODY, plays: true };
    expect(
      navigationFor({ roles: player, pathname: "/home" }).rail.map((item) => item.key),
    ).toContain("find");
  });
});

describe("the strip always says where you are, whatever role you hold", () => {
  const at = (pathname: string, role: SeasonRole, canSettle = false): string =>
    activeSeasonTab(pathname, "demo-pl", seasonTabs("demo-pl", role, { canSettle }));

  it("a consolidated tab owns its children", () => {
    // Nine tabs became seven by joining surfaces that answer one question. The
    // children are still routes, and standing on one must light its parent —
    // before `claims`, /lineups fell through and underlined Overview, a page
    // the reader was demonstrably not on.
    expect(at("/seasons/demo-pl/registrations", "organizer")).toBe("players");
    expect(at("/seasons/demo-pl/lineups", "organizer")).toBe("players");
    expect(at("/seasons/demo-pl/fixtures", "organizer")).toBe("schedule");
    expect(at("/seasons/demo-pl/standings", "organizer")).toBe("schedule");
    expect(at("/seasons/demo-pl/fixtures/match-day", "organizer")).toBe("schedule");
  });

  it("the SAME path belongs to different tabs for different people", () => {
    // Which is exactly what a fixed path→key table could not express.
    expect(at("/seasons/demo-pl/standings", "organizer")).toBe("schedule");
    expect(at("/seasons/demo-pl/standings", "owner")).toBe("standings");
    expect(at("/seasons/demo-pl/standings", "player")).toBe("standings");
  });

  it("longest match wins, so an owner's plan is not swallowed by the auction", () => {
    expect(at("/seasons/demo-pl/auction/plan", "owner")).toBe("my-plan");
    expect(at("/seasons/demo-pl/auction/live", "owner")).toBe("room");
    expect(at("/seasons/demo-pl/teams", "owner")).toBe("my-team");
  });

  it("readiness belongs to the auction that sends you there", () => {
    expect(at("/seasons/demo-pl/readiness", "organizer")).toBe("auction");
    expect(at("/seasons/demo-pl/auction", "auctioneer")).toBe("auction");
  });

  it("Money lights only for somebody who was given the tab", () => {
    expect(at("/seasons/demo-pl/money", "organizer", true)).toBe("money");
    // Without the books there is no Money tab, so the page 404s under a strip
    // that is not claiming to hold it.
    expect(at("/seasons/demo-pl/money", "organizer", false)).toBe("overview");
  });

  it("a page that is not a tab lights nothing rather than the wrong thing", () => {
    expect(at("/seasons/demo-pl/posters", "organizer")).toBe("");
    expect(at("/seasons/demo-pl", "organizer")).toBe("overview");
  });

  it("a player's own entry is a tab, so /register lights it", () => {
    expect(at("/seasons/demo-pl/register", "player")).toBe("my-entry");
    // …but for an organizer the same path is not a tab at all.
    expect(at("/seasons/demo-pl/register", "organizer")).toBe("");
  });

  it("every tab every role is given can light itself", () => {
    const roles: SeasonRole[] = [
      "organizer",
      "staff",
      "auctioneer",
      "owner",
      "player",
      "member",
      "public",
    ];
    for (const role of roles) {
      for (const tab of seasonTabs("demo-pl", role, { canSettle: true })) {
        expect(at(tab.href, role, true)).toBe(tab.key);
      }
    }
  });
});

describe("administration shows an operator the desks they hold (RN-1 §6.3)", () => {
  const keys = (held: PlatformDoorCapability[]): string[] =>
    adminSectionsFor(held).map((section) => section.key);

  it("a support-only operator sees their two desks, not twelve dead ends", () => {
    /*
     * THE RULE THIS REVERSES. Every section used to be shown to everybody, with
     * the page 404ing without the grant, so comparing two screens could not
     * reveal who holds what. The leak it prevented is between colleagues who
     * are all staff of this company; the cost was ten "This page doesn't exist"
     * clicks per visit, levied on the operators with the fewest grants.
     */
    expect(keys(["platform.support"])).toEqual(["reports", "reviews"]);
  });

  it("each single grant opens exactly its own desk", () => {
    expect(keys(["platform.moderate"])).toEqual(["moderation"]);
    expect(keys(["platform.privacy"])).toEqual(["erasure"]);
    expect(keys(["platform.pass"])).toEqual(["passes"]);
    expect(keys(["platform.demo"])).toEqual(["demos"]);
  });

  it("no platform grant, no sections — administration is absent, not locked", () => {
    expect(keys([])).toEqual([]);
  });

  it("platform.admin is not a superset: it opens neither the pass desk nor erasure", () => {
    // The capability engine's whole point — seeing the platform is a different
    // act of trust from changing what a customer is entitled to, or ending
    // somebody's account. The chrome must not imply otherwise.
    const admin = keys(["platform.admin"]);
    expect(admin).not.toContain("passes");
    expect(admin).not.toContain("erasure");
    expect(admin).not.toContain("moderation");
    expect(admin).not.toContain("demos");
    expect(admin).not.toContain("reports");
  });

  it("groups run platform → trust → commercial, and only seams are marked", () => {
    const sections = adminSectionsFor([
      "platform.admin",
      "platform.moderate",
      "platform.privacy",
      "platform.support",
    ]);
    // 4 platform (overview, live, health, audit), 4 trust (orgs, users,
    // moderation, erasure), 4 commercial (reports, reviews from support;
    // newsletter, messaging from admin — passes and demos need their own
    // grants, which this operator does not hold).
    expect(sections.map((section) => section.group)).toEqual([
      ...Array<string>(4).fill("platform"),
      ...Array<string>(4).fill("trust"),
      ...Array<string>(4).fill("commercial"),
    ]);
    // Exactly two seams for three groups, and never one on the first item.
    expect(sections.filter((section) => section.dividerBefore === true)).toHaveLength(2);
    expect(sections[0]?.dividerBefore).toBeUndefined();
  });

  it("a seam appears only where a group actually changes", () => {
    // One grant, one group: no seam to draw.
    const only = adminSectionsFor(["platform.support"]);
    expect(only.filter((section) => section.dividerBefore === true)).toHaveLength(0);
    // Two grants in two groups: one seam.
    const two = adminSectionsFor(["platform.privacy", "platform.pass"]);
    expect(two.map((section) => section.key)).toEqual(["erasure", "passes"]);
    expect(two[1]?.dividerBefore).toBe(true);
  });
});
