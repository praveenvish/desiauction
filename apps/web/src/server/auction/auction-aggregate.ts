import {
  auctionTransition,
  basePriceFor,
  bidTransition,
  decideBid,
  extendOnBid,
  holdRemainingMs,
  lotNumber,
  lotTransition,
  minPossiblePrice,
  openLotTimer,
  paddleNumber,
  replayAuction,
  requeueAllowed,
  validateAuctionConfig,
  type AuctionCommand,
  type AuctionConfig,
  type AuctionEventEnvelope,
  type AuctionProjection,
  type AuctionStatus,
  type BidRejectionCode,
  type LotCommand,
  type LotStatus,
  type Paise,
  paise,
} from "@desiauction/core";
import {
  auctionEvents,
  auctions,
  auditLog,
  bids,
  lots,
  newId,
  paddles,
  registrations,
  teams,
  type Db,
} from "@desiauction/db";
import { and, asc, eq, inArray, sql } from "drizzle-orm";

import type { CompetitionSummary } from "../competition/competitions";
import type { AuctionReadyProjection } from "./auction-ready";

// THE AUCTION AGGREGATE (M-IP4-1). The sole authority over auction, lot, bid
// and paddle state — no route or service mutates these tables elsewhere.
// Every operation follows one shape:
//
//   decide (pure core: machine / gauntlet / timer)
//   → ONE transaction: row mutations + ONE immutable event (per-auction seq,
//     the single-writer total order) + ONE audit row
//     (who=actor · what=action · when=at · why=reason · source · correlation
//      · evidence=event seq)
//
// The event log is the source of truth: `recoverAuction` replays it with
// core's pure reducer and heals the row projections from it (no hidden state).

export interface AuctionRecord {
  id: string;
  orgId: string;
  competitionId: string;
  name: string;
  status: AuctionStatus;
  config: AuctionConfig;
}

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Server wall-clock milliseconds — the ONLY clock (doc 41 fairness rules). */
function serverNowMs(): number {
  return Date.now();
}

/**
 * Append the next event in the auction's total order and its audit row.
 * The unique (auction_id, seq) index turns concurrent writers into loud
 * failures instead of silent interleaving — the M-IP4-1 stand-in for the
 * dedicated single-writer engine process that arrives with live bidding.
 */
async function appendEvent(
  tx: Tx,
  auction: { id: string; orgId: string },
  actorId: string,
  correlationId: string,
  atMs: number,
  type: string,
  payload: Record<string, unknown>,
  subject: string,
  reason?: string,
): Promise<number> {
  const [row] = await tx
    .select({ max: sql<number>`coalesce(max(${auctionEvents.seq}), 0)::int` })
    .from(auctionEvents)
    .where(eq(auctionEvents.auctionId, auction.id));
  const seq = (row?.max ?? 0) + 1;
  await tx.insert(auctionEvents).values({
    id: newId(),
    orgId: auction.orgId,
    auctionId: auction.id,
    seq,
    type,
    atMs,
    actor: actorId,
    correlationId,
    payload,
  });
  await tx.insert(auditLog).values({
    id: newId(),
    actor: actorId,
    action: `auction.${type}`,
    scopeType: "org",
    scopeId: auction.orgId,
    subject,
    meta: {
      source: "web",
      correlationId,
      eventSeq: String(seq),
      ...(reason !== undefined && reason !== "" ? { reason } : {}),
    },
  });
  return seq;
}

// --- Create (gated by the AuctionReady projection — the sole gateway) -----------

export type CreateAuctionResult =
  | { ok: true; auctionId: string; lotCount: number }
  | { ok: false; reason: "not_ready" | "invalid_config" | "auction_exists" };

/**
 * Create the auction from an AuctionReady projection: config locks now
 * (doc 41), the pool becomes prepared lots in registration-number order
 * (deterministic queue), everything lands in ONE transaction with its events.
 */
