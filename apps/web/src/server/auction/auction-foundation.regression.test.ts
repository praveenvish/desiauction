// PERMANENT AUCTION FOUNDATION REGRESSION SUITE (M-IP4-1). Encodes the frozen
// contract: the AuctionReady gateway, deterministic lot preparation, immutable
// paddles, the auction/lot lifecycles with their guards, the bid gauntlet with
// immutable evidence (accepted AND rejected), event emission with a contiguous
// single-writer seq, audit completeness with correlation, replay = persisted
// state, deterministic recovery healing, fail-closed corrupted logs, abort +
// re-creation, and RLS read/write proofs on all five auction tables.
// Real Postgres; unique phones/orgs per run.
import { DEFAULT_AUCTION_CONFIG, registrationNumber } from "@desiauction/core";
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
  otpCodes,
  otpInbox,
  paddles as paddlesTable,
  people,
  registrations as registrationsTable,
  sessions,
  teams as teamsTable,
  type DbHandle,
} from "@desiauction/db";
import { and, desc, eq, inArray, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { env } from "../../env";
import { requestOtp, verifyOtp } from "../auth/otp";
import { DevInboxSender } from "../auth/otp-sender";
import { canCompetition } from "../competition/authz";
import {
  advanceCompetition,
  createCompetition,
  createTeam,
  resolveCompetition,
  type CompetitionSummary,
} from "../competition/competitions";
import { createOrg } from "../orgs/orgs";
import {
  createAuction,
  issuePaddle,
  loadEvents,
  placeBid,
  queueAllLots,
  recoverAuction,
  transitionAuction,
  transitionLot,
  undoLastAction,
  type AuctionRecord,
} from "@desiauction/auction";
import { auctionOf, auctionView, bidsOf } from "@desiauction/auction";
import { auctionReady } from "./auction-ready";
import { replayAuction } from "@desiauction/core";

const handle: DbHandle = createDb(env.DATABASE_URL);
const db = handle.db;
const sender = new DevInboxSender(db);

const RUN = String(Date.now()).slice(-7);
const PHONE_OWNER = `+9198${RUN}6`;
const PHONE_OUTSIDER = `+9196${RUN}9`;
const TEST_PHONES = [PHONE_OWNER, PHONE_OUTSIDER];
const SEED_PHONE_PREFIX = `+91944${RUN}`;

let owner = "";
let outsider = "";
let org = { id: "", name: "", slug: "" };
let orgRival = { id: "", name: "", slug: "" };
let comp: CompetitionSummary = null as unknown as CompetitionSummary;
let auction: AuctionRecord = null as unknown as AuctionRecord;
const teamIds: string[] = [];
const paddleIds: string[] = [];
const seededPersonIds: string[] = [];

async function login(phone: string): Promise<string> {
  await requestOtp(db, sender, phone);
  const [row] = await db
    .select()
    .from(otpInbox)
    .where(eq(otpInbox.phone, phone))
    .orderBy(desc(otpInbox.createdAt))
    .limit(1);
  const verified = await verifyOtp(db, phone, row?.code ?? "");
  if (!verified.ok) {
    throw new Error("login failed");
  }
  return verified.personId;
}

function must<T>(value: T | undefined | null, label: string): T {
  if (value === undefined || value === null) {
    throw new Error(`expected ${label}`);
  }
  return value;
}

/** Seed an APPROVED registration (the pool path is regression-covered in IP-3). */
async function seedApproved(
  competitionId: string,
  orgId: string,
  name: string,
  suffix: string,
  band: string | null = null,
): Promise<string> {
  const personId = newId();
  await db.insert(people).values({ id: personId, phone: `${SEED_PHONE_PREFIX}${suffix}`, name });
  seededPersonIds.push(personId);
  const id = newId();
  await db.insert(registrationsTable).values({
    id,
    orgId,
    competitionId,
    personId,
    role: "batter",
    status: "approved",
    registrationNumber: registrationNumber(id),
    ...(band !== null ? { basePriceBand: band } : {}),
  });
  return id;
}

async function freshAuction(): Promise<AuctionRecord> {
  const record = await auctionOf(db, comp.id);
  return must(record, "auction record");
}

/**
 * Resolve a lot by its player's name. Lot NUMBERS follow the pool's
 * registration-number order, which derives from ULIDs — deterministic for a
 * given pool but not predictable across runs, so tests address lots by player.
 */
/** The squad placement the WHOLE product reads (Teams, export, public page). */
async function registrationTeamOf(auctionId: string, playerName: string) {
  const [row] = await db
    .select({ teamId: registrationsTable.teamId })
    .from(lotsTable)
    .innerJoin(registrationsTable, eq(registrationsTable.id, lotsTable.registrationId))
    .innerJoin(people, eq(people.id, registrationsTable.personId))
    .where(and(eq(lotsTable.auctionId, auctionId), eq(people.name, playerName)))
    .limit(1);
  return must(row, `registration for ${playerName}`).teamId;
}

async function lotByPlayer(auctionId: string, playerName: string) {
  const [row] = await db
    .select({ lot: lotsTable })
    .from(lotsTable)
    .innerJoin(registrationsTable, eq(registrationsTable.id, lotsTable.registrationId))
    .innerJoin(people, eq(people.id, registrationsTable.personId))
    .where(and(eq(lotsTable.auctionId, auctionId), eq(people.name, playerName)))
    .limit(1);
  return must(row, `lot for ${playerName}`).lot;
}

beforeAll(async () => {
  owner = await login(PHONE_OWNER);
  outsider = await login(PHONE_OUTSIDER);
  org = await createOrg(db, owner, `Auction Org ${RUN}`);
  orgRival = await createOrg(db, outsider, `Auction Rival ${RUN}`);
  comp = await createCompetition(db, org.id, owner, {
    name: `Mumbai Premier League ${RUN}`,
    location: "Malad",
    startsOn: "2026-08-01",
    endsOn: "2026-09-15",
  });
  for (const name of ["Andheri Arrows", "Bandra Blasters", "Colaba Kings"]) {
    const team = await createTeam(db, org.id, comp.id, owner, name);
    if (!team.ok) {
      throw new Error("team setup failed");
    }
    teamIds.push(team.team.id);
  }
});

afterAll(async () => {
  const orgIds = [org.id, orgRival.id].filter((id) => id !== "");
  const personIds = [owner, outsider, ...seededPersonIds].filter((id) => id !== "");
  if (orgIds.length > 0) {
    await db.delete(auctionEventsTable).where(inArray(auctionEventsTable.orgId, orgIds));
    await db.delete(bidsTable).where(inArray(bidsTable.orgId, orgIds));
    await db.delete(lotsTable).where(inArray(lotsTable.orgId, orgIds));
    await db.delete(paddlesTable).where(inArray(paddlesTable.orgId, orgIds));
    await db.delete(auctionsTable).where(inArray(auctionsTable.orgId, orgIds));
    await db.delete(registrationsTable).where(inArray(registrationsTable.orgId, orgIds));
    await db.delete(teamsTable).where(inArray(teamsTable.orgId, orgIds));
    await db.delete(competitionsTable).where(inArray(competitionsTable.orgId, orgIds));
    await db.delete(grantsTable).where(inArray(grantsTable.scopeId, orgIds));
    await db.delete(orgMembers).where(inArray(orgMembers.orgId, orgIds));
    await db.delete(auditLog).where(inArray(auditLog.scopeId, orgIds));
    await db.delete(organizations).where(inArray(organizations.id, orgIds));
  }
  if (personIds.length > 0) {
    await db.delete(sessions).where(inArray(sessions.personId, personIds));
    await db.delete(auditLog).where(inArray(auditLog.actor, personIds));
    await db.delete(people).where(inArray(people.id, personIds));
  }
  await db.delete(otpCodes).where(inArray(otpCodes.phone, TEST_PHONES));
  await db.delete(otpInbox).where(inArray(otpInbox.phone, TEST_PHONES));
  await handle.sql.end();
});

describe("AUCTION FOUNDATION — the AuctionReady gateway", () => {
  it("is NOT ready while registration is open or the pool is empty", async () => {
    // draft → setup → registration_open, no approved players yet.
    let current = must(await resolveCompetition(db, owner, comp.slug), "competition");
    expect((await advanceCompetition(db, current, owner, "setup")).ok).toBe(true);
    current = must(await resolveCompetition(db, owner, comp.slug), "competition");
    expect((await advanceCompetition(db, current, owner, "registration_open")).ok).toBe(true);
    current = must(await resolveCompetition(db, owner, comp.slug), "competition");
    const ready = await auctionReady(db, current);
    expect(ready.ok).toBe(false);
    expect(ready.checks.find((c) => c.id === "intake_closed")?.pass).toBe(false);
    expect(ready.checks.find((c) => c.id === "pool_present")?.pass).toBe(false);
    // The gateway is the ONLY door: creation with a failing projection refuses.
    const refused = await createAuction(db, current, ready, owner, DEFAULT_AUCTION_CONFIG);
    expect(refused).toEqual({ ok: false, reason: "not_ready" });
  });

  it("becomes ready once the pool is approved and intake closes; the projection is frozen", async () => {
    await seedApproved(comp.id, org.id, "Kohli Local", "a01", "A");
    await seedApproved(comp.id, org.id, "Sharma Local", "a02", "B");
    await seedApproved(comp.id, org.id, "Patel Local", "a03", null);
    let current = must(await resolveCompetition(db, owner, comp.slug), "competition");
    expect((await advanceCompetition(db, current, owner, "registration_closed")).ok).toBe(true);
    current = must(await resolveCompetition(db, owner, comp.slug), "competition");
    comp = current;
    const ready = await auctionReady(db, current);
    expect(ready.ok).toBe(true);
    expect(ready.pool.length).toBe(3);
    expect(ready.teams.length).toBe(3);
    expect(Object.isFrozen(ready)).toBe(true);
    expect(Object.isFrozen(ready.pool)).toBe(true);
    // Deterministic: two projections of the same state are identical.
    expect(await auctionReady(db, current)).toEqual(ready);
  });

  it("creates the auction: config locks, lots prepare in deterministic pool order", async () => {
    const ready = await auctionReady(db, comp.id === "" ? comp : comp);
    const result = await createAuction(db, comp, ready, owner, DEFAULT_AUCTION_CONFIG);
    expect(result.ok).toBe(true);
    auction = await freshAuction();
    expect(auction.status).toBe("scheduled");
    const view = await auctionView(db, auction);
    expect(view.lots.length).toBe(3);
    expect(view.lots.map((l) => l.lotNumber)).toEqual(["L001", "L002", "L003"]);
    // Lot order mirrors the pool's registration-number order exactly.
    expect(view.lots.map((l) => l.playerName)).toEqual(ready.pool.map((p) => p.playerName));
    // Base prices resolve by band, fail-closed to the default.
    const kohli = must(
      view.lots.find((l) => l.playerName === "Kohli Local"),
      "kohli lot",
    );
    const patel = must(
      view.lots.find((l) => l.playerName === "Patel Local"),
      "patel lot",
    );
    expect(kohli.basePrice).toBe(5_000_000);
    expect(patel.basePrice).toBe(1_000_000);
    // Events: AuctionCreated + one LotPrepared per lot, seq 1..4.
    const events = await loadEvents(db, auction.id);
    expect(events.map((e) => e.seq)).toEqual([1, 2, 3, 4]);
    expect(events[0]?.type).toBe("AuctionCreated");
    expect(events.filter((e) => e.type === "LotPrepared").length).toBe(3);
    // A second auction for the same competition is refused.
    expect(await createAuction(db, comp, ready, owner, DEFAULT_AUCTION_CONFIG)).toEqual({
      ok: false,
      reason: "auction_exists",
    });
  });
});

describe("AUCTION FOUNDATION — paddles are immutable identity", () => {
  it("issues one paddle per team with stable human numbers; reissue is refused", async () => {
    for (const teamId of [teamIds[0], teamIds[1]] as string[]) {
      const result = await issuePaddle(db, auction, owner, teamId, owner);
      if (!result.ok) {
        throw new Error(`paddle issue failed: ${result.reason}`);
      }
      paddleIds.push(result.paddleId);
    }
    const view = await auctionView(db, auction);
    expect(view.paddles.map((p) => p.paddleNumber)).toEqual(["P01", "P02"]);
    // Never reused, never reissued: the same team cannot get a second paddle.
    expect(await issuePaddle(db, auction, owner, teamIds[0] as string, owner)).toEqual({
      ok: false,
      reason: "already_issued",
    });
    // A foreign team is refused (tenant + competition safety).
    expect(await issuePaddle(db, auction, owner, newId(), owner)).toEqual({
      ok: false,
      reason: "unknown_team",
    });
  });
});

describe("AUCTION FOUNDATION — auction lifecycle guards", () => {
  it("open is guard-blocked until lots are queued; then the walk works", async () => {
    expect(await transitionAuction(db, auction, owner, "open")).toEqual({
      ok: false,
      reason: "guard_failed",
    });
    const queued = await queueAllLots(db, auction, owner);
    expect(queued).toEqual({ applied: 3, skipped: 0 });
    expect((await transitionAuction(db, auction, owner, "open")).ok).toBe(true);
    auction = await freshAuction();
    expect(auction.status).toBe("live");
    // Illegal edges are refused; pause ⇄ resume works.
    expect(await transitionAuction(db, auction, owner, "open")).toEqual({
      ok: false,
      reason: "illegal_transition",
    });
    expect((await transitionAuction(db, auction, owner, "pause")).ok).toBe(true);
    auction = await freshAuction();
    expect((await transitionAuction(db, auction, owner, "resume")).ok).toBe(true);
    auction = await freshAuction();
    expect(auction.status).toBe("live");
  });
});

describe("AUCTION FOUNDATION — bids: the gauntlet + immutable evidence", () => {
  it("opens exactly one lot at a time, with a server timer", async () => {
    const lot1 = await lotByPlayer(auction.id, "Kohli Local");
    const result = await transitionLot(db, auction, lot1.id, owner, "open");
    expect(result).toEqual({ ok: true, status: "on_block" });
    const opened = await lotByPlayer(auction.id, "Kohli Local");
    expect(opened.endsAtMs).not.toBeNull();
    const lot2 = await lotByPlayer(auction.id, "Sharma Local");
    expect(await transitionLot(db, auction, lot2.id, owner, "open")).toEqual({
      ok: false,
      reason: "another_lot_open",
    });
  });

  it("rejects below-base with evidence but NO bid row; accepts on the ladder", async () => {
    const lot1 = await lotByPlayer(auction.id, "Kohli Local"); // band A base = 5_000_000
    const eventsBefore = (await loadEvents(db, auction.id)).length;
    const rejected = await placeBid(db, auction, owner, {
      lotId: lot1.id,
      paddleId: paddleIds[0] as string,
      amountRaw: 1_000_000,
      bidderAuthorized: true,
    });
    expect(rejected).toEqual({ ok: false, code: "BELOW_BASE" });
    expect((await bidsOf(db, auction.id, lot1.id)).length).toBe(0);
    const events = await loadEvents(db, auction.id);
    expect(events.length).toBe(eventsBefore + 1);
    expect(events[events.length - 1]?.type).toBe("BidRejected");

    const accepted = await placeBid(db, auction, owner, {
      lotId: lot1.id,
      paddleId: paddleIds[0] as string,
      amountRaw: 5_000_000, // the base — first bid needs no leader
      bidderAuthorized: true,
    });
    expect(accepted.ok).toBe(true);
    expect((await bidsOf(db, auction.id, lot1.id)).length).toBe(1);
  });

  it("refuses self-outbid and off-ladder amounts; a higher bid replaces the leader", async () => {
    const lot1 = await lotByPlayer(auction.id, "Kohli Local");
    expect(
      await placeBid(db, auction, owner, {
        lotId: lot1.id,
        paddleId: paddleIds[0] as string,
        amountRaw: 5_500_000,
        bidderAuthorized: true,
      }),
    ).toEqual({ ok: false, code: "ALREADY_LEADING" });
    expect(
      await placeBid(db, auction, owner, {
        lotId: lot1.id,
        paddleId: paddleIds[1] as string,
        amountRaw: 5_700_000, // off the +₹5k ladder from ₹50k base
        bidderAuthorized: true,
      }),
    ).toEqual({ ok: false, code: "INVALID_INCREMENT" });
    const replace = await placeBid(db, auction, owner, {
      lotId: lot1.id,
      paddleId: paddleIds[1] as string,
      amountRaw: 5_500_000,
      bidderAuthorized: true,
    });
    expect(replace.ok).toBe(true);
    const history = await bidsOf(db, auction.id, lot1.id);
    expect(history.length).toBe(2);
    // Replace semantics: the earlier accepted bid is now outbid — but its row
    // and its BidAccepted event remain, immutable evidence (amounts untouched).
    expect(history[0]?.status).toBe("outbid");
    expect(history[0]?.amount).toBe(5_000_000);
    expect(history[1]?.status).toBe("accepted");
    // Deterministic ordering: bid history follows the event seq.
    expect(history.map((b) => b.eventSeq)).toEqual(
      [...history.map((b) => b.eventSeq)].sort((a, b) => a - b),
    );
  });

  it("unauthorized bidders are refused with evidence (manual-conduct gate)", async () => {
    const lot1 = await lotByPlayer(auction.id, "Kohli Local");
    expect(
      await placeBid(db, auction, outsider, {
        lotId: lot1.id,
        paddleId: paddleIds[0] as string,
        amountRaw: 6_000_000,
        bidderAuthorized: false,
      }),
    ).toEqual({ ok: false, code: "NOT_AUTHORIZED" });
  });

  it("sells to the leading paddle; a sold lot is terminal", async () => {
    const lot1 = await lotByPlayer(auction.id, "Kohli Local");
    const sold = await transitionLot(db, auction, lot1.id, owner, "sell");
    expect(sold).toEqual({ ok: true, status: "sold" });
    const after = await lotByPlayer(auction.id, "Kohli Local");
    expect(after.soldPrice).toBe(5_500_000);
    expect(after.soldToPaddleId).toBe(paddleIds[1]);
    // DA-01: the sale reaches the competition read model, not just the lot.
    // Without this the Teams tab, the roster export and the public page all
    // report that nobody was bought.
    expect(await registrationTeamOf(auction.id, "Kohli Local")).toBe(teamIds[1]);
    for (const command of ["open", "sell", "pass", "withdraw", "hold"] as const) {
      expect((await transitionLot(db, auction, lot1.id, owner, command)).ok).toBe(false);
    }
    // Bidding a sold lot is LOT_NOT_OPEN.
    expect(
      await placeBid(db, auction, owner, {
        lotId: lot1.id,
        paddleId: paddleIds[0] as string,
        amountRaw: 6_000_000,
        bidderAuthorized: true,
      }),
    ).toEqual({ ok: false, code: "LOT_NOT_OPEN" });
  });

  it("DA-01: undoing a sale withdraws the squad placement too, then re-selling restores it", async () => {
    const lot1 = await lotByPlayer(auction.id, "Kohli Local");
    expect(await registrationTeamOf(auction.id, "Kohli Local")).toBe(teamIds[1]);
    const undone = await undoLastAction(db, auction, owner, "wrong paddle");
    expect(undone).toMatchObject({ ok: true, lotId: lot1.id, kind: "sold" });
    // A roster that keeps a player the ledger says was never signed is the
    // failure mode that looks correct, so it never gets reported.
    expect(await registrationTeamOf(auction.id, "Kohli Local")).toBeNull();
    // Re-run the sale so the rest of the suite sees the state it expects.
    expect(
      await placeBid(db, auction, owner, {
        lotId: lot1.id,
        paddleId: paddleIds[1] as string,
        amountRaw: 5_500_000,
        bidderAuthorized: true,
      }),
    ).toMatchObject({ ok: true });
    expect(await transitionLot(db, auction, lot1.id, owner, "sell")).toEqual({
      ok: true,
      status: "sold",
    });
    expect(await registrationTeamOf(auction.id, "Kohli Local")).toBe(teamIds[1]);
  });

  it("pass requires NO leading bid; unsold requeues per policy until exhausted", async () => {
    const lot2 = await lotByPlayer(auction.id, "Sharma Local");
    expect((await transitionLot(db, auction, lot2.id, owner, "open")).ok).toBe(true);
    // sell without a bid is guard-refused; pass works.
    expect(await transitionLot(db, auction, lot2.id, owner, "sell")).toEqual({
      ok: false,
      reason: "guard_failed",
    });
    expect(await transitionLot(db, auction, lot2.id, owner, "pass")).toEqual({
      ok: true,
      status: "unsold",
    });
    // Requeue round 1 of 2 allowed.
    expect(await transitionLot(db, auction, lot2.id, owner, "requeue")).toEqual({
      ok: true,
      status: "queued",
    });
    expect((await lotByPlayer(auction.id, "Sharma Local")).roundsUsed).toBe(1);
    // Exhaust the policy → the guard closes.
    await db
      .update(lotsTable)
      .set({ status: "unsold", roundsUsed: 2 })
      .where(eq(lotsTable.id, lot2.id));
    expect(await transitionLot(db, auction, lot2.id, owner, "requeue")).toEqual({
      ok: false,
      reason: "guard_failed",
    });
    // Restore for the close walk below.
    await db
      .update(lotsTable)
      .set({ status: "queued", roundsUsed: 1 })
      .where(eq(lotsTable.id, lot2.id));
  });

  it("hold freezes a lot (invariant 17); frozen resolves without blocking the night", async () => {
    const lot2 = await lotByPlayer(auction.id, "Sharma Local");
    expect((await transitionLot(db, auction, lot2.id, owner, "open")).ok).toBe(true);
    expect(await transitionLot(db, auction, lot2.id, owner, "hold")).toEqual({
      ok: true,
      status: "frozen",
    });
    // The frozen lot does NOT hold the block: the next lot can open.
    const lot3 = await lotByPlayer(auction.id, "Patel Local");
    expect((await transitionLot(db, auction, lot3.id, owner, "open")).ok).toBe(true);
    expect((await transitionLot(db, auction, lot3.id, owner, "pass")).ok).toBe(true);
    // Frozen exits via the same guards (no leading bid → pass).
    expect(await transitionLot(db, auction, lot2.id, owner, "pass")).toEqual({
      ok: true,
      status: "unsold",
    });
  });

  it("withdraw is legal only pre-block; close is guard-blocked until all resolve", async () => {
    // Everything is resolved (sold / unsold / unsold) → complete works.
    const before = await transitionAuction(
      db,
      auction,
      owner,
      "complete",
      undefined,
      /* squads are deliberately tiny in this fixture — override DA-06 */ true,
    );
    expect(before.ok).toBe(true);
    auction = await freshAuction();
    expect(auction.status).toBe("completed");
    // Completed is terminal for conduct commands.
    expect((await transitionAuction(db, auction, owner, "pause")).ok).toBe(false);
    expect((await transitionAuction(db, auction, owner, "abort")).ok).toBe(false);
  });
});

describe("AUCTION FOUNDATION — events, audit, replay, recovery", () => {
  it("EVENT EMISSION: the log is a contiguous single-writer sequence", async () => {
    const events = await loadEvents(db, auction.id);
    expect(events.length).toBeGreaterThan(10);
    expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => i + 1));
    // Every event names its actor, instant and correlation.
    for (const event of events) {
      expect(event.actor.length).toBe(26);
      expect(event.correlationId.length).toBe(26);
      expect(event.atMs).toBeGreaterThan(0);
    }
  });

  it("AUDIT COMPLETENESS: every event has its audit row, correlated (who/what/when/why/source/correlation/evidence)", async () => {
    const events = await loadEvents(db, auction.id);
    const auditRows = await db
      .select({ action: auditLog.action, meta: auditLog.meta, actor: auditLog.actor })
      .from(auditLog)
      .where(and(eq(auditLog.scopeId, org.id), like(auditLog.action, "auction.%")));
    expect(auditRows.length).toBe(events.length);
    const byCorrelation = new Map<string, number>();
    for (const row of auditRows) {
      const meta = row.meta as { correlationId?: string; eventSeq?: string; source?: string };
      expect(meta.source).toBe("web");
      expect(meta.correlationId?.length).toBe(26);
      expect(Number(meta.eventSeq)).toBeGreaterThan(0);
      byCorrelation.set(
        meta.correlationId ?? "",
        (byCorrelation.get(meta.correlationId ?? "") ?? 0) + 1,
      );
    }
    // Every event's (correlation, seq) pair is present in the audit trail.
    for (const event of events) {
      expect(byCorrelation.has(event.correlationId)).toBe(true);
    }
  });

  it("REPLAY: folding the event log reproduces the persisted aggregates exactly", async () => {
    const events = await loadEvents(db, auction.id);
    const replay = replayAuction(events);
    expect(replay.ok).toBe(true);
    if (!replay.ok) {
      return;
    }
    expect(replay.projection.status).toBe("completed");
    const lot1 = await lotByPlayer(auction.id, "Kohli Local");
    expect(replay.projection.lots[lot1.id]).toMatchObject({
      status: "sold",
      soldAmount: 5_500_000,
      soldPaddleId: paddleIds[1],
      // Two on the way up, plus the re-bid after the DA-01 undo test voided
      // the first sale — invalidated bids stay in the log as evidence.
      bidCount: 3,
    });
    // Determinism: replaying twice gives the identical projection.
    expect(replayAuction(events)).toEqual(replay);
    // The recovery operation agrees: zero divergences.
    const report = await recoverAuction(db, auction, owner);
    expect(report.ok).toBe(true);
    expect(report.divergences).toEqual([]);
    expect(report.healed).toBe(false);
  });

  it("RECOVERY: a corrupted row projection is healed FROM the events", async () => {
    const lot1 = await lotByPlayer(auction.id, "Kohli Local");
    // Simulate a crash-corrupted projection: the sale vanishes from the rows.
    await db
      .update(lotsTable)
      .set({ status: "queued", soldPrice: null, soldToPaddleId: null })
      .where(eq(lotsTable.id, lot1.id));
    const report = await recoverAuction(db, auction, owner);
    expect(report.ok).toBe(true);
    expect(report.healed).toBe(true);
    expect(report.divergences.length).toBeGreaterThan(0);
    const healed = await lotByPlayer(auction.id, "Kohli Local");
    expect(healed.status).toBe("sold");
    expect(healed.soldPrice).toBe(5_500_000);
    expect(healed.soldToPaddleId).toBe(paddleIds[1]);
    // The recovery itself left evidence.
    const events = await loadEvents(db, auction.id);
    expect(events.filter((e) => e.type === "AuctionRecovered").length).toBeGreaterThanOrEqual(2);
  });

  it("RECOVERY FAILS CLOSED on a corrupted log (sequence gap) and heals nothing", async () => {
    const events = await loadEvents(db, auction.id);
    const victim = must(events[2], "third event");
    const [victimRow] = await db
      .select()
      .from(auctionEventsTable)
      .where(
        and(eq(auctionEventsTable.auctionId, auction.id), eq(auctionEventsTable.seq, victim.seq)),
      )
      .limit(1);
    await db
      .delete(auctionEventsTable)
      .where(
        and(eq(auctionEventsTable.auctionId, auction.id), eq(auctionEventsTable.seq, victim.seq)),
      );
    const report = await recoverAuction(db, auction, owner);
    expect(report.ok).toBe(false);
    expect(report.reason).toBe("sequence_gap");
    expect(report.healed).toBe(false);
    // Restore the log for the remaining assertions.
    await db.insert(auctionEventsTable).values(must(victimRow, "victim row"));
    expect((await recoverAuction(db, auction, owner)).ok).toBe(true);
  });

  it("ABORT freezes everything; a new auction may then be created", async () => {
    const comp2 = await createCompetition(db, org.id, owner, {
      name: `Abort League ${RUN}`,
      location: "Malad",
      startsOn: "2026-10-01",
      endsOn: "2026-10-30",
    });
    let current = must(await resolveCompetition(db, owner, comp2.slug), "comp2");
    for (const to of ["setup", "registration_open", "registration_closed"] as const) {
      expect((await advanceCompetition(db, current, owner, to)).ok).toBe(true);
      current = must(await resolveCompetition(db, owner, comp2.slug), "comp2");
    }
    await seedApproved(comp2.id, org.id, "Abort Player", "b01");
    await createTeam(db, org.id, comp2.id, owner, "Abort XI");
    await createTeam(db, org.id, comp2.id, owner, "Abort United");
    const ready = await auctionReady(db, current);
    expect(ready.ok).toBe(true);
    expect((await createAuction(db, current, ready, owner, DEFAULT_AUCTION_CONFIG)).ok).toBe(true);
    let auction2 = must(await auctionOf(db, comp2.id), "auction2");
    expect((await transitionAuction(db, auction2, owner, "abort", "venue lost power")).ok).toBe(
      true,
    );
    auction2 = must(await auctionOf(db, comp2.id), "auction2");
    expect(auction2.status).toBe("abandoned");
    // The abort reason is audited (the WHY of the audit model).
    const [abortAudit] = await db
      .select({ meta: auditLog.meta })
      .from(auditLog)
      .where(and(eq(auditLog.scopeId, org.id), eq(auditLog.action, "auction.AuctionAborted")))
      .limit(1);
    expect((abortAudit?.meta as { reason?: string }).reason).toBe("venue lost power");
    // Abandoned unblocks re-creation (the one exception to auction_exists).
    expect((await createAuction(db, current, ready, owner, DEFAULT_AUCTION_CONFIG)).ok).toBe(true);
  });
});

