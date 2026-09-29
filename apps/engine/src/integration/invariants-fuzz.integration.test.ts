// AUCTION INTEGRITY UNDER RANDOM, HOSTILE, CONCURRENT PLAY (PRR 2026-09-29).
//
// The live-engine and certification suites each prove a named scenario: ten
// identical bids, one duplicate command, one restart. This one proves the
// INVARIANTS, against whatever a seeded random night throws at the engine:
//
//   · every team bids at once, every round — valid rungs, stale rungs, amounts
//     off the ladder, negative, fractional, absurd, and with a paddle that
//     belongs to somebody else;
//   · the same command id is retried, concurrently with itself;
//   · the engine is restarted in the middle of a lot (its memory dropped, its
//     state rebuilt from the event log) and play carries on;
//   · lots close by the gavel and by the clock, and a bid arrives after each.
//
// After EVERY lot the database — not the engine's memory, not the snapshot —
// is read back and held to the rules a real night depends on: no team over its
// purse, no squad over its cap, one winner per lot and it is the highest bid,
// no player on two teams, the event log unbroken. The database is the source
// of truth, so the database is what is checked.
//
// Reproducible: the seed is printed, and FUZZ_SEED=<n> replays a night exactly.
import { buildLiveSnapshot, createAuction } from "@desiauction/auction";
import {
  DEFAULT_AUCTION_CONFIG,
  minPossiblePrice,
  paise,
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
import { eq } from "drizzle-orm";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db, sql } from "../db.js";
import { AuctionEngine } from "../engine-core.js";
import { deletePeopleCascading } from "./people-teardown.js";

const logger = pino({ level: "silent" });
const RUN = String(Date.now()).slice(-7);
// eslint-disable-next-line no-restricted-syntax -- a test knob, not app configuration: FUZZ_SEED replays one night
const SEED = Number(process.env["FUZZ_SEED"] ?? Date.now() % 2_147_483_647);

const TEAMS = 4;
const LOTS = 14;
const RUPEE = 100;
const STEP = 5_000 * RUPEE;
const BASE = 10_000 * RUPEE;

// A purse small enough that money is a real constraint by the fourth lot, a
// squad cap the night can actually reach, and a minimum the reserve rule has
// to protect.
const CONFIG: AuctionConfig = {
  ...DEFAULT_AUCTION_CONFIG,
  pursePerTeam: paise(100_000 * RUPEE),
  squadMin: 2,
  squadMax: 4,
  slabs: [{ upTo: null, step: paise(STEP) }],
  basePriceBands: {},
  basePriceDefault: paise(BASE),
  timer: { initialSeconds: 10, extensionSeconds: 10 },
  unsoldPolicy: { mode: "final" },
  roleQuotas: {},
};

/** mulberry32 — small, seeded, and good enough to choose between six things. */
function prng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}
const random = prng(SEED);
const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
const chance = (probability: number): boolean => random() < probability;

/**
 * The engine's clock. It follows the real one, except that a lot closed by the
 * timer is closed by moving this PAST the lot's deadline — and the next lot
 * puts it back. So it steps backwards several times a night, which is what a
 * corrected wall clock does and what the engine must shrug off.
 */
let fakeNow = Date.now();
let lastBroadcastVersion = 0;
let broadcastWentBackwards = false;

function newEngine(): AuctionEngine {
  return new AuctionEngine({
    db,
    logger,
    // The PRODUCTION meter, at its production numbers. Two things are proved
    // by leaving it on: four bidders playing as hard as they can never trip
    // it, and the clock below — which steps BACKWARDS after every lot the
    // timer closes — costs nobody a token (engine-core `allow`).
    onSnapshot: (_auctionId, _serialized, version) => {
      if (version < lastBroadcastVersion) {
        broadcastWentBackwards = true;
      }
      lastBroadcastVersion = version;
    },
    nowMs: () => fakeNow,
  });
}

let engine = newEngine();

const orgId = newId();
const ownerId = newId();
const bidderIds = Array.from({ length: TEAMS }, () => newId());
const teamIds = Array.from({ length: TEAMS }, () => newId());
const playerIds = Array.from({ length: LOTS }, () => newId());
const compId = newId();
let auctionId = "";
const paddleOfBidder = new Map<string, string>();
const teamOfPaddle = new Map<string, string>();

const tally = {
  commands: 0,
  accepted: 0,
  rejected: 0,
  restarts: 0,
  byReason: new Map<string, number>(),
};

