import type { AuctionConfig, AuctionStatus, BidStatus, LotStatus } from "@desiauction/core";
import {
  auctionEvents,
  auctions,
  bids,
  lots,
  paddles,
  people,
  registrations,
  teams,
  type Db,
} from "@desiauction/db";
import { and, asc, desc, eq, sql } from "drizzle-orm";

import type { AuctionRecord } from "./aggregate";

// Auction read models (M-IP4-1). Read-only, plain frozen shapes — the same
// discipline as the Competition snapshots. Mutations live ONLY in the
// aggregate; nothing here writes.

export async function auctionOf(db: Db, competitionId: string): Promise<AuctionRecord | null> {
  const [row] = await db
    .select({
      id: auctions.id,
      orgId: auctions.orgId,
      competitionId: auctions.competitionId,
      name: auctions.name,
      status: auctions.status,
      config: auctions.config,
    })
    .from(auctions)
    .where(eq(auctions.competitionId, competitionId))
    .orderBy(desc(auctions.createdAt))
    .limit(1);
  if (row === undefined) {
    return null;
  }
  return { ...row, config: row.config as AuctionConfig };
}

export interface PaddleView {
  readonly id: string;
  readonly paddleNumber: string;
  readonly teamId: string;
  readonly teamName: string;
  readonly holderName: string | null;
  readonly committed: number; // paise
  readonly squadSize: number;
}

export interface LotView {
  readonly id: string;
  readonly lotNumber: string;
  readonly seq: number;
  readonly playerName: string | null;
  readonly role: string;
  readonly basePrice: number;
  readonly status: LotStatus;
  readonly roundsUsed: number;
  readonly endsAtMs: number | null;
  readonly soldPrice: number | null;
  readonly soldToPaddle: string | null;
  readonly bidCount: number;
}

export interface AuctionEventView {
  readonly seq: number;
  readonly type: string;
  readonly atMs: number;
  readonly correlationId: string;
}

export interface AuctionView {
  readonly auction: {
    id: string;
    name: string;
    status: AuctionStatus;
    config: AuctionConfig;
  };
  readonly paddles: readonly PaddleView[];
  readonly lots: readonly LotView[];
  readonly lotStats: Readonly<Record<LotStatus, number>>;
  readonly events: readonly AuctionEventView[];
  readonly eventCount: number;
}

export async function auctionView(db: Db, auction: AuctionRecord): Promise<AuctionView> {
  const [paddleRows, lotRows, eventRows, countRow] = await Promise.all([
    db
      .select({
        id: paddles.id,
        paddleNumber: paddles.paddleNumber,
        teamId: paddles.teamId,
        teamName: teams.name,
        holderName: people.name,
      })
      .from(paddles)
      .leftJoin(teams, eq(teams.id, paddles.teamId))
      .leftJoin(people, eq(people.id, paddles.personId))
      .where(eq(paddles.auctionId, auction.id))
      .orderBy(asc(paddles.paddleNumber)),
    db
      .select({
        id: lots.id,
        lotNumber: lots.lotNumber,
        seq: lots.seq,
        playerName: people.name,
        role: registrations.role,
        basePrice: lots.basePrice,
        status: lots.status,
        roundsUsed: lots.roundsUsed,
        endsAtMs: lots.endsAtMs,
        soldPrice: lots.soldPrice,
        soldToPaddleId: lots.soldToPaddleId,
        bidCount: sql<number>`(select count(*)::int from ${bids} where ${bids.lotId} = ${lots.id})`,
      })
      .from(lots)
      .leftJoin(registrations, eq(registrations.id, lots.registrationId))
      .leftJoin(people, eq(people.id, registrations.personId))
      .where(eq(lots.auctionId, auction.id))
      .orderBy(asc(lots.seq)),
    db
      .select({
        seq: auctionEvents.seq,
        type: auctionEvents.type,
        atMs: auctionEvents.atMs,
        correlationId: auctionEvents.correlationId,
      })
      .from(auctionEvents)
      .where(eq(auctionEvents.auctionId, auction.id))
      .orderBy(desc(auctionEvents.seq))
      .limit(50),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(auctionEvents)
      .where(eq(auctionEvents.auctionId, auction.id)),
  ]);

  const committedByPaddle = new Map<string, { committed: number; squad: number }>();
  const paddleNumberById = new Map(paddleRows.map((p) => [p.id, p.paddleNumber]));
  for (const lot of lotRows) {
    if (lot.soldToPaddleId !== null && lot.soldPrice !== null) {
      const entry = committedByPaddle.get(lot.soldToPaddleId) ?? { committed: 0, squad: 0 };
      entry.committed += lot.soldPrice;
      entry.squad += 1;
      committedByPaddle.set(lot.soldToPaddleId, entry);
    }
  }
  const lotStats: Record<LotStatus, number> = {
    prepared: 0,
    queued: 0,
    on_block: 0,
    closing_soon: 0,
    sold: 0,
    unsold: 0,
    frozen: 0,
    withdrawn: 0,
  };
  for (const lot of lotRows) {
    lotStats[lot.status] += 1;
  }

  return Object.freeze({
    auction: {
      id: auction.id,
      name: auction.name,
      status: auction.status,
      config: auction.config,
    },
    paddles: paddleRows.map((row) =>
      Object.freeze({
        id: row.id,
        paddleNumber: row.paddleNumber,
        teamId: row.teamId,
        teamName: row.teamName ?? "Unknown",
        holderName: row.holderName,
        committed: committedByPaddle.get(row.id)?.committed ?? 0,
        squadSize: committedByPaddle.get(row.id)?.squad ?? 0,
      }),
    ),
    lots: lotRows.map((row) =>
      Object.freeze({
        id: row.id,
        lotNumber: row.lotNumber,
        seq: row.seq,
        playerName: row.playerName,
        role: row.role ?? "",
        basePrice: row.basePrice,
        status: row.status,
        roundsUsed: row.roundsUsed,
        endsAtMs: row.endsAtMs,
        soldPrice: row.soldPrice,
        soldToPaddle:
          row.soldToPaddleId === null ? null : (paddleNumberById.get(row.soldToPaddleId) ?? null),
        bidCount: row.bidCount,
      }),
    ),
    lotStats,
    events: eventRows,
    eventCount: countRow[0]?.count ?? 0,
  });
}

export interface BidRow {
  readonly id: string;
  readonly lotId: string;
  readonly paddleId: string;
  readonly amount: number;
  readonly status: BidStatus;
  readonly eventSeq: number;
}

/** A lot's bid history in event order — the immutable evidence trail. */
export async function bidsOf(db: Db, auctionId: string, lotId: string): Promise<BidRow[]> {
  return db
    .select({
      id: bids.id,
      lotId: bids.lotId,
      paddleId: bids.paddleId,
      amount: bids.amount,
      status: bids.status,
      eventSeq: bids.eventSeq,
    })
    .from(bids)
    .where(and(eq(bids.auctionId, auctionId), eq(bids.lotId, lotId)))
    .orderBy(asc(bids.eventSeq));
}
