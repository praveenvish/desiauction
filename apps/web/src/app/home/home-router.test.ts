import { describe, expect, it } from "vitest";

import { homeSections, type HomeFacts } from "./home-router";

/**
 * WHICH HOME EACH ROLE GETS (RN-1 Phase 3).
 *
 * /home is the union surface: it is what makes the rail's five-item cap
 * affordable, because anything the cap drops is still one tap away here. So
 * "which sections does this person get" is a product ruling, and this is it.
 */

const NOBODY: HomeFacts = {
  manages: false,
  owns: false,
  conducts: false,
  plays: false,
  belongsToClub: false,
};

describe("every role gets its own home, and only its own", () => {
  it("a newcomer is asked which they are, and nothing else", () => {
    expect(homeSections(NOBODY)).toEqual(["newcomer"]);
  });

  it("a player gets their seasons — never the organizer's dashboard", () => {
    expect(homeSections({ ...NOBODY, plays: true })).toEqual(["player"]);
  });

  it("a team owner gets their team — and NOT the host club's calendar", () => {
    /*
     * The regression this pins: `acceptOwnerJoin` makes every accepted owner a
     * viewer-level member of the host club, and the member section used to
     * render for every non-organizer. So a team owner's home opened with
     * "Seasons in your club" — the whole calendar of a club they do not run.
     */
    expect(homeSections({ ...NOBODY, owns: true, belongsToClub: true })).toEqual(["owner"]);
  });

  it("an auctioneer gets the surface that did not exist before", () => {
    expect(homeSections({ ...NOBODY, conducts: true })).toEqual(["auctioneer"]);
  });

  it("an organizer gets the dashboard", () => {
    expect(homeSections({ ...NOBODY, manages: true })).toEqual(["organizer"]);
  });

  it("membership alone is the ONLY case that renders the club's seasons", () => {
    expect(homeSections({ ...NOBODY, belongsToClub: true })).toEqual(["member"]);
    for (const extra of ["manages", "owns", "conducts", "plays"] as const) {
      expect(homeSections({ ...NOBODY, belongsToClub: true, [extra]: true })).not.toContain(
        "member",
      );
    }
  });
});

describe("several roles compose, in the menu's precedence order", () => {
  it("an organizer who also plays gets both, dashboard first", () => {
    expect(homeSections({ ...NOBODY, manages: true, plays: true })).toEqual([
      "organizer",
      "player",
    ]);
  });

  it("an owner who conducts and plays gets three, urgency first", () => {
    expect(homeSections({ ...NOBODY, owns: true, conducts: true, plays: true })).toEqual([
      "owner",
      "auctioneer",
      "player",
    ]);
  });

  it("the order matches nav.ts §3.1 for every combination", () => {
    // owner → auctioneer → organizer → player: the same ranking the rail uses,
    // so a person reading both never has to reconcile two answers about what
    // matters most right now.
    const rank = ["newcomer", "owner", "auctioneer", "organizer", "player", "member"];
    const flags = [true, false];
    for (const manages of flags) {
      for (const owns of flags) {
        for (const conducts of flags) {
          for (const plays of flags) {
            for (const belongsToClub of flags) {
              const sections = homeSections({ manages, owns, conducts, plays, belongsToClub });
              const positions = sections.map((section) => rank.indexOf(section));
              expect([...positions].sort((a, b) => a - b)).toEqual(positions);
              // Never empty: somebody always gets told something.
              expect(sections.length).toBeGreaterThan(0);
            }
          }
        }
      }
    }
  });

  it("newcomer is exclusive — it means there is nothing else to show", () => {
    const flags = [true, false];
    for (const manages of flags) {
      for (const owns of flags) {
        for (const conducts of flags) {
          for (const plays of flags) {
            for (const belongsToClub of flags) {
              const facts = { manages, owns, conducts, plays, belongsToClub };
              const sections = homeSections(facts);
              if (sections.includes("newcomer")) {
                expect(sections).toEqual(["newcomer"]);
                expect(Object.values(facts).some(Boolean)).toBe(false);
              }
            }
          }
        }
      }
    }
  });
});

describe("the organize door", () => {
  it("is offered to a player, and withheld from somebody who already runs a club", () => {
    // An organizer who also plays was being asked, underneath their own club's
    // dashboard, whether they had considered organizing.
    expect(homeSections({ ...NOBODY, plays: true })).toContain("player");
    expect(homeSections({ ...NOBODY, plays: true, manages: true })).toContain("player");
  });
});
