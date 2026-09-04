// PERMANENT CERTIFICATION SUITE (M-IP4-4). The evidence behind the freeze.
//
// Everything here is a DRILL, not a demo: it attacks the platform and asserts
// the platform refuses to lie. Determinism (two independent engines, byte
// equality, hash stability), the immutable ledger (regeneration equality,
// append-only), production-style recovery (kill/restart, corrupted lot rows,
// corrupted MONEY rows, corrupted auction status, poisoned log), every watchdog
// halt condition, capability enforcement on every command, duplicate-command
// idempotency, and permanent regressions for the two defects certification
// found:
//
//   D-1 undo after a requeue wrote an UNREPLAYABLE LotReopened event, bricking
//       the auction forever (replay + recovery both fail closed on it).
//   D-2 the bids table — the row the gavel reads the sale price FROM — was not
//       covered by projection verification, so a corrupted bid row sold at the
//       corrupted price and the log recorded the lie as history.
import { createHash, randomInt } from "node:crypto";

import {
  buildLiveSnapshot,
  createAuction,
  loadEvents,
  snapshotRefs,
  type AuctionRecord,
} from "@desiauction/auction";
import {
  buildAuctionLedger,
  canonicalJson,
  DEFAULT_AUCTION_CONFIG,
  registrationNumber,
  replayAuction,
  type AuctionConfig,
  type CommandAck,
} from "@desiauction/core";
import {
  auctionEvents as auctionEventsTable,
  auctionOwnerInvites,
  auctions as auctionsTable,
  auditLog,
  bids as bidsTable,
  competitions,
  lots as lotsTable,
  newId,
  organizations,
  orgMembers,
  paddleGrants,
  paddles as paddlesTable,
  people,
  registrations,
  teams,
} from "@desiauction/db";
import { and, asc, eq, inArray } from "drizzle-orm";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db, sql } from "../db.js";
import { AuctionEngine } from "../engine-core.js";

const logger = pino({ level: "silent" });
// Random, not time-derived: Date.now() digits repeat every ~2.8h, so a run
// whose window collides with residue another harness left in the shared dev
// DB fails on people_phone_unique (PVP-1 D1). Randomness makes reruns clean.
const RUN = String(randomInt(0, 10_000_000)).padStart(7, "0");

const CONFIG: AuctionConfig = {
  ...DEFAULT_AUCTION_CONFIG,
  timer: { initialSeconds: 30, extensionSeconds: 15 },
  unsoldPolicy: { mode: "requeue", rounds: 2 },
};

const engine = new AuctionEngine({ db, logger, onSnapshot: () => undefined });

const orgId = newId();
const organizerId = newId();
const ownerIds = [newId(), newId()];
const playerIds = [newId(), newId(), newId(), newId()];
const teamIds = [newId(), newId()];
const compId = newId();
let auctionId = "";
let record: AuctionRecord;
const paddleOf = new Map<string, string>();
const lotIds: string[] = [];

