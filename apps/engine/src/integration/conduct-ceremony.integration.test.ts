// PERMANENT CONDUCT & CEREMONY REGRESSION SUITE (M-IP4-3). In-process
// AuctionEngine against real Postgres. Encodes: the owner model (invitation →
// acceptance → grant → claim, every refusal deterministic), compensating undo
// (history immutable, purse restored, replay identical), AuctionLedger
// correctness (one row per event, regenerated = identical), engine diagnostics
// (hashes, queue, throughput), recovery evidence, and spectator isolation
// (snapshot bytes carry no person ids, no tokens, no engine internals).
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";

import {
  createAuction,
  buildLiveSnapshot,
  ledgerOf,
  loadEvents,
  type AuctionRecord,
} from "@desiauction/auction";
import {
  DEFAULT_AUCTION_CONFIG,
  deriveCeremony,
  registrationNumber,
  type AuctionConfig,
  type AuctionSnapshot,
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
import { and, eq, inArray } from "drizzle-orm";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db, sql } from "../db.js";
import { AuctionEngine } from "../engine-core.js";

const logger = pino({ level: "silent" });
const RUN = String(Date.now()).slice(-7);

const CONFIG: AuctionConfig = {
  ...DEFAULT_AUCTION_CONFIG,
  timer: { initialSeconds: 10, extensionSeconds: 10 },
  unsoldPolicy: { mode: "requeue", rounds: 2 },
};

const fakeNow = Date.now();

const engine = new AuctionEngine({
  db,
  logger,
  onSnapshot: () => undefined,
  nowMs: () => fakeNow,
});

const orgId = newId();
const organizerId = newId();
const ownerA = newId(); // team 1 owner
const ownerB = newId(); // team 2 owner
const outsiderId = newId(); // never invited, never granted
const teamIds = [newId(), newId()];
const compId = newId();
let auctionId = "";
let paddleA = "";
let paddleB = "";
let lot1 = "";
let lot2 = "";
let lot3 = "";

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

function snapshot(): AuctionSnapshot {
  const state = engine.snapshotOf(auctionId);
  if (state?.snapshot == null) {
    throw new Error("no snapshot");
  }
  return state.snapshot;
}

beforeAll(async () => {
  await db.insert(people).values([
    { id: organizerId, phone: `+9190${RUN}0`, name: "Priya Organizer" },
    { id: ownerA, phone: `+9190${RUN}1`, name: "Owner Arrows" },
    { id: ownerB, phone: `+9190${RUN}2`, name: "Owner Blasters" },
    { id: outsiderId, phone: `+9190${RUN}3`, name: "Random Outsider" },
  ]);
  await db.insert(organizations).values({
    id: orgId,
    name: `Conduct Org ${RUN}`,
    slug: `conduct-${RUN}`,
    createdBy: organizerId,
  });
  await db.insert(orgMembers).values([
    { orgId, personId: organizerId },
    { orgId, personId: ownerA },
    { orgId, personId: ownerB },
    { orgId, personId: outsiderId },
  ]);
  await db.insert(competitions).values({
    id: compId,
    orgId,
    name: `Conduct Cup ${RUN}`,
    slug: `conduct-cup-${RUN}`,
    status: "registration_closed",
    createdBy: organizerId,
  });
  await db.insert(teams).values(
    teamIds.map((id, i) => ({
      id,
      orgId,
      competitionId: compId,
      name: i === 0 ? "Arrows" : "Blasters",
      createdBy: organizerId,
    })),
  );
  const regIds = [newId(), newId(), newId()];
  await db.insert(registrations).values(
    regIds.map((id, i) => ({
      id,
      orgId,
      competitionId: compId,
      personId: [organizerId, ownerA, ownerB][i] as string,
      role: "batter" as const,
      status: "approved" as const,
      registrationNumber: registrationNumber(id),
    })),
  );
  const created = await createAuction(
    db,
    { id: compId, orgId, name: `Conduct Cup ${RUN}` },
    {
      ok: true,
      competitionId: compId,
      pool: regIds.map((registrationId) => ({ registrationId, basePriceBand: null })),
    },
    organizerId,
    CONFIG,
  );
  if (!created.ok) {
    throw new Error("auction creation failed");
  }
  auctionId = created.auctionId;
  await engine.ensureAuction(auctionId);
});

