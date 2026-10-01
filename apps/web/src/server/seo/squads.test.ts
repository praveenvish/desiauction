import { describe, expect, it } from "vitest";

import { squadListingDecision } from "./squads";

/**
 * SEO-1 Phase 5. Squad pages name players; this rule decides whether a search
 * engine may index them. It fails CLOSED: only proof of adulthood lets a name
 * through, the way `mayPublishPhoto` treats a face.
 */
const now = new Date("2026-10-01T00:00:00Z");

describe("squadListingDecision", () => {
  it("indexes nothing the organizer has not opted in", () => {
    expect(squadListingDecision({ optedIn: false, birthDates: ["1990-01-01"], now })).toEqual({
      indexable: false,
      reason: "off",
      blocking: 0,
    });
  });

  it("indexes a season whose every approved player is a known adult", () => {
    expect(
      squadListingDecision({ optedIn: true, birthDates: ["1990-01-01", "2008-10-01"], now }),
    ).toEqual({ indexable: true });
  });

  it("is blocked by one minor anywhere in the season", () => {
    // 2008-10-02 turns 18 the day after `now`.
    expect(
      squadListingDecision({ optedIn: true, birthDates: ["1990-01-01", "2008-10-02"], now }),
    ).toEqual({ indexable: false, reason: "unproven_age", blocking: 1 });
  });

  it("fails closed on an unknown or unparseable date of birth", () => {
    expect(
      squadListingDecision({ optedIn: true, birthDates: [null, "12/05/1990", "1990-02-30"], now }),
    ).toEqual({ indexable: false, reason: "unproven_age", blocking: 3 });
  });

  it("lists nothing before any player is approved", () => {
    expect(squadListingDecision({ optedIn: true, birthDates: [], now })).toEqual({
      indexable: false,
      reason: "no_players",
      blocking: 0,
    });
  });
});
