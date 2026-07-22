import { describe, expect, it } from "vitest";

import {
  buildCompetitionShareCard,
  buildPlayerShareCard,
  type CompetitionShareCardInput,
  type PlayerShareCardInput,
} from "./share-card";

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

const player: PlayerShareCardInput = {
  name: "Rohit Sharma",
  number: "12",
  role: "all_rounder",
  age: 24,
  battingStyle: "right_hand_opener",
  bowlingStyle: "off_break",
  status: "available",
  teamName: null,
  competitionName: "Sunday Premier League",
};

describe("buildPlayerShareCard", () => {
  it("builds the identity and subtitle", () => {
    const card = buildPlayerShareCard(player);
    expect(card.name).toBe("Rohit Sharma");
    expect(card.subtitle).toBe("#12 · Sunday Premier League");
  });

  it("labels the role and appends age when known", () => {
    expect(buildPlayerShareCard(player).roleLine).toBe("All-rounder · 24 yrs");
    expect(buildPlayerShareCard({ ...player, age: null }).roleLine).toBe("All-rounder");
  });

  it("labels batting/bowling styles via the core label functions", () => {
    expect(buildPlayerShareCard(player).styleLine).toBe("Right Hand Opener · Off-Break");
    expect(buildPlayerShareCard({ ...player, bowlingStyle: null }).styleLine).toBe(
      "Right Hand Opener",
    );
    expect(
      buildPlayerShareCard({ ...player, battingStyle: null, bowlingStyle: null }).styleLine,
    ).toBeNull();
  });

  it("passes an unknown/legacy style key through unchanged", () => {
    expect(buildPlayerShareCard({ ...player, battingStyle: "switch_hit" }).styleLine).toBe(
      "switch_hit · Off-Break",
    );
  });

  it("shows Available (open tone) for an unsold player", () => {
    expect(buildPlayerShareCard(player)).toMatchObject({
      statusLabel: "Available",
      statusTone: "open",
    });
  });

  it("celebrates a sale with the team name and the accent (live) tone", () => {
    expect(
      buildPlayerShareCard({ ...player, status: "sold", teamName: "Mumbai Indians" }),
    ).toMatchObject({ statusLabel: "Sold to Mumbai Indians", statusTone: "live" });
    expect(buildPlayerShareCard({ ...player, status: "sold", teamName: null })).toMatchObject({
      statusLabel: "Sold",
      statusTone: "live",
    });
  });

  it("truncates an over-long name and degrades a blank one", () => {
    const long = buildPlayerShareCard({ ...player, name: "X".repeat(200) });
    expect(long.name.length).toBeLessThanOrEqual(70);
    expect(buildPlayerShareCard({ ...player, name: "  " }).name).toBe("Player");
  });
});
