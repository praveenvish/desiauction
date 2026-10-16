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
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Lifecycle action tests mock only authenticated session and engine transport.
// Canonical aggregate writes below use the isolated real Postgres fixture.
let actingPerson = "";
let endMode: "accepted" | "unknown" | "post-commit-unknown" | "replacement" | "real-start" =
  "accepted";
const endedIds: string[] = [];
vi.mock("../auth/actions", () => ({
  currentSession: () => Promise.resolve({ personId: actingPerson }),
}));
vi.mock("./engine-client", () => ({
  sendEngineCommand: async (input: { auctionId: string; actor: string; commandId: string }) => {
    endedIds.push(input.auctionId);
    if (endMode === "unknown")
      return {
        commandId: input.commandId,
        accepted: false,
        reason: "engine_unreachable",
        version: 0,
      };
    const [row] = await db
      .select()
      .from(auctionsTable)
      .where(eq(auctionsTable.id, input.auctionId));
    if (!row) throw new Error("No selected practice");
    const ended = await transitionAuction(
      db,
      row as AuctionRecord,
      input.actor,
      "abort",
      "practice ended",
    );
    if (!ended.ok)
      return { commandId: input.commandId, accepted: false, reason: ended.reason, version: 0 };
    if (endMode === "post-commit-unknown")
      return { commandId: input.commandId, accepted: false, reason: "command_failed", version: 0 };
    if (endMode === "replacement") {
      const created = await createPracticeAuction(
        db,
        real,
        owner,
        practiceAuctionConfig(real.config, 2),
        8,
      );
      if (!created.ok) throw new Error("Replacement setup failed");
    }
    if (endMode === "real-start")
      await db.update(auctionsTable).set({ status: "live" }).where(eq(auctionsTable.id, real.id));
    return { commandId: input.commandId, accepted: true, version: 1 };
  },
}));
import {
  practiceIntentAction,
  practiceCardView,
  practiceLifecycleContext,
} from "./practice-actions";

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

