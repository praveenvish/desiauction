// RESULTS ENTERED BY HAND (0105), against real Postgres.
//
// A season whose auction happened outside the app: players are placed on
// teams with an optional price, then published. What publishing writes must
// read exactly like a night run in the app — posters, the lock — and a player
// placed without a price must still be on their team's poster.
import {
  DEFAULT_POINTS_AUCTION_CONFIG,
  paise,
  registrationNumber,
  replayAuction,
} from "@desiauction/core";
import {
  auctionEvents as auctionEventsTable,
  auctions as auctionsTable,
  auditLog,
  competitions as competitionsTable,
  createDb,
  grants as grantsTable,
  lots as lotsTable,
  newId,
  organizations,
  orgMembers,
  paddles as paddlesTable,
  people,
  registrations as registrationsTable,
  teams as teamsTable,
  type DbHandle,
} from "@desiauction/db";
import { auctionOf, loadEvents, publishResultsByHand } from "@desiauction/auction";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { env } from "../../env";
import { createOrg } from "../orgs/orgs";
import { createCompetition, createTeam, type CompetitionSummary } from "./competitions";
import { ownedTeamIdsOn } from "./team-ownership";
import { playerPosterFor, teamPosterFor } from "./posters";
import { auctionHoldsRoster, rosterAuction } from "./registration-aggregate";

const handle: DbHandle = createDb(env.DATABASE_URL);
const db = handle.db;
const RUN = String(Date.now()).slice(-7);
const REQUEST = { theme: "floodlight", size: "square" } as const;

let owner = "";
let orgId = "";
let comp: CompetitionSummary = null as unknown as CompetitionSummary;
const teamIds: string[] = [];
const personIds: string[] = [];
/** icon (team 0), bought for 500 (team 0), placed at no price (team 0), bought for 300 (team 1), two never placed. */
const reg = { icon: "", dear: "", free: "", cheap: "", left1: "", left2: "" };

async function seed(
  suffix: string,
  fields: { teamId?: string; isIcon?: boolean; offlinePrice?: number } = {},
): Promise<string> {
  const personId = newId();
  await db
    .insert(people)
    .values({ id: personId, phone: `+9193${RUN}${suffix}`, name: `Hand ${suffix}` });
  personIds.push(personId);
  const id = newId();
  await db.insert(registrationsTable).values({
    id,
    orgId,
    competitionId: comp.id,
    personId,
    role: "batter",
    status: "approved",
    registrationNumber: registrationNumber(id),
    ...fields,
  });
  return id;
}

const config = { ...DEFAULT_POINTS_AUCTION_CONFIG, squadMin: 1, squadMax: 3 };

beforeAll(async () => {
  owner = newId();
  await db.insert(people).values({ id: owner, phone: `+9193${RUN}00`, name: "Organizer" });
  orgId = (await createOrg(db, owner, `Hand Club ${RUN}`)).id;
  comp = await createCompetition(db, orgId, owner, {
    sport: "cricket",
    name: `Hand Cup ${RUN}`,
    location: "Pune",
    startsOn: "2026-10-01",
    endsOn: "2026-10-30",
  });
  for (const name of ["Hand Kings", "Hand Tigers"]) {
    const team = await createTeam(db, orgId, comp.id, owner, name);
    if (!team.ok) throw new Error("team setup failed");
    teamIds.push(team.team.id);
  }
  const [kings = "", tigers = ""] = teamIds;
  reg.icon = await seed("01", { teamId: kings, isIcon: true });
  reg.dear = await seed("02", { teamId: kings, offlinePrice: 500 * 100 });
  reg.free = await seed("03", { teamId: kings });
  reg.cheap = await seed("04", { teamId: tigers, offlinePrice: 300 * 100 });
  reg.left1 = await seed("05");
  reg.left2 = await seed("06");
});

afterAll(async () => {
  if (orgId !== "") {
    await db.delete(auctionEventsTable).where(eq(auctionEventsTable.orgId, orgId));
    await db.delete(lotsTable).where(eq(lotsTable.orgId, orgId));
    await db.delete(paddlesTable).where(eq(paddlesTable.orgId, orgId));
    await db.delete(auctionsTable).where(eq(auctionsTable.orgId, orgId));
    await db.delete(registrationsTable).where(eq(registrationsTable.orgId, orgId));
    await db.delete(teamsTable).where(eq(teamsTable.orgId, orgId));
    await db.delete(competitionsTable).where(eq(competitionsTable.orgId, orgId));
    await db.delete(grantsTable).where(eq(grantsTable.scopeId, orgId));
    await db.delete(orgMembers).where(eq(orgMembers.orgId, orgId));
    await db.delete(auditLog).where(eq(auditLog.scopeId, orgId));
    await db.delete(organizations).where(eq(organizations.id, orgId));
  }
  const everyone = [owner, ...personIds].filter((id) => id !== "");
  await db.delete(auditLog).where(inArray(auditLog.actor, everyone));
  await db.delete(people).where(inArray(people.id, everyone));
  await handle.sql.end();
});