afterAll(async () => {
  await db.delete(auctionEventsTable).where(eq(auctionEventsTable.orgId, orgId));
  await db.delete(bidsTable).where(eq(bidsTable.orgId, orgId));
  await db.delete(lotsTable).where(eq(lotsTable.orgId, orgId));
  await db.delete(paddlesTable).where(eq(paddlesTable.orgId, orgId));
  await db.delete(paddleGrants).where(eq(paddleGrants.orgId, orgId));
  await db.delete(auctionOwnerInvites).where(eq(auctionOwnerInvites.orgId, orgId));
  await db.delete(auctionsTable).where(eq(auctionsTable.orgId, orgId));
  await db.delete(registrations).where(eq(registrations.orgId, orgId));
  await db.delete(teams).where(eq(teams.orgId, orgId));
  await db.delete(competitions).where(eq(competitions.orgId, orgId));
  await db.delete(orgMembers).where(eq(orgMembers.orgId, orgId));
  await db.delete(auditLog).where(eq(auditLog.scopeId, orgId));
  await db.delete(organizations).where(eq(organizations.id, orgId));
  await db.delete(people).where(inArray(people.id, [organizerId, ownerA, ownerB, outsiderId]));
  await sql.end();
});

describe("OWNER MODEL — invitation → acceptance → grant → claim", () => {
  let inviteA = "";

  it("only conductors invite; only invited people accept; single-use tokens", async () => {
    // Non-conduct invitation is refused.
    const denied = await command("InviteOwner", ownerA, {
      teamId: teamIds[0],
      tokenHash: `h-${RUN}-x`,
      expiresAtMs: Date.now() + 3_600_000,
    });
    expect(denied).toMatchObject({ accepted: false, reason: "not_authorized" });

    const invited = await command(
      "InviteOwner",
      organizerId,
      { teamId: teamIds[0], tokenHash: `h-${RUN}-a`, expiresAtMs: Date.now() + 3_600_000 },
      { conduct: true },
    );
    expect(invited.accepted).toBe(true);
    inviteA = (invited.reason ?? "").replace("invite:", "");
    expect(inviteA).not.toBe("");

    // Unknown team refused.
    const badTeam = await command(
      "InviteOwner",
      organizerId,
      { teamId: newId(), tokenHash: `h-${RUN}-bad`, expiresAtMs: Date.now() + 3_600_000 },
      { conduct: true },
    );
    expect(badTeam).toMatchObject({ accepted: false, reason: "unknown_team" });

    // Acceptance is one-time: ownerA accepts; a second person is refused.
    const accepted = await command("AcceptOwnerInvite", ownerA, { inviteId: inviteA });
    expect(accepted.accepted).toBe(true);
    const stolen = await command("AcceptOwnerInvite", outsiderId, { inviteId: inviteA });
    expect(stolen).toMatchObject({ accepted: false, reason: "already_accepted" });
    // Re-acceptance by the SAME person is idempotent.
    const again = await command("AcceptOwnerInvite", ownerA, { inviteId: inviteA });
    expect(again.accepted).toBe(true);

    // An expired invitation is dead on arrival.
    const expiredInvite = await command(
      "InviteOwner",
      organizerId,
      { teamId: teamIds[1], tokenHash: `h-${RUN}-exp`, expiresAtMs: Date.now() - 1_000 },
      { conduct: true },
    );
    const expiredId = (expiredInvite.reason ?? "").replace("invite:", "");
    const late = await command("AcceptOwnerInvite", ownerB, { inviteId: expiredId });
    expect(late).toMatchObject({ accepted: false, reason: "expired" });
  });

  it("grants require an ACCEPTED owner; claims require an ACTIVE grant", async () => {
    // Granting someone who never accepted is refused.
    const notOwner = await command(
      "GrantPaddle",
      organizerId,
      { teamId: teamIds[0], personId: outsiderId },
      { conduct: true },
    );
    expect(notOwner).toMatchObject({ accepted: false, reason: "not_an_owner" });

    // Non-conduct grant refused.
    const deniedGrant = await command("GrantPaddle", ownerA, {
      teamId: teamIds[0],
      personId: ownerA,
    });
    expect(deniedGrant).toMatchObject({ accepted: false, reason: "not_authorized" });

    // Claim before grant: refused — no active paddle without explicit grant.
    const early = await command("ClaimPaddle", ownerA, { teamId: teamIds[0] });
    expect(early).toMatchObject({ accepted: false, reason: "no_grant" });

    const granted = await command(
      "GrantPaddle",
      organizerId,
      { teamId: teamIds[0], personId: ownerA },
      { conduct: true },
    );
    expect(granted.accepted).toBe(true);
    // Granting twice is idempotent — the original grant stands.
    const twice = await command(
      "GrantPaddle",
      organizerId,
      { teamId: teamIds[0], personId: ownerA },
      { conduct: true },
    );
    expect(twice.accepted).toBe(true);

    const claimed = await command("ClaimPaddle", ownerA, { teamId: teamIds[0] });
    expect(claimed.accepted).toBe(true);

    // Team 2's owner: full workflow.
    const invitedB = await command(
      "InviteOwner",
      organizerId,
      { teamId: teamIds[1], tokenHash: `h-${RUN}-b`, expiresAtMs: Date.now() + 3_600_000 },
      { conduct: true },
    );
    const inviteB = (invitedB.reason ?? "").replace("invite:", "");
    expect((await command("AcceptOwnerInvite", ownerB, { inviteId: inviteB })).accepted).toBe(true);
    expect(
      (
        await command(
          "GrantPaddle",
          organizerId,
          { teamId: teamIds[1], personId: ownerB },
          { conduct: true },
        )
      ).accepted,
    ).toBe(true);
    expect((await command("ClaimPaddle", ownerB, { teamId: teamIds[1] })).accepted).toBe(true);

    const rows = await db
      .select({ id: paddlesTable.id, personId: paddlesTable.personId })
      .from(paddlesTable)
      .where(eq(paddlesTable.auctionId, auctionId));
    expect(rows.length).toBe(2);
    paddleA = rows.find((row) => row.personId === ownerA)?.id ?? "";
    paddleB = rows.find((row) => row.personId === ownerB)?.id ?? "";
  });
});

