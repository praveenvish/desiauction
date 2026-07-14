import {
  buildAuctionSnapshot,
  replayAuction,
  serializeSnapshot,
  type AuctionProjection,
  type AuctionSnapshot,
  type CurrentLotBids,
  type SnapshotRefs,
} from "@desiauction/core";
import { bids, lots, paddles, people, registrations, teams, type Db } from "@desiauction/db";
import { and, asc, eq } from "drizzle-orm";

import {
  diffProjection,
  loadBidRows,
  loadEvents,
  loadPaddleRows,
  type AuctionRecord,
} from "./aggregate";

// Live snapshot assembly (M-IP4-2). The engine's read path: fold the event log
// (core's pure reducer), assemble static reference data, build the immutable
// AuctionSnapshot. Deterministic end to end — no clock is read anywhere here.

export async function snapshotRefs(db: Db, auction: AuctionRecord): Promise<SnapshotRefs> {
  const [lotRows, paddleRows] = await Promise.all([
    db
      .select({
        id: lots.id,
        lotNumber: lots.lotNumber,
        seq: lots.seq,
        playerName: people.name,
        role: registrations.role,
        basePrice: lots.basePrice,
      })
      .from(lots)
      .leftJoin(registrations, eq(registrations.id, lots.registrationId))
      .leftJoin(people, eq(people.id, registrations.personId))
      .where(eq(lots.auctionId, auction.id))
      .orderBy(asc(lots.seq)),
    db
      .select({
        id: paddles.id,
        paddleNumber: paddles.paddleNumber,
        teamId: paddles.teamId,
        teamName: teams.name,
      })
      .from(paddles)
      .leftJoin(teams, eq(teams.id, paddles.teamId))
      .where(eq(paddles.auctionId, auction.id))
      .orderBy(asc(paddles.paddleNumber)),
  ]);
  const lotRefs: Record<string, SnapshotRefs["lots"][string]> = {};
  for (const row of lotRows) {
    lotRefs[row.id] = {
      lotNumber: row.lotNumber,
      seq: row.seq,
      playerName: row.playerName,
      role: row.role ?? "",
      basePrice: row.basePrice,
    };
  }
  const paddleRefs: Record<string, SnapshotRefs["paddles"][string]> = {};
  for (const row of paddleRows) {
    paddleRefs[row.id] = {
      paddleNumber: row.paddleNumber,
      teamId: row.teamId,
      teamName: row.teamName ?? "Unknown",
    };
  }
  return {
    auctionId: auction.id,
    auctionName: auction.name,
    pursePerTeam: auction.config.pursePerTeam,
    slabs: auction.config.slabs,
    lots: lotRefs,
    paddles: paddleRefs,
  };
}

/**
 * The current lot's bid history in event order (snapshot input).
 *
 * Deliberately UNFILTERED by bid status: a bid voided by an undo or a requeue
 * override stays "voided-but-visible" (M-IP4-3) — the cockpit and the stage see
 * what was reversed rather than money silently vanishing. Certification
 * (M-IP4-4) confirmed this is intentional and carries no money impact:
 * `decideBid` and `nextMinimumBid` read the LEADING amount, which the reducer
 * clears on reopen. The known constraint — SnapshotBidEntry has no `voided`
 * marker, so a reversed bid is not visually distinguishable in the history — is
 * recorded in SNAPSHOT.md and deferred to a post-freeze wire-contract change.
 */
export async function currentLotBids(
  db: Db,
  auctionId: string,
  lotId: string,
): Promise<CurrentLotBids> {
  const rows = await db
    .select({ bidId: bids.id, paddleId: bids.paddleId, amount: bids.amount })
    .from(bids)
    .where(and(eq(bids.auctionId, auctionId), eq(bids.lotId, lotId)))
    .orderBy(asc(bids.eventSeq));
  return { lotId, bids: rows };
}

export type LiveSnapshotResult =
  | {
      ok: true;
      snapshot: AuctionSnapshot;
      serialized: string;
      projection: AuctionProjection;
      divergences: string[];
    }
  | { ok: false; reason: string; atSeq: number };

/**
 * Fold events → verify against the row projections (the watchdog's
 * projection-mismatch check) → build + serialize the snapshot. A replay that
 * fails closed returns the offending seq and NOTHING else — the engine halts
 * that auction rather than serving a lying snapshot.
 */
export async function buildLiveSnapshot(
  db: Db,
  auction: AuctionRecord,
): Promise<LiveSnapshotResult> {
  const events = await loadEvents(db, auction.id);
  const replay = replayAuction(events);
  if (!replay.ok) {
    return { ok: false, reason: replay.reason, atSeq: replay.atSeq };
  }
  const [lotRows, bidRows, paddleRows] = await Promise.all([
    db
      .select({
        id: lots.id,
        status: lots.status,
        soldPrice: lots.soldPrice,
        soldToPaddleId: lots.soldToPaddleId,
        roundsUsed: lots.roundsUsed,
      })
      .from(lots)
      .where(eq(lots.auctionId, auction.id)),
    loadBidRows(db, auction.id),
    loadPaddleRows(db, auction.id),
  ]);
  const divergences = diffProjection(
    replay.projection,
    auction.status,
    lotRows,
    bidRows,
    paddleRows,
  );
  const refs = await snapshotRefs(db, auction);
  const onBlockId = Object.entries(replay.projection.lots).find(
    ([, lot]) => lot.status === "on_block" || lot.status === "closing_soon",
  )?.[0];
  const lotBids = onBlockId !== undefined ? await currentLotBids(db, auction.id, onBlockId) : null;
  const snapshot = buildAuctionSnapshot(replay.projection, refs, lotBids);
  return {
    ok: true,
    snapshot,
    serialized: serializeSnapshot(snapshot),
    projection: replay.projection,
    divergences,
  };
}
