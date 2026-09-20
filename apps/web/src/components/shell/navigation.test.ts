import { describe, expect, it } from "vitest";

import { PLATFORM_CAPABILITY_SETS, platformCapabilitiesOf } from "../../server/admin/capabilities";
import {
  navigationFor,
  operatorDoorHref,
  seasonRoleFor,
  seasonTabs,
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

  it("an organizer gets the indexes and no 'find' — they have three doors already", () => {
    expect(keys({ ...NOBODY, organizes: true })).toEqual(["home", "tournaments", "orgs"]);
  });

  it("Money returns only for the people who have books (DA-18 reversed, narrowly)", () => {
    expect(keys({ ...NOBODY, organizes: true, hasBooks: true })).toEqual([
      "home",
      "tournaments",
      "orgs",
      "money",
    ]);
    expect(keys({ ...NOBODY, organizes: true, hasBooks: false })).not.toContain("money");
  });

  it("an organizer who owns a team is offered both — the union, not a mode", () => {
    expect(
      keys({ ...NOBODY, organizes: true, teams: [scope("Demo Panthers", "demo-pl")] }),
    ).toEqual(["home", "team", "tournaments", "orgs"]);
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

describe("LAW 1: one list, never more than five", () => {
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
                expect(model.rail.length).toBeLessThanOrEqual(RAIL_CAP);
                expect(model.rail[0]?.key).toBe("home");
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

  it("a dropped item takes the last seat back when you are standing on it", () => {
    // `busy` overflows the cap, so "My sports" is not offered on /home...
    expect(keys(busy)).toEqual(["home", "team", "tournaments", "orgs", "money"]);
    // ...but the menu must still be able to say where you are (LAW 1's cap is
    // only affordable because nothing it drops can become unreachable).
    const model = navigationFor({ roles: busy, pathname: "/me/cricket" });
    expect(model.rail.map((item) => item.key)).toEqual([
      "home",
      "team",
      "tournaments",
      "orgs",
      "sports",
    ]);
    expect(model.rail).toHaveLength(RAIL_CAP);
    expect(model.rail.find((item) => item.active)?.key).toBe("sports");
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