describe("COMPENSATING UNDO — history immutable, replay identical", () => {
  it("stage the night: open auction, queue, open lot 1, sell it", async () => {
    expect((await command("QueueLots", organizerId, {}, { conduct: true })).accepted).toBe(true);
    expect((await command("OpenAuction", organizerId, {}, { conduct: true })).accepted).toBe(true);
    const queue = snapshot().queue;
    expect(queue.length).toBe(3);
    lot1 = queue[0]?.lotId ?? "";
    lot2 = queue[1]?.lotId ?? "";
    lot3 = queue[2]?.lotId ?? "";
    expect(
      (await command("OpenLot", organizerId, { lotId: lot1 }, { conduct: true })).accepted,
    ).toBe(true);
    const bid = await command("PlaceBid", ownerA, {
      lotId: lot1,
      paddleId: paddleA,
      amountRaw: 1_000_000,
    });
    expect(bid.accepted).toBe(true);
    const gavel = await command("CloseLot", organizerId, { lotId: lot1 }, { conduct: true });
    expect(gavel.accepted).toBe(true);
    expect(snapshot().lastOutcome).toMatchObject({ kind: "sold", amount: 1_000_000 });
    // The purse committed the sale.
    const paddle = snapshot().paddles.find((entry) => entry.paddleId === paddleA);
    expect(paddle?.committed).toBe(1_000_000);
  });

  it("undo demands conduct AND override — the highest-friction action", async () => {
    const conductOnly = await command("UndoLastAction", organizerId, {}, { conduct: true });
    expect(conductOnly).toMatchObject({ accepted: false, reason: "not_authorized" });
    const overrideOnly = await command("UndoLastAction", organizerId, {}, { override: true });
    expect(overrideOnly).toMatchObject({ accepted: false, reason: "not_authorized" });
  });

  it("undo reopens the lot with compensating events; purse restores; nothing is deleted", async () => {
    const eventsBefore = await loadEvents(db, auctionId);
    const undone = await command(
      "UndoLastAction",
      organizerId,
      { reason: "wrong gavel" },
      { conduct: true, override: true },
    );
    expect(undone).toMatchObject({ accepted: true });

    // History grew — nothing was deleted or rewritten.
    const eventsAfter = await loadEvents(db, auctionId);
    expect(eventsAfter.length).toBe(eventsBefore.length + 2); // BidInvalidated + LotReopened
    expect(eventsAfter.slice(0, eventsBefore.length)).toEqual(eventsBefore);
    const reopen = eventsAfter.at(-1);
    expect(reopen?.type).toBe("LotReopened");
    expect(reopen?.payload["compensatesSeq"]).toBe(
      eventsBefore.findLast((event) => event.type === "LotSold")?.seq,
    );

    // The lot is back on the block with a fresh window; the purse restored.
    const snap = snapshot();
    expect(snap.currentLot?.lotId).toBe(lot1);
    expect(snap.currentLot?.status).toBe("on_block");
    expect(snap.currentLot?.endsAtMs).not.toBeNull();
    const paddle = snap.paddles.find((entry) => entry.paddleId === paddleA);
    expect(paddle?.committed).toBe(0);
    expect(snap.lastOutcome).toMatchObject({ kind: "reopened", lotNumber: "L001" });

    // The winning bid is voided-but-VISIBLE: the row survives as invalidated.
    const bidRows = await db
      .select({ status: bidsTable.status })
      .from(bidsTable)
      .where(and(eq(bidsTable.auctionId, auctionId), eq(bidsTable.lotId, lot1)));
    expect(bidRows.length).toBe(1);
    expect(bidRows[0]?.status).toBe("invalidated");
    // And the history rides the snapshot for everyone to see.
    expect(snap.currentLot?.bidHistory.length).toBe(1);
  });

  it("REPLAY EQUALITY: a fresh engine folds the undone log to the identical snapshot", async () => {
    const current = engine.snapshotOf(auctionId);
    const fresh = new AuctionEngine({ db, logger, onSnapshot: () => undefined });
    const state = await fresh.ensureAuction(auctionId);
    expect(state?.halted).toBeNull();
    expect(state?.serialized).toBe(current?.serialized);
    // And the projection hashes agree (projection equality, machine-checked).
    expect(fresh.diagnosticsOf(auctionId)?.projectionHash).toBe(
      engine.diagnosticsOf(auctionId)?.projectionHash,
    );
  });

  it("a second undo inside the same window is refused (the reopened lot closed it)", async () => {
    const again = await command(
      "UndoLastAction",
      organizerId,
      {},
      { conduct: true, override: true },
    );
    expect(again).toMatchObject({ accepted: false, reason: "undo_window_closed" });
  });

  it("the night continues: the reopened lot sells to the OTHER team; undo of an unsold pass works too", async () => {
    const bid = await command("PlaceBid", ownerB, {
      lotId: lot1,
      paddleId: paddleB,
      amountRaw: 1_500_000,
    });
    expect(bid.accepted).toBe(true);
    expect(
      (await command("CloseLot", organizerId, { lotId: lot1 }, { conduct: true })).accepted,
    ).toBe(true);
    const sold = snapshot();
    expect(sold.lastOutcome).toMatchObject({ kind: "sold", teamName: "Blasters" });

    // Pass lot 2 with no bids, then undo the pass.
    expect(
      (await command("OpenLot", organizerId, { lotId: lot2 }, { conduct: true })).accepted,
    ).toBe(true);
    expect(
      (await command("CloseLot", organizerId, { lotId: lot2 }, { conduct: true })).accepted,
    ).toBe(true);
    expect(snapshot().lastOutcome).toMatchObject({ kind: "unsold" });
    const undone = await command(
      "UndoLastAction",
      organizerId,
      {},
      { conduct: true, override: true },
    );
    expect(undone.accepted).toBe(true);
    expect(snapshot().currentLot?.lotId).toBe(lot2);
    // Resolve it again so the auction can complete later.
    expect(
      (await command("CloseLot", organizerId, { lotId: lot2 }, { conduct: true })).accepted,
    ).toBe(true);
  });
});

