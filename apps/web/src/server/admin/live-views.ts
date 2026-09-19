import {
  auctionEvents,
  auctions,
  bids,
  competitions,
  lots,
  organizations,
  paddles,
  teams,
  type Db,
} from "@desiauction/db";
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";

/**
 * THE LIVE BOARD — every auction running right now, across every club.
 *
 * The question on an auction night is not "how many auctions are live" (the
 * status column has said `live` for days about auctions nobody closed) but
 * "which rooms are actually moving, and is anything wrong in one of them". So
 * every row carries its own clock: when it opened (the `AuctionOpened` event),
 * when anything last happened, and how many bids arrived in the last five
 * minutes. Recency decides which list a row is in; nothing here guesses.
 *
 * A projection like every other in this folder: committed state only, read on
 * whichever handle the caller passes, driven by the runtime read-only proof.
 * The engine's own view of each room (connections, queue, halts) is fetched
 * separately by the caller, because it is a network read with a timeout and
 * this module never leaves the database.
 *
 * Hand-written aliases in every correlated subquery: drizzle emits `${col}`
 * unqualified inside raw SQL, which once bound a subquery to the wrong table
 * (PX-9 finding — see views.ts).
 */

/** A room is ACTIVE if anything happened this recently. */
export const ACTIVE_WINDOW_MS = 15 * 60 * 1000;
/** Silent for longer than this, a `live` auction is a night nobody closed. */
export const STALE_AFTER_MS = 12 * 60 * 60 * 1000;
/** "Bids in the last five minutes" — the room's pulse. */
export const PULSE_WINDOW_MS = 5 * 60 * 1000;
/** How far back "recently ended" reaches. */
export const ENDED_WINDOW_MS = 24 * 60 * 60 * 1000;

const LIVE_STATUSES = ["live", "paused"] as const;
const ENDED_STATUSES = ["completed", "reconciled", "abandoned"] as const;

export type RoomState = "active" | "quiet" | "paused" | "stale";

export interface LiveAuctionRow {
  readonly auctionId: string;
  readonly auctionName: string;
  readonly status: string;
  readonly state: RoomState;
  readonly orgName: string;
  readonly orgSlug: string;
  readonly seasonName: string;
  readonly seasonSlug: string;
  readonly sport: string;
  readonly lots: {
    readonly total: number;
    readonly sold: number;
    readonly unsold: number;
    readonly remaining: number;
  };
  /** Paise across every sold lot. */
  readonly moneyMoved: number;
  readonly bids: { readonly total: number; readonly lastFiveMinutes: number };
  readonly openedAtMs: number | null;
  readonly lastEventAtMs: number | null;
}

export interface EndedAuctionRow {
  readonly auctionId: string;
  readonly auctionName: string;
  readonly status: string;
  readonly orgName: string;
  readonly seasonName: string;
  readonly sold: number;
  readonly unsold: number;
  readonly moneyMoved: number;
  readonly endedAtMs: number;
}

export interface LiveBoard {
  readonly generatedAtMs: number;
  /** Active, quiet and paused rooms — the ones a human might need to look at. */
  readonly running: readonly LiveAuctionRow[];
  /** `live` or `paused` in the database, silent for over twelve hours. */
  readonly stale: readonly LiveAuctionRow[];
  readonly ended: readonly EndedAuctionRow[];
}

export function roomState(status: string, lastEventAtMs: number | null, nowMs: number): RoomState {
  const silentFor = lastEventAtMs === null ? Number.POSITIVE_INFINITY : nowMs - lastEventAtMs;
  if (silentFor > STALE_AFTER_MS) {
    return "stale";
  }
  if (status === "paused") {
    return "paused";
  }
  return silentFor <= ACTIVE_WINDOW_MS ? "active" : "quiet";
}

function num(value: unknown): number {
  return typeof value === "number" ? value : Number(value ?? 0);
}

