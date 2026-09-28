import { describe, expect, it } from "vitest";

import type { AuctionNightStatus } from "../../server/console/auctions-index";
import { dateTile, doorLabel, nightSections, waitingLine } from "./auctions-model";

const night = (
  id: string,
  status: AuctionNightStatus,
  startsOn: string | null,
  extra: { roleLabel?: string; setup?: boolean; lots?: number; teams?: number } = {},
) => ({
  id,
  startsOn,
  roleLabel: extra.roleLabel ?? "Organizer",
  links: extra.setup === true ? [{ label: "Setup", href: "/x" }] : [],
  facts: { status, lotsTotal: extra.lots ?? 0, teams: extra.teams ?? 4 },
});

describe("nightSections", () => {
  it("puts live first, upcoming soonest first, finished newest first", () => {
    const sections = nightSections([
      night("a", "settled", "2026-01-10"),
      night("b", "scheduled", "2026-10-12"),
      night("c", "live", "2026-10-01"),
      night("d", "none", null),
      night("e", "none", "2026-08-01"),
      night("f", "completed", "2026-09-26"),
      night("g", "paused", "2026-09-01"),
    ]);
    expect(sections.live.map((card) => card.id)).toEqual(["c", "g"]);
    expect(sections.upcoming.map((card) => card.id)).toEqual(["e", "b", "d"]);
    expect(sections.finished.map((card) => card.id)).toEqual(["f", "a"]);
  });
});

describe("waitingLine", () => {
  it("asks the organizer to set it up", () => {
    expect(waitingLine(night("a", "none", null, { setup: true })).lead).toBe(
      "Set the purse and rules",
    );
  });

  it("tells an auctioneer they are waiting, and where they'll run it", () => {
    const line = waitingLine(night("a", "none", null, { roleLabel: "Auctioneer" }));
    expect(line.lead).toBe("Waiting on the organizer");
    expect(line.rest).toContain("cockpit");
  });

  it("says a scheduled night is ready, with its queue when there is one", () => {
    expect(waitingLine(night("a", "scheduled", null, { lots: 37, teams: 6 }))).toEqual({
      lead: "Ready to open",
      rest: " · 37 lots queued for 6 teams",
    });
    expect(waitingLine(night("a", "scheduled", null, { teams: 1 })).rest).toBe(" · 1 team");
  });
});

describe("doorLabel and dateTile", () => {
  it("names a door by what it does", () => {
    expect(doorLabel({ label: "Setup", href: "" }, "none")).toBe("Set up the auction");
    expect(doorLabel({ label: "Setup", href: "" }, "scheduled")).toBe("Rules & setup");
    expect(doorLabel({ label: "Cockpit", href: "" }, "live")).toBe("Open the cockpit");
    expect(doorLabel({ label: "Results", href: "" }, "settled")).toBe("Results");
  });

  it("reads a date tile from an ISO date", () => {
    expect(dateTile("2026-10-05")).toEqual({ month: "OCT", day: "05" });
    expect(dateTile(null)).toBeNull();
    expect(dateTile("soon")).toBeNull();
  });
});