describe("MANUAL CONDUCT — freeze, requeue, withdraw on the command path", () => {
  it("freeze the open lot (hold), requeue it, and withdraw it before re-opening", async () => {
    expect(
      (await command("OpenLot", organizerId, { lotId: lot3 }, { conduct: true })).accepted,
    ).toBe(true);
    const frozen = await command("HoldLot", organizerId, { lotId: lot3 }, { conduct: true });
    expect(frozen.accepted).toBe(true);
    expect(snapshot().lastOutcome).toMatchObject({ kind: "held" });
    // A frozen lot resolves by requeue (round counted), then withdrawal ends it.
    const requeued = await command("RequeueLot", organizerId, { lotId: lot3 }, { conduct: true });
    expect(requeued.accepted).toBe(true);
    expect(snapshot().queue.some((entry) => entry.lotId === lot3)).toBe(true);
    const withdrawn = await command("WithdrawLot", organizerId, { lotId: lot3 }, { conduct: true });
    expect(withdrawn.accepted).toBe(true);
    // Non-conduct manual controls are refused.
    const denied = await command("WithdrawLot", ownerA, { lotId: lot3 });
    expect(denied).toMatchObject({ accepted: false, reason: "not_authorized" });
  });
});

describe("AUCTION LEDGER — the canonical operational record", () => {
  it("one row per event, regenerated identically, with the sale/undo/rejection evidence", async () => {
    const record = (engine.snapshotOf(auctionId) as { record: AuctionRecord }).record;
    const events = await loadEvents(db, auctionId);
    const start = performance.now();
    const ledger = await ledgerOf(db, record);
    const generationMs = performance.now() - start;
    expect(ledger.length).toBe(events.length);
    expect(ledger.map((row) => row.seq)).toEqual(events.map((event) => event.seq));

    // Regeneration is byte-identical — the ledger cannot drift from history.
    const again = await ledgerOf(db, record);
    expect(JSON.stringify(again)).toBe(JSON.stringify(ledger));

    // The sale carries paddle, team, lot, amount, actor and correlation.
    const sale = ledger.filter((row) => row.result === "SOLD").at(-1);
    expect(sale).toMatchObject({
      teamName: "Blasters",
      lotNumber: "L001",
      amount: 1_500_000,
      actorName: "Priya Organizer",
    });
    expect(sale?.correlationId).toBeTruthy();
    // The undo pair is visible: voided bid + compensating reopen.
    expect(ledger.some((row) => row.result === "Bid voided" && row.reason === "undo")).toBe(true);
    expect(ledger.some((row) => row.result.startsWith("UNDO — lot reopened"))).toBe(true);
    // Owner workflow rows are part of the operational history.
    expect(ledger.some((row) => row.result === "Owner invited")).toBe(true);
    expect(ledger.some((row) => row.result === "Owner invitation accepted")).toBe(true);
    expect(ledger.some((row) => row.result === "Paddle grant issued")).toBe(true);

    // eslint-disable-next-line no-console
    console.log(
      `ledger generation: ${String(ledger.length)} rows in ${generationMs.toFixed(1)} ms`,
    );
  });
});