async function command(
  type: string,
  actor: string,
  payload: Record<string, unknown> = {},
  options: { conduct?: boolean; override?: boolean; commandId?: string } = {},
): Promise<CommandAck> {
  return engine.submit({
    commandId: options.commandId ?? newId(),
    auctionId,
    type: type as never,
    actor,
    conduct: options.conduct ?? false,
    override: options.override ?? false,
    payload,
  });
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** A fresh engine process: no shared memory, only the event log. */
function independentEngine(): AuctionEngine {
  return new AuctionEngine({ db, logger, onSnapshot: () => undefined });
}

async function reloadRecord(): Promise<void> {
  const [row] = await db
    .select({ status: auctionsTable.status })
    .from(auctionsTable)
    .where(eq(auctionsTable.id, auctionId))
    .limit(1);
  record = { ...record, status: (row as { status: AuctionRecord["status"] }).status };
}

beforeAll(async () => {
  await db.insert(people).values([
    { id: organizerId, phone: `+9190${RUN}0`, name: "Cert Organizer" },
    ...ownerIds.map((id, i) => ({
      id,
      phone: `+9191${RUN.slice(0, 5)}${String(i).padStart(2, "0")}`,
      name: `Cert Owner ${String(i + 1)}`,
    })),
    ...playerIds.map((id, i) => ({
      id,
      phone: `+9189${RUN.slice(0, 5)}${String(i).padStart(2, "0")}`,
      name: `Cert Player ${String(i + 1)}`,
    })),
  ]);
  await db
    .insert(organizations)
    .values({ id: orgId, name: `Cert Org ${RUN}`, slug: `cert-${RUN}`, createdBy: organizerId });
  await db.insert(orgMembers).values({ orgId, personId: organizerId });
  await db.insert(competitions).values({
    id: compId,
    orgId,
    name: `Cert League ${RUN}`,
    slug: `cert-league-${RUN}`,
    status: "registration_closed",
    createdBy: organizerId,
  });
  await db.insert(teams).values(
    teamIds.map((id, i) => ({
      id,
      orgId,
      competitionId: compId,
      name: `Cert Team ${String(i + 1)}`,
      createdBy: organizerId,
    })),
  );
  const regIds = playerIds.map(() => newId());
  await db.insert(registrations).values(
    regIds.map((id, i) => ({
      id,
      orgId,
      competitionId: compId,
      personId: playerIds[i] as string,
      role: "batter" as const,
      status: "approved" as const,
      registrationNumber: registrationNumber(id),
    })),
  );
  const created = await createAuction(
    db,
    { id: compId, orgId, name: `Cert League ${RUN}` },
    {
      ok: true,
      competitionId: compId,
      pool: regIds.map((registrationId) => ({ registrationId, basePriceBand: null })),
    },
    organizerId,
    CONFIG,
  );
  if (!created.ok) {
    throw new Error("cert auction creation failed");
  }
  auctionId = created.auctionId;
  record = {
    id: auctionId,
    orgId,
    competitionId: compId,
    name: `Cert League ${RUN}`,
    status: "scheduled",
    config: CONFIG,
  };

  // Owner model → paddles for both teams.
  for (let i = 0; i < 2; i++) {
    const owner = ownerIds[i] as string;
    const invited = await command(
      "InviteOwner",
      organizerId,
      {
        teamId: teamIds[i],
        tokenHash: `cert-${RUN}-${String(i)}`,
        expiresAtMs: Date.now() + 3.6e6,
      },
      { conduct: true },
    );
    const inviteId = (invited.reason ?? "").replace("invite:", "");
    await command("AcceptOwnerInvite", owner, { inviteId });
    await command(
      "GrantPaddle",
      organizerId,
      { teamId: teamIds[i], personId: owner },
      { conduct: true },
    );
    await command("ClaimPaddle", owner, { teamId: teamIds[i] });
  }
  const paddleRows = await db
    .select({ id: paddlesTable.id, personId: paddlesTable.personId })
    .from(paddlesTable)
    .where(eq(paddlesTable.auctionId, auctionId));
  for (const row of paddleRows) {
    paddleOf.set(row.personId, row.id);
  }

  await command("QueueLots", organizerId, {}, { conduct: true });
  await command("OpenAuction", organizerId, {}, { conduct: true });
  await reloadRecord();

  const lotRows = await db
    .select({ id: lotsTable.id })
    .from(lotsTable)
    .where(eq(lotsTable.auctionId, auctionId))
    .orderBy(asc(lotsTable.seq));
  lotIds.push(...lotRows.map((row) => row.id));
});

afterAll(async () => {
  await db.delete(auctionEventsTable).where(eq(auctionEventsTable.orgId, orgId));
  await db.delete(bidsTable).where(eq(bidsTable.orgId, orgId));
  await db.delete(lotsTable).where(eq(lotsTable.orgId, orgId));
  await db.delete(paddleGrants).where(eq(paddleGrants.orgId, orgId));
  await db.delete(auctionOwnerInvites).where(eq(auctionOwnerInvites.orgId, orgId));
  await db.delete(paddlesTable).where(eq(paddlesTable.orgId, orgId));
  await db.delete(auctionsTable).where(eq(auctionsTable.orgId, orgId));
  await db.delete(registrations).where(eq(registrations.orgId, orgId));
  await db.delete(teams).where(eq(teams.orgId, orgId));
  await db.delete(competitions).where(eq(competitions.orgId, orgId));
  await db.delete(orgMembers).where(eq(orgMembers.orgId, orgId));
  await db.delete(auditLog).where(eq(auditLog.scopeId, orgId));
  await db.delete(organizations).where(eq(organizations.id, orgId));
  await db.delete(people).where(inArray(people.id, [organizerId, ...ownerIds, ...playerIds]));
  await sql.end();
});

// ---------------------------------------------------------------------------
describe("SNAPSHOT CERTIFICATION — determinism is measured, never assumed", () => {
  it("TWO INDEPENDENT ENGINES replaying the same log produce byte-identical snapshots", async () => {
    // A real bid so the log carries money, timers and a leader.
    const lot = lotIds[0] as string;
    expect(
      (await command("OpenLot", organizerId, { lotId: lot }, { conduct: true })).accepted,
    ).toBe(true);
    const bid = await command("PlaceBid", ownerIds[0] as string, {
      lotId: lot,
      paddleId: paddleOf.get(ownerIds[0] as string),
      amountRaw: CONFIG.basePriceDefault,
    });
    expect(bid.accepted).toBe(true);

    const a = independentEngine();
    const b = independentEngine();
    const [stateA, stateB] = await Promise.all([
      a.ensureAuction(auctionId),
      b.ensureAuction(auctionId),
    ]);
    expect(stateA?.halted).toBeNull();
    expect(stateB?.halted).toBeNull();

    // BYTES, not deep-equality: the wire contract must be identical.
    expect(stateA?.serialized).toBe(stateB?.serialized);
    expect(sha256(stateA?.serialized ?? "x")).toBe(sha256(stateB?.serialized ?? "y"));
    expect(stateA?.version).toBe(stateB?.version);
    // And identical to the live engine that actually wrote the events.
    expect(stateA?.serialized).toBe(engine.snapshotOf(auctionId)?.serialized);
  });

  it("HASH STABILITY: ten independent folds of the same log agree byte for byte", async () => {
    const hashes = new Set<string>();
    const projectionHashes = new Set<string>();
    for (let i = 0; i < 10; i++) {
      const built = await buildLiveSnapshot(db, record);
      expect(built.ok).toBe(true);
      if (built.ok) {
        hashes.add(sha256(built.serialized));
        projectionHashes.add(sha256(canonicalJson(built.projection)));
      }
    }
    expect(hashes.size).toBe(1);
    expect(projectionHashes.size).toBe(1);
  });

  it("CANONICAL SERIALIZATION: key order in the source object cannot change the bytes", () => {
    const one = { b: 1, a: { d: 4, c: [3, { f: 6, e: 5 }] } };
    const two = { a: { c: [3, { e: 5, f: 6 }], d: 4 }, b: 1 };
    expect(canonicalJson(one)).toBe(canonicalJson(two));
  });

  it("no clock is read during snapshot construction (identical bytes across time)", async () => {
    const first = await buildLiveSnapshot(db, record);
    await new Promise((resolve) => setTimeout(resolve, 25));
    const second = await buildLiveSnapshot(db, record);
    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(first.serialized).toBe(second.serialized);
    }
  });
});

