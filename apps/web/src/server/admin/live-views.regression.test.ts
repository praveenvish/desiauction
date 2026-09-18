// THE LIVE BOARD, AGAINST REAL POSTGRES.
//
// Four auctions in one club: a busy room, a room that went silent thirteen
// hours ago with its status still `live`, one that closed an hour ago and one
// that closed two days ago. The board must put each in the right list, count
// the room from the database's own rows (invalidated bids are not bids), and
// name the times from the event log — never from `auctions.created_at`.
import { registrationNumber } from "@desiauction/core";
import {
  auctionEvents,
  auctions,
  bids,
  competitions,
  createDb,
  lots,
  newId,
  organizations,
  paddles,
  people,
  registrations,
  teams,
  type DbHandle,
} from "@desiauction/db";
import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { env } from "../../env";
import { purgeOrg } from "../test-support/purge-org";
import {
  ACTIVE_WINDOW_MS,
  STALE_AFTER_MS,
  auctionPulse,
  liveAuctionBoard,
  roomState,
} from "./live-views";

const handle: DbHandle = createDb(env.DATABASE_URL);
const db = handle.db;

const MARK = "LIVEBOARD-REGRESSION";
const MIN = 60_000;
const HOUR = 60 * MIN;
const NOW = Date.now();

let orgId = "";
/** The season of the auction created last — the busy room's, while it is seeded. */
let competitionId = "";
let creator = "";
const personIds: string[] = [];
let busy = "";
let silent = "";
let closedRecently = "";
let closedLongAgo = "";
let paddleA = "";
let paddleB = "";

async function person(name: string): Promise<string> {
  const id = newId();
  // Every person must be reachable (people_reachable_check); an address that
  // can never deliver is enough for a fixture.
  await db
    .insert(people)
    .values({ id, name: `${MARK} ${name}`, email: `liveboard-${id.toLowerCase()}@example.test` });
  personIds.push(id);
  return id;
}

/** One auction per season — `auctions_competition_active_uq` allows no more. */
async function auction(status: "live" | "completed", name: string): Promise<string> {
  const id = newId();
  const seasonId = newId();
  await db.insert(competitions).values({
    id: seasonId,
    orgId,
    sport: "cricket",
    name: `${MARK} ${name} Season`,
    slug: `liveboard-s-${seasonId.toLowerCase()}`,
    createdBy: creator,
  });
  competitionId = seasonId;
  await db.insert(auctions).values({
    id,
    orgId,
    competitionId,
    name: `${MARK} ${name}`,
    status,
    config: {},
    createdBy: creator,
  });
  return id;
}

async function event(auctionId: string, seq: number, type: string, atMs: number): Promise<void> {
  await db.insert(auctionEvents).values({
    id: newId(),
    orgId,
    auctionId,
    seq,
    type,
    atMs,
    actor: creator,
    correlationId: newId(),
    payload: {},
  });
}

async function lot(
  auctionId: string,
  seq: number,
  status: "sold" | "unsold" | "queued" | "on_block" | "withdrawn",
  sale?: { paddleId: string; price: number },
): Promise<string> {
  const player = await person(`Player ${String(seq)}`);
  const registrationId = newId();
  await db.insert(registrations).values({
    id: registrationId,
    orgId,
    competitionId,
    personId: player,
    role: "batter",
    status: "approved",
    registrationNumber: registrationNumber(registrationId),
  });
  const id = newId();
  await db.insert(lots).values({
    id,
    orgId,
    auctionId,
    registrationId,
    lotNumber: `L${String(seq)}`,
    seq,
    basePrice: 100_000_00,
    status,
    ...(sale === undefined ? {} : { soldToPaddleId: sale.paddleId, soldPrice: sale.price }),
  });
  return id;
}

async function bid(
  auctionId: string,
  lotId: string,
  paddleId: string,
  amount: number,
  eventSeq: number,
  placedAtMs: number,
  status: "accepted" | "outbid" | "invalidated" = "accepted",
): Promise<void> {
  await db.insert(bids).values({
    id: newId(),
    orgId,
    auctionId,
    lotId,
    paddleId,
    amount,
    status,
    eventSeq,
    placedAtMs,
  });
}

