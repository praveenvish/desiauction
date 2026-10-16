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
import { registrationWriteState } from "./registration-write-state";
import { squadWriteState } from "./squad-write-state";
import { setRegistrationMarks } from "./registration-aggregate";
import { playerDeskContext } from "./player-desk";
import { teamsWorkspace } from "./team-workspace";
import { playerPosterFor, seasonPosterFor, teamPosterFor } from "./posters";
import { auctionHoldsRoster, rosterAuction, seasonRosterLocked } from "./registration-aggregate";

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

  it("draws the season sheet as results, not a pre-auction snapshot", async () => {
    const season = await seasonPosterFor(owner, comp.slug, REQUEST);
    if (!season.ok) throw new Error(season.message);
    expect(season.input.stage).toBe("after");
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

  it("opens hand entry once a scheduled auction is aborted, and not before", async () => {
    const other = await createCompetition(db, orgId, owner, {
      sport: "cricket",
      name: `Hand Aborted ${RUN}`,
      location: "Pune",
      startsOn: "2026-10-01",
      endsOn: "2026-10-30",
    });
    const auctionId = newId();
    await db.insert(auctionsTable).values({
      id: auctionId,
      orgId,
      competitionId: other.id,
      name: "Set up, then held elsewhere",
      config,
      createdBy: owner,
    });
    expect(
      (await teamsWorkspace(db, other, { money: false, roster: false, manage: true })).handEntry,
    ).toBeUndefined();
    await db
      .update(auctionsTable)
      .set({ status: "abandoned" })
      .where(eq(auctionsTable.id, auctionId));
    const after = await teamsWorkspace(db, other, { money: false, roster: false, manage: true });
    expect(after.handEntry).toBe("open");
    // The setup's purse rides along, to fill "points each team started with".
    expect(after.suggestedPurse).toBe(config.pursePerTeam);
    // BPL-4 (2026-10-07): an auction aborted before it ever opened holds no
    // roster — the club's own team sheet must not lock behind it.
    expect(await seasonRosterLocked(db, other.id)).toBe(false);
  });

  it("keeps the roster locked behind an auction aborted AFTER it opened", async () => {
    const other = await createCompetition(db, orgId, owner, {
      sport: "cricket",
      name: `Hand Aborted Live ${RUN}`,
      location: "Pune",
      startsOn: "2026-10-01",
      endsOn: "2026-10-30",
    });
    const auctionId = newId();
    await db.insert(auctionsTable).values({
      id: auctionId,
      orgId,
      competitionId: other.id,
      name: "Opened, then abandoned mid-night",
      config,
      createdBy: owner,
      status: "abandoned",
    });
    expect(await seasonRosterLocked(db, other.id)).toBe(false);
    // The room opened once: lots were drawn and may have sold.
    await db.insert(auctionEventsTable).values({
      id: newId(),
      orgId,
      auctionId,
      seq: 1,
      type: "AuctionOpened",
      atMs: Date.now(),
      actor: owner,
      correlationId: newId(),
      payload: {},
    });
    expect(await seasonRosterLocked(db, other.id)).toBe(true);
  });
});

describe("formation-aware player desk", () => {
  it("retains imported auction hand entry and suppresses it for both non-auction formation paths", async () => {
    for (const formation of ["auction", "organizer", "team_entry"] as const) {
      const season = await createCompetition(db, orgId, owner, {
        name: `Desk ${formation} ${RUN}`,
        sport: "cricket",
        teamFormation: formation,
      });
      await db
        .update(competitionsTable)
        .set({ auctionSource: "imported" })
        .where(eq(competitionsTable.id, season.id));
      const context = await playerDeskContext(db, owner, season);
      expect(context).toMatchObject({
        teamFormation: formation,
        canManageTeams: true,
        rosterLocked: false,
        auctionExists: false,
        handEntry: formation === "auction",
      });
      const outsider = newId();
      await db
        .insert(people)
        .values({ id: outsider, name: "Desk outsider", email: `${outsider}@example.test` });
      personIds.push(outsider);
      expect(await playerDeskContext(db, outsider, season)).toMatchObject({
        teamFormation: formation,
        canManageTeams: false,
        handEntry: false,
      });
    }
  });
});

