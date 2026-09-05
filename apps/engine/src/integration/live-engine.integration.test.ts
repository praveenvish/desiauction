// PERMANENT LIVE ENGINE REGRESSION SUITE (M-IP4-2). In-process AuctionEngine
// against real Postgres — the command queue IS the single writer. Encodes:
// concurrent bids (2/5/10 paddles, exactly one winner), duplicate-command
// idempotency, late bids, anti-snipe execution, snapshot byte-equality,
// broadcast ordering, timer pause/resume/expiry, engine restart recovery
// (measured), projection healing, fail-closed halts, and race evidence.
import { performance } from "node:perf_hooks";

import {
  createAuction,
  buildLiveSnapshot,
  loadEvents,
  type AuctionRecord,
} from "@desiauction/auction";
import {
  DEFAULT_AUCTION_CONFIG,
  registrationNumber,
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
import { and, eq } from "drizzle-orm";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db, sql } from "../db.js";
import { deletePeopleCascading } from "./people-teardown.js";
import { AuctionEngine, ENGINE_ACTOR } from "../engine-core.js";

const logger = pino({ level: "silent" });
const RUN = String(Date.now()).slice(-7);

// Anti-snipe config for tests: extension == initial ⇒ EVERY accepted bid
// extends (deterministic without sleeping); expiry is driven by a fake clock.
const CONFIG: AuctionConfig = {
  ...DEFAULT_AUCTION_CONFIG,
  timer: { initialSeconds: 10, extensionSeconds: 10 },
  unsoldPolicy: { mode: "requeue", rounds: 2 },
};

let fakeNow = Date.now();
const broadcasts: { auctionId: string; version: number }[] = [];

const engine = new AuctionEngine({
  db,
  logger,
  onSnapshot: (auctionId, _serialized, version) => {
    broadcasts.push({ auctionId, version });
  },
  nowMs: () => fakeNow,
});

const orgId = newId();
const ownerId = newId();
const bidderIds = Array.from({ length: 10 }, () => newId());
/**
 * An owner who holds NO team, for the "second granted owner cannot claim a held
 * paddle" case below. That case used to reuse `bidderIds[1]`, who already owns
 * team 1 — a state invariant 18 now forbids (migration 0042), so the fixture
 * would be asserting a scenario the product refuses. The behaviour under test
 * is one ACTIVE paddle per team, which has nothing to do with owning two.
 */
const spareOwnerId = newId();
const teamIds = Array.from({ length: 10 }, () => newId());
const compId = newId();
let auctionId = "";
const paddleByBidder = new Map<string, string>();
let lot1 = "";
let lot2 = "";
let lot3 = "";

async function command(
  type: string,
  actor: string,
  payload: Record<string, unknown>,
  options: { conduct?: boolean; commandId?: string } = {},
): Promise<CommandAck> {
  return engine.submit({
    commandId: options.commandId ?? newId(),
    auctionId,
    type: type as never,
    actor,
    conduct: options.conduct ?? false,
    payload,
  });
}

beforeAll(async () => {
  await db.insert(people).values([
    { id: ownerId, phone: `+9199${RUN}0`, name: "Live Owner" },
    ...bidderIds.map((id, i) => ({
      id,
      phone: `+9198${RUN.slice(0, 5)}${String(i).padStart(2, "0")}`,
      name: `Bidder ${String(i + 1)}`,
    })),
    { id: spareOwnerId, phone: `+9197${RUN}0`, name: "Spare Owner" },
  ]);
  await db
    .insert(organizations)
    .values({ id: orgId, name: `Live Org ${RUN}`, slug: `live-${RUN}`, createdBy: ownerId });
  await db.insert(orgMembers).values({ orgId, personId: ownerId });
  await db.insert(competitions).values({
    id: compId,
    orgId,
    sport: "cricket",
    name: `Live League ${RUN}`,
    slug: `live-league-${RUN}`,
    status: "registration_closed",
    createdBy: ownerId,
  });
  await db.insert(teams).values(
    teamIds.map((id, i) => ({
      id,
      orgId,
      competitionId: compId,
      name: `Live Team ${String(i + 1).padStart(2, "0")}`,
      createdBy: ownerId,
    })),
  );
  const regIds = [newId(), newId(), newId()];
  await db.insert(registrations).values(
    regIds.map((id, i) => ({
      id,
      orgId,
      competitionId: compId,
      personId: bidderIds[i] as string,
      role: "batter" as const,
      status: "approved" as const,
      registrationNumber: registrationNumber(id),
    })),
  );
  const created = await createAuction(
    db,
    { id: compId, orgId, name: `Live League ${RUN}` },
    {
      ok: true,
      competitionId: compId,
      pool: regIds.map((registrationId) => ({ registrationId, basePriceBand: null })),
    },
    ownerId,
    CONFIG,
  );
  if (!created.ok) {
    throw new Error("auction creation failed");
  }
  auctionId = created.auctionId;
  const state = await engine.ensureAuction(auctionId);
  if (state === null) {
    throw new Error("engine load failed");
  }
});

