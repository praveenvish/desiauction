// THE PRACTICE AUCTION TOUCHES NOTHING REAL (0101), against real Postgres.
//
// A practice runs beside a scheduled real auction on the same engine rules,
// drawing its sample lots from the season's own players. Its sales must never
// place a player, its opening must never redraw the season's pool, it can
// never complete (completing announces results), and its log must replay like
// any night's.
import {
  DEFAULT_AUCTION_CONFIG,
  practiceAuctionConfig,
  registrationNumber,
  replayAuction,
} from "@desiauction/core";
import {
  auctionEvents as auctionEventsTable,
  auctions as auctionsTable,
  auditLog,
  bids as bidsTable,
  competitions as competitionsTable,
  createDb,
  grants as grantsTable,
  lots as lotsTable,
  newId,
  organizations,
  orgMembers,
  paddleGrants as paddleGrantsTable,
  paddles as paddlesTable,
  people,
  registrations as registrationsTable,
  teams as teamsTable,
  type DbHandle,
} from "@desiauction/db";
import {
  addOwnerToPractice,
  auctionOf,
  createAuction,
  createPracticeAuction,
  loadEvents,
  placeBid,
  practiceOf,
  recoverAuction,
  roomAuctionOf,
  transitionAuction,
  transitionLot,
  type AuctionRecord,
} from "@desiauction/auction";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { env } from "../../env";
import {
  advanceCompetition,
  createCompetition,
  createTeam,
  resolveCompetition,
  type CompetitionSummary,
} from "../competition/competitions";
import { createOrg } from "../orgs/orgs";
import { auctionReady } from "./auction-ready";

const handle: DbHandle = createDb(env.DATABASE_URL);
const db = handle.db;
const RUN = String(Date.now()).slice(-7);

let owner = "";
let orgId = "";
let comp: CompetitionSummary = null as unknown as CompetitionSummary;
let real: AuctionRecord = null as unknown as AuctionRecord;
let practice: AuctionRecord = null as unknown as AuctionRecord;
const teamIds: string[] = [];
const personIds: string[] = [];
const regIds: string[] = [];

async function seed(suffix: string, marks: { isIcon?: boolean } = {}) {
  const personId = newId();
  await db
    .insert(people)
    .values({ id: personId, phone: `+9194${RUN}${suffix}`, name: `P${suffix}` });
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
    ...(marks.isIcon === true ? { isIcon: true, teamId: teamIds[0] } : {}),
  });
  regIds.push(id);
}

async function reload(record: AuctionRecord): Promise<AuctionRecord> {
  const [row] = await db.select().from(auctionsTable).where(eq(auctionsTable.id, record.id));
  if (row === undefined) throw new Error("auction missing");
  return { ...record, status: row.status };
}

beforeAll(async () => {
  owner = newId();
  await db.insert(people).values({ id: owner, phone: `+9194${RUN}00`, name: "Organizer" });
  orgId = (await createOrg(db, owner, `Practice Club ${RUN}`)).id;
  comp = await createCompetition(db, orgId, owner, {
    sport: "cricket",
    name: `Practice Cup ${RUN}`,
    location: "Pune",
    startsOn: "2026-10-01",
    endsOn: "2026-10-30",
  });
  for (const name of ["Practice Kings", "Practice Tigers", "Practice Lions"]) {
    const team = await createTeam(db, orgId, comp.id, owner, name);
    if (!team.ok) throw new Error("team setup failed");
    teamIds.push(team.team.id);
  }
  for (const stage of ["setup", "registration_open"] as const) {
    const current = await resolveCompetition(db, owner, comp.slug);
    if (current === null) throw new Error("competition missing");
    expect((await advanceCompetition(db, current, owner, stage)).ok).toBe(true);
  }
  // An icon already on the first team, and five pool players.
  await seed("01", { isIcon: true });
  for (const suffix of ["02", "03", "04", "05", "06"]) {
    await seed(suffix);
  }
  const current = await resolveCompetition(db, owner, comp.slug);
  if (current === null) throw new Error("competition missing");
  expect((await advanceCompetition(db, current, owner, "registration_closed")).ok).toBe(true);
  comp = (await resolveCompetition(db, owner, comp.slug)) ?? comp;
  const ready = await auctionReady(db, comp);
  expect((await createAuction(db, comp, ready, owner, DEFAULT_AUCTION_CONFIG)).ok).toBe(true);
  const found = await auctionOf(db, comp.id);
  if (found === null) throw new Error("no real auction");
  real = found;
});