export async function createAuction(
  db: Db,
  competition: CompetitionSummary,
  ready: AuctionReadyProjection,
  actorId: string,
  config: AuctionConfig,
): Promise<CreateAuctionResult> {
  if (!ready.ok || ready.competitionId !== competition.id) {
    return { ok: false, reason: "not_ready" };
  }
  const valid = validateAuctionConfig(config);
  if (!valid.ok) {
    return { ok: false, reason: "invalid_config" };
  }
  // One auction per competition unless the previous one was abandoned.
  const [existing] = await db
    .select({ id: auctions.id })
    .from(auctions)
    .where(and(eq(auctions.competitionId, competition.id), sql`${auctions.status} != 'abandoned'`))
    .limit(1);
  if (existing !== undefined) {
    return { ok: false, reason: "auction_exists" };
  }
  const auctionId = newId();
  const correlationId = newId();
  const atMs = serverNowMs();
  const name = `${competition.name} Auction`;
  await db.transaction(async (tx) => {
    await tx.insert(auctions).values({
      id: auctionId,
      orgId: competition.orgId,
      competitionId: competition.id,
      name,
      status: "scheduled",
      config,
      createdBy: actorId,
    });
    const scope = { id: auctionId, orgId: competition.orgId };
    await appendEvent(
      tx,
      scope,
      actorId,
      correlationId,
      atMs,
      "AuctionCreated",
      { competitionId: competition.id, lotCount: ready.pool.length, name },
      auctionId,
    );
    for (let i = 0; i < ready.pool.length; i++) {
      const entry = ready.pool[i];
      if (entry === undefined) {
        continue;
      }
      const lotId = newId();
      const number = lotNumber(i + 1);
      const base = basePriceFor(config, entry.basePriceBand);
      await tx.insert(lots).values({
        id: lotId,
        orgId: competition.orgId,
        auctionId,
        registrationId: entry.registrationId,
        lotNumber: number,
        seq: i + 1,
        basePrice: base,
        status: "prepared",
      });
      await appendEvent(
        tx,
        scope,
        actorId,
        correlationId,
        atMs,
        "LotPrepared",
        { lotId, registrationId: entry.registrationId, lotNumber: number, basePrice: base },
        lotId,
      );
    }
  });
  return { ok: true, auctionId, lotCount: ready.pool.length };
}

// --- Paddles (immutable identity — issued once, never reused, never mutated) ----

export type IssuePaddleResult =
  | { ok: true; paddleId: string; paddleNumber: string }
  | { ok: false; reason: "terminal_auction" | "unknown_team" | "already_issued" };

export async function issuePaddle(
  db: Db,
  auction: AuctionRecord,
  actorId: string,
  teamId: string,
  personId: string,
): Promise<IssuePaddleResult> {
  if (
    auction.status === "completed" ||
    auction.status === "reconciled" ||
    auction.status === "abandoned"
  ) {
    return { ok: false, reason: "terminal_auction" };
  }
  const [team] = await db
    .select({ id: teams.id })
    .from(teams)
    .where(and(eq(teams.id, teamId), eq(teams.competitionId, auction.competitionId)))
    .limit(1);
  if (team === undefined) {
    return { ok: false, reason: "unknown_team" };
  }
  const paddleId = newId();
  const correlationId = newId();
  const atMs = serverNowMs();
  try {
    await db.transaction(async (tx) => {
      const [countRow] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(paddles)
        .where(eq(paddles.auctionId, auction.id));
      const number = paddleNumber((countRow?.count ?? 0) + 1);
      await tx.insert(paddles).values({
        id: paddleId,
        orgId: auction.orgId,
        auctionId: auction.id,
        teamId,
        personId,
        paddleNumber: number,
      });
      await appendEvent(
        tx,
        auction,
        actorId,
        correlationId,
        atMs,
        "PaddleIssued",
        { paddleId, teamId, personId, paddleNumber: number },
        paddleId,
      );
    });
  } catch {
    // Unique (auction, team): a team's paddle exists exactly once, forever.
    return { ok: false, reason: "already_issued" };
  }
  const [issued] = await db
    .select({ number: paddles.paddleNumber })
    .from(paddles)
    .where(eq(paddles.id, paddleId))
    .limit(1);
  return { ok: true, paddleId, paddleNumber: issued?.number ?? "" };
}

