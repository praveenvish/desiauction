import {
  auctions,
  competitions,
  createDb,
  fixtures,
  lots,
  newId,
  organizations,
  paddles,
  people,
  registrations,
  teams,
  tournaments,
  type DbHandle,
} from "@desiauction/db";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { env } from "../../env";
import { myRegistrations } from "../competition/public";
import { personSeasonsInOrg, playerCareer, playerUpcomingMatches } from "./career";

/**
 * The career projection, against a real database (PI-1 P5).
 *
 * Two properties are load-bearing enough to pin: the ABANDONED-AUCTION GUARD
 * (abandoned nights accumulate lots without limit — an unguarded join lists a
 * season twice, the second time carrying a verdict from a night nobody ran to
 * the end; documented at myRegistrations and re-proven here for the new
 * reader), and honest rendering of a withdrawn season (history is never
 * deleted, so it must render, correctly labeled, not leak a phantom verdict).
 */

const handle: DbHandle = createDb(env.DATABASE_URL);
const db = handle.db;

const RUN = String(Date.now()).slice(-8);
const PHONE = `+9185${RUN}`;

const personId = newId();
const orgId = newId();
const tournamentId = newId();
const soldCompId = newId();
const withdrawnCompId = newId();
const teamId = newId();
const regSold = newId();
const regWithdrawn = newId();
const realAuctionId = newId();
const abandonedAuctionId = newId();

const SOLD_PRICE = 2_50_000_00; // ₹2,50,000 in paise

// The calendar: one rival and four fixtures, of which exactly one is upcoming.
const rivalTeamId = newId();
const fixtureIds = [newId(), newId(), newId(), newId()] as const;

beforeAll(async () => {
  await db.insert(people).values({ id: personId, phone: PHONE, name: "Career Synthetic" });
  await db.insert(organizations).values({
    id: orgId,
    name: `Career Test Org ${RUN}`,
    slug: `career-test-org-${RUN}`,
    createdBy: personId,
  });
  await db.insert(tournaments).values({
    id: tournamentId,
    orgId,
    sport: "cricket",
    name: "Career Premier League",
    slug: `career-premier-league-${RUN}`,
    createdBy: personId,
  });
  await db.insert(competitions).values([
    {
      id: soldCompId,
      orgId,
      sport: "cricket",
      tournamentId,
      name: "CPL 1",
      slug: `cpl-1-${RUN}`,
      status: "registration_closed",
      startsOn: "2025-01-01",
      createdBy: personId,
    },
    {
      id: withdrawnCompId,
      orgId,
      sport: "cricket",
      name: "Career One-Off",
      slug: `career-one-off-${RUN}`,
      status: "registration_open",
      startsOn: "2026-02-01",
      createdBy: personId,
    },
  ]);
  await db.insert(teams).values([
    {
      id: teamId,
      orgId,
      competitionId: soldCompId,
      name: "Career Strikers",
      primaryColor: "#123456",
      createdBy: personId,
    },
    {
      id: rivalTeamId,
      orgId,
      competitionId: soldCompId,
      name: "Career Rivals",
      createdBy: personId,
    },
  ]);
  await db.insert(registrations).values([
    {
      id: regSold,
      orgId,
      competitionId: soldCompId,
      personId,
      role: "all_rounder",
      status: "approved",
      registrationNumber: `R${RUN.slice(0, 6)}`,
      teamId,
      isCaptain: true,
      jerseyNumber: "07",
    },
    {
      id: regWithdrawn,
      orgId,
      competitionId: withdrawnCompId,
      personId,
      role: "bowler",
      status: "withdrawn",
      registrationNumber: `R${RUN.slice(2, 8)}`,
    },
  ]);
  // The night that counts, and the phantom: an abandoned auction whose lot
  // claims a sale. The guard must keep the phantom out of the career.
  await db.insert(auctions).values([
    {
      id: realAuctionId,
      orgId,
      competitionId: soldCompId,
      name: "CPL 1 Auction",
      status: "completed",
      config: {},
      createdBy: personId,
    },
    {
      id: abandonedAuctionId,
      orgId,
      competitionId: soldCompId,
      name: "CPL 1 Auction (aborted)",
      status: "abandoned",
      config: {},
      createdBy: personId,
    },
  ]);
  /*
   * REAL PADDLES, because a sold lot has a real buyer.
   *
   * Both lots used to carry `soldToPaddleId: newId()` — a buyer invented on the
   * spot, referencing nothing. Migration 0043's `lots_sold_to_paddle_id_fk`
   * refuses that outright, and rightly: a sale whose paddle does not exist is
   * precisely the corruption the audit found 214 of, and a fixture that asserts
   * career facts about it was asserting them about a state the product cannot
   * reach. The phantom this test is actually about is the ABANDONED auction,
   * not a dangling pointer, and that phantom is unaffected.
   */
  const realPaddleId = newId();
  const phantomPaddleId = newId();
  await db.insert(paddles).values([
    {
      id: realPaddleId,
      orgId,
      auctionId: realAuctionId,
      teamId,
      personId,
      paddleNumber: "P01",
    },
    {
      id: phantomPaddleId,
      orgId,
      auctionId: abandonedAuctionId,
      teamId,
      personId,
      paddleNumber: "P01",
    },
  ]);
  await db.insert(lots).values([
    {
      id: newId(),
      orgId,
      auctionId: realAuctionId,
      registrationId: regSold,
      lotNumber: "L001",
      seq: 1,
      basePrice: 10_000_00,
      status: "sold",
      soldToPaddleId: realPaddleId,
      soldPrice: SOLD_PRICE,
    },
    {
      id: newId(),
      orgId,
      auctionId: abandonedAuctionId,
      registrationId: regSold,
      lotNumber: "L001",
      seq: 1,
      basePrice: 10_000_00,
      status: "sold",
      soldToPaddleId: phantomPaddleId,
      soldPrice: 99_99_999_00, // the phantom price that must never surface
    },
  ]);
  const fixture = (
    index: number,
    status: "draft" | "published" | "completed",
    kickoffAt: string,
  ) => ({
    id: fixtureIds[index] ?? newId(),
    orgId,
    competitionId: soldCompId,
    fixtureNumber: `CRT${RUN}-F00${String(index + 1)}`,
    seq: index + 1,
    homeTeamId: index % 2 === 0 ? teamId : rivalTeamId,
    awayTeamId: index % 2 === 0 ? rivalTeamId : teamId,
    kickoffAt,
    status,
    createdBy: personId,
  });
  await db
    .insert(fixtures)
    .values([
      fixture(0, "published", "2099-03-01T16:30"),
      fixture(1, "published", "2020-03-01T16:30"),
      fixture(2, "draft", "2099-04-01T16:30"),
      fixture(3, "completed", "2099-05-01T16:30"),
    ]);
});