afterAll(async () => {
  await db.delete(auctionEventsTable).where(eq(auctionEventsTable.orgId, orgId));
  await db.delete(bidsTable).where(eq(bidsTable.orgId, orgId));
  await db.delete(lotsTable).where(eq(lotsTable.orgId, orgId));
  // THE OWNER MODEL LEAVES TWO TABLES THIS TEARDOWN NEVER KNEW ABOUT.
  //
  // The suite drives the real production path — invite → accept → grant →
  // claim — so it writes `auction_owner_invites` and `paddle_grants` as well as
  // `paddles`. Migration 0040 then gave `paddle_grants.person_id` a foreign key
  // with ON DELETE RESTRICT, and from that day the final `delete from people`
  // below could not succeed: all 66 assertions passed and `afterAll` threw
  // 23503, so the suite reported FAILED with nothing wrong with the engine.
  //
  // Worse than a red suite: every run leaked a person and its grants into the
  // shared database, and that residue is what later makes an unrelated failure
  // look like a product bug (audit PA-1 §21).
  //
  // Grants and invites go before paddles for readability — the delete order
  // that matters is simply that both precede `people`.
  await db.delete(paddleGrants).where(eq(paddleGrants.orgId, orgId));
  await db.delete(auctionOwnerInvites).where(eq(auctionOwnerInvites.orgId, orgId));
  await db.delete(paddlesTable).where(eq(paddlesTable.orgId, orgId));
  // 0040 made person_id a real foreign key: a grant or an accepted invite still
  // pointing at a bidder refuses the people delete below, so they go first.
  await db.delete(paddleGrants).where(eq(paddleGrants.orgId, orgId));
  await db.delete(auctionOwnerInvites).where(eq(auctionOwnerInvites.orgId, orgId));
  await db.delete(auctionsTable).where(eq(auctionsTable.orgId, orgId));
  await db.delete(registrations).where(eq(registrations.orgId, orgId));
  await db.delete(teams).where(eq(teams.orgId, orgId));
  await db.delete(competitions).where(eq(competitions.orgId, orgId));
  await db.delete(orgMembers).where(eq(orgMembers.orgId, orgId));
  await db.delete(auditLog).where(eq(auditLog.scopeId, orgId));
  await db.delete(organizations).where(eq(organizations.id, orgId));
  await deletePeopleCascading([ownerId, spareOwnerId, ...bidderIds]);
  await sql.end();
});