describe("complete private squad-write reconciliation", () => {
  it("includes an off-page non-approved captain and returns only identity, membership and marks", async () => {
    const source = teamIds[0],
      destination = teamIds[1];
    if (!source || !destination) throw new Error("Missing teams");
    const old = await seed("21", { teamId: destination });
    await db
      .update(registrationsTable)
      .set({ isCaptain: true, status: "waitlisted" })
      .where(eq(registrationsTable.id, old));
    const before = await squadWriteState(db, comp.id, [reg.free], [destination]);
    expect(before?.teams.sort()).toEqual([source, destination].sort());
    expect(before?.rows.find((row) => row.id === old)).toMatchObject({
      teamId: destination,
      isCaptain: true,
    });
    for (const row of before?.rows ?? [])
      expect(Object.keys(row).sort()).toEqual(
        ["id", "teamId", "isCaptain", "isIcon", "isRetained"].sort(),
      );
    // The canonical writer, rather than a UI assumption, establishes uniqueness.
    expect(
      await setRegistrationMarks(
        db,
        orgId,
        comp.id,
        reg.free,
        { teamId: destination, isCaptain: true },
        owner,
      ),
    ).toMatchObject({ ok: true });
    const after = await squadWriteState(db, comp.id, [reg.free, old], [source, destination]);
    expect(after?.rows.find((row) => row.id === old)).toMatchObject({ isCaptain: false });
    expect(after?.rows.find((row) => row.id === reg.free)).toMatchObject({
      teamId: destination,
      isCaptain: true,
    });
  });
  it("rejects foreign/missing registrations and bounded-input violations", async () => {
    expect(await squadWriteState(db, newId(), [reg.free], [])).toBeNull();
    expect(await squadWriteState(db, comp.id, [newId()], [])).toBeNull();
    expect(
      await squadWriteState(db, comp.id, [reg.free, reg.icon, reg.dear, reg.cheap], []),
    ).toBeNull();
    expect(await squadWriteState(db, comp.id, [reg.free], [newId(), newId(), newId()])).toBeNull();
  });
});

describe("bounded bulk reconciliation", () => {
  it("reads the maximum 1000 selected rows in one minimal batch, including records outside the visible page", async () => {
    const records = Array.from({ length: 1000 }, () => ({ id: newId(), personId: newId() }));
    personIds.push(...records.map((row) => row.personId));
    await db
      .insert(people)
      .values(
        records.map((row) => ({ id: row.personId, name: "Batch validation", clubOrgId: orgId })),
      );
    await db.insert(registrationsTable).values(
      records.map((row) => ({
        id: row.id,
        personId: row.personId,
        orgId,
        competitionId: comp.id,
        registrationNumber: registrationNumber(row.id),
        status: "submitted" as const,
        role: "batter",
        adultConfirmedAt: null,
      })),
    );
    const rows = await registrationWriteState(
      db,
      comp.id,
      records.map((row) => row.id),
    );
    expect(rows).toHaveLength(1000);
    expect(new Set(rows?.map((row) => row.id))).toEqual(new Set(records.map((row) => row.id)));
    for (const row of rows ?? [])
      expect(Object.keys(row).sort()).toEqual(
        ["id", "status", "adultConfirmed", "rejectionReason", "rejectionNote"].sort(),
      );
    expect(
      await registrationWriteState(db, comp.id, [...records.map((row) => row.id), newId()]),
    ).toBeNull();
    expect(await registrationWriteState(db, comp.id, [reg.free, newId()])).toBeNull();
    expect(await registrationWriteState(db, newId(), [reg.free])).toBeNull();
  });
});