describe("AUCTION FOUNDATION — isolation", () => {
  it("capability: the owner conducts; the outsider cannot", async () => {
    const scope = { orgId: org.id, competitionId: comp.id };
    expect(await canCompetition(db, owner, scope, "auction.conduct")).toBe(true);
    expect(await canCompetition(db, outsider, scope, "auction.conduct")).toBe(false);
  });

  it("cross-tenant lot ids resolve to not_found (no probing across auctions)", async () => {
    expect(await transitionLot(db, auction, newId(), owner, "queue")).toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("RLS PROOF (auction tables): cross-tenant + no-context reads are empty", async () => {
    const role = `auc_rls_${RUN}`;
    await handle.sql.unsafe(`drop role if exists ${role}`);
    await handle.sql.unsafe(`create role ${role} login password 'probe' nosuperuser nobypassrls`);
    await handle.sql.unsafe(
      `grant select on auctions, paddles, lots, bids, auction_events to ${role}`,
    );
    const url = new URL(env.DATABASE_URL);
    const probeHandle = createDb(
      `postgres://${role}:probe@${url.hostname}:${url.port}${url.pathname}`,
    );
    const probe = probeHandle.sql;
    try {
      const visible = await probe.begin(async (tx) => {
        await tx`select set_config('app.org_id', ${org.id}, true)`;
        return tx`select * from auctions where org_id = ${org.id}`;
      });
      expect(visible.length).toBeGreaterThan(0);
      const cross = await probe.begin(async (tx) => {
        await tx`select set_config('app.org_id', ${orgRival.id}, true)`;
        return tx`select * from auction_events where org_id = ${org.id}`;
      });
      expect(cross.length).toBe(0);
      for (const table of ["auctions", "paddles", "lots", "bids", "auction_events"]) {
        expect((await probe.unsafe(`select * from ${table}`)).length).toBe(0);
      }
    } finally {
      await probe.end();
      await handle.sql.unsafe(`drop owned by ${role}`);
      await handle.sql.unsafe(`drop role if exists ${role}`);
    }
  });

  it("RLS WRITE PROOF: a cross-tenant event insert is rejected by WITH CHECK", async () => {
    const role = `auc_wrls_${RUN}`;
    await handle.sql.unsafe(`drop role if exists ${role}`);
    await handle.sql.unsafe(`create role ${role} login password 'probe' nosuperuser nobypassrls`);
    await handle.sql.unsafe(`grant select, insert on auction_events to ${role}`);
    const url = new URL(env.DATABASE_URL);
    const probeHandle = createDb(
      `postgres://${role}:probe@${url.hostname}:${url.port}${url.pathname}`,
    );
    const probe = probeHandle.sql;
    try {
      const cross = probe.begin(async (tx) => {
        await tx`select set_config('app.org_id', ${orgRival.id}, true)`;
        await tx`insert into auction_events(id, org_id, auction_id, seq, type, at_ms, actor, correlation_id, payload)
                 values (${newId()}::char(26), ${org.id}::char(26), ${auction.id}::char(26),
                         ${99_999}::int, ${"Forged"}::text, ${1}::bigint,
                         ${owner}::char(26), ${newId()}::char(26), ${"{}"}::jsonb)`;
      });
      await expect(cross).rejects.toThrow(/row-level security/);
    } finally {
      await probe.end();
      await handle.sql.unsafe(`drop owned by ${role}`);
      await handle.sql.unsafe(`drop role if exists ${role}`);
    }
  });

  it("single-writer order: a duplicate (auction, seq) fails loudly", async () => {
    const events = await loadEvents(db, auction.id);
    const last = must(events[events.length - 1], "last event");
    await expect(
      db.insert(auctionEventsTable).values({
        id: newId(),
        orgId: org.id,
        auctionId: auction.id,
        seq: last.seq, // collides with the total order
        type: "Forged",
        atMs: 1,
        actor: owner,
        correlationId: newId(),
        payload: {},
      }),
    ).rejects.toThrow();
  });
});