afterAll(async () => {
  if (orgId !== "") {
    await db.delete(auctionEventsTable).where(eq(auctionEventsTable.orgId, orgId));
    await db.delete(bidsTable).where(eq(bidsTable.orgId, orgId));
    await db.delete(lotsTable).where(eq(lotsTable.orgId, orgId));
    await db.delete(paddlesTable).where(eq(paddlesTable.orgId, orgId));
    await db.delete(paddleGrantsTable).where(eq(paddleGrantsTable.orgId, orgId));
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

describe("THE PRACTICE AUCTION", () => {
  it("is made beside the scheduled real auction, every team in it", async () => {
    const config = practiceAuctionConfig(real.config, 2);
    // 3 teams x 2 + 2 = 8 wanted; the season has 6 players, so all 6 are used.
    const created = await createPracticeAuction(db, real, owner, config, 8);
    expect(created).toMatchObject({ ok: true, lotCount: 6 });
    const found = await practiceOf(db, comp.id);
    if (found === null) throw new Error("no practice");
    practice = found;
    expect(practice.kind).toBe("practice");
    expect(practice.config.pursePerTeam).toBe(100 * 100);
    // No owners yet, so the organiser holds every team's paddle.
    const held = await db
      .select({ teamId: paddlesTable.teamId, personId: paddlesTable.personId })
      .from(paddlesTable)
      .where(and(eq(paddlesTable.auctionId, practice.id), isNull(paddlesTable.releasedAt)));
    expect(held.map((row) => row.teamId).sort()).toEqual([...teamIds].sort());
    expect(held.every((row) => row.personId === owner)).toBe(true);
  });

  it("leaves the season's auction exactly where it was", async () => {
    expect((await auctionOf(db, comp.id))?.id).toBe(real.id);
    const room = await roomAuctionOf(db, comp.id);
    expect(room?.auction.id).toBe(practice.id);
    expect((await roomAuctionOf(db, comp.id, "real"))?.auction.id).toBe(real.id);
    // One practice at a time.
    expect(
      await createPracticeAuction(db, real, owner, practiceAuctionConfig(real.config, 2), 8),
    ).toEqual({ ok: false, reason: "exists" });
  });

  it("opens without redrawing the season's pool", async () => {
    expect((await transitionAuction(db, practice, owner, "open")).ok).toBe(true);
    practice = await reload(practice);
    const practiceLots = await db
      .select({ id: lotsTable.id })
      .from(lotsTable)
      .where(eq(lotsTable.auctionId, practice.id));
    expect(practiceLots).toHaveLength(6);
  });

  it("teaches the reserve rule, and a sale places nobody on a team", async () => {
    const [lot] = await db
      .select({ id: lotsTable.id, registrationId: lotsTable.registrationId })
      .from(lotsTable)
      .where(eq(lotsTable.auctionId, practice.id))
      .orderBy(asc(lotsTable.seq))
      .limit(1);
    if (lot === undefined) throw new Error("no lot");
    const [paddle] = await db
      .select({ id: paddlesTable.id })
      .from(paddlesTable)
      .where(
        and(eq(paddlesTable.auctionId, practice.id), eq(paddlesTable.teamId, teamIds[0] ?? "")),
      );
    if (paddle === undefined) throw new Error("no paddle");
    expect((await transitionLot(db, practice, lot.id, owner, "open")).ok).toBe(true);
    // 91 of 100 would leave less than the 10 the second place needs. The
    // team's icon is NOT counted: a practice squad starts empty.
    const tooMuch = await placeBid(db, practice, owner, {
      lotId: lot.id,
      paddleId: paddle.id,
      amountRaw: 91 * 100,
      bidderAuthorized: true,
    });
    expect(tooMuch.ok).toBe(false);
    const fine = await placeBid(db, practice, owner, {
      lotId: lot.id,
      paddleId: paddle.id,
      amountRaw: 90 * 100,
      bidderAuthorized: true,
    });
    expect(fine.ok).toBe(true);
    expect((await transitionLot(db, practice, lot.id, owner, "sell")).ok).toBe(true);
    const [player] = await db
      .select({ teamId: registrationsTable.teamId })
      .from(registrationsTable)
      .where(eq(registrationsTable.id, lot.registrationId));
    expect(player?.teamId).toBeNull();
  });

  it("cannot complete, and replays like any night", async () => {
    expect(await transitionAuction(db, practice, owner, "complete")).toEqual({
      ok: false,
      reason: "illegal_transition",
    });
    const replay = replayAuction(await loadEvents(db, practice.id));
    expect(replay.ok).toBe(true);
    const report = await recoverAuction(db, practice, owner);
    expect(report).toMatchObject({ ok: true, divergences: [] });
  });

  it("takes in only real owners of the team", async () => {
    const stranger = personIds[1] ?? "";
    expect(await addOwnerToPractice(db, practice, owner, teamIds[1] ?? "", stranger)).toEqual({
      ok: false,
      reason: "not_an_owner",
    });
  });

  it("ends by abort, and the season can start another", async () => {
    expect((await transitionAuction(db, practice, owner, "abort")).ok).toBe(true);
    expect(await practiceOf(db, comp.id)).toBeNull();
    expect((await roomAuctionOf(db, comp.id))?.auction.id).toBe(real.id);
    expect(
      (await createPracticeAuction(db, real, owner, practiceAuctionConfig(real.config, 3), 11)).ok,
    ).toBe(true);
  });
});