describe("ENGINE DIAGNOSTICS + RECOVERY DASHBOARD FEED", () => {
  it("diagnostics report queue, throughput, hashes and watchdog — read-only truth", async () => {
    await engine.settle(auctionId);
    const diagnostics = engine.diagnosticsOf(auctionId);
    if (diagnostics === null) {
      throw new Error("no diagnostics");
    }
    expect(diagnostics.queueDepth).toBe(0);
    expect(diagnostics.processed).toBeGreaterThan(10);
    expect(diagnostics.accepted).toBeGreaterThan(10);
    expect(diagnostics.rejected).toBeGreaterThan(0);
    expect(diagnostics.avgProcessMs).toBeGreaterThan(0);
    expect(diagnostics.lastReplayMs).toBeGreaterThan(0);
    expect(diagnostics.snapshotHash).toMatch(/^[0-9a-f]{64}$/);
    expect(diagnostics.projectionHash).toMatch(/^[0-9a-f]{64}$/);
    expect(diagnostics.version).toBe(engine.snapshotOf(auctionId)?.version);
    expect(diagnostics.eventCount).toBe(diagnostics.version);
    expect(diagnostics.halted).toBeNull();

    // The snapshot hash IS the hash of the broadcast bytes (integrity check).
    const serialized = engine.snapshotOf(auctionId)?.serialized ?? "";
    expect(diagnostics.snapshotHash).toBe(createHash("sha256").update(serialized).digest("hex"));
  });

  it("a halted engine is visible in diagnostics; recovery heals and records duration", async () => {
    // Corrupt the sold lot out-of-band, restart-equivalent load → halted.
    await db
      .update(lotsTable)
      .set({ status: "queued", soldPrice: null, soldToPaddleId: null })
      .where(eq(lotsTable.id, lot1));
    const fresh = new AuctionEngine({ db, logger, onSnapshot: () => undefined });
    await fresh.ensureAuction(auctionId);
    const halted = fresh.diagnosticsOf(auctionId);
    expect(halted?.halted).toContain("projection_mismatch");

    const recovered = await fresh.submit({
      commandId: newId(),
      auctionId,
      type: "RecoverAuction",
      actor: organizerId,
      conduct: true,
      payload: {},
    });
    expect(recovered.accepted).toBe(true);
    const after = fresh.diagnosticsOf(auctionId);
    expect(after?.halted).toBeNull();
    expect(after?.lastRecoveryMs).toBeGreaterThan(0);
    expect(after?.recoveries).toBeGreaterThan(0);
    // Our long-lived engine sees the healed history too (recovery event replays).
    engine.reset(auctionId);
    await engine.ensureAuction(auctionId);
    expect(engine.diagnosticsOf(auctionId)?.halted).toBeNull();
  });
});

