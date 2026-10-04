import {
  buildAuctionLedger,
  type AuctionConfig,
  type AuctionStatus,
  type BidStatus,
  type LotStatus,
} from "@desiauction/core";
import {
  auctionEvents,
  auctionOwnerInvites,
  auctions,
  bids,
  lots,
  paddleGrants,
  paddles,
  people,
  registrations,
  teams,
  type Db,
} from "@desiauction/db";
import { and, asc, desc, eq, inArray, isNull, sql, type AnyColumn, type SQL } from "drizzle-orm";

import { loadEvents, type AuctionRecord } from "./aggregate";
import { lotPlayerName, snapshotRefs } from "./live";

// Auction read models (M-IP4-1). Read-only, plain frozen shapes — the same
// discipline as the Competition snapshots. Mutations live ONLY in the
// aggregate; nothing here writes.

/**
 * "THE SEASON'S AUCTION" MEANS THE REAL ONE (0101).
 *
 * A season can also carry a practice auction — the organiser's rehearsal,
 * same engine, same screens. Every query that finds an auction BY SEASON (or
 * by org, person, player…) rather than by an auction id it was handed must
 * say which it means, or a rehearsal sale turns up on a public page, a
 * poster or a career. These two are how it says so; the guard test
 * `real-auction-filter.regression.test.ts` (apps/web) keeps it said.
 */
export function isRealAuction(): SQL {
  return eq(auctions.kind, "real");
}

/** For an `auction_id` column on lots, paddles, bids…: it belongs to a real auction. */
export function inRealAuction(auctionIdColumn: AnyColumn): SQL {
  return sql`${auctionIdColumn} in (select ${auctions.id} from ${auctions} where ${auctions.kind} = 'real')`;
}

const RECORD_FIELDS = {
  id: auctions.id,
  orgId: auctions.orgId,
  competitionId: auctions.competitionId,
  name: auctions.name,
  status: auctions.status,
  config: auctions.config,
  kind: auctions.kind,
  enteredByHand: auctions.enteredByHand,
} as const;

/** The season's REAL auction (the newest, as before 0101). Never a practice. */
export async function auctionOf(db: Db, competitionId: string): Promise<AuctionRecord | null> {
  const [row] = await db
    .select(RECORD_FIELDS)
    .from(auctions)
    .where(and(eq(auctions.competitionId, competitionId), isRealAuction()))
    .orderBy(desc(auctions.createdAt))
    .limit(1);
  if (row === undefined) {
    return null;
  }
  return { ...row, config: row.config as AuctionConfig };
}

/** The season's practice that has not ended (scheduled, live or paused), if any. */
export async function practiceOf(db: Db, competitionId: string): Promise<AuctionRecord | null> {
  const [row] = await db
    .select(RECORD_FIELDS)
    .from(auctions)
    .where(
      and(
        eq(auctions.competitionId, competitionId),
        eq(auctions.kind, "practice"),
        sql`${auctions.status} <> 'abandoned'`,
      ),
    )
    .orderBy(desc(auctions.createdAt))
    .limit(1);
  if (row === undefined) {
    return null;
  }
  return { ...row, config: row.config as AuctionConfig };
}

/**
 * WHICH AUCTION THE ROOM SHOWS — the one question the live screens ask.
 *
 * The practice, while one is running and the real auction has not started;
 * the real auction otherwise. `prefer: "real"` is the room switch: anyone can
 * step out of a practice to look at the real auction's waiting room. Once the
 * real auction leaves `scheduled`, the practice is over (opening it ends the
 * practice) and the room is the night's, whatever was asked.
 */