beforeAll(async () => {
  creator = await person("Organizer");
  orgId = newId();
  await db.insert(organizations).values({
    id: orgId,
    name: `${MARK} Club`,
    slug: `liveboard-${orgId.toLowerCase()}`,
    createdBy: creator,
  });

  // --- The busy room ----------------------------------------------------------
  busy = await auction("live", "Busy");
  const teamA = newId();
  const teamB = newId();
  await db.insert(teams).values([
    { id: teamA, orgId, competitionId, name: `${MARK} Strikers`, createdBy: creator },
    { id: teamB, orgId, competitionId, name: `${MARK} Titans`, createdBy: creator },
  ]);
  paddleA = newId();
  paddleB = newId();
  await db.insert(paddles).values([
    { id: paddleA, orgId, auctionId: busy, teamId: teamA, personId: creator, paddleNumber: "P01" },
    { id: paddleB, orgId, auctionId: busy, teamId: teamB, personId: creator, paddleNumber: "P02" },
  ]);
  await event(busy, 1, "AuctionOpened", NOW - 2 * HOUR);
  const sold1 = await lot(busy, 1, "sold", { paddleId: paddleA, price: 500_000_00 });
  await lot(busy, 2, "sold", { paddleId: paddleB, price: 300_000_00 });
  await lot(busy, 3, "unsold");
  await lot(busy, 4, "withdrawn");
  const onBlock = await lot(busy, 5, "on_block");
  await lot(busy, 6, "queued");
  // Old bids on lot 1, recent ones on the lot under the hammer, and one the
  // organizer invalidated — which is not a bid at all.
  await bid(busy, sold1, paddleB, 400_000_00, 2, NOW - HOUR, "outbid");
  await bid(busy, sold1, paddleA, 500_000_00, 3, NOW - HOUR + MIN);
  await bid(busy, onBlock, paddleA, 150_000_00, 4, NOW - 3 * MIN, "outbid");
  await bid(busy, onBlock, paddleB, 200_000_00, 5, NOW - 2 * MIN, "invalidated");
  await bid(busy, onBlock, paddleB, 250_000_00, 6, NOW - MIN);
  await event(busy, 7, "BidAccepted", NOW - MIN);

  // --- The room nobody closed -------------------------------------------------
  silent = await auction("live", "Silent");
  await event(silent, 1, "AuctionOpened", NOW - 2 * STALE_AFTER_MS);
  await event(silent, 2, "LotSold", NOW - STALE_AFTER_MS - HOUR);

  // --- Two that closed --------------------------------------------------------
  closedRecently = await auction("completed", "Closed recently");
  await event(closedRecently, 1, "AuctionOpened", NOW - 4 * HOUR);
  await event(closedRecently, 2, "AuctionClosed", NOW - HOUR);
  closedLongAgo = await auction("completed", "Closed long ago");
  await event(closedLongAgo, 1, "AuctionOpened", NOW - 50 * HOUR);
  await event(closedLongAgo, 2, "AuctionClosed", NOW - 48 * HOUR);
}, 60_000);

afterAll(async () => {
  if (orgId !== "") {
    await purgeOrg(db, orgId);
  }
  if (personIds.length > 0) {
    await db.delete(registrations).where(inArray(registrations.personId, personIds));
    await db.delete(people).where(inArray(people.id, personIds));
  }
  await handle.sql.end();
}, 60_000);

describe("roomState", () => {
  it("reads recency, not the status column", () => {
    expect(roomState("live", NOW - MIN, NOW)).toBe("active");
    expect(roomState("live", NOW - ACTIVE_WINDOW_MS - MIN, NOW)).toBe("quiet");
    expect(roomState("paused", NOW - MIN, NOW)).toBe("paused");
    expect(roomState("live", NOW - STALE_AFTER_MS - MIN, NOW)).toBe("stale");
    // A paused room silent for a day is still a room nobody closed.
    expect(roomState("paused", NOW - STALE_AFTER_MS - MIN, NOW)).toBe("stale");
    expect(roomState("live", null, NOW)).toBe("stale");
  });
});

describe("liveAuctionBoard", () => {
  it("puts each auction in the list its own clock says it belongs to", async () => {
    const board = await liveAuctionBoard(db, NOW);
    const running = board.running.find((row) => row.auctionId === busy);
    expect(running?.state).toBe("active");
    expect(board.stale.map((row) => row.auctionId)).toContain(silent);
    expect(board.running.map((row) => row.auctionId)).not.toContain(silent);
    expect(board.ended.map((row) => row.auctionId)).toContain(closedRecently);
    expect(board.ended.map((row) => row.auctionId)).not.toContain(closedLongAgo);
  });

  it("counts the room from its own rows", async () => {
    const board = await liveAuctionBoard(db, NOW);
    const row = board.running.find((entry) => entry.auctionId === busy);
    expect(row?.lots).toEqual({ total: 6, sold: 2, unsold: 1, remaining: 2 });
    expect(row?.moneyMoved).toBe(800_000_00);
    // Five rows in the bids table, one invalidated: four bids.
    expect(row?.bids.total).toBe(4);
    // In the last five minutes: the outbid at -3m and the leader at -1m.
    expect(row?.bids.lastFiveMinutes).toBe(2);
    expect(row?.openedAtMs).toBe(NOW - 2 * HOUR);
    expect(row?.lastEventAtMs).toBe(NOW - MIN);
  });

  it("names when a closed auction ended, from its log", async () => {
    const board = await liveAuctionBoard(db, NOW);
    const ended = board.ended.find((row) => row.auctionId === closedRecently);
    expect(ended?.endedAtMs).toBe(NOW - HOUR);
  });
});

describe("auctionPulse", () => {
  it("reads the room's clock, its pulse and its tape — invalidated bids excluded", async () => {
    const pulse = await auctionPulse(db, busy, NOW);
    expect(pulse.openedAtMs).toBe(NOW - 2 * HOUR);
    expect(pulse.closedAtMs).toBeNull();
    expect(pulse.bidsTotal).toBe(4);
    expect(pulse.bidsLastFiveMinutes).toBe(2);
    expect(pulse.activeBidders).toBe(2);
    // Newest first, by the event log's order.
    expect(pulse.tape.map((row) => row.amount)).toEqual([
      250_000_00, 150_000_00, 500_000_00, 400_000_00,
    ]);
    expect(pulse.tape[0]).toMatchObject({
      lotNumber: "L5",
      paddleNumber: "P02",
      teamName: `${MARK} Titans`,
    });
  });

  it("names a closed auction's close", async () => {
    const pulse = await auctionPulse(db, closedRecently, NOW);
    expect(pulse.closedAtMs).toBe(NOW - HOUR);
    expect(pulse.bidsTotal).toBe(0);
    expect(pulse.tape).toEqual([]);
  });
});