// --- Auction lifecycle -----------------------------------------------------------

export type AuctionMutationResult =
  | { ok: true; status: AuctionStatus }
  | { ok: false; reason: "illegal_transition" | "guard_failed" };

const AUCTION_EVENT_OF: Record<AuctionCommand, string> = {
  open: "AuctionOpened",
  pause: "AuctionPaused",
  resume: "AuctionResumed",
  complete: "AuctionClosed",
  reconcile: "AuctionReconciled", // declared edge; no aggregate caller yet (IP-6)
  abort: "AuctionAborted",
};

async function auctionReadiness(db: Db, auctionId: string) {
  const [paddleRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(paddles)
    .where(eq(paddles.auctionId, auctionId));
  const [queuedRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(lots)
    .where(and(eq(lots.auctionId, auctionId), eq(lots.status, "queued")));
  const [unresolvedRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(lots)
    .where(
      and(
        eq(lots.auctionId, auctionId),
        inArray(lots.status, ["on_block", "closing_soon", "frozen"]),
      ),
    );
  return {
    paddleCount: paddleRow?.count ?? 0,
    queuedLots: queuedRow?.count ?? 0,
    unresolvedLots: unresolvedRow?.count ?? 0,
  };
}

/** open / pause / resume / complete / abort — one machine-decided audited step. */
export async function transitionAuction(
  db: Db,
  auction: AuctionRecord,
  actorId: string,
  command: Exclude<AuctionCommand, "reconcile">,
  reason?: string,
): Promise<AuctionMutationResult> {
  const readiness = await auctionReadiness(db, auction.id);
  const decision = auctionTransition(auction.status, command, readiness);
  if (!decision.ok) {
    return decision;
  }
  const correlationId = newId();
  const atMs = serverNowMs();
  await db.transaction(async (tx) => {
    await tx.update(auctions).set({ status: decision.next }).where(eq(auctions.id, auction.id));
    await appendEvent(
      tx,
      auction,
      actorId,
      correlationId,
      atMs,
      AUCTION_EVENT_OF[command],
      { from: auction.status },
      auction.id,
      reason,
    );
  });
  return { ok: true, status: decision.next };
}

// --- Lot lifecycle -----------------------------------------------------------------

interface LotRow {
  id: string;
  status: LotStatus;
  basePrice: number;
  roundsUsed: number;
  endsAtMs: number | null;
  heldRemainingMs: number | null;
  timerExtensions: number;
  registrationId: string;
}

async function loadLot(db: Db, auctionId: string, lotId: string): Promise<LotRow | undefined> {
  const [row] = await db
    .select({
      id: lots.id,
      status: lots.status,
      basePrice: lots.basePrice,
      roundsUsed: lots.roundsUsed,
      endsAtMs: lots.endsAtMs,
      heldRemainingMs: lots.heldRemainingMs,
      timerExtensions: lots.timerExtensions,
      registrationId: lots.registrationId,
    })
    .from(lots)
    .where(and(eq(lots.id, lotId), eq(lots.auctionId, auctionId)))
    .limit(1);
  return row;
}

async function leadingBidOf(db: Db, lotId: string) {
  const [row] = await db
    .select({ id: bids.id, paddleId: bids.paddleId, amount: bids.amount })
    .from(bids)
    .where(and(eq(bids.lotId, lotId), eq(bids.status, "accepted")))
    .orderBy(sql`${bids.eventSeq} desc`)
    .limit(1);
  return row ?? null;
}

export type LotMutationResult =
  | { ok: true; status: LotStatus }
  | {
      ok: false;
      reason:
        | "not_found"
        | "illegal_transition"
        | "guard_failed"
        | "auction_not_live"
        | "another_lot_open";
    };

const LOT_EVENT_OF: Record<LotCommand, string> = {
  queue: "LotQueued",
  open: "LotOpened",
  closing: "LotClosingSoon",
  extend: "TimerExtended",
  hold: "LotHeld",
  sell: "LotSold",
  pass: "LotUnsold",
  requeue: "LotRequeued",
  withdraw: "LotWithdrawn",
};

/**
 * queue / open / hold / sell / pass / requeue / withdraw. Opening requires a
 * LIVE auction and an empty block (one lot at a time — a frozen lot does NOT
 * block the next, invariant 19). Timer state moves with the lifecycle:
 * open starts the window, hold freezes the remainder, requeue resets it.
 */
export async function transitionLot(
  db: Db,
  auction: AuctionRecord,
  lotId: string,
  actorId: string,
  command: Exclude<LotCommand, "closing" | "extend">,
  reason?: string,
): Promise<LotMutationResult> {
  const lot = await loadLot(db, auction.id, lotId);
  if (lot === undefined) {
    return { ok: false, reason: "not_found" };
  }
  const leading = await leadingBidOf(db, lot.id);
  const guards = {
    hasLeadingBid: leading !== null,
    requeueAllowed: requeueAllowed(auction.config.unsoldPolicy, lot.roundsUsed),
  };
  const decision = lotTransition(lot.status, command, guards);
  if (!decision.ok) {
    return decision;
  }
  if (command === "open") {
    if (auction.status !== "live") {
      return { ok: false, reason: "auction_not_live" };
    }
    const [onBlock] = await db
      .select({ id: lots.id })
      .from(lots)
      .where(
        and(eq(lots.auctionId, auction.id), inArray(lots.status, ["on_block", "closing_soon"])),
      )
      .limit(1);
    if (onBlock !== undefined) {
      return { ok: false, reason: "another_lot_open" };
    }
  }

  const correlationId = newId();
  const atMs = serverNowMs();
  const fields: Record<string, unknown> = { status: decision.next };
  const payload: Record<string, unknown> = { lotId: lot.id };
  if (command === "open") {
    // Resume a held remainder if one exists, else the full opening window.
    const timer =
      lot.heldRemainingMs !== null
        ? { endsAtMs: atMs + lot.heldRemainingMs, extensions: lot.timerExtensions }
        : { ...openLotTimer(atMs, auction.config.timer), extensions: 0 };
    fields["endsAtMs"] = timer.endsAtMs;
    fields["heldRemainingMs"] = null;
    fields["timerExtensions"] = timer.extensions;
    payload["endsAtMs"] = timer.endsAtMs;
  }
  if (command === "hold" && lot.endsAtMs !== null) {
    const remaining = holdRemainingMs(
      { opensAtMs: 0, endsAtMs: lot.endsAtMs, extensions: lot.timerExtensions },
      atMs,
    );
    fields["heldRemainingMs"] = remaining;
    payload["heldRemainingMs"] = remaining;
  }
  if (command === "sell") {
    if (leading === null) {
      return { ok: false, reason: "guard_failed" }; // unreachable; machine guarded
    }
    fields["soldToPaddleId"] = leading.paddleId;
    fields["soldPrice"] = leading.amount;
    payload["bidId"] = leading.id;
    payload["paddleId"] = leading.paddleId;
    payload["amount"] = leading.amount;
  }
  if (command === "requeue") {
    fields["roundsUsed"] = lot.roundsUsed + 1;
    fields["endsAtMs"] = null;
    fields["heldRemainingMs"] = null;
    fields["timerExtensions"] = 0;
  }

  await db.transaction(async (tx) => {
    await tx.update(lots).set(fields).where(eq(lots.id, lot.id));
    if (command === "requeue" && leading !== null) {
      // Frozen-lot override: prior leading money is voided-but-visible.
      const bidDecision = bidTransition("accepted", "invalidate");
      if (bidDecision.ok) {
        await tx.update(bids).set({ status: bidDecision.next }).where(eq(bids.id, leading.id));
        await appendEvent(
          tx,
          auction,
          actorId,
          correlationId,
          atMs,
          "BidInvalidated",
          { lotId: lot.id, bidId: leading.id, reason: "requeue" },
          leading.id,
          reason,
        );
      }
    }
    await appendEvent(
      tx,
      auction,
      actorId,
      correlationId,
      atMs,
      LOT_EVENT_OF[command],
      payload,
      lot.id,
      reason,
    );
  });
  return { ok: true, status: decision.next };
}

/** Queue every prepared lot (bulk ≡ N singles, per-lot events, skip on refusal). */
export async function queueAllLots(
  db: Db,
  auction: AuctionRecord,
  actorId: string,
): Promise<{ applied: number; skipped: number }> {
  const prepared = await db
    .select({ id: lots.id })
    .from(lots)
    .where(and(eq(lots.auctionId, auction.id), eq(lots.status, "prepared")))
    .orderBy(asc(lots.seq));
  let applied = 0;
  let skipped = 0;
  for (const lot of prepared) {
    const result = await transitionLot(db, auction, lot.id, actorId, "queue");
    if (result.ok) {
      applied++;
    } else {
      skipped++;
    }
  }
  return { applied, skipped };
}

// --- Bids (the gauntlet; accepted = immutable evidence, rejected = evidence too) --

export interface PlaceBidInput {
  lotId: string;
  paddleId: string;
  amountRaw: number;
  /** True when the actor is the paddle holder or a conductor (manual mode). */
  bidderAuthorized: boolean;
}

export type PlaceBidResult =
  | { ok: true; bidId: string; amount: Paise; extended: boolean }
  | { ok: false; code: BidRejectionCode | "not_found" };

/**
 * The full doc-41 gauntlet, then one transaction: bid row + previous leader →
 * outbid + timer extension + BidAccepted event. A REJECTED bid writes no bid
 * row but still leaves evidence: a BidRejected event and its audit row.
 */
export async function placeBid(
  db: Db,
  auction: AuctionRecord,
  actorId: string,
  input: PlaceBidInput,
): Promise<PlaceBidResult> {
  const lot = await loadLot(db, auction.id, input.lotId);
  if (lot === undefined) {
    return { ok: false, code: "not_found" };
  }
  const [paddle] = await db
    .select({ id: paddles.id, teamId: paddles.teamId })
    .from(paddles)
    .where(and(eq(paddles.id, input.paddleId), eq(paddles.auctionId, auction.id)))
    .limit(1);
  if (paddle === undefined) {
    return { ok: false, code: "not_found" };
  }
  const leading = await leadingBidOf(db, lot.id);

  // Purse / squad / role projections from SOLD lots (committed money).
  const [purseRow] = await db
    .select({
      // int8 arrives as a string from the driver — parsed exactly below.
      committed: sql<string>`coalesce(sum(${lots.soldPrice}), 0)::bigint`,
      squad: sql<number>`count(*)::int`,
    })
    .from(lots)
    .where(and(eq(lots.auctionId, auction.id), eq(lots.soldToPaddleId, paddle.id)));
  const committed = Number(purseRow?.committed ?? "0");
  const squadSize = purseRow?.squad ?? 0;
  const [roleRow] = await db
    .select({ role: registrations.role })
    .from(registrations)
    .where(eq(registrations.id, lot.registrationId))
    .limit(1);
  if (roleRow === undefined) {
    return { ok: false, code: "not_found" };
  }
  const role = roleRow.role;
  const [roleCountRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(lots)
    .innerJoin(registrations, eq(registrations.id, lots.registrationId))
    .where(
      and(
        eq(lots.auctionId, auction.id),
        eq(lots.soldToPaddleId, paddle.id),
        eq(registrations.role, role),
      ),
    );

  const decision = decideBid({
    auctionStatus: auction.status,
    lotStatus: lot.status,
    basePrice: paise(lot.basePrice),
    leadingAmount: leading === null ? null : paise(leading.amount),
    leadingPaddleId: leading?.paddleId ?? null,
    paddleId: paddle.id,
    bidderAuthorized: input.bidderAuthorized,
    amountRaw: input.amountRaw,
    slabs: auction.config.slabs,
    purseRemaining: paise(Math.max(0, auction.config.pursePerTeam - committed)),
    squadSize,
    squadMin: auction.config.squadMin,
    squadMax: auction.config.squadMax,
    minPossiblePrice: minPossiblePrice(auction.config),
    roleCount: roleCountRow?.count ?? 0,
    roleMax: auction.config.roleQuotas[role] ?? null,
  });

  const correlationId = newId();
  const atMs = serverNowMs();

  if (!decision.ok) {
    // Rejected bids still produce audit evidence (directive): event + audit.
    await db.transaction(async (tx) => {
      await appendEvent(
        tx,
        auction,
        actorId,
        correlationId,
        atMs,
        "BidRejected",
        { lotId: lot.id, paddleId: paddle.id, amount: input.amountRaw, code: decision.code },
        lot.id,
      );
    });
    return { ok: false, code: decision.code };
  }

  const bidId = newId();
  const timer = { opensAtMs: 0, endsAtMs: lot.endsAtMs ?? atMs, extensions: lot.timerExtensions };
  const extension = extendOnBid(timer, atMs, auction.config.timer);
  await db.transaction(async (tx) => {
    if (leading !== null) {
      const outbid = bidTransition("accepted", "outbid");
      if (outbid.ok) {
        await tx.update(bids).set({ status: outbid.next }).where(eq(bids.id, leading.id));
      }
    }
    const seq = await appendEvent(
      tx,
      auction,
      actorId,
      correlationId,
      atMs,
      "BidAccepted",
      {
        lotId: lot.id,
        bidId,
        paddleId: paddle.id,
        amount: decision.amount,
        prevBidId: leading?.id ?? null,
      },
      bidId,
    );
    await tx.insert(bids).values({
      id: bidId,
      orgId: auction.orgId,
      auctionId: auction.id,
      lotId: lot.id,
      paddleId: paddle.id,
      amount: decision.amount,
      status: "accepted",
      eventSeq: seq,
      placedAtMs: atMs,
    });
    const lotFields: Record<string, unknown> = {};
    if (extension.extended) {
      lotFields["endsAtMs"] = extension.timer.endsAtMs;
      lotFields["timerExtensions"] = extension.timer.extensions;
      await appendEvent(
        tx,
        auction,
        actorId,
        correlationId,
        atMs,
        "TimerExtended",
        { lotId: lot.id, endsAtMs: extension.timer.endsAtMs },
        lot.id,
      );
      // Anti-snipe pulls a closing lot back onto the block (doc 39).
      if (lot.status === "closing_soon") {
        lotFields["status"] = "on_block";
      }
    }
    if (Object.keys(lotFields).length > 0) {
      await tx.update(lots).set(lotFields).where(eq(lots.id, lot.id));
    }
  });
  return { ok: true, bidId, amount: decision.amount, extended: extension.extended };
}

// --- Recovery (replay events → restore aggregates → resume) -----------------------

export interface RecoveryReport {
  ok: boolean;
  reason?: string;
  atSeq?: number;
  eventCount: number;
  divergences: string[];
  healed: boolean;
  projectionStatus?: AuctionStatus;
}

export async function loadEvents(db: Db, auctionId: string): Promise<AuctionEventEnvelope[]> {
  const rows = await db
    .select({
      seq: auctionEvents.seq,
      type: auctionEvents.type,
      atMs: auctionEvents.atMs,
      actor: auctionEvents.actor,
      correlationId: auctionEvents.correlationId,
      payload: auctionEvents.payload,
    })
    .from(auctionEvents)
    .where(eq(auctionEvents.auctionId, auctionId))
    .orderBy(asc(auctionEvents.seq));
  return rows.map((row) => ({ ...row, payload: row.payload as Record<string, unknown> }));
}

function diffProjection(
  projection: AuctionProjection,
  auctionStatus: AuctionStatus,
  lotRows: {
    id: string;
    status: LotStatus;
    soldPrice: number | null;
    soldToPaddleId: string | null;
  }[],
): string[] {
  const divergences: string[] = [];
  if (projection.status !== auctionStatus) {
    divergences.push(`auction: rows=${auctionStatus} events=${projection.status}`);
  }
  for (const row of lotRows) {
    const replayed = projection.lots[row.id];
    if (replayed === undefined) {
      divergences.push(`lot ${row.id}: missing from event log`);
      continue;
    }
    if (replayed.status !== row.status) {
      divergences.push(`lot ${row.id}: rows=${row.status} events=${replayed.status}`);
    }
    if ((replayed.soldAmount ?? null) !== row.soldPrice) {
      divergences.push(`lot ${row.id}: sold price diverged`);
    }
    if ((replayed.soldPaddleId ?? null) !== row.soldToPaddleId) {
      divergences.push(`lot ${row.id}: sold paddle diverged`);
    }
  }
  return divergences;
}

/**
 * Deterministic recovery: fold the immutable event log with core's pure
 * reducer, compare against the row projections, and HEAL the rows from the
 * events (events are the source of truth — no hidden state). Emits
 * AuctionRecovered with the divergence evidence. A corrupted log (gap,
 * unknown type, illegal replay) fails closed and heals nothing.
 */
export async function recoverAuction(
  db: Db,
  auction: AuctionRecord,
  actorId: string,
): Promise<RecoveryReport> {
  const events = await loadEvents(db, auction.id);
  const replay = replayAuction(events);
  if (!replay.ok) {
    return {
      ok: false,
      reason: replay.reason,
      atSeq: replay.atSeq,
      eventCount: events.length,
      divergences: [],
      healed: false,
    };
  }
  const lotRows = await db
    .select({
      id: lots.id,
      status: lots.status,
      soldPrice: lots.soldPrice,
      soldToPaddleId: lots.soldToPaddleId,
    })
    .from(lots)
    .where(eq(lots.auctionId, auction.id));
  const divergences = diffProjection(replay.projection, auction.status, lotRows);

  const correlationId = newId();
  const atMs = serverNowMs();
  await db.transaction(async (tx) => {
    if (divergences.length > 0) {
      // Restore aggregates FROM the events.
      if (replay.projection.status !== auction.status) {
        await tx
          .update(auctions)
          .set({ status: replay.projection.status })
          .where(eq(auctions.id, auction.id));
      }
      for (const row of lotRows) {
        const replayed = replay.projection.lots[row.id];
        if (replayed === undefined) {
          continue;
        }
        if (
          replayed.status !== row.status ||
          (replayed.soldAmount ?? null) !== row.soldPrice ||
          (replayed.soldPaddleId ?? null) !== row.soldToPaddleId
        ) {
          await tx
            .update(lots)
            .set({
              status: replayed.status,
              soldPrice: replayed.soldAmount,
              soldToPaddleId: replayed.soldPaddleId,
            })
            .where(eq(lots.id, row.id));
        }
      }
    }
    await appendEvent(
      tx,
      auction,
      actorId,
      correlationId,
      atMs,
      "AuctionRecovered",
      { divergences: divergences.length, eventCount: events.length },
      auction.id,
    );
  });
  return {
    ok: true,
    eventCount: events.length,
    divergences,
    healed: divergences.length > 0,
    projectionStatus: replay.projection.status,
  };
}