function numOrNull(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

export async function liveAuctionBoard(db: Db, nowMs: number): Promise<LiveBoard> {
  const pulseSince = nowMs - PULSE_WINDOW_MS;
  const [liveRows, endedRows] = await Promise.all([
    db
      .select({
        auctionId: auctions.id,
        auctionName: auctions.name,
        status: auctions.status,
        orgName: organizations.name,
        orgSlug: organizations.slug,
        seasonName: competitions.name,
        seasonSlug: competitions.slug,
        sport: competitions.sport,
        lotsTotal: sql<number>`(select count(*)::int from lots l where l.auction_id = auctions.id)`,
        lotsSold: sql<number>`(select count(*)::int from lots l where l.auction_id = auctions.id and l.status = 'sold')`,
        lotsUnsold: sql<number>`(select count(*)::int from lots l where l.auction_id = auctions.id and l.status = 'unsold')`,
        lotsWithdrawn: sql<number>`(select count(*)::int from lots l where l.auction_id = auctions.id and l.status = 'withdrawn')`,
        moneyMoved: sql<number>`(select coalesce(sum(l.sold_price), 0)::bigint from lots l where l.auction_id = auctions.id and l.status = 'sold')`,
        bidsTotal: sql<number>`(select count(*)::int from bids b where b.auction_id = auctions.id and b.status <> 'invalidated')`,
        bidsPulse: sql<number>`(select count(*)::int from bids b where b.auction_id = auctions.id and b.status <> 'invalidated' and b.placed_at_ms > ${pulseSince})`,
        openedAtMs: sql<
          number | null
        >`(select min(e.at_ms) from auction_events e where e.auction_id = auctions.id and e.type = 'AuctionOpened')`,
        lastEventAtMs: sql<
          number | null
        >`(select e.at_ms from auction_events e where e.auction_id = auctions.id order by e.seq desc limit 1)`,
      })
      .from(auctions)
      .innerJoin(organizations, eq(organizations.id, auctions.orgId))
      .innerJoin(competitions, eq(competitions.id, auctions.competitionId))
      .where(inArray(auctions.status, [...LIVE_STATUSES]))
      .limit(200),
    db
      .select({
        auctionId: auctions.id,
        auctionName: auctions.name,
        status: auctions.status,
        orgName: organizations.name,
        seasonName: competitions.name,
        sold: sql<number>`(select count(*)::int from lots l where l.auction_id = auctions.id and l.status = 'sold')`,
        unsold: sql<number>`(select count(*)::int from lots l where l.auction_id = auctions.id and l.status = 'unsold')`,
        moneyMoved: sql<number>`(select coalesce(sum(l.sold_price), 0)::bigint from lots l where l.auction_id = auctions.id and l.status = 'sold')`,
        endedAtMs: sql<number>`(select e.at_ms from auction_events e where e.auction_id = auctions.id order by e.seq desc limit 1)`,
      })
      .from(auctions)
      .innerJoin(organizations, eq(organizations.id, auctions.orgId))
      .innerJoin(competitions, eq(competitions.id, auctions.competitionId))
      .where(
        and(
          inArray(auctions.status, [...ENDED_STATUSES]),
          // Only auctions whose log moved inside the window — each probe reads
          // that one auction's own events through auction_events_auction_idx.
          sql`exists (select 1 from auction_events e where e.auction_id = auctions.id and e.at_ms > ${nowMs - ENDED_WINDOW_MS})`,
        ),
      )
      .orderBy(
        desc(
          sql`(select e.at_ms from auction_events e where e.auction_id = auctions.id order by e.seq desc limit 1)`,
        ),
      )
      .limit(10),
  ]);

  const shaped = liveRows.map((row): LiveAuctionRow => {
    const total = num(row.lotsTotal);
    const sold = num(row.lotsSold);
    const unsold = num(row.lotsUnsold);
    const lastEventAtMs = numOrNull(row.lastEventAtMs);
    return {
      auctionId: row.auctionId,
      auctionName: row.auctionName,
      status: row.status,
      state: roomState(row.status, lastEventAtMs, nowMs),
      orgName: row.orgName,
      orgSlug: row.orgSlug,
      seasonName: row.seasonName,
      seasonSlug: row.seasonSlug,
      sport: row.sport,
      lots: {
        total,
        sold,
        unsold,
        remaining: Math.max(0, total - sold - unsold - num(row.lotsWithdrawn)),
      },
      moneyMoved: num(row.moneyMoved),
      bids: { total: num(row.bidsTotal), lastFiveMinutes: num(row.bidsPulse) },
      openedAtMs: numOrNull(row.openedAtMs),
      lastEventAtMs,
    };
  });
  // Busiest room first; a silent room sinks.
  const byRecency = (a: LiveAuctionRow, b: LiveAuctionRow) =>
    b.bids.lastFiveMinutes - a.bids.lastFiveMinutes ||
    (b.lastEventAtMs ?? 0) - (a.lastEventAtMs ?? 0);

  return {
    generatedAtMs: nowMs,
    running: shaped.filter((row) => row.state !== "stale").sort(byRecency),
    stale: shaped.filter((row) => row.state === "stale").sort(byRecency),
    ended: endedRows
      .map((row) => ({
        auctionId: row.auctionId,
        auctionName: row.auctionName,
        status: row.status,
        orgName: row.orgName,
        seasonName: row.seasonName,
        sold: num(row.sold),
        unsold: num(row.unsold),
        moneyMoved: num(row.moneyMoved),
        endedAtMs: num(row.endedAtMs),
      }))
      .sort((a, b) => b.endedAtMs - a.endedAtMs),
  };
}

// ---------------------------------------------------------------------------
// One auction, watched.
// ---------------------------------------------------------------------------

export interface AuctionHeader {
  readonly auctionId: string;
  readonly auctionName: string;
  readonly status: string;
  readonly config: unknown;
  readonly orgName: string;
  readonly orgSlug: string;
  readonly seasonName: string;
  readonly seasonSlug: string;
  readonly sport: string;
}

export async function auctionHeader(db: Db, auctionId: string): Promise<AuctionHeader | null> {
  const [row] = await db
    .select({
      auctionId: auctions.id,
      auctionName: auctions.name,
      status: auctions.status,
      config: auctions.config,
      orgName: organizations.name,
      orgSlug: organizations.slug,
      seasonName: competitions.name,
      seasonSlug: competitions.slug,
      sport: competitions.sport,
    })
    .from(auctions)
    .innerJoin(organizations, eq(organizations.id, auctions.orgId))
    .innerJoin(competitions, eq(competitions.id, auctions.competitionId))
    .where(eq(auctions.id, auctionId))
    .limit(1);
  return row ?? null;
}

export interface BidTapeRow {
  readonly amount: number;
  readonly status: string;
  readonly placedAtMs: number;
  readonly lotNumber: string;
  readonly paddleNumber: string;
  readonly teamName: string;
}

export interface AuctionPulse {
  readonly openedAtMs: number | null;
  readonly closedAtMs: number | null;
  readonly lastEventAtMs: number | null;
  readonly eventCount: number;
  readonly bidsTotal: number;
  readonly bidsLastFiveMinutes: number;
  /** Distinct paddles that have placed at least one bid. */
  readonly activeBidders: number;
  /** The newest bids, newest first — what an operator reads to see the room move. */
  readonly tape: readonly BidTapeRow[];
}

export async function auctionPulse(
  db: Db,
  auctionId: string,
  nowMs: number,
): Promise<AuctionPulse> {
  const notInvalidated = and(eq(bids.auctionId, auctionId), ne(bids.status, "invalidated"));
  const [[clock], [counts], tape] = await Promise.all([
    db
      .select({
        openedAtMs: sql<
          number | null
        >`min(${auctionEvents.atMs}) filter (where ${auctionEvents.type} = 'AuctionOpened')`,
        closedAtMs: sql<
          number | null
        >`max(${auctionEvents.atMs}) filter (where ${auctionEvents.type} = 'AuctionClosed')`,
        lastEventAtMs: sql<number | null>`max(${auctionEvents.atMs})`,
        eventCount: sql<number>`count(*)::int`,
      })
      .from(auctionEvents)
      .where(eq(auctionEvents.auctionId, auctionId)),
    db
      .select({
        total: sql<number>`count(*)::int`,
        pulse: sql<number>`count(*) filter (where ${bids.placedAtMs} > ${nowMs - PULSE_WINDOW_MS})::int`,
        bidders: sql<number>`count(distinct ${bids.paddleId})::int`,
      })
      .from(bids)
      .where(notInvalidated),
    db
      .select({
        amount: bids.amount,
        status: bids.status,
        placedAtMs: bids.placedAtMs,
        lotNumber: lots.lotNumber,
        paddleNumber: paddles.paddleNumber,
        teamName: teams.name,
      })
      .from(bids)
      .innerJoin(lots, eq(lots.id, bids.lotId))
      .innerJoin(paddles, eq(paddles.id, bids.paddleId))
      .innerJoin(teams, eq(teams.id, paddles.teamId))
      .where(notInvalidated)
      .orderBy(desc(bids.eventSeq))
      .limit(15),
  ]);
  return {
    openedAtMs: numOrNull(clock?.openedAtMs),
    closedAtMs: numOrNull(clock?.closedAtMs),
    lastEventAtMs: numOrNull(clock?.lastEventAtMs),
    eventCount: num(clock?.eventCount),
    bidsTotal: num(counts?.total),
    bidsLastFiveMinutes: num(counts?.pulse),
    activeBidders: num(counts?.bidders),
    tape: tape.map((row) => ({ ...row, placedAtMs: num(row.placedAtMs) })),
  };
}

/**
 * Whether an id names an auction at all — answered before any boundary opens,
 * so a miss is a real 404 rather than a 200 carrying "not found" (PX-2).
 * A malformed id simply matches nothing, and 404s exactly like a well-formed miss.
 */
export async function auctionExists(db: Db, auctionId: string): Promise<boolean> {
  const rows = await db
    .select({ id: auctions.id })
    .from(auctions)
    .where(eq(auctions.id, auctionId))
    .limit(1);
  return rows.length > 0;
}