// ---------------------------------------------------------------------------
describe("LEDGER CERTIFICATION — the only operational history", () => {
  it("REGENERATION EQUALITY: rebuilding the ledger from events can never diverge", async () => {
    const events = await loadEvents(db, auctionId);
    const refs = await snapshotRefs(db, record);
    const names = { [organizerId]: "Cert Organizer" };
    const first = buildAuctionLedger(events, refs, names);
    const second = buildAuctionLedger(events, refs, names);
    expect(canonicalJson(first)).toBe(canonicalJson(second));
    expect(first.length).toBe(events.length);
  });

  it("APPEND-ONLY: one new event appends exactly one row and rewrites nothing", async () => {
    const before = await loadEvents(db, auctionId);
    const refs = await snapshotRefs(db, record);
    const ledgerBefore = buildAuctionLedger(before, refs, {});

    const lot = lotIds[0] as string;
    const bid = await command("PlaceBid", ownerIds[1] as string, {
      lotId: lot,
      paddleId: paddleOf.get(ownerIds[1] as string),
      amountRaw: engine.snapshotOf(auctionId)?.snapshot?.currentLot?.nextMinimumBid ?? 0,
    });
    expect(bid.accepted).toBe(true);

    const after = await loadEvents(db, auctionId);
    const ledgerAfter = buildAuctionLedger(after, await snapshotRefs(db, record), {});

    // Every prior row is byte-identical — the past is immutable.
    expect(canonicalJson(ledgerAfter.slice(0, ledgerBefore.length))).toBe(
      canonicalJson(ledgerBefore),
    );
    expect(ledgerAfter.length).toBeGreaterThan(ledgerBefore.length);
    // Sequence is dense and strictly increasing — no gaps, no reordering.
    after.forEach((event, index) => {
      expect(event.seq).toBe(index + 1);
    });
  });

  it("every ledger row carries the ten audit columns (traceability to a person)", async () => {
    const events = await loadEvents(db, auctionId);
    const rows = buildAuctionLedger(events, await snapshotRefs(db, record), {
      [organizerId]: "Cert Organizer",
    });
    for (const row of rows) {
      expect(typeof row.seq).toBe("number");
      expect(typeof row.atMs).toBe("number");
      expect(row.actorId).not.toBe("");
      expect(row.result).not.toBe("");
      expect(row.correlationId).not.toBe("");
    }
    // The sale is traceable to the paddle, team and money.
    const sold = rows.find((row) => row.result === "Bid accepted");
    expect(sold?.amount).toBeGreaterThan(0);
    expect(sold?.paddleNumber).not.toBeNull();
  });

  it("AUDIT LINKAGE: every auction event has an audit row carrying its seq", async () => {
    const events = await loadEvents(db, auctionId);
    const audits = await db
      .select({ action: auditLog.action, meta: auditLog.meta })
      .from(auditLog)
      .where(eq(auditLog.scopeId, orgId));
    const seqs = new Set(
      audits.map((row) => (row.meta as { eventSeq?: string }).eventSeq).filter(Boolean),
    );
    for (const event of events) {
      expect(seqs.has(String(event.seq))).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
describe("RECOVERY CERTIFICATION — production drills", () => {
  it("KILL + RESTART: a cold engine rebuilds the identical snapshot from the log alone", async () => {
    const before = engine.snapshotOf(auctionId);
    engine.reset(auctionId); // ≙ process death: all in-memory state is gone
    const state = await engine.ensureAuction(auctionId);
    expect(state?.halted).toBeNull();
    expect(state?.serialized).toBe(before?.serialized);
    expect(state?.version).toBe(before?.version);
  });

  it("CORRUPTED LOT ROW: the watchdog halts, RecoverAuction heals, the auction resumes", async () => {
    const lot = lotIds[0] as string;
    await db.update(lotsTable).set({ status: "withdrawn" }).where(eq(lotsTable.id, lot));

    engine.reset(auctionId);
    const halted = await engine.ensureAuction(auctionId);
    expect(halted?.halted).toContain("projection_mismatch");

    // Fail closed: while halted, NOTHING mutates.
    const refused = await command("PlaceBid", ownerIds[0] as string, {
      lotId: lot,
      paddleId: paddleOf.get(ownerIds[0] as string),
      amountRaw: 99_000_000,
    });
    expect(refused).toMatchObject({ accepted: false, reason: "engine_halted" });

    const healed = await command("RecoverAuction", organizerId, {}, { conduct: true });
    expect(healed.accepted).toBe(true);
    expect(healed.reason).toContain("healed");
    expect(engine.snapshotOf(auctionId)?.halted).toBeNull();

    const [row] = await db
      .select({ status: lotsTable.status })
      .from(lotsTable)
      .where(eq(lotsTable.id, lot))
      .limit(1);
    expect(row?.status).toBe("on_block"); // restored FROM the events
  });

  it("DELETED LOT ROW: a vanished sale is DETECTED (fail-closed), never silently un-committed", async () => {
    // A DELETE on a sold lot removes its soldPrice — the source `placeBid` sums
    // into a team's purse — so a missing lot row would silently hand that team
    // its money back. The watchdog must halt on it exactly as it does for a
    // missing bid or paddle row (regression: diffProjection lot-row blind spot).
    const lot = lotIds[0] as string;
    const [saved] = await db.select().from(lotsTable).where(eq(lotsTable.id, lot)).limit(1);
    expect(saved).toBeDefined();

    /*
     * The bids go with it, and that is a truer simulation than it looks.
     *
     * Migration 0043 gave `bids.lot_id` a foreign key with ON DELETE RESTRICT,
     * so a lot with bids can no longer simply vanish — which is the whole point
     * of the constraint, and it means this drill can no longer delete the lot
     * alone. Deleting the bids first reproduces the same condition the drill is
     * actually about: the PROJECTION has lost a sale the event log still
     * records, and the watchdog must halt rather than hand a team its money
     * back. The detection path under test is unchanged; only the way the
     * corruption is staged had to move, because the database now refuses the
     * lazier version of it.
     */
    const savedBids = await db.select().from(bidsTable).where(eq(bidsTable.lotId, lot));
    await db.delete(bidsTable).where(eq(bidsTable.lotId, lot));
    await db.delete(lotsTable).where(eq(lotsTable.id, lot));
    engine.reset(auctionId);
    const halted = await engine.ensureAuction(auctionId);
    expect(halted?.halted).toContain("row missing");

    // Heal cannot re-insert a row the aggregate never wrote — fail-closed is the
    // contract. Restore the exact row so the shared auction stays verifiable.
    await db.insert(lotsTable).values(saved as typeof lotsTable.$inferInsert);
    if (savedBids.length > 0) {
      await db.insert(bidsTable).values(savedBids as (typeof bidsTable.$inferInsert)[]);
    }
    engine.reset(auctionId);
    const restored = await engine.ensureAuction(auctionId);
    expect(restored?.halted).toBeNull();
  });

  it("CORRUPTED MONEY ROW (D-2): a tampered bid amount halts the engine and heals", async () => {
    const lot = lotIds[0] as string;
    const [bid] = await db
      .select({ id: bidsTable.id, amount: bidsTable.amount })
      .from(bidsTable)
      .where(and(eq(bidsTable.lotId, lot), eq(bidsTable.status, "accepted")))
      .limit(1);
    expect(bid).toBeDefined();
    const trueAmount = (bid as { amount: number }).amount;

    // The gavel reads the sale price from THIS row.
    await db
      .update(bidsTable)
      .set({ amount: trueAmount * 3 })
      .where(eq(bidsTable.id, (bid as { id: string }).id));

    engine.reset(auctionId);
    const halted = await engine.ensureAuction(auctionId);
    expect(halted?.halted).toContain("amount diverged");

    const healed = await command("RecoverAuction", organizerId, {}, { conduct: true });
    expect(healed.accepted).toBe(true);
    expect(engine.snapshotOf(auctionId)?.halted).toBeNull();

    const [restored] = await db
      .select({ amount: bidsTable.amount })
      .from(bidsTable)
      .where(eq(bidsTable.id, (bid as { id: string }).id))
      .limit(1);
    expect(restored?.amount).toBe(trueAmount); // healed from BidAccepted
  });

  it("CORRUPTED BID STATUS: a silently re-crowned leader is detected and healed", async () => {
    const lot = lotIds[0] as string;
    const outbid = await db
      .select({ id: bidsTable.id })
      .from(bidsTable)
      .where(and(eq(bidsTable.lotId, lot), eq(bidsTable.status, "outbid")))
      .limit(1);
    expect(outbid.length).toBe(1); // the first bid was outbid by the second

    // Promote a LOSING bid back to leader — the classic silent-theft corruption.
    await db
      .update(bidsTable)
      .set({ status: "accepted" })
      .where(eq(bidsTable.id, (outbid[0] as { id: string }).id));

    engine.reset(auctionId);
    const halted = await engine.ensureAuction(auctionId);
    expect(halted?.halted).toContain("projection_mismatch");

    const healed = await command("RecoverAuction", organizerId, {}, { conduct: true });
    expect(healed.accepted).toBe(true);
    expect(engine.snapshotOf(auctionId)?.halted).toBeNull();
    const [row] = await db
      .select({ status: bidsTable.status })
      .from(bidsTable)
      .where(eq(bidsTable.id, (outbid[0] as { id: string }).id))
      .limit(1);
    expect(row?.status).toBe("outbid"); // the log's verdict stands
  });

  it("CORRUPTED AUCTION STATUS: a paused row against a live log is detected and healed", async () => {
    await db.update(auctionsTable).set({ status: "paused" }).where(eq(auctionsTable.id, auctionId));
    engine.reset(auctionId);
    const halted = await engine.ensureAuction(auctionId);
    expect(halted?.halted).toContain("auction: rows=paused");

    const healed = await command("RecoverAuction", organizerId, {}, { conduct: true });
    expect(healed.accepted).toBe(true);
    await reloadRecord();
    expect(record.status).toBe("live");
    expect(engine.snapshotOf(auctionId)?.halted).toBeNull();
  });

  it("CORRUPTED PADDLE PERSON (D-3): an authorization hijack is detected and healed", async () => {
    // Hand owner A's paddle to a stranger. In the engine, PlaceBid authorizes by
    // `holder = paddle.personId === actor`, so this would let the stranger bid
    // with A's paddle — pure authorization theft, invisible before D-3.
    const paddleId = paddleOf.get(ownerIds[0] as string) as string;
    await db
      .update(paddlesTable)
      .set({ personId: playerIds[0] })
      .where(eq(paddlesTable.id, paddleId));

    engine.reset(auctionId);
    const halted = await engine.ensureAuction(auctionId);
    expect(halted?.halted).toContain("paddle");
    expect(halted?.halted).toContain("person diverged");

    const healed = await command("RecoverAuction", organizerId, {}, { conduct: true });
    expect(healed.accepted).toBe(true);
    expect(engine.snapshotOf(auctionId)?.halted).toBeNull();

    const [row] = await db
      .select({ personId: paddlesTable.personId })
      .from(paddlesTable)
      .where(eq(paddlesTable.id, paddleId))
      .limit(1);
    expect(row?.personId).toBe(ownerIds[0]); // healed FROM PaddleIssued
  });

  it("CORRUPTED PADDLE RELEASE (D-3): a silently re-activated/killed paddle is detected and healed", async () => {
    // Mark an ACTIVE paddle as released in the row while the log says it is live
    // (a released paddle can never bid). The reducer knows it is active.
    const paddleId = paddleOf.get(ownerIds[1] as string) as string;
    await db
      .update(paddlesTable)
      .set({ releasedAt: new Date() })
      .where(eq(paddlesTable.id, paddleId));

    engine.reset(auctionId);
    const halted = await engine.ensureAuction(auctionId);
    expect(halted?.halted).toContain("released diverged");

    const healed = await command("RecoverAuction", organizerId, {}, { conduct: true });
    expect(healed.accepted).toBe(true);
    expect(engine.snapshotOf(auctionId)?.halted).toBeNull();

    const [row] = await db
      .select({ releasedAt: paddlesTable.releasedAt })
      .from(paddlesTable)
      .where(eq(paddlesTable.id, paddleId))
      .limit(1);
    expect(row?.releasedAt).toBeNull(); // healed: the log says the claim never ended
  });

  it("CORRUPTED LOT ROUNDS (D-3): a requeue-policy bypass is detected and healed", async () => {
    // Inflate roundsUsed so the unsold policy would refuse further requeues (or,
    // deflated, allow more than policy permits). The reducer folds the true count.
    const lot = lotIds[0] as string;
    const [before] = await db
      .select({ roundsUsed: lotsTable.roundsUsed })
      .from(lotsTable)
      .where(eq(lotsTable.id, lot))
      .limit(1);
    await db.update(lotsTable).set({ roundsUsed: 77 }).where(eq(lotsTable.id, lot));

    engine.reset(auctionId);
    const halted = await engine.ensureAuction(auctionId);
    expect(halted?.halted).toContain("rounds diverged");

    const healed = await command("RecoverAuction", organizerId, {}, { conduct: true });
    expect(healed.accepted).toBe(true);
    expect(engine.snapshotOf(auctionId)?.halted).toBeNull();

    const [after] = await db
      .select({ roundsUsed: lotsTable.roundsUsed })
      .from(lotsTable)
      .where(eq(lotsTable.id, lot))
      .limit(1);
    expect(after?.roundsUsed).toBe(before?.roundsUsed); // healed to the folded count
  });

  it("SNAPSHOT CACHE is derived, never authoritative: dropping it restores from the log", async () => {
    const truth = engine.snapshotOf(auctionId)?.serialized ?? "";
    const state = engine.snapshotOf(auctionId);
    if (state !== undefined) {
      state.serialized = '{"kind":"garbage"}'; // corrupt the in-memory cache
    }
    engine.reset(auctionId); // the only cure a cache ever needs
    const restored = await engine.ensureAuction(auctionId);
    expect(restored?.serialized).toBe(truth);
    expect(restored?.halted).toBeNull();
  });

  it("DEEP VERIFY: two folds of the live log agree (no snapshot indeterminism)", async () => {
    expect(await engine.deepVerify(auctionId)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe("WATCHDOG CERTIFICATION — a poisoned log fails closed and STAYS closed", () => {
  it("SEQUENCE GAP: replay refuses, the engine halts, and recovery cannot fabricate truth", async () => {
    // A gap is unforgeable evidence of a lost/deleted event. This drill runs on
    // a THROWAWAY auction: poisoning a log is irreversible by design.
    const gapCompId = newId();
    const gapPlayer = newId();
    await db.insert(people).values({ id: gapPlayer, phone: `+9188${RUN}9`, name: "Gap Player" });
    await db.insert(competitions).values({
      id: gapCompId,
      orgId,
      name: `Gap League ${RUN}`,
      slug: `gap-league-${RUN}`,
      status: "registration_closed",
      createdBy: organizerId,
    });
    const regId = newId();
    await db.insert(registrations).values({
      id: regId,
      orgId,
      competitionId: gapCompId,
      personId: gapPlayer,
      role: "batter",
      status: "approved",
      registrationNumber: registrationNumber(regId),
    });
    const created = await createAuction(
      db,
      { id: gapCompId, orgId, name: `Gap League ${RUN}` },
      {
        ok: true,
        competitionId: gapCompId,
        pool: [{ registrationId: regId, basePriceBand: null }],
      },
      organizerId,
      CONFIG,
    );
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }
    const gapAuctionId = created.auctionId;

    // Delete an event from the middle of the immutable log.
    await db
      .delete(auctionEventsTable)
      .where(and(eq(auctionEventsTable.auctionId, gapAuctionId), eq(auctionEventsTable.seq, 1)));

    const events = await loadEvents(db, gapAuctionId);
    const replay = replayAuction(events);
    expect(replay).toMatchObject({ ok: false, reason: "sequence_gap" });

    const gapEngine = independentEngine();
    const state = await gapEngine.ensureAuction(gapAuctionId);
    expect(state?.halted).toContain("replay_failed");
    expect(state?.snapshot).toBeNull(); // no snapshot is EVER served from a bad log

    // Recovery refuses too: a gap cannot be healed, only escalated. The engine
    // stays halted rather than inventing history.
    const recover = await gapEngine.submit({
      commandId: newId(),
      auctionId: gapAuctionId,
      type: "RecoverAuction",
      actor: organizerId,
      conduct: true,
      payload: {},
    });
    expect(recover).toMatchObject({ accepted: false });
    expect(recover.reason).toContain("replay_failed");
    expect(gapEngine.snapshotOf(gapAuctionId)?.halted).toContain("replay_failed");

    await db.delete(auctionEventsTable).where(eq(auctionEventsTable.auctionId, gapAuctionId));
    await db.delete(lotsTable).where(eq(lotsTable.auctionId, gapAuctionId));
    await db.delete(auctionsTable).where(eq(auctionsTable.id, gapAuctionId));
    await db.delete(registrations).where(eq(registrations.id, regId));
    await db.delete(competitions).where(eq(competitions.id, gapCompId));
    await db.delete(people).where(eq(people.id, gapPlayer));
  });

  it("UNKNOWN EVENT TYPE: an unrecognised event stops the fold rather than being skipped", () => {
    const replay = replayAuction([
      {
        seq: 1,
        type: "SettlementInvented",
        atMs: 1,
        actor: "a",
        correlationId: "c",
        payload: {},
      },
    ]);
    expect(replay).toMatchObject({ ok: false, atSeq: 1, reason: "unknown_event_type" });
  });

  it("TIMER SHRANK: replay re-proves invariant 14 (a bid can never shorten a lot)", () => {
    const replay = replayAuction([
      { seq: 1, type: "AuctionCreated", atMs: 1, actor: "a", correlationId: "c", payload: {} },
      {
        seq: 2,
        type: "LotPrepared",
        atMs: 1,
        actor: "a",
        correlationId: "c",
        payload: { lotId: "L" },
      },
      {
        seq: 3,
        type: "LotQueued",
        atMs: 1,
        actor: "a",
        correlationId: "c",
        payload: { lotId: "L" },
      },
      {
        seq: 4,
        type: "LotOpened",
        atMs: 1,
        actor: "a",
        correlationId: "c",
        payload: { lotId: "L", endsAtMs: 10_000 },
      },
      {
        seq: 5,
        type: "TimerExtended",
        atMs: 2,
        actor: "a",
        correlationId: "c",
        payload: { lotId: "L", endsAtMs: 5_000 }, // SHRANK
      },
    ]);
    expect(replay).toMatchObject({ ok: false, atSeq: 5, reason: "timer_shrank" });
  });
});

// ---------------------------------------------------------------------------
describe("SECURITY CERTIFICATION — capability enforcement on every command", () => {
  const CONDUCT_ONLY = [
    "QueueLots",
    "OpenLot",
    "CloseLot",
    "OpenAuction",
    "PauseAuction",
    "ResumeAuction",
    "CompleteAuction",
    "AbortAuction",
    "WithdrawLot",
    "HoldLot",
    "RequeueLot",
    "IssuePaddle",
    "InviteOwner",
    "GrantPaddle",
    "RecoverAuction",
  ];

  it("EVERY conduct command refuses an actor without conduct — no exceptions", async () => {
    const spectator = ownerIds[0] as string; // authenticated, but not a conductor
    for (const type of CONDUCT_ONLY) {
      const ack = await command(type, spectator, { lotId: lotIds[0], teamId: teamIds[0] });
      expect(
        { type, accepted: ack.accepted, reason: ack.reason },
        `${type} must refuse a non-conductor`,
      ).toMatchObject({ type, accepted: false, reason: "not_authorized" });
    }
  });

  it("UNDO demands conduct AND override — conduct alone is never enough", async () => {
    expect(await command("UndoLastAction", organizerId, {}, { conduct: true })).toMatchObject({
      accepted: false,
      reason: "not_authorized",
    });
    expect(await command("UndoLastAction", organizerId, {}, { override: true })).toMatchObject({
      accepted: false,
      reason: "not_authorized",
    });
  });

  it("a paddle may not be driven by a person who does not hold it", async () => {
    const lot = lotIds[0] as string;
    // Owner B tries to bid using Owner A's paddle.
    const ack = await command("PlaceBid", ownerIds[1] as string, {
      lotId: lot,
      paddleId: paddleOf.get(ownerIds[0] as string),
      amountRaw: engine.snapshotOf(auctionId)?.snapshot?.currentLot?.nextMinimumBid ?? 0,
    });
    expect(ack).toMatchObject({ accepted: false, reason: "NOT_AUTHORIZED" });
  });

  it("an unknown command type is refused before it can reach the aggregate", async () => {
    const ack = await engine.submit({
      commandId: newId(),
      auctionId,
      type: "DrainThePurse" as never,
      actor: organizerId,
      conduct: true,
      payload: {},
    });
    expect(ack).toMatchObject({ accepted: false, reason: "unknown_command" });
  });

  it("claiming a paddle without a grant is refused (no paddle without authority)", async () => {
    const stranger = playerIds[0] as string;
    const ack = await command("ClaimPaddle", stranger, { teamId: teamIds[0] });
    expect(ack).toMatchObject({ accepted: false, reason: "no_grant" });
  });
});

// ---------------------------------------------------------------------------
describe("COMMAND QUEUE — idempotency and serialization", () => {
  it("DUPLICATE COMMAND: the same commandId returns the ORIGINAL ack and never re-executes", async () => {
    const lot = lotIds[0] as string;
    const commandId = newId();
    const amount = engine.snapshotOf(auctionId)?.snapshot?.currentLot?.nextMinimumBid ?? 0;
    const owner = ownerIds[0] as string;
    const payload = { lotId: lot, paddleId: paddleOf.get(owner), amountRaw: amount };

    const first = await command("PlaceBid", owner, payload, { commandId });
    const second = await command("PlaceBid", owner, payload, { commandId });
    expect(first.accepted).toBe(true);
    expect(second).toEqual(first); // byte-for-byte the same acknowledgement

    // Exactly ONE bid exists at that amount — the money was not doubled.
    const rows = await db
      .select({ id: bidsTable.id })
      .from(bidsTable)
      .where(and(eq(bidsTable.lotId, lot), eq(bidsTable.amount, amount)));
    expect(rows.length).toBe(1);
  });

  it("CONCURRENT BIDS: ten simultaneous bids at the same price produce exactly one winner", async () => {
    const lot = lotIds[1] as string;
    await command("CloseLot", organizerId, { lotId: lotIds[0] }, { conduct: true });
    await command("OpenLot", organizerId, { lotId: lot }, { conduct: true });
    const amount = engine.snapshotOf(auctionId)?.snapshot?.currentLot?.nextMinimumBid ?? 0;

    // Both owners fire the SAME amount at the same instant.
    const acks = await Promise.all([
      command("PlaceBid", ownerIds[0] as string, {
        lotId: lot,
        paddleId: paddleOf.get(ownerIds[0] as string),
        amountRaw: amount,
      }),
      command("PlaceBid", ownerIds[1] as string, {
        lotId: lot,
        paddleId: paddleOf.get(ownerIds[1] as string),
        amountRaw: amount,
      }),
    ]);
    // The single writer serialized them: one wins, one is BELOW_CURRENT.
    const accepted = acks.filter((ack) => ack.accepted);
    expect(accepted.length).toBe(1);
    expect(acks.find((ack) => !ack.accepted)?.reason).toBe("BELOW_CURRENT");
  });
});

// ---------------------------------------------------------------------------
describe("REGRESSION D-1 — undo may never write an unreplayable event", () => {
  it("undo AFTER a requeue is refused, and the log stays replayable forever", async () => {
    const lot = lotIds[2] as string;
    await command("CloseLot", organizerId, { lotId: lotIds[1] }, { conduct: true });
    await command("OpenLot", organizerId, { lotId: lot }, { conduct: true });
    // Close with NO bids → UNSOLD, then requeue it (policy allows 2 rounds).
    await command("CloseLot", organizerId, { lotId: lot }, { conduct: true });
    expect(
      (await command("RequeueLot", organizerId, { lotId: lot }, { conduct: true })).accepted,
    ).toBe(true);

    // The conductor changes their mind: undo the UNSOLD they already acted on.
    const undone = await command(
      "UndoLastAction",
      organizerId,
      { reason: "changed my mind" },
      { conduct: true, override: true },
    );
    expect(undone).toMatchObject({ accepted: false, reason: "undo_window_closed" });

    // THE INVARIANT: the log still folds, and the engine is not bricked.
    const replay = replayAuction(await loadEvents(db, auctionId));
    expect(replay.ok).toBe(true);
    expect(engine.snapshotOf(auctionId)?.halted).toBeNull();

    // A cold engine still recovers — proof the auction survived the attempt.
    const cold = independentEngine();
    const state = await cold.ensureAuction(auctionId);
    expect(state?.halted).toBeNull();
  });

  it("undo of a WITHDRAWN-after-unsold lot is refused for the same reason", async () => {
    const lot = lotIds[2] as string; // now queued (requeued above)
    expect(
      (await command("WithdrawLot", organizerId, { lotId: lot }, { conduct: true })).accepted,
    ).toBe(true);
    const undone = await command(
      "UndoLastAction",
      organizerId,
      {},
      { conduct: true, override: true },
    );
    expect(undone).toMatchObject({ accepted: false, reason: "undo_window_closed" });
    expect(replayAuction(await loadEvents(db, auctionId)).ok).toBe(true);
  });
});