async function command(
  type: string,
  actor: string,
  payload: Record<string, unknown>,
  options: { conduct?: boolean; override?: boolean; commandId?: string } = {},
): Promise<CommandAck> {
  const ack = await engine.submit({
    commandId: options.commandId ?? newId(),
    auctionId,
    type: type as never,
    actor,
    conduct: options.conduct ?? false,
    override: options.override ?? false,
    payload,
  });
  tally.commands += 1;
  if (ack.accepted) {
    tally.accepted += 1;
  } else {
    tally.rejected += 1;
    const reason = ack.reason ?? "?";
    tally.byReason.set(reason, (tally.byReason.get(reason) ?? 0) + 1);
  }
  return ack;
}

const conduct = (type: string, payload: Record<string, unknown> = {}) =>
  command(type, ownerId, payload, { conduct: true, override: true });

/** Every rule a night depends on, read back from the DATABASE. */
async function assertInvariants(where: string): Promise<void> {
  const context = `seed ${String(SEED)} · ${where}`;
  const lotRows = await db.select().from(lotsTable).where(eq(lotsTable.auctionId, auctionId));
  const bidRows = await db.select().from(bidsTable).where(eq(bidsTable.auctionId, auctionId));
  const eventRows = await db
    .select({ seq: auctionEventsTable.seq, type: auctionEventsTable.type })
    .from(auctionEventsTable)
    .where(eq(auctionEventsTable.auctionId, auctionId));
  const registrationRows = await db
    .select({ id: registrations.id, teamId: registrations.teamId })
    .from(registrations)
    .where(eq(registrations.competitionId, compId));

  // 1 · THE LOG IS UNBROKEN: 1..n, no gap, no repeat.
  const seqs = eventRows.map((row) => row.seq).sort((a, b) => a - b);
  expect(seqs, `${context}: event log is 1..n`).toEqual(seqs.map((_, index) => index + 1));

  // 2 · ONE LEADER PER LOT, and accepted money only ever goes UP.
  const bidsByLot = new Map<string, typeof bidRows>();
  for (const bid of bidRows) {
    bidsByLot.set(bid.lotId, [...(bidsByLot.get(bid.lotId) ?? []), bid]);
  }
  for (const [lotId, lotBids] of bidsByLot) {
    const standing = lotBids.filter((bid) => bid.status === "accepted");
    expect(
      standing.length,
      `${context}: lot ${lotId} has at most one leading bid`,
    ).toBeLessThanOrEqual(1);
    const inOrder = [...lotBids].sort((a, b) => a.eventSeq - b.eventSeq);
    for (let i = 1; i < inOrder.length; i++) {
      expect(
        inOrder[i]?.amount,
        `${context}: lot ${lotId} bid ${String(i)} is above the one before it`,
      ).toBeGreaterThan(inOrder[i - 1]?.amount ?? 0);
    }
    for (const bid of lotBids) {
      const amount = bid.amount;
      expect(
        Number.isSafeInteger(amount) && amount >= BASE,
        `${context}: bid amount ${String(amount)}`,
      ).toBe(true);
      expect((amount - BASE) % STEP, `${context}: bid ${String(amount)} is on the ladder`).toBe(0);
    }
  }

  // 3 · EVERY SALE IS THE HIGHEST BID, to the paddle that made it.
  const spent = new Map<string, number>();
  const squad = new Map<string, number>();
  const soldRegistrations = new Set<string>();
  for (const lot of lotRows) {
    if (lot.status !== "sold") {
      expect(lot.soldPrice, `${context}: unsold lot ${lot.id} carries no price`).toBeNull();
      expect(lot.soldToPaddleId, `${context}: unsold lot ${lot.id} carries no buyer`).toBeNull();
      continue;
    }
    const lotBids = bidsByLot.get(lot.id) ?? [];
    const winner = lotBids.find((bid) => bid.status === "accepted");
    expect(winner, `${context}: sold lot ${lot.id} has a winning bid`).toBeDefined();
    expect(lot.soldPrice, `${context}: lot ${lot.id} sold at its winning bid`).toBe(winner?.amount);
    expect(lot.soldToPaddleId, `${context}: lot ${lot.id} sold to the winning paddle`).toBe(
      winner?.paddleId,
    );
    expect(winner?.amount, `${context}: lot ${lot.id} sold to the HIGHEST bid`).toBe(
      Math.max(...lotBids.map((bid) => bid.amount)),
    );
    // 4 · NO PLAYER IS SOLD TWICE.
    expect(soldRegistrations.has(lot.registrationId), `${context}: player sold once`).toBe(false);
    soldRegistrations.add(lot.registrationId);
    const teamId = teamOfPaddle.get(lot.soldToPaddleId ?? "") ?? "";
    expect(teamId, `${context}: the buyer is a team in this auction`).not.toBe("");
    spent.set(teamId, (spent.get(teamId) ?? 0) + (lot.soldPrice ?? 0));
    squad.set(teamId, (squad.get(teamId) ?? 0) + 1);
    // 5 · THE PLAYER IS ON THE TEAM THAT BOUGHT THEM, in the row the product reads.
    const registration = registrationRows.find((row) => row.id === lot.registrationId);
    expect(registration?.teamId, `${context}: lot ${lot.id}'s player is on the buyer's team`).toBe(
      teamId,
    );
  }
  for (const registration of registrationRows) {
    if (!soldRegistrations.has(registration.id)) {
      expect(registration.teamId, `${context}: an unsold player is on no team`).toBeNull();
    }
  }

  // 6 · NO TEAM OVER ITS PURSE, NO SQUAD OVER ITS CAP — and the reserve rule
  //     held: whoever is still short of the minimum can still afford it.
  const floor = Number(minPossiblePrice(CONFIG));
  for (const teamId of teamIds) {
    const teamSpent = spent.get(teamId) ?? 0;
    const teamSquad = squad.get(teamId) ?? 0;
    expect(teamSpent, `${context}: team ${teamId} within its purse`).toBeLessThanOrEqual(
      Number(CONFIG.pursePerTeam),
    );
    expect(teamSquad, `${context}: team ${teamId} within squadMax`).toBeLessThanOrEqual(
      CONFIG.squadMax,
    );
    const stillNeeded = Math.max(0, CONFIG.squadMin - teamSquad);
    expect(
      Number(CONFIG.pursePerTeam) - teamSpent,
      `${context}: team ${teamId} can still afford its minimum squad`,
    ).toBeGreaterThanOrEqual(stillNeeded * floor);
  }

  // 7 · EVERY ACCEPTED BID IS IN THE LOG, and nothing else is.
  const acceptedEvents = eventRows.filter((row) => row.type === "BidAccepted").length;
  expect(bidRows.length, `${context}: one bid row per BidAccepted event`).toBe(acceptedEvents);

  // 8 · THE ENGINE AGREES WITH ITSELF: not halted, and a cold fold of the log
  //     is byte-identical to what it is serving.
  const state = engine.snapshotOf(auctionId);
  expect(state?.halted ?? null, `${context}: engine is not halted`).toBeNull();
  if (state !== undefined) {
    const cold = await buildLiveSnapshot(db, state.record);
    expect(cold.ok, `${context}: the log replays`).toBe(true);
    if (cold.ok) {
      expect(cold.divergences, `${context}: rows agree with the log`).toEqual([]);
      expect(cold.serialized, `${context}: served snapshot equals a cold fold`).toBe(
        state.serialized,
      );
    }
  }
  expect(broadcastWentBackwards, `${context}: broadcast versions never go backwards`).toBe(false);
}