afterAll(async () => {
  await db.delete(fixtures).where(inArray(fixtures.id, [...fixtureIds]));
  await db.delete(lots).where(inArray(lots.auctionId, [realAuctionId, abandonedAuctionId]));
  await db.delete(paddles).where(inArray(paddles.auctionId, [realAuctionId, abandonedAuctionId]));
  await db.delete(auctions).where(inArray(auctions.id, [realAuctionId, abandonedAuctionId]));
  await db.delete(registrations).where(inArray(registrations.id, [regSold, regWithdrawn]));
  await db.delete(teams).where(inArray(teams.id, [teamId, rivalTeamId]));
  await db.delete(competitions).where(inArray(competitions.id, [soldCompId, withdrawnCompId]));
  await db.delete(tournaments).where(eq(tournaments.id, tournamentId));
  await db.delete(organizations).where(eq(organizations.id, orgId));
  await db.delete(people).where(eq(people.id, personId));
  await handle.sql.end({ timeout: 5 });
});

describe("playerCareer (PI-1)", () => {
  it("lists each season once, guarded against abandoned-auction phantoms", async () => {
    const career = await playerCareer(personId);
    expect(career.seasons).toHaveLength(2);
    const sold = career.seasons.find((s) => s.competitionName === "CPL 1");
    expect(sold?.auction).toEqual({ kind: "sold", soldPrice: SOLD_PRICE });
    expect(sold?.tournamentName).toBe("Career Premier League");
    expect(sold?.teamName).toBe("Career Strikers");
    expect(sold?.isCaptain).toBe(true);
    expect(sold?.jerseyNumber).toBe("07");
  });

  it("renders a withdrawn season honestly — present, labeled, verdict-free", async () => {
    const career = await playerCareer(personId);
    const withdrawn = career.seasons.find((s) => s.competitionName === "Career One-Off");
    expect(withdrawn?.status).toBe("withdrawn");
    expect(withdrawn?.auction).toBeNull();
    expect(withdrawn?.tournamentName).toBeNull();
  });

  it("folds totals from the real night only", async () => {
    const career = await playerCareer(personId);
    expect(career.totals).toEqual({
      seasons: 2,
      teams: 1,
      soldCount: 1,
      highestPrice: SOLD_PRICE,
      highestUnit: "inr",
    });
  });

  it("scopes the organizer line to the org and excludes the season in hand", async () => {
    const seasons = await personSeasonsInOrg(personId, orgId, soldCompId);
    expect(seasons).toHaveLength(1);
    expect(seasons[0]?.competitionName).toBe("Career One-Off");
    // A different org sees nothing — the club's records are the club's.
    expect(await personSeasonsInOrg(personId, newId())).toHaveLength(0);
  });

  it("lists only published fixtures from today on, from this person's side", async () => {
    const upcoming = await playerUpcomingMatches(personId, "2026-01-01");
    expect(upcoming).toHaveLength(1);
    expect(upcoming[0]).toMatchObject({
      fixtureId: fixtureIds[0],
      teamName: "Career Strikers",
      teamColor: "#123456",
      opponentName: "Career Rivals",
      competitionName: "CPL 1",
    });
    expect(await playerUpcomingMatches(newId(), "2026-01-01")).toEqual([]);
  });

  it("carries the team colour on a season for its chip", async () => {
    const career = await playerCareer(personId);
    expect(career.seasons.find((s) => s.competitionName === "CPL 1")?.teamColor).toBe("#123456");
  });

  it("/home's myRegistrations tells the same verdict as the career — price, team, colour", async () => {
    // /home used to show a sold player only their registration's "approved";
    // it now reads the verdict from here, so it must agree with /me — and be
    // held to the same abandoned-auction guard (one row, the real price).
    const rows = await myRegistrations(personId);
    expect(rows).toHaveLength(2);
    const sold = rows.find((row) => row.competitionName === "CPL 1");
    expect(sold?.auction).toEqual({ kind: "sold", soldPrice: SOLD_PRICE });
    expect(sold?.auctionUnit).toBe("inr");
    expect(sold?.teamName).toBe("Career Strikers");
    expect(sold?.teamColor).toBe("#123456");
    const withdrawn = rows.find((row) => row.competitionName === "Career One-Off");
    expect(withdrawn?.auction).toBeNull();
    expect(withdrawn?.teamName).toBeNull();
  });
});
