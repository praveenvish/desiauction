import type { GrantLike } from "@desiauction/core";
import { describe, expect, it } from "vitest";

import { auctionLinks, nightStatus } from "./auctions-index";
import { mergePlayerSlices, type PlayerIndexRow, type PlayersSlice } from "./players-index";
import { seasonAccess } from "./reach";
import { reportRows, type SeasonReport } from "./reports";

const ORG = "ORG00000000000000000000001";
const SEASON = { id: "SEA00000000000000000000001", orgId: ORG };

function grant(capabilitySet: string, scopeType = "org", scopeId = ORG): GrantLike {
  return { capabilitySet, scopeType, scopeId, revokedAt: null };
}

describe("seasonAccess — the three indexes' gates, folded from grants", () => {
  it("a viewer-level member (every team owner) sees no players and no money", () => {
    expect(seasonAccess([grant("viewer")], SEASON)).toEqual({
      canReview: false,
      canManage: false,
      canConduct: false,
      canSettle: false,
      seesSeasonMoney: false,
      seesAuctionMoney: false,
    });
  });

  it("staff review players but hold no money sight", () => {
    const access = seasonAccess([grant("org:staff")], SEASON);
    expect(access.canReview).toBe(true);
    expect(access.seesSeasonMoney).toBe(false);
    expect(access.seesAuctionMoney).toBe(false);
  });

  it("the owner manages, conducts and sees both kinds of money", () => {
    const access = seasonAccess([grant("org:owner")], SEASON);
    expect(access).toMatchObject({
      canReview: true,
      canManage: true,
      canConduct: true,
      seesSeasonMoney: true,
      seesAuctionMoney: true,
    });
  });

  it("an appointed auctioneer holds conduct on the SEASON only — auction money, not the books", () => {
    const access = seasonAccess([grant("auction:conductor", "tournament", SEASON.id)], SEASON);
    expect(access.canConduct).toBe(true);
    expect(access.seesAuctionMoney).toBe(true);
    expect(access.seesSeasonMoney).toBe(false);
    expect(access.canReview).toBe(false);
  });

  it("a finance officer sees the season's books without running it", () => {
    const access = seasonAccess([grant("settlement:officer")], SEASON);
    expect(access.canSettle).toBe(true);
    expect(access.seesSeasonMoney).toBe(true);
    expect(access.canReview).toBe(false);
  });

  it("revoked grants and other clubs' grants confer nothing", () => {
    const revoked = { ...grant("org:owner"), revokedAt: new Date() };
    const elsewhere = grant("org:owner", "org", "ORG00000000000000000000002");
    expect(seasonAccess([revoked, elsewhere], SEASON).canReview).toBe(false);
  });
});

describe("auction doors by role", () => {
  const none = { manage: false, conduct: false, ownsTeam: null };

  it("folds a settled case into the night's word", () => {
    expect(nightStatus("completed", "settled")).toBe("settled");
    expect(nightStatus("completed", "settling")).toBe("completed");
    expect(nightStatus("reconciled", null)).toBe("settled");
    expect(nightStatus(null, null)).toBe("none");
  });

  it("an organizer before the night gets setup and the cockpit", () => {
    const links = auctionLinks("cup", "scheduled", { ...none, manage: true, conduct: true });
    expect(links.map((link) => link.label)).toEqual(["Cockpit", "Setup"]);
    expect(links[0]?.primary).toBe(true);
  });

  it("a team owner mid-auction gets the room and their plan — never the cockpit", () => {
    const links = auctionLinks("cup", "live", { ...none, ownsTeam: "Kings" });
    expect(links.map((link) => [link.label, link.href])).toEqual([
      ["Live room", "/seasons/cup/auction/live"],
      ["My plan", "/seasons/cup/auction/plan"],
    ]);
  });

  it("a plain member can watch a live night and read the results after", () => {
    expect(auctionLinks("cup", "live", none).map((link) => link.label)).toEqual(["Watch live"]);
    expect(auctionLinks("cup", "completed", none).map((link) => link.label)).toEqual(["Results"]);
  });

  it("replay and ledger are offered only to those who conduct", () => {
    const labels = auctionLinks("cup", "settled", { ...none, conduct: true, ownsTeam: null }).map(
      (link) => link.label,
    );
    expect(labels).toEqual(["Results", "Replay", "Ledger"]);
    expect(
      auctionLinks("cup", "settled", { ...none, ownsTeam: "Kings" }).map((link) => link.label),
    ).toEqual(["Results", "My squad"]);
  });
});

describe("merging per-club player slices", () => {
  const row = (id: string, createdAt: number): PlayerIndexRow => ({
    registrationId: id,
    number: id,
    name: id,
    photoUrl: null,
    seasonSlug: "s",
    seasonName: "S",
    role: null,
    status: "approved",
    teamName: null,
    teamColor: null,
    feeStatus: "pending",
    squadRoute: null,
    createdAt,
  });
  const slice = (rows: PlayerIndexRow[], approved: number): PlayersSlice => ({
    rows,
    total: rows.length,
    stats: { total: rows.length, approved, sold: 0, preSigned: 0 },
  });

  it("interleaves newest-first, pages the merged list and sums the counts", () => {
    const merged = mergePlayerSlices(
      [slice([row("A3", 30), row("A1", 10)], 1), slice([row("B2", 20)], 1)],
      1,
      2,
    );
    expect(merged.rows.map((entry) => entry.registrationId)).toEqual(["A3", "B2"]);
    expect(merged.total).toBe(3);
    expect(merged.stats.approved).toBe(2);
    const second = mergePlayerSlices(
      [slice([row("A3", 30), row("A1", 10)], 1), slice([row("B2", 20)], 1)],
      2,
      2,
    );
    expect(second.rows.map((entry) => entry.registrationId)).toEqual(["A1"]);
  });
});

describe("report CSV tables obey the money gate", () => {
  const base: SeasonReport = {
    registrations: {
      total: 3,
      submitted: 1,
      approved: 2,
      waitlisted: 0,
      rejected: 0,
      withdrawn: 0,
      auctionPool: 2,
      preSigned: 0,
    },
    fees: { paid: 1, pending: 2, waived: 0, refunded: 0 },
    auction: { status: null, sold: 0, unsold: 0, remaining: 0 },
    teams: [{ teamId: "T1", name: "Kings", color: null, squad: 2 }],
  };

  it("registrations export for every reviewer", () => {
    expect(reportRows(base, "registrations")?.rows[0]).toEqual(["Submitted", "1"]);
  });

  it("team spend and top buys refuse without money sight", () => {
    expect(reportRows(base, "teams")).toBeNull();
    expect(reportRows(base, "buys")).toBeNull();
  });

  it("with money sight, spend is exported in rupees", () => {
    const withMoney: SeasonReport = {
      ...base,
      teams: [
        {
          teamId: "T1",
          name: "Kings",
          color: null,
          squad: 2,
          squadMax: 4,
          spend: 250_000,
          purse: 1_000_000,
        },
      ],
      topBuys: [],
    };
    expect(reportRows(withMoney, "teams")?.rows).toEqual([["Kings", "2", "4", "2500", "10000"]]);
    expect(reportRows(withMoney, "buys")?.rows).toEqual([]);
  });
});