describe("RESULTS ENTERED BY HAND", () => {
  it("publishes as a completed real auction: priced players sold, the unplaced unsold", async () => {
    expect(await publishResultsByHand(db, comp, owner, config)).toEqual({
      ok: true,
      auctionId: expect.any(String) as string,
      sold: 2,
      unsold: 2,
    });
    const auction = await auctionOf(db, comp.id);
    expect(auction).toMatchObject({ status: "completed", kind: "real", enteredByHand: true });

    const lots = await db
      .select({
        registrationId: lotsTable.registrationId,
        status: lotsTable.status,
        soldPrice: lotsTable.soldPrice,
        teamId: paddlesTable.teamId,
      })
      .from(lotsTable)
      .leftJoin(paddlesTable, eq(paddlesTable.id, lotsTable.soldToPaddleId))
      .where(eq(lotsTable.auctionId, auction?.id ?? ""));
    const byReg = new Map(lots.map((lot) => [lot.registrationId, lot]));
    expect(byReg.get(reg.dear)).toMatchObject({
      status: "sold",
      soldPrice: 50_000,
      teamId: teamIds[0],
    });
    expect(byReg.get(reg.cheap)).toMatchObject({
      status: "sold",
      soldPrice: 30_000,
      teamId: teamIds[1],
    });
    expect(byReg.get(reg.left1)?.status).toBe("unsold");
    expect(byReg.get(reg.left2)?.status).toBe("unsold");
    // No price, no lot — and the icon is pre-signed, as always.
    expect(byReg.has(reg.free)).toBe(false);
    expect(byReg.has(reg.icon)).toBe(false);
  });

  it("makes nobody a team's owner, and its log replays", async () => {
    const auction = await auctionOf(db, comp.id);
    if (auction === null) throw new Error("no auction");
    expect(await ownedTeamIdsOn(db, owner, comp.id)).toEqual([]);
    const replay = replayAuction(await loadEvents(db, auction.id));
    expect(replay.ok).toBe(true);
  });

  it("locks the roster like any finished auction, and cannot be published twice", async () => {
    expect(auctionHoldsRoster(await rosterAuction(db, comp.id))).toBe(true);
    expect(await publishResultsByHand(db, comp, owner, config)).toEqual({
      ok: false,
      reason: "auction_exists",
    });
  });

  it("puts the priceless player on the squad poster and gives them a SOLD card", async () => {
    const squad = await teamPosterFor(owner, comp.slug, teamIds[0] ?? "", REQUEST);
    if (!squad.ok) throw new Error(squad.message);
    const names = squad.input.members.map((member) => [member.name, member.pricePaise]);
    expect(names).toEqual(
      expect.arrayContaining([
        ["Hand 01", null],
        ["Hand 02", 50_000],
        ["Hand 03", null],
      ]),
    );
    expect(squad.input.members).toHaveLength(3);
    expect(squad.input.spentPaise).toBe(50_000);
    expect(squad.input.pursePaise).toBe(config.pursePerTeam);

    const free = await playerPosterFor(owner, comp.slug, reg.free, REQUEST);
    if (!free.ok) throw new Error(free.message);
    expect(free.input).toMatchObject({ outcome: "sold", pricePaise: null, teamName: "Hand Kings" });

    const dear = await playerPosterFor(owner, comp.slug, reg.dear, REQUEST);
    if (!dear.ok) throw new Error(dear.message);
    expect(dear.input).toMatchObject({ outcome: "sold", pricePaise: 50_000 });

    const left = await playerPosterFor(owner, comp.slug, reg.left1, REQUEST);
    if (!left.ok) throw new Error(left.message);
    expect(left.input.outcome).toBe("unsold");
  });

  it("refuses a season where nobody was placed", async () => {
    const empty = await createCompetition(db, orgId, owner, {
      sport: "cricket",
      name: `Hand Empty ${RUN}`,
      location: "Pune",
      startsOn: "2026-10-01",
      endsOn: "2026-10-30",
    });
    expect(
      await publishResultsByHand(db, empty, owner, { ...config, pursePerTeam: paise(1000 * 100) }),
    ).toEqual({ ok: false, reason: "nobody_placed" });
  });
});