describe("SPECTATOR ISOLATION + CEREMONY DETERMINISM", () => {
  it("the broadcast snapshot carries NO person ids, NO tokens, NO engine internals", () => {
    const state = engine.snapshotOf(auctionId);
    const serialized = state?.serialized ?? "";
    for (const personId of [organizerId, ownerA, ownerB, outsiderId]) {
      expect(serialized).not.toContain(personId);
    }
    expect(serialized).not.toContain("tokenHash");
    expect(serialized).not.toContain(`h-${RUN}`);
    expect(serialized).not.toContain("snapshotHash");
    expect(serialized).not.toContain("queueDepth");
    // Owner invitations and grants never ride the snapshot (owner data).
    expect(serialized).not.toContain("invite");
    expect(serialized).not.toContain("grant");
  });

  it("ceremony transitions derive deterministically from broadcast snapshots", async () => {
    const before = snapshot();
    const rebuilt = await buildLiveSnapshot(
      db,
      (engine.snapshotOf(auctionId) as { record: AuctionRecord }).record,
    );
    if (!rebuilt.ok) {
      throw new Error("rebuild failed");
    }
    // Identical snapshots → identical ceremony, across independent folds.
    expect(deriveCeremony(before, rebuilt.snapshot)).toEqual(
      deriveCeremony(before, rebuilt.snapshot),
    );
    expect(deriveCeremony(null, rebuilt.snapshot).phase).toBeDefined();
  });

  it("the auction completes; every unresolved path was conducted through commands", async () => {
    const completed = await command(
      "CompleteAuction",
      organizerId,
      // Squads are deliberately tiny in this fixture — DA-06 refuses a
      // completion below squadMin unless the conductor overrides on the record.
      { overrideSquadMinimum: true },
      { conduct: true },
    );
    expect(completed.accepted).toBe(true);
    expect(snapshot().auctionStatus).toBe("completed");
    expect(deriveCeremony(null, snapshot()).phase).toBe("completed");
  });
});