describe("identity-bound practice lifecycle actions", () => {
  beforeEach(async () => {
    actingPerson = owner;
    endMode = "accepted";
    endedIds.length = 0;
    await db
      .update(auctionsTable)
      .set({ status: "scheduled" })
      .where(eq(auctionsTable.id, real.id));
    const active = await practiceOf(db, comp.id);
    if (active) expect((await transitionAuction(db, active, owner, "abort")).ok).toBe(true);
  });
  async function start() {
    const result = await practiceIntentAction(comp.slug, "start", real.id, null, 2, newId());
    expect(result).toMatchObject({ kind: "accepted", stage: "complete", ended: false });
    if (!result.practiceId) throw new Error("No created practice receipt");
    return result.practiceId;
  }
  it("returns actual identity and exposes scoped card identities", async () => {
    const id = await start();
    expect((await practiceOf(db, comp.id))?.id).toBe(id);
    expect(await practiceCardView(comp.slug)).toMatchObject({
      personId: owner,
      realAuctionId: real.id,
      practice: { id },
    });
  });
  it("refuses stale End and Run again without ending the replacement", async () => {
    const old = await start();
    expect((await practiceIntentAction(comp.slug, "end", real.id, old, 2, newId())).kind).toBe(
      "accepted",
    );
    endedIds.length = 0;
    const replacement = await start();
    for (const kind of ["end", "again"] as const)
      expect((await practiceIntentAction(comp.slug, kind, real.id, old, 2, newId())).kind).toBe(
        "refused",
      );
    expect((await practiceOf(db, comp.id))?.id).toBe(replacement);
    expect(endedIds).toEqual([]);
  });
  it("does not turn an ended old Run again into Start", async () => {
    const old = await start();
    await practiceIntentAction(comp.slug, "end", real.id, old, 2, newId());
    const [before] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(auctionsTable)
      .where(eq(auctionsTable.competitionId, comp.id));
    expect((await practiceIntentAction(comp.slug, "again", real.id, old, 2, newId())).kind).toBe(
      "refused",
    );
    const [after] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(auctionsTable)
      .where(eq(auctionsTable.competitionId, comp.id));
    expect(after).toEqual(before);
    expect(await practiceOf(db, comp.id)).toBeNull();
  });
  it.each(["unknown", "post-commit-unknown"] as const)(
    "stops before creation after %s End",
    async (mode) => {
      const old = await start();
      endMode = mode;
      const [before] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(auctionsTable)
        .where(eq(auctionsTable.competitionId, comp.id));
      expect(
        await practiceIntentAction(comp.slug, "again", real.id, old, 2, newId()),
      ).toMatchObject({ kind: "unknown", stage: "end", ended: false });
      const [after] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(auctionsTable)
        .where(eq(auctionsTable.competitionId, comp.id));
      expect(after).toEqual(before);
      expect(endedIds).toEqual([old]);
    },
  );
  it.each(["replacement", "real-start"] as const)(
    "reports ended-old/create-refused when %s intervenes",
    async (mode) => {
      const old = await start();
      endMode = mode;
      expect(
        await practiceIntentAction(comp.slug, "again", real.id, old, 2, newId()),
      ).toMatchObject({ kind: "refused", stage: "create", ended: true });
      expect(endedIds).toEqual([old]);
      if (mode === "replacement") expect((await practiceOf(db, comp.id))?.id).not.toBe(old);
    },
  );
  it("rejects foreign identities and invalid size without writes", async () => {
    const old = await start();
    expect((await practiceIntentAction(comp.slug, "end", newId(), old, 2, newId())).kind).toBe(
      "refused",
    );
    expect((await practiceIntentAction(comp.slug, "end", real.id, newId(), 2, newId())).kind).toBe(
      "refused",
    );
    expect((await practiceIntentAction(comp.slug, "again", real.id, old, 3, newId())).kind).toBe(
      "refused",
    );
    expect(endedIds).toEqual([]);
    expect((await practiceOf(db, comp.id))?.id).toBe(old);
  });
  it("refuses a non-member directly and discloses no card or lifecycle context", async () => {
    const old = await start();
    actingPerson = personIds[0] ?? "";
    expect((await practiceIntentAction(comp.slug, "end", real.id, old, 2, newId())).kind).toBe(
      "refused",
    );
    expect(await practiceCardView(comp.slug)).toBeNull();
    expect(await practiceLifecycleContext(comp.slug, real.id)).toBeNull();
    expect(endedIds).toEqual([]);
  });
  it("lets an appointed conductor End but never Start/Run again or read the manager card", async () => {
    const old = await start();
    const conductor = personIds[1];
    if (!conductor) throw new Error("Missing conductor fixture");
    await db.insert(orgMembers).values({ orgId, personId: conductor });
    await db.insert(grantsTable).values({
      id: newId(),
      personId: conductor,
      scopeType: "tournament",
      scopeId: comp.id,
      capabilitySet: "auction:conductor",
      grantedBy: owner,
    });
    try {
      actingPerson = conductor;
      expect(await practiceCardView(comp.slug)).toBeNull();
      expect(await practiceLifecycleContext(comp.slug, real.id)).toMatchObject({
        personId: conductor,
        practiceId: old,
      });
      expect((await practiceIntentAction(comp.slug, "start", real.id, null, 2, newId())).kind).toBe(
        "refused",
      );
      expect((await practiceIntentAction(comp.slug, "again", real.id, old, 2, newId())).kind).toBe(
        "refused",
      );
      expect(endedIds).toEqual([]);
      expect((await practiceIntentAction(comp.slug, "end", real.id, old, 2, newId())).kind).toBe(
        "accepted",
      );
      expect(endedIds).toEqual([old]);
    } finally {
      await db
        .delete(grantsTable)
        .where(and(eq(grantsTable.personId, conductor), eq(grantsTable.scopeId, comp.id)));
    }
  });
  it("concurrent Start creates one active practice and leaves real money/history unchanged", async () => {
    const before = await db.select().from(auctionsTable).where(eq(auctionsTable.id, real.id));
    const money = await db.select().from(bidsTable).where(eq(bidsTable.auctionId, real.id));
    const history = await db
      .select()
      .from(auctionEventsTable)
      .where(eq(auctionEventsTable.auctionId, real.id));
    const results = await Promise.all(
      [1, 2].map(() => practiceIntentAction(comp.slug, "start", real.id, null, 2, newId())),
    );
    expect(results.filter((item) => item.kind === "accepted")).toHaveLength(1);
    const active = await db
      .select()
      .from(auctionsTable)
      .where(
        and(
          eq(auctionsTable.competitionId, comp.id),
          eq(auctionsTable.kind, "practice"),
          sql`${auctionsTable.status} <> 'abandoned'`,
        ),
      );
    expect(active).toHaveLength(1);
    expect(await db.select().from(auctionsTable).where(eq(auctionsTable.id, real.id))).toEqual(
      before,
    );
    expect(await db.select().from(bidsTable).where(eq(bidsTable.auctionId, real.id))).toEqual(
      money,
    );
    expect(
      await db.select().from(auctionEventsTable).where(eq(auctionEventsTable.auctionId, real.id)),
    ).toEqual(history);
  });
});
