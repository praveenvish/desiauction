import {
  auctionEvents,
  bids,
  lots,
  paddles,
  people,
  registrations,
  teams,
  type Db,
} from "@desiauction/db";
import { and, desc, eq, isNull } from "drizzle-orm";

import { rulesOf } from "./live-summary";

/**
 * The Auction tab's operational dashboard (PX "Season Workspace" → Auction):
 * progress, what is on the block, per-paddle purse burndown, the lot queue and
 * the tail of the immutable event log.
 *
 * This is a READ of committed state — the engine remains the single writer. It
 * is a page-load snapshot, not a live feed: the real-time surfaces are /live and
 * /cockpit, which stream the same auction over the websocket. Nothing here
 * animates a timer, because a server-rendered countdown is stale the moment it
 * paints.
 */

export interface AuctionLotRow {
  lotId: string;
  lotNumber: string;
  playerName: string | null;
  role: string;
  basePrice: number;
  status: string;
  soldPrice: number | null;
  /** The winning paddle, e.g. "P08". */
  paddleNumber: string | null;
}

export interface AuctionPaddleRow {
  paddleNumber: string;
  teamId: string;
  teamName: string;
  color: string | null;
  spent: number;
  remaining: number;
  purseTotal: number;
}

export interface AuctionOnBlock {
  lotNumber: string;
  playerName: string | null;
  role: string;
  basePrice: number;
  /** Highest accepted bid, or null when nobody has bid yet. */
  currentBid: number | null;
  leadingTeamName: string | null;
  leadingColor: string | null;
}

export interface AuctionEventRow {
  seq: number;
  type: string;
  atMs: number;
}

export interface AuctionOverview {
  counts: { sold: number; onBlock: number; queued: number; unsold: number };
  totalLots: number;
  /** Paise across every sold lot. */
  moneyMoved: number;
  paddles: AuctionPaddleRow[];
  lots: AuctionLotRow[];
  onBlock: AuctionOnBlock | null;
  events: AuctionEventRow[];
}

const QUEUED = new Set(["prepared", "queued"]);
const ON_BLOCK = new Set(["on_block", "closing_soon", "frozen"]);

export async function auctionOverview(
  db: Db,
  auctionId: string,
  config: unknown,
): Promise<AuctionOverview> {
  const rules = rulesOf(config);

  const [lotRows, paddleRows, eventRows] = await Promise.all([
    db
      .select({
        lotId: lots.id,
        lotNumber: lots.lotNumber,
        seq: lots.seq,
        basePrice: lots.basePrice,
        status: lots.status,
        soldPrice: lots.soldPrice,
        soldToPaddleId: lots.soldToPaddleId,
        playerName: people.name,
        role: registrations.role,
      })
      .from(lots)
      .innerJoin(registrations, eq(registrations.id, lots.registrationId))
      .innerJoin(people, eq(people.id, registrations.personId))
      .where(eq(lots.auctionId, auctionId))
      .orderBy(lots.seq),
    db
      .select({
        paddleId: paddles.id,
        paddleNumber: paddles.paddleNumber,
        teamId: paddles.teamId,
        teamName: teams.name,
        color: teams.primaryColor,
      })
      .from(paddles)
      .innerJoin(teams, eq(teams.id, paddles.teamId))
      .where(and(eq(paddles.auctionId, auctionId), isNull(paddles.releasedAt)))
      .orderBy(paddles.paddleNumber),
    db
      .select({ seq: auctionEvents.seq, type: auctionEvents.type, atMs: auctionEvents.atMs })
      .from(auctionEvents)
      .where(eq(auctionEvents.auctionId, auctionId))
      .orderBy(desc(auctionEvents.seq))
      .limit(12),
  ]);

  const paddleById = new Map(paddleRows.map((row) => [row.paddleId, row]));

  const counts = { sold: 0, onBlock: 0, queued: 0, unsold: 0 };
  let moneyMoved = 0;
  const spentByTeam = new Map<string, number>();
  for (const lot of lotRows) {
    if (lot.status === "sold") {
      counts.sold += 1;
      moneyMoved += lot.soldPrice ?? 0;
      const paddle = lot.soldToPaddleId === null ? undefined : paddleById.get(lot.soldToPaddleId);
      if (paddle !== undefined) {
        spentByTeam.set(
          paddle.teamId,
          (spentByTeam.get(paddle.teamId) ?? 0) + (lot.soldPrice ?? 0),
        );
      }
    } else if (lot.status === "unsold") {
      counts.unsold += 1;
    } else if (ON_BLOCK.has(lot.status)) {
      counts.onBlock += 1;
    } else if (QUEUED.has(lot.status)) {
      counts.queued += 1;
    }
  }

  // What is under the hammer right now, with the highest accepted bid on it.
  const live = lotRows.find((lot) => ON_BLOCK.has(lot.status)) ?? null;
  let onBlock: AuctionOnBlock | null = null;
  if (live !== null) {
    const [top] = await db
      .select({ amount: bids.amount, paddleId: bids.paddleId })
      .from(bids)
      .where(and(eq(bids.lotId, live.lotId), eq(bids.status, "accepted")))
      .orderBy(desc(bids.amount))
      .limit(1);
    const leading = top === undefined ? undefined : paddleById.get(top.paddleId);
    onBlock = {
      lotNumber: live.lotNumber,
      playerName: live.playerName,
      role: live.role,
      basePrice: live.basePrice,
      currentBid: top?.amount ?? null,
      leadingTeamName: leading?.teamName ?? null,
      leadingColor: leading?.color ?? null,
    };
  }

  return {
    counts,
    totalLots: lotRows.length,
    moneyMoved,
    paddles: paddleRows.map((row) => {
      const spent = spentByTeam.get(row.teamId) ?? 0;
      return {
        paddleNumber: row.paddleNumber,
        teamId: row.teamId,
        teamName: row.teamName,
        color: row.color,
        spent,
        remaining: Math.max(0, rules.pursePerTeam - spent),
        purseTotal: rules.pursePerTeam,
      };
    }),
    lots: lotRows.map((row) => ({
      lotId: row.lotId,
      lotNumber: row.lotNumber,
      playerName: row.playerName,
      role: row.role,
      basePrice: row.basePrice,
      status: row.status,
      soldPrice: row.soldPrice,
      paddleNumber:
        row.soldToPaddleId === null
          ? null
          : (paddleById.get(row.soldToPaddleId)?.paddleNumber ?? null),
    })),
    onBlock,
    events: eventRows,
  };
}
