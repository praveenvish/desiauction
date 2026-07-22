import { describe, expect, it } from "vitest";

import { buildCompetitionShareCard, type CompetitionShareCardInput } from "./share-card";

const base: CompetitionShareCardInput = {
  name: "Sunday Premier League",
  organizer: "Mumbai Cricket Club",
  location: "Mumbai",
  dateRange: "1 – 3 Aug 2026",
  teamCount: 8,
  playerCount: 64,
  status: "registration_open",
  auctionStatus: null,
};

describe("buildCompetitionShareCard", () => {
  it("carries the identity fields through", () => {
    const card = buildCompetitionShareCard(base);
    expect(card.title).toBe("Sunday Premier League");
    expect(card.organizer).toBe("Mumbai Cricket Club");
  });

  it("composes location and date range into the meta line", () => {
    expect(buildCompetitionShareCard(base).meta).toBe("Mumbai · 1 – 3 Aug 2026");
  });

  it("drops missing meta parts, and yields null when both are absent", () => {
    expect(buildCompetitionShareCard({ ...base, location: null }).meta).toBe("1 – 3 Aug 2026");
    expect(buildCompetitionShareCard({ ...base, dateRange: null }).meta).toBe("Mumbai");
    expect(buildCompetitionShareCard({ ...base, location: null, dateRange: "" }).meta).toBeNull();
  });

  it("builds team + player stat pills, omitting zero counts", () => {
    expect(buildCompetitionShareCard(base).stats).toEqual([
      { label: "Teams", value: "8" },
      { label: "Players", value: "64" },
    ]);
    expect(buildCompetitionShareCard({ ...base, playerCount: 0 }).stats).toEqual([
      { label: "Teams", value: "8" },
    ]);
    expect(buildCompetitionShareCard({ ...base, teamCount: 0, playerCount: 0 }).stats).toEqual([]);
  });

  it("uses singular labels for a count of one", () => {
    expect(buildCompetitionShareCard({ ...base, teamCount: 1, playerCount: 1 }).stats).toEqual([
      { label: "Team", value: "1" },
      { label: "Player", value: "1" },
    ]);
  });

  it("maps lifecycle + auction state to an honest status", () => {
    expect(buildCompetitionShareCard(base)).toMatchObject({
      statusLabel: "Registration open",
      statusTone: "open",
    });
    expect(buildCompetitionShareCard({ ...base, auctionStatus: "live" })).toMatchObject({
      statusLabel: "Auction live",
      statusTone: "live",
    });
    expect(buildCompetitionShareCard({ ...base, auctionStatus: "paused" })).toMatchObject({
      statusLabel: "Auction live",
      statusTone: "live",
    });
    expect(buildCompetitionShareCard({ ...base, auctionStatus: "completed" })).toMatchObject({
      statusLabel: "Auction complete",
      statusTone: "closed",
    });
    expect(buildCompetitionShareCard({ ...base, status: "draft" })).toMatchObject({
      statusLabel: "Registration closed",
      statusTone: "closed",
    });
  });

  it("a live auction wins over an open registration status", () => {
    const card = buildCompetitionShareCard({
      ...base,
      status: "registration_open",
      auctionStatus: "live",
    });
    expect(card.statusLabel).toBe("Auction live");
  });

  it("truncates an over-long name with an ellipsis, no trailing space", () => {
    const long = `${"Grand ".repeat(20)}Championship`;
    const card = buildCompetitionShareCard({ ...base, name: long });
    expect(card.title.length).toBeLessThanOrEqual(70);
    expect(card.title.endsWith("…")).toBe(true);
    expect(card.title).not.toMatch(/\s…$/);
  });

  it("truncates an over-long organizer name", () => {
    const card = buildCompetitionShareCard({
      ...base,
      organizer: "The Very Long Association of Metropolitan Weekend Cricketers United",
    });
    expect(card.organizer.length).toBeLessThanOrEqual(48);
    expect(card.organizer.endsWith("…")).toBe(true);
  });

  it("degrades a blank name to a branded default rather than empty", () => {
    expect(buildCompetitionShareCard({ ...base, name: "   " }).title).toBe("Untitled competition");
  });
});
