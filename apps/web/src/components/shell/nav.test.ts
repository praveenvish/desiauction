import { describe, expect, it } from "vitest";

import {
  RAIL,
  activeCompetitionTab,
  activeRailKey,
  competitionTabs,
  liveExit,
  sectionLabel,
  shellKind,
} from "./nav";

describe("shellKind", () => {
  it("routes every surface to its shell", () => {
    expect(shellKind("/")).toBe("public");
    expect(shellKind("/login")).toBe("public");
    expect(shellKind("/help")).toBe("public");
    expect(shellKind("/join/tok123")).toBe("public");
    expect(shellKind("/owner-join/tok123")).toBe("public");
    expect(shellKind("/competitions/mpl-2026/register")).toBe("public");
    expect(shellKind("/home")).toBe("console");
    expect(shellKind("/account")).toBe("console");
    expect(shellKind("/competitions/mpl-2026/registrations")).toBe("console");
    expect(shellKind("/competitions/mpl-2026/auction")).toBe("console");
    expect(shellKind("/competitions/mpl-2026/auction/ledger")).toBe("console");
    expect(shellKind("/competitions/mpl-2026/auction/live")).toBe("live");
    expect(shellKind("/competitions/mpl-2026/auction/cockpit")).toBe("live");
    expect(shellKind("/competitions/mpl-2026/auction/spectate")).toBe("live");
    expect(shellKind("/competitions/mpl-2026/auction/replay")).toBe("live");
    expect(shellKind("/gallery")).toBe("bare");
    expect(shellKind("/dev/inbox")).toBe("bare");
    // The OBS overlay and public live board are chrome-free, never Live-framed.
    expect(shellKind("/competitions/mpl-2026/auction/overlay")).toBe("bare");
    expect(shellKind("/competitions/mpl-2026/auction/board")).toBe("bare");
  });
});

describe("rail", () => {
  it("has exactly five items, forever", () => {
    expect(RAIL).toHaveLength(5);
    expect(RAIL.map((item) => item.key)).toEqual(["home", "competitions", "orgs", "money", "help"]);
  });

  it("maps paths to the owning rail item", () => {
    expect(activeRailKey("/home")).toBe("home");
    expect(activeRailKey("/competitions/mpl/fixtures")).toBe("competitions");
    expect(activeRailKey("/org/malad-cc/venues")).toBe("orgs");
    expect(activeRailKey("/orgs")).toBe("orgs");
    expect(activeRailKey("/money")).toBe("money");
    expect(activeRailKey("/help")).toBe("help");
    expect(activeRailKey("/account")).toBeNull();
    expect(activeRailKey("/inbox")).toBeNull();
  });
});

describe("competition tabs", () => {
  it("builds the five organizer tabs and resolves the active one", () => {
    const tabs = competitionTabs("mpl");
    expect(tabs.map((tab) => tab.key)).toEqual([
      "overview",
      "teams",
      "registrations",
      "fixtures",
      "auction",
    ]);
    expect(activeCompetitionTab("/competitions/mpl", "mpl")).toBe("overview");
    expect(activeCompetitionTab("/competitions/mpl/teams", "mpl")).toBe("teams");
    expect(activeCompetitionTab("/competitions/mpl/registrations", "mpl")).toBe("registrations");
    expect(activeCompetitionTab("/competitions/mpl/fixtures/calendar", "mpl")).toBe("fixtures");
    expect(activeCompetitionTab("/competitions/mpl/auction/ledger", "mpl")).toBe("auction");
    // Readiness lives with the auction preparation context.
    expect(activeCompetitionTab("/competitions/mpl/readiness", "mpl")).toBe("auction");
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
      "auction",
      "money",
    ]);
    expect(tabs.at(-1)?.href).toBe("/competitions/mpl/money");
  });

  it("keeps the money surfaces on the Money tab", () => {
    expect(activeCompetitionTab("/competitions/mpl/money", "mpl")).toBe("money");
    expect(activeCompetitionTab("/competitions/mpl/money/case/01ABC", "mpl")).toBe("money");
  });

  it("labels deep sections for the breadcrumb", () => {
    expect(sectionLabel("/competitions/mpl")).toBeNull();
    expect(sectionLabel("/competitions/mpl/teams")).toBe("Teams");
    expect(sectionLabel("/competitions/mpl/readiness")).toBe("Readiness");
    expect(sectionLabel("/competitions/mpl/registrations")).toBe("Registrations");
    expect(sectionLabel("/competitions/mpl/fixtures/match-day")).toBe("Match day");
    expect(sectionLabel("/competitions/mpl/auction/ledger")).toBe("Ledger");
    // PX-7: the case review is its own place, never just "Money".
    expect(sectionLabel("/competitions/mpl/money")).toBe("Money");
    expect(sectionLabel("/competitions/mpl/money/case/01ABC")).toBe("Case review");
    expect(sectionLabel("/org/demo-club/settlement")).toBe("Settlement");
    // PX-8: the finance segments are their own places, never just "Money".
    expect(sectionLabel("/org/demo-club/money")).toBe("Money");
    expect(sectionLabel("/org/demo-club/money/deliveries")).toBe("Deliveries");
    expect(sectionLabel("/org/demo-club/money/reconciliation")).toBe("Reconciliation");
    expect(sectionLabel("/org/demo-club/money/documents/01ABC")).toBe("Document");
  });
});

describe("liveExit", () => {
  it("exits to the auction hub for members and to the front door for anonymous spectators", () => {
    expect(liveExit("/competitions/mpl/auction/cockpit", true).href).toBe(
      "/competitions/mpl/auction",
    );
    expect(liveExit("/competitions/mpl/auction/spectate", false).href).toBe("/");
    expect(liveExit("/competitions/mpl/auction/spectate", true).href).toBe(
      "/competitions/mpl/auction",
    );
  });
});