export async function roomAuctionOf(
  db: Db,
  competitionId: string,
  prefer: "practice" | "real" = "practice",
): Promise<{ auction: AuctionRecord; real: AuctionRecord; practice: AuctionRecord | null } | null> {
  const real = await auctionOf(db, competitionId);
  if (real === null) {
    return null;
  }
  const practice = real.status === "scheduled" ? await practiceOf(db, competitionId) : null;
  return {
    auction: practice !== null && prefer === "practice" ? practice : real,
    real,
    practice,
  };
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
    /** Held outside the app and typed in afterwards (0106): there was no room. */
    enteredByHand: boolean;
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
        playerName: lotPlayerName,
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
      enteredByHand: auction.enteredByHand === true,
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

// --- AuctionLedger + owner board (M-IP4-3) ------------------------------------------

/**
 * The AuctionLedger read model: fold the immutable log through core's pure
 * builder with names resolved. Regenerated on demand — a projection of the
 * event store, so it can never diverge from history and nothing can mutate it.
 */
export async function ledgerOf(db: Db, auction: AuctionRecord) {
  const [events, refs] = await Promise.all([loadEvents(db, auction.id), snapshotRefs(db, auction)]);
  const actorIds = [...new Set(events.map((event) => event.actor))];
  const actorRows =
    actorIds.length > 0
      ? await db
          .select({ id: people.id, name: people.name })
          .from(people)
          .where(inArray(people.id, actorIds))
      : [];
  const actorNames: Record<string, string> = {
    // The engine's own actions (timer expiry, closing-soon) attribute to it.
    "00000000000000000000000000": "Engine",
  };
  for (const row of actorRows) {
    if (row.name !== null) {
      actorNames[row.id] = row.name;
    }
  }
  return buildAuctionLedger(events, refs, actorNames);
}

export interface OwnerInviteView {
  readonly id: string;
  readonly teamId: string;
  readonly teamName: string;
  readonly acceptedBy: string | null;
  readonly acceptedByName: string | null;
  readonly expiresAtMs: number;
  readonly expired: boolean;
}

export interface PaddleGrantView {
  readonly id: string;
  readonly teamId: string;
  readonly teamName: string;
  readonly personId: string;
  readonly personName: string | null;
  readonly claimed: boolean;
}

export interface OwnerBoard {
  readonly invites: readonly OwnerInviteView[];
  readonly grants: readonly PaddleGrantView[];
}

/** The cockpit's owner-workflow panel: invites, acceptances, grants, claims. */
export async function ownerBoard(db: Db, auction: AuctionRecord): Promise<OwnerBoard> {
  const [inviteRows, grantRows, activePaddles] = await Promise.all([
    db
      .select({
        id: auctionOwnerInvites.id,
        teamId: auctionOwnerInvites.teamId,
        teamName: teams.name,
        acceptedBy: auctionOwnerInvites.acceptedBy,
        acceptedByName: people.name,
        expiresAt: auctionOwnerInvites.expiresAt,
      })
      .from(auctionOwnerInvites)
      .leftJoin(teams, eq(teams.id, auctionOwnerInvites.teamId))
      .leftJoin(people, eq(people.id, auctionOwnerInvites.acceptedBy))
      .where(
        and(eq(auctionOwnerInvites.auctionId, auction.id), isNull(auctionOwnerInvites.revokedAt)),
      )
      .orderBy(asc(auctionOwnerInvites.createdAt)),
    db
      .select({
        id: paddleGrants.id,
        teamId: paddleGrants.teamId,
        teamName: teams.name,
        personId: paddleGrants.personId,
        personName: people.name,
      })
      .from(paddleGrants)
      .leftJoin(teams, eq(teams.id, paddleGrants.teamId))
      .leftJoin(people, eq(people.id, paddleGrants.personId))
      .where(and(eq(paddleGrants.auctionId, auction.id), isNull(paddleGrants.revokedAt)))
      .orderBy(asc(paddleGrants.createdAt)),
    db
      .select({ teamId: paddles.teamId, personId: paddles.personId })
      .from(paddles)
      .where(and(eq(paddles.auctionId, auction.id), isNull(paddles.releasedAt))),
  ]);
  const nowMs = Date.now();
  const held = new Set(activePaddles.map((paddle) => `${paddle.teamId}:${paddle.personId}`));
  return Object.freeze({
    invites: inviteRows.map((row) =>
      Object.freeze({
        id: row.id,
        teamId: row.teamId,
        teamName: row.teamName ?? "Unknown",
        acceptedBy: row.acceptedBy,
        acceptedByName: row.acceptedByName,
        expiresAtMs: row.expiresAt.getTime(),
        expired: row.expiresAt.getTime() < nowMs && row.acceptedBy === null,
      }),
    ),
    grants: grantRows.map((row) =>
      Object.freeze({
        id: row.id,
        teamId: row.teamId,
        teamName: row.teamName ?? "Unknown",
        personId: row.personId,
        personName: row.personName,
        claimed: held.has(`${row.teamId}:${row.personId}`),
      }),
    ),
  });
}