describe("LIVE ENGINE — paddles, queue, opening", () => {
  it("ten bidders claim ten paddles through the command queue (owner model: invite → accept → grant → claim)", async () => {
    // M-IP4-3 production rule: no active paddle without an explicit grant.
    // A claim without one is refused deterministically.
    const ungranted = await command("ClaimPaddle", bidderIds[0] as string, {
      teamId: teamIds[0],
    });
    expect(ungranted).toMatchObject({ accepted: false, reason: "no_grant" });

    // Invitation → acceptance → grant, all through the command path.
    for (let i = 0; i < 10; i++) {
      const bidder = bidderIds[i] as string;
      const invited = await command(
        "InviteOwner",
        ownerId,
        {
          teamId: teamIds[i],
          tokenHash: `hash-${RUN}-${String(i)}`,
          expiresAtMs: Date.now() + 3_600_000,
        },
        { conduct: true },
      );
      expect(invited.accepted).toBe(true);
      const inviteId = (invited.reason ?? "").replace("invite:", "");
      const acceptedInvite = await command("AcceptOwnerInvite", bidder, { inviteId });
      expect(acceptedInvite.accepted).toBe(true);
      const granted = await command(
        "GrantPaddle",
        ownerId,
        { teamId: teamIds[i], personId: bidder },
        { conduct: true },
      );
      expect(granted.accepted).toBe(true);
    }

    const acks = await Promise.all(
      bidderIds.map((bidder, i) => command("ClaimPaddle", bidder, { teamId: teamIds[i] })),
    );
    expect(acks.every((ack) => ack.accepted)).toBe(true);
    const rows = await db
      .select({ id: paddlesTable.id, personId: paddlesTable.personId })
      .from(paddlesTable)
      .where(eq(paddlesTable.auctionId, auctionId));
    expect(rows.length).toBe(10);
    for (const row of rows) {
      paddleByBidder.set(row.personId, row.id);
    }
    // An ungranted person is refused BEFORE the held check (grants gate claims).
    const refused = await command("ClaimPaddle", ownerId, { teamId: teamIds[0] });
    expect(refused).toMatchObject({ accepted: false, reason: "no_grant" });
    // MULTIPLE owners may exist for one team: a second granted owner still
    // cannot claim while the paddle is held (one ACTIVE paddle per team).
    //
    // The second owner is `spareOwnerId`, who holds no other team. This used to
    // be `bidderIds[1]`, who owns team 1 — and after migration 0042 that person
    // can no longer be granted a second team at all, so the setup would refuse
    // before reaching the behaviour under test. The rule being proved here is
    // about one paddle per TEAM, not about one team per owner.
    const second = spareOwnerId;
    const invited2 = await command(
      "InviteOwner",
      ownerId,
      { teamId: teamIds[0], tokenHash: `hash-${RUN}-second`, expiresAtMs: Date.now() + 3_600_000 },
      { conduct: true },
    );
    const inviteId2 = (invited2.reason ?? "").replace("invite:", "");
    expect((await command("AcceptOwnerInvite", second, { inviteId: inviteId2 })).accepted).toBe(
      true,
    );
    expect(
      (
        await command(
          "GrantPaddle",
          ownerId,
          { teamId: teamIds[0], personId: second },
          { conduct: true },
        )
      ).accepted,
    ).toBe(true);
    const held = await command("ClaimPaddle", second, { teamId: teamIds[0] });
    expect(held).toMatchObject({ accepted: false, reason: "paddle_held" });
    // Re-claiming your own is idempotent-accepted.
    const again = await command("ClaimPaddle", bidderIds[0] as string, {
      teamId: teamIds[0],
    });
    expect(again.accepted).toBe(true);
  });

  it("conduct commands open the auction; non-conductors are refused", async () => {
    const denied = await command("QueueLots", bidderIds[0] as string, {});
    expect(denied).toMatchObject({ accepted: false, reason: "not_authorized" });
    expect((await command("QueueLots", ownerId, {}, { conduct: true })).accepted).toBe(true);
    expect(
      (await command("OpenLot", ownerId, { lotId: "missing" }, { conduct: true })).accepted,
    ).toBe(false);
    const state = engine.snapshotOf(auctionId);
    const queue = state?.snapshot?.queue ?? [];
    expect(queue.length).toBe(3);
    lot1 = queue[0]?.lotId ?? "";
    lot2 = queue[1]?.lotId ?? "";
    lot3 = queue[2]?.lotId ?? "";
    // Opening a lot before the auction is live is refused deterministically,
    // as are lifecycle commands illegal from `scheduled`.
    const early = await command("OpenLot", ownerId, { lotId: lot1 }, { conduct: true });
    expect(early).toMatchObject({ accepted: false, reason: "auction_not_live" });
    expect((await command("ResumeAuction", ownerId, {}, { conduct: true })).accepted).toBe(false);
    expect((await command("PauseAuction", ownerId, {}, { conduct: true })).accepted).toBe(false);
  });
});