beforeAll(async () => {
  await db.insert(people).values([
    { id: ownerId, phone: `+9196${RUN}0`, name: "Fuzz Owner" },
    ...bidderIds.map((id, i) => ({
      id,
      phone: `+9195${RUN.slice(0, 5)}${String(i).padStart(2, "0")}`,
      name: `Fuzz Bidder ${String(i + 1)}`,
    })),
    ...playerIds.map((id, i) => ({
      id,
      phone: `+9194${RUN.slice(0, 5)}${String(i).padStart(2, "0")}`,
      name: `Fuzz Player ${String(i + 1)}`,
    })),
  ]);
  await db
    .insert(organizations)
    .values({ id: orgId, name: `Fuzz Org ${RUN}`, slug: `fuzz-${RUN}`, createdBy: ownerId });
  await db.insert(orgMembers).values({ orgId, personId: ownerId });
  await db.insert(competitions).values({
    id: compId,
    orgId,
    sport: "cricket",
    name: `Fuzz League ${RUN}`,
    slug: `fuzz-league-${RUN}`,
    status: "registration_closed",
    createdBy: ownerId,
  });
  await db.insert(teams).values(
    teamIds.map((id, i) => ({
      id,
      orgId,
      competitionId: compId,
      name: `Fuzz Team ${String(i + 1)}`,
      createdBy: ownerId,
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
    { id: compId, orgId, name: `Fuzz League ${RUN}` },
    {
      ok: true,
      competitionId: compId,
      pool: regIds.map((registrationId) => ({ registrationId, basePriceBand: null })),
    },
    ownerId,
    CONFIG,
  );
  if (!created.ok) {
    throw new Error(`auction creation failed: ${created.reason}`);
  }
  auctionId = created.auctionId;

  for (let i = 0; i < TEAMS; i++) {
    const bidder = bidderIds[i] as string;
    const invited = await conduct("InviteOwner", {
      teamId: teamIds[i],
      tokenHash: `fuzz-${RUN}-${String(i)}-${newId()}`,
      expiresAtMs: Date.now() + 3_600_000,
    });
    expect(invited.accepted).toBe(true);
    const inviteId = (invited.reason ?? "").replace("invite:", "");
    expect((await command("AcceptOwnerInvite", bidder, { inviteId })).accepted).toBe(true);
    expect((await conduct("GrantPaddle", { teamId: teamIds[i], personId: bidder })).accepted).toBe(
      true,
    );
    expect((await command("ClaimPaddle", bidder, { teamId: teamIds[i] })).accepted).toBe(true);
  }
  const paddleRows = await db
    .select({ id: paddlesTable.id, personId: paddlesTable.personId, teamId: paddlesTable.teamId })
    .from(paddlesTable)
    .where(eq(paddlesTable.auctionId, auctionId));
  for (const row of paddleRows) {
    paddleOfBidder.set(row.personId, row.id);
    teamOfPaddle.set(row.id, row.teamId);
  }
  expect((await conduct("QueueLots")).accepted).toBe(true);
  expect((await conduct("OpenAuction")).accepted).toBe(true);
}, 120_000);

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
  await deletePeopleCascading([ownerId, ...bidderIds, ...playerIds]);
  await sql.end();
});

/** What one bidder sends this round: mostly a real bid, sometimes an attack. */
function bidFor(bidder: string, lotId: string, nextMinimum: number): Record<string, unknown> {
  const ownPaddle = paddleOfBidder.get(bidder) ?? "";
  const someoneElses = pick(bidderIds.filter((id) => id !== bidder));
  const roll = random();
  const amountRaw =
    roll < 0.45
      ? nextMinimum // the honest next rung
      : roll < 0.6
        ? nextMinimum + STEP * (1 + Math.floor(random() * 4)) // a jump, still on the ladder
        : roll < 0.68
          ? nextMinimum - STEP // a rung the room has passed
          : roll < 0.76
            ? nextMinimum + 1 // off the ladder by one paisa
            : roll < 0.82
              ? -nextMinimum
              : roll < 0.87
                ? 0
                : roll < 0.92
                  ? nextMinimum + 0.5
                  : roll < 0.96
                    ? Number.MAX_SAFE_INTEGER
                    : Number(CONFIG.pursePerTeam) + STEP; // one rung past a whole purse
  return {
    lotId,
    // One bid in ten is placed with a paddle the bidder does not hold.
    paddleId: chance(0.1) ? (paddleOfBidder.get(someoneElses) ?? "") : ownPaddle,
    amountRaw,
  };
}

describe(`AUCTION INTEGRITY — a random hostile night (seed ${String(SEED)})`, () => {
  it("holds every invariant after every lot, through concurrent bids, retries, restarts and both closes", async () => {
    const queue = engine.snapshotOf(auctionId)?.snapshot?.queue ?? [];
    expect(queue.length).toBe(LOTS);

    for (const [index, entry] of queue.entries()) {
      const where = `lot ${String(index + 1)}/${String(LOTS)}`;
      fakeNow = Date.now();
      expect((await conduct("OpenLot", { lotId: entry.lotId })).accepted, `${where} opens`).toBe(
        true,
      );

      const rounds = Math.floor(random() * 6);
      for (let round = 0; round < rounds; round++) {
        fakeNow = Date.now();
        const nextMinimum =
          engine.snapshotOf(auctionId)?.snapshot?.currentLot?.nextMinimumBid ?? BASE;
        const sends: Promise<CommandAck>[] = [];
        for (const bidder of bidderIds) {
          const payload = bidFor(bidder, entry.lotId, nextMinimum);
          if (chance(0.2)) {
            // A RETRY: the same command, twice, at the same moment. Both
            // answers must be the same answer, and it must have run once.
            const commandId = newId();
            const first = command("PlaceBid", bidder, payload, { commandId });
            const second = command("PlaceBid", bidder, payload, { commandId });
            sends.push(first, second);
            void Promise.all([first, second]).then(([a, b]) => {
              expect(
                b,
                `seed ${String(SEED)} · ${where}: a retry gets the original answer`,
              ).toEqual(a);
            });
          } else {
            sends.push(command("PlaceBid", bidder, payload));
          }
        }
        const acks = await Promise.all(sends);
        // However many were sent at one price, the log says who won; what
        // can be said here is that the engine answered every one of them.
        for (const ack of acks) {
          expect(typeof ack.accepted).toBe("boolean");
        }

        if (chance(0.15)) {
          // THE ENGINE DIES AND COMES BACK, mid-lot. A new process has no
          // memory: everything it knows, it reads from the event log.
          await engine.settle(auctionId);
          engine = newEngine();
          tally.restarts += 1;
          expect(await engine.ensureAuction(auctionId), `${where}: reloads`).not.toBeNull();
          await assertInvariants(`${where} · after a restart in round ${String(round + 1)}`);
        }
        if (chance(0.1)) {
          expect((await conduct("PauseAuction")).accepted, `${where} pauses`).toBe(true);
          // A paused room takes no bids and no gavel.
          const duringPause = await command("PlaceBid", bidderIds[0] as string, {
            lotId: entry.lotId,
            paddleId: paddleOfBidder.get(bidderIds[0] as string),
            amountRaw: nextMinimum + STEP * 9,
          });
          expect(duringPause.accepted, `${where}: no bid lands while paused`).toBe(false);
          expect((await conduct("CloseLot", { lotId: entry.lotId })).accepted).toBe(false);
          expect((await conduct("ResumeAuction")).accepted, `${where} resumes`).toBe(true);
        }
      }

      const before = engine.snapshotOf(auctionId)?.snapshot?.currentLot;
      expect(before?.lotId, `${where} is still on the block`).toBe(entry.lotId);
      if (chance(0.5)) {
        expect((await conduct("CloseLot", { lotId: entry.lotId })).accepted, `${where} gavel`).toBe(
          true,
        );
      } else {
        // THE CLOCK runs out: the engine's own tick closes the lot, through
        // the same queue as every bid.
        fakeNow = (before?.endsAtMs ?? Date.now()) + 1;
        engine.tick();
        await engine.settle(auctionId);
      }
      const after = engine.snapshotOf(auctionId)?.snapshot;
      expect(after?.currentLot ?? null, `${where} left the block`).toBeNull();

      // A BID AFTER THE HAMMER, from everyone at once.
      const late = await Promise.all(
        bidderIds.map((bidder) =>
          command("PlaceBid", bidder, {
            lotId: entry.lotId,
            paddleId: paddleOfBidder.get(bidder),
            amountRaw: (before?.nextMinimumBid ?? BASE) + STEP,
          }),
        ),
      );
      expect(
        late.some((ack) => ack.accepted),
        `seed ${String(SEED)} · ${where}: no bid is accepted after the lot closed`,
      ).toBe(false);

      await assertInvariants(where);
    }

    // The night ends. Short squads are possible on a random night, so the
    // conductor closes on the record.
    const completed = await conduct("CompleteAuction", {
      overrideSquadMinimum: true,
      reason: "fuzz night over",
    });
    expect(completed.accepted, "the auction completes").toBe(true);
    await assertInvariants("after completion");

    // AFTER THE NIGHT, NOTHING MOVES.
    const firstLot = queue[0]?.lotId ?? "";
    for (const [type, payload] of [
      ["OpenLot", { lotId: firstLot }],
      ["RequeueLot", { lotId: firstLot }],
      ["WithdrawLot", { lotId: firstLot }],
      ["ResumeAuction", {}],
      ["OpenAuction", {}],
    ] as const) {
      expect((await conduct(type, payload)).accepted, `${type} after completion`).toBe(false);
    }
    const afterHours = await command("PlaceBid", bidderIds[0] as string, {
      lotId: firstLot,
      paddleId: paddleOfBidder.get(bidderIds[0] as string),
      amountRaw: BASE,
    });
    expect(afterHours.accepted, "no bid on a completed auction").toBe(false);
    await assertInvariants("after the post-completion attempts");

    // The night must have actually exercised what it claims to.
    expect(tally.accepted, "bids and commands were accepted").toBeGreaterThan(LOTS);
    expect(tally.rejected, "hostile input was refused").toBeGreaterThan(LOTS);
    expect(
      tally.byReason.get("rate_limited") ?? 0,
      `seed ${String(SEED)}: nobody is rate limited for a clock that stepped backwards`,
    ).toBe(0);
    // eslint-disable-next-line no-console -- the one line that makes a failure replayable
    console.log(
      `fuzz night: seed ${String(SEED)} · ${String(tally.commands)} commands · ` +
        `${String(tally.accepted)} accepted · ${String(tally.rejected)} refused · ` +
        `${String(tally.restarts)} restarts · refusals ${JSON.stringify(Object.fromEntries(tally.byReason))}`,
    );
  }, 300_000);
});