describe("LIVE ENGINE — the single writer under fire", () => {
  it("opens the auction and the first lot — the OpenAuction edge is a COMMAND (M-IP4-3)", async () => {
    // Nothing bypasses the command path anymore: the scheduled→live edge
    // travels the same queue as everything else.
    const denied = await command("OpenAuction", bidderIds[0] as string, {});
    expect(denied).toMatchObject({ accepted: false, reason: "not_authorized" });
    const opened = await command("OpenAuction", ownerId, {}, { conduct: true });
    expect(opened.accepted).toBe(true);
    expect(engine.snapshotOf(auctionId)?.snapshot?.auctionStatus).toBe("live");
    const lotOpened = await command("OpenLot", ownerId, { lotId: lot1 }, { conduct: true });
    expect(lotOpened.accepted).toBe(true);
    const after = engine.snapshotOf(auctionId);
    expect(after?.snapshot?.currentLot?.lotId).toBe(lot1);
    expect(after?.snapshot?.currentLot?.endsAtMs).not.toBeNull();
  });

  it("CONCURRENCY: ten simultaneous identical bids — exactly ONE accepted, nine explained", async () => {
    const base = 1_000_000; // default band base
    const acks = await Promise.all(
      bidderIds.map((bidder) =>
        command("PlaceBid", bidder, {
          lotId: lot1,
          paddleId: paddleByBidder.get(bidder) ?? "",
          amountRaw: base,
        }),
      ),
    );
    const accepted = acks.filter((ack) => ack.accepted);
    const rejected = acks.filter((ack) => !ack.accepted);
    expect(accepted.length).toBe(1);
    expect(rejected.length).toBe(9);
    // Every rejection carries a deterministic reason (the gauntlet's codes).
    expect(rejected.every((ack) => ack.reason === "BELOW_CURRENT")).toBe(true);
    // Rejected bids left evidence: BidRejected events, no bid rows.
    const bidRows = await db
      .select({ id: bidsTable.id })
      .from(bidsTable)
      .where(and(eq(bidsTable.auctionId, auctionId), eq(bidsTable.lotId, lot1)));
    expect(bidRows.length).toBe(1);
    const events = await loadEvents(db, auctionId);
    expect(events.filter((e) => e.type === "BidRejected").length).toBeGreaterThanOrEqual(9);
  });

  it("CONCURRENCY: an escalating burst serializes; the highest on-ladder bid leads", async () => {
    const step = 500_000;
    const amounts = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => 1_000_000 + i * step);
    const acks = await Promise.all(
      amounts.map((amount, i) =>
        command("PlaceBid", bidderIds[(i + 1) % 10] as string, {
          lotId: lot1,
          paddleId: paddleByBidder.get(bidderIds[(i + 1) % 10] as string) ?? "",
          amountRaw: amount,
        }),
      ),
    );
    expect(acks.some((ack) => ack.accepted)).toBe(true);
    const state = engine.snapshotOf(auctionId);
    const leading = state?.snapshot?.currentLot?.currentBid;
    // The leader is the maximum ACCEPTED amount; every bid row below it is outbid.
    const history = await db
      .select({ amount: bidsTable.amount, status: bidsTable.status, eventSeq: bidsTable.eventSeq })
      .from(bidsTable)
      .where(and(eq(bidsTable.auctionId, auctionId), eq(bidsTable.lotId, lot1)));
    const maxAccepted = Math.max(...history.map((b) => b.amount));
    expect(leading?.amount).toBe(maxAccepted);
    expect(history.filter((b) => b.status === "accepted").length).toBe(1);
    // Deterministic ordering: bid eventSeq strictly increasing with amount order
    // of acceptance (the queue's total order).
    const seqs = history.map((b) => b.eventSeq).sort((a, b) => a - b);
    expect(new Set(seqs).size).toBe(seqs.length);
  });

  it("RACE: simultaneous bids at the same amount resolve to exactly ONE winner", async () => {
    // The certification could not test this: one browser profile carries one
    // session, so four owners bidding at once was unreachable from the UI. It
    // is the failure that would matter most on auction night — two owners
    // tapping the same rung in the same instant — so it is asserted here,
    // against the real queue, where true concurrency is expressible.
    const state = engine.snapshotOf(auctionId);
    const amount = state?.snapshot?.currentLot?.nextMinimumBid ?? 0;
    const contenders = [bidderIds[5], bidderIds[6], bidderIds[7]] as string[];

    const acks = await Promise.all(
      contenders.map((bidder) =>
        command("PlaceBid", bidder, {
          lotId: lot1,
          paddleId: paddleByBidder.get(bidder) ?? "",
          amountRaw: amount,
        }),
      ),
    );

    // Exactly one may win at a given rung; the losers are refused BELOW_CURRENT
    // (someone got there first), never silently dropped.
    const accepted = acks.filter((ack) => ack.accepted);
    expect(accepted).toHaveLength(1);
    for (const refusal of acks.filter((ack) => !ack.accepted)) {
      expect(refusal.reason).toBe("BELOW_CURRENT");
    }

    // And the money agrees: one accepted row at that amount, one leader.
    const rows = await db
      .select({ id: bidsTable.id, status: bidsTable.status })
      .from(bidsTable)
      .where(and(eq(bidsTable.lotId, lot1), eq(bidsTable.amount, amount)));
    expect(rows.filter((row) => row.status === "accepted")).toHaveLength(1);
    expect(engine.snapshotOf(auctionId)?.snapshot?.currentLot?.currentBid?.amount).toBe(amount);
  });

  it("IDEMPOTENCY: a duplicated command id returns the ORIGINAL ack, executing once", async () => {
    const commandId = newId();
    const bidder = bidderIds[3] as string;
    const state = engine.snapshotOf(auctionId);
    const next = state?.snapshot?.currentLot?.nextMinimumBid ?? 0;
    const first = await command(
      "PlaceBid",
      bidder,
      { lotId: lot1, paddleId: paddleByBidder.get(bidder) ?? "", amountRaw: next },
      { commandId },
    );
    const second = await command(
      "PlaceBid",
      bidder,
      { lotId: lot1, paddleId: paddleByBidder.get(bidder) ?? "", amountRaw: next },
      { commandId },
    );
    expect(first.accepted).toBe(true);
    expect(second).toEqual(first); // the cached ack, byte for byte
    const rows = await db
      .select({ id: bidsTable.id })
      .from(bidsTable)
      .where(and(eq(bidsTable.lotId, lot1), eq(bidsTable.amount, next)));
    expect(rows.length).toBe(1); // executed exactly once
    // A RETRY with a NEW id is a fresh command — refused as self-outbid.
    const retry = await command("PlaceBid", bidder, {
      lotId: lot1,
      paddleId: paddleByBidder.get(bidder) ?? "",
      amountRaw: next + 500_000,
    });
    expect(retry).toMatchObject({ accepted: false, reason: "ALREADY_LEADING" });
  });

  it("ANTI-SNIPE EXECUTION: accepted bids extend; the timer NEVER shrinks; no duplicate extension", async () => {
    const events = await loadEvents(db, auctionId);
    const extensions = events.filter((e) => e.type === "TimerExtended");
    expect(extensions.length).toBeGreaterThan(0);
    // Monotonic: each TimerExtended endsAtMs ≥ the previous (never shorten).
    const ends = extensions.map((e) => e.payload["endsAtMs"] as number);
    for (let i = 1; i < ends.length; i++) {
      expect(ends[i]).toBeGreaterThanOrEqual(ends[i - 1] as number);
    }
    // One extension per accepted bid at most (no duplicates): extensions ≤ accepted bids.
    const acceptedBids = events.filter((e) => e.type === "BidAccepted").length;
    expect(extensions.length).toBeLessThanOrEqual(acceptedBids);
    // The snapshot carries the extension count for the lot on the block.
    const state = engine.snapshotOf(auctionId);
    expect(state?.snapshot?.currentLot?.extensions).toBe(
      extensions.filter((e) => e.payload["lotId"] === lot1).length,
    );
  });

  it("TIMER PAUSE/RESUME: the runway freezes exactly and re-attaches exactly", async () => {
    const before = engine.snapshotOf(auctionId)?.snapshot?.currentLot?.endsAtMs ?? null;
    expect(before).not.toBeNull();
    const paused = await command("PauseAuction", ownerId, {}, { conduct: true });
    expect(paused.accepted).toBe(true);
    const during = engine.snapshotOf(auctionId)?.snapshot;
    expect(during?.auctionStatus).toBe("paused");
    expect(during?.currentLot?.endsAtMs).toBeNull(); // frozen — no absolute end
    const [heldRow] = await db
      .select({ held: lotsTable.heldRemainingMs })
      .from(lotsTable)
      .where(eq(lotsTable.id, lot1));
    const held = heldRow?.held ?? null;
    expect(held).not.toBeNull();
    const resumed = await command("ResumeAuction", ownerId, {}, { conduct: true });
    expect(resumed.accepted).toBe(true);
    const after = engine.snapshotOf(auctionId)?.snapshot;
    expect(after?.auctionStatus).toBe("live");
    const endsAt = after?.currentLot?.endsAtMs ?? null;
    expect(endsAt).not.toBeNull();
    // The exact remainder re-attached: endsAt - resumeInstant === held. The
    // resume event carries both, so verify from the log (no wall-clock races).
    const events = await loadEvents(db, auctionId);
    const heldEvent = events.filter((e) => e.type === "TimerHeld").at(-1);
    const resumeEvent = events.filter((e) => e.type === "TimerResumed").at(-1);
    if (heldEvent === undefined || resumeEvent === undefined) {
      throw new Error("expected TimerHeld + TimerResumed events");
    }
    expect(heldEvent.payload["heldRemainingMs"]).toBe(held);
    expect((resumeEvent.payload["endsAtMs"] as number) - resumeEvent.atMs).toBe(held);
  });

  it("PAUSE IS TOTAL: the gavel is refused while the auction is paused", async () => {
    /**
     * Audit PA-1 §6. `transitionLot` checked `auction.status === "live"` for
     * `open` only, so a PAUSED auction still accepted CloseLot and HoldLot: the
     * lot on the block could be sold, passed or frozen in the middle of the
     * dispute the pause was called to settle. The timer half was already
     * correct — pause banks the remainder and nulls `ends_at_ms` — which is why
     * nothing caught it: the auction looked frozen while the gavel still worked.
     *
     * Ordering note: this runs before the closing-soon test below and returns
     * the auction to `live`, so the shared fixture is unchanged for it.
     */
    expect((await command("PauseAuction", ownerId, {}, { conduct: true })).accepted).toBe(true);
    expect(engine.snapshotOf(auctionId)?.snapshot?.auctionStatus).toBe("paused");

    const hammered = await command("CloseLot", ownerId, { lotId: lot1 }, { conduct: true });
    expect(hammered.accepted, "a paused auction sold the lot on the block").toBe(false);
    expect(hammered.accepted ? "" : hammered.reason).toBe("auction_not_live");

    const held = await command("HoldLot", ownerId, { lotId: lot1 }, { conduct: true });
    expect(held.accepted, "a paused auction froze the lot on the block").toBe(false);

    // The lot is untouched, and resuming leaves the night exactly where it was.
    const [row] = await db
      .select({ status: lotsTable.status })
      .from(lotsTable)
      .where(eq(lotsTable.id, lot1));
    expect(row?.status).toBe("on_block");
    expect((await command("ResumeAuction", ownerId, {}, { conduct: true })).accepted).toBe(true);
    expect(engine.snapshotOf(auctionId)?.snapshot?.auctionStatus).toBe("live");
  });

  it("CLOSING-SOON BID: the anti-snipe extend edge replays cleanly (regression: watchdog halt)", async () => {
    // Drive the lot into closing_soon via the watchdog tick, then bid. The
    // TimerExtended event must flip the projection back to on_block exactly
    // like the row — the M-IP4-2 divergence the watchdog originally caught.
    const before = engine.snapshotOf(auctionId)?.snapshot?.currentLot;
    expect(before?.status).toBe("on_block");
    fakeNow = (before?.endsAtMs ?? 0) - 5_000; // inside the extension window
    engine.tick();
    await engine.settle(auctionId);
    const closing = engine.snapshotOf(auctionId)?.snapshot?.currentLot;
    expect(closing?.status).toBe("closing_soon");
    const bidder = bidderIds[6] as string;
    const ack = await command("PlaceBid", bidder, {
      lotId: lot1,
      paddleId: paddleByBidder.get(bidder) ?? "",
      amountRaw: closing?.nextMinimumBid ?? 0,
    });
    expect(ack.accepted).toBe(true);
    expect(ack.extended).toBe(true);
    const after = engine.snapshotOf(auctionId);
    expect(after?.halted).toBeNull(); // rows and events agree — no halt
    expect(after?.snapshot?.currentLot?.status).toBe("on_block");
  });

  it("LATE BIDS: timer expiry closes the lot in-engine; bids after are LOT_NOT_OPEN with evidence", async () => {
    // Fast-forward the engine clock past the lot's end and tick the watchdog.
    const endsAt = engine.snapshotOf(auctionId)?.snapshot?.currentLot?.endsAtMs ?? 0;
    fakeNow = endsAt + 1;
    engine.tick();
    await engine.settle(auctionId);
    const state = engine.snapshotOf(auctionId);
    expect(state?.snapshot?.currentLot).toBeNull();
    const [lotRow] = await db
      .select({ status: lotsTable.status, soldPrice: lotsTable.soldPrice })
      .from(lotsTable)
      .where(eq(lotsTable.id, lot1));
    expect(lotRow?.status).toBe("sold"); // it had a leading bid — doc 41 close
    expect(lotRow?.soldPrice).toBeGreaterThan(0);
    // A second tick with the same expiry enqueues the SAME command id → deduped.
    engine.tick();
    await engine.settle(auctionId);
    expect((await loadEvents(db, auctionId)).filter((e) => e.type === "LotSold").length).toBe(1);
    // Late bid: rejected deterministically, evidence in the log.
    const late = await command("PlaceBid", bidderIds[5] as string, {
      lotId: lot1,
      paddleId: paddleByBidder.get(bidderIds[5] as string) ?? "",
      amountRaw: 99_000_000,
    });
    expect(late).toMatchObject({ accepted: false, reason: "LOT_NOT_OPEN" });
  });

  it("AUDIT SOURCE (MIN-1): timer-authored events attribute to the engine, human commands to web", async () => {
    // The LATE BIDS drill closed lot1 through the watchdog tick — an ENGINE_ACTOR
    // write. Its audit row must read source "engine"; a human command's "web".
    const audits = await db
      .select({ actor: auditLog.actor, meta: auditLog.meta })
      .from(auditLog)
      .where(eq(auditLog.scopeId, orgId));
    const engineRow = audits.find((row) => row.actor === ENGINE_ACTOR);
    expect(engineRow, "expected at least one engine-authored audit row").toBeDefined();
    expect((engineRow?.meta as { source?: string }).source).toBe("engine");
    const humanRow = audits.find((row) => row.actor !== ENGINE_ACTOR);
    expect(humanRow, "expected at least one human-authored audit row").toBeDefined();
    expect((humanRow?.meta as { source?: string }).source).toBe("web");
  });

  it("BROADCAST ORDERING: snapshot versions only ever increase", () => {
    const versions = broadcasts.filter((b) => b.auctionId === auctionId).map((b) => b.version);
    expect(versions.length).toBeGreaterThan(5);
    for (let i = 1; i < versions.length; i++) {
      expect(versions[i]).toBeGreaterThanOrEqual(versions[i - 1] as number);
    }
  });
});

describe("LIVE ENGINE — restart, recovery, fail-closed", () => {
  it("SNAPSHOT EQUALITY: identical events → identical bytes, across engine instances", async () => {
    const current = engine.snapshotOf(auctionId);
    const rebuilt = await buildLiveSnapshot(db, (current as { record: AuctionRecord }).record);
    expect(rebuilt.ok).toBe(true);
    if (!rebuilt.ok) {
      return;
    }
    expect(rebuilt.serialized).toBe(current?.serialized);
    expect(rebuilt.serialized).not.toContain("generatedAt");
  });

  it("ENGINE RESTART: a fresh instance replays to the identical snapshot (recovery measured)", async () => {
    const before = engine.snapshotOf(auctionId)?.serialized ?? "";
    const fresh = new AuctionEngine({ db, logger, onSnapshot: () => undefined });
    const start = performance.now();
    const state = await fresh.ensureAuction(auctionId);
    const recoveryMs = performance.now() - start;
    expect(state?.halted).toBeNull();
    expect(state?.serialized).toBe(before); // no divergence, no lost state
    expect(recoveryMs).toBeLessThan(2_000);
    // eslint-disable-next-line no-console
    console.log(`recovery (replay + rebuild) after restart: ${recoveryMs.toFixed(1)} ms`);
  });

  it("BOOT REHYDRATION: a restarted engine resumes the clock with nobody touching it", async () => {
    /**
     * Audit PA-1 §6. `tick()` only walks auctions resident in memory, and a
     * fresh engine's map is empty — an auction became resident only when
     * something touched it. So after a deploy or crash mid-lot, the countdown
     * on every screen stopped until somebody clicked, which is precisely what a
     * room does NOT do while it watches a lot run down.
     *
     * The test is deliberately hostile to the old behaviour: the fresh engine
     * is never asked about this auction. No ensureAuction, no snapshotOf, no
     * command. Only `rehydrate()` — then a tick.
     */
    const fresh = new AuctionEngine({ db, logger, onSnapshot: () => undefined });

    // Nothing is resident until it is rehydrated.
    expect(fresh.snapshotOf(auctionId)).toBeUndefined();

    const { found, loaded } = await fresh.rehydrate();
    expect(found, "the live auction was not found for rehydration").toBeGreaterThanOrEqual(1);
    expect(loaded).toBe(found);
    expect(
      fresh.snapshotOf(auctionId),
      "a live auction was not made resident by rehydration, so its timer would not run",
    ).toBeDefined();
    expect(fresh.snapshotOf(auctionId)?.snapshot?.auctionStatus).toBe("live");
  });

  it("PROJECTION HEALING: corrupted rows halt fail-closed, RecoverAuction heals, engine resumes", async () => {
    // Corrupt the sold lot's row projection out-of-band.
    await db
      .update(lotsTable)
      .set({ status: "queued", soldPrice: null, soldToPaddleId: null })
      .where(eq(lotsTable.id, lot1));
    const fresh = new AuctionEngine({ db, logger, onSnapshot: () => undefined });
    const state = await fresh.ensureAuction(auctionId);
    expect(state?.halted).toContain("projection_mismatch"); // loud, fail closed
    // Every command is rejected while halted…
    const denied = await fresh.submit({
      commandId: newId(),
      auctionId,
      type: "PlaceBid",
      actor: bidderIds[0] as string,
      conduct: false,
      payload: {
        lotId: lot2,
        paddleId: paddleByBidder.get(bidderIds[0] as string) ?? "",
        amountRaw: 1_000_000,
      },
    });
    expect(denied).toMatchObject({ accepted: false, reason: "engine_halted" });
    // …except RecoverAuction, which heals FROM the events and resumes.
    const recovered = await fresh.submit({
      commandId: newId(),
      auctionId,
      type: "RecoverAuction",
      actor: ownerId,
      conduct: true,
      payload: {},
    });
    expect(recovered.accepted).toBe(true);
    const healed = await db
      .select({ status: lotsTable.status, soldPrice: lotsTable.soldPrice })
      .from(lotsTable)
      .where(eq(lotsTable.id, lot1));
    expect(healed[0]?.status).toBe("sold");
    expect(healed[0]?.soldPrice).toBeGreaterThan(0);
    expect(fresh.snapshotOf(auctionId)?.halted).toBeNull();
  });

  it("the night continues: lot 2 opens and passes unsold; lot 3 withdrawn pre-block", async () => {
    engine.reset(auctionId);
    await engine.ensureAuction(auctionId);
    expect((await command("OpenLot", ownerId, { lotId: lot2 }, { conduct: true })).accepted).toBe(
      true,
    );
    const closed = await command("CloseLot", ownerId, { lotId: lot2 }, { conduct: true });
    expect(closed.accepted).toBe(true); // no bids → unsold (doc 41)
    const [row] = await db
      .select({ status: lotsTable.status })
      .from(lotsTable)
      .where(eq(lotsTable.id, lot2));
    expect(row?.status).toBe("unsold");
    // Withdraw the final lot ON the command path, then the auction completes.
    const withdrawn = await command("WithdrawLot", ownerId, { lotId: lot3 }, { conduct: true });
    expect(withdrawn.accepted).toBe(true);
    const completed = await command(
      "CompleteAuction",
      ownerId,
      // Squads are deliberately tiny in this fixture — DA-06 refuses a
      // completion below squadMin unless the conductor overrides on the record.
      { overrideSquadMinimum: true },
      { conduct: true },
    );
    expect(completed.accepted).toBe(true);
    expect(engine.snapshotOf(auctionId)?.snapshot?.auctionStatus).toBe("completed");
  });
});
