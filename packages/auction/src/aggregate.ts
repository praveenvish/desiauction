import {
  auctionTransition,
  basePriceFor,
  bidTransition,
  decideBid,
  decideUndo,
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
  type BidStatus,
  type LotCommand,
  type LotStatus,
  type Paise,
  paise,
} from "@desiauction/core";
import {
  auctionEvents,
  auctionOwnerInvites,
  auctions,
  auditLog,
  bids,
  lots,
  newId,
  paddleGrants,
  paddles,
  registrations,
  teams,
  type Db,
} from "@desiauction/db";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";

// Input shapes (structural — web's CompetitionSummary and AuctionReadyProjection
// satisfy them; the engine supplies them from its own reads). The package never
// imports app code (boundary: packages never know apps exist).
export interface CompetitionRef {
  id: string;
  orgId: string;
  name: string;
}

export interface PoolEntryRef {
  readonly registrationId: string;
  readonly basePriceBand: string | null;
}

export interface AuctionCreationGate {
  readonly ok: boolean;
  readonly competitionId: string;
  readonly pool: readonly PoolEntryRef[];
}

// THE AUCTION AGGREGATE (M-IP4-1; shared web+engine since M-IP4-2). The sole
// authority over auction, lot, bid and paddle state — no route or service
// mutates these tables elsewhere.
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
 * The engine's self-actor for timer-driven writes (all-zero ULID). Mirrors the
 * engine's ENGINE_ACTOR sentinel by value — packages never import apps — so the
 * audit trail can attribute engine-authored events (timer close, closing-soon)
 * to "engine" and human-originated commands to "web".
 */
const ENGINE_ACTOR = "00000000000000000000000000";

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
      // Attribute by the writing tier: engine self-actor → "engine" (timer
      // close, closing-soon, recovery it authors), everything else → "web".
      source: actorId === ENGINE_ACTOR ? "engine" : "web",
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
  competition: CompetitionRef,
  ready: AuctionCreationGate,
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
  | { ok: false; reason: "illegal_transition" | "guard_failed" | "squad_below_minimum" };

const AUCTION_EVENT_OF: Record<AuctionCommand, string> = {
  open: "AuctionOpened",
  pause: "AuctionPaused",
  resume: "AuctionResumed",
  complete: "AuctionClosed",
  reconcile: "AuctionReconciled", // declared edge; no aggregate caller yet (IP-6)
  abort: "AuctionAborted",
};

/** The readiness numbers behind every lifecycle guard — exported so the web
 * layer can say WHICH gate is red instead of listing them all (DA-25). */
export async function auctionReadiness(db: Db, auctionId: string, auction?: AuctionRecord) {
  // DISTINCT TEAMS, STILL HOLDING. The guard this feeds is "at least two teams
  // are in the room", and it was counting PADDLE ROWS including released ones —
  // so one team that claimed, released and claimed again satisfied a two-team
  // requirement by itself, and an auction could go live with a single bidder
  // (audit 2026-08-18, P3-4).
  const [paddleRow] = await db
    .select({ count: sql<number>`count(distinct ${paddles.teamId})::int` })
    .from(paddles)
    .where(and(eq(paddles.auctionId, auctionId), isNull(paddles.releasedAt)));
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
  // DA-06: "squad 8–15" is printed on every auction screen. Counting it here
  // makes the floor real — the ceiling was already enforced by the bid gauntlet.
  // Every team counts, including one that never bid: no squad is the shortest.
  let below = 0;
  if (auction !== undefined) {
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(teams)
      .where(
        and(
          eq(teams.competitionId, auction.competitionId),
          sql`(select count(*) from ${registrations} where ${registrations.teamId} = ${teams.id})
              < ${auction.config.squadMin}`,
        ),
      );
    below = row?.count ?? 0;
  }
  return {
    paddleCount: paddleRow?.count ?? 0,
    queuedLots: queuedRow?.count ?? 0,
    unresolvedLots: unresolvedRow?.count ?? 0,
    teamsBelowSquadMin: below,
  };
}

/** open / pause / resume / complete / abort — one machine-decided audited step. */
export async function transitionAuction(
  db: Db,
  auction: AuctionRecord,
  actorId: string,
  command: Exclude<AuctionCommand, "reconcile">,
  reason?: string,
  /** Conductor's explicit override of the soft squad-minimum guard (DA-06). */
  override = false,
): Promise<AuctionMutationResult> {
  const readiness = await auctionReadiness(db, auction.id, auction);
  const decision = auctionTransition(auction.status, command, readiness, override);
  if (!decision.ok) {
    return decision;
  }
  const correlationId = newId();
  const atMs = serverNowMs();
  // Pause is TOTAL (doc 39): the open lot's runway freezes with the auction
  // and re-attaches on resume — both through events so replay restores the
  // exact remaining time (M-IP4-2).
  const [openLot] =
    command === "pause" || command === "resume"
      ? await db
          .select({
            id: lots.id,
            endsAtMs: lots.endsAtMs,
            heldRemainingMs: lots.heldRemainingMs,
            timerExtensions: lots.timerExtensions,
          })
          .from(lots)
          .where(
            and(eq(lots.auctionId, auction.id), inArray(lots.status, ["on_block", "closing_soon"])),
          )
          .limit(1)
      : [];
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
    if (command === "pause" && openLot !== undefined && openLot.endsAtMs !== null) {
      const remaining = holdRemainingMs(
        { opensAtMs: 0, endsAtMs: openLot.endsAtMs, extensions: openLot.timerExtensions },
        atMs,
      );
      await tx
        .update(lots)
        .set({ heldRemainingMs: remaining, endsAtMs: null })
        .where(eq(lots.id, openLot.id));
      await appendEvent(
        tx,
        auction,
        actorId,
        correlationId,
        atMs,
        "TimerHeld",
        { lotId: openLot.id, heldRemainingMs: remaining },
        openLot.id,
      );
    }
    if (command === "resume" && openLot !== undefined && openLot.heldRemainingMs !== null) {
      const endsAtMs = atMs + openLot.heldRemainingMs;
      await tx.update(lots).set({ endsAtMs, heldRemainingMs: null }).where(eq(lots.id, openLot.id));
      await appendEvent(
        tx,
        auction,
        actorId,
        correlationId,
        atMs,
        "TimerResumed",
        { lotId: openLot.id, endsAtMs },
        openLot.id,
      );
    }
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
    .select({
      id: bids.id,
      paddleId: bids.paddleId,
      amount: bids.amount,
      teamId: paddles.teamId,
    })
    .from(bids)
    .innerJoin(paddles, eq(paddles.id, bids.paddleId))
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
        | "another_lot_open"
        | "terminal_auction";
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
  // AFTER THE HAMMER, NOTHING MOVES.
  //
  // Only `open` used to ask what state the auction was in, so every OTHER lot
  // command stayed live on a completed one. The cockpit's "Needs resolution"
  // panel keeps its Requeue buttons enabled there — one click on a finished
  // auction put an unsold lot back in the queue, which left a COMPLETED
  // auction carrying unresolved lots: exactly the state `complete` refuses to
  // be entered with (`unresolvedLots > 0`), reached by going through it. The
  // same card then read "Auction complete. 79 of 80 lots resolved" above
  // "78/80 LOTS RESOLVED" — two numbers for one night, and the record of who
  // owns whom silently changed after everyone went home.
  //
  // `issuePaddle`, `grantPaddle`, `inviteOwner` and `acceptOwnerInvite` all
  // already refuse a terminal auction. This is the same fence around the lots.
  //
  // It sits AFTER the lot lookup deliberately: a lot id that belongs to another
  // auction is `not_found` whatever state this one is in, which is the answer
  // that leaks least and the one the isolation suite pins.
  if (
    auction.status === "completed" ||
    auction.status === "reconciled" ||
    auction.status === "abandoned"
  ) {
    return { ok: false, reason: "terminal_auction" };
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
    // The road back into Competition (M-IP4-1 left this half unbuilt): the sale
    // is the authority on where a POOL player ends up, so it stamps the
    // registration the whole product reads — Teams, the roster export and the
    // public page all key on registrations.team_id. Icons never have a lot, so
    // their pre-signed assignment is structurally out of reach here.
    if (command === "sell" && leading !== null) {
      await tx
        .update(registrations)
        .set({ teamId: leading.teamId })
        .where(eq(registrations.id, lot.registrationId));
    }
    if (command === "requeue" || command === "withdraw") {
      await tx
        .update(registrations)
        .set({ teamId: null })
        .where(eq(registrations.id, lot.registrationId));
    }
    if ((command === "requeue" || command === "withdraw") && leading !== null) {
      /*
       * Frozen-lot override: prior leading money is voided-but-visible.
       *
       * `withdraw` joins `requeue` here because a frozen lot can now be
       * withdrawn — the exit that keeps a mistaken bid from deadlocking the
       * whole auction (see LOT_EDGES.frozen). A withdrawn lot with a bid still
       * marked `accepted` would leave the ledger asserting live money against a
       * lot that no longer exists, which is the same untidiness requeue has
       * always cleaned up. Withdrawal from prepared or queued cannot reach this
       * branch: those states have no bids.
       */
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
          // The command that voided it, not a constant — "requeue" on a
          // withdrawal would misreport why the money stopped counting.
          { lotId: lot.id, bidId: leading.id, reason: command },
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
  /**
   * When the engine RECEIVED the bid. Falls back to the processing clock.
   *
   * This is the timestamp the expiry rule is judged on, and it has to be, or
   * anti-snipe stops working: the bid anti-snipe exists to honour is the one
   * placed in the last moment before the hammer, and that is precisely the bid
   * a deep queue delivers to the reducer AFTER the deadline.
   */
  receivedAtMs?: number;
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
    .select({ id: paddles.id, teamId: paddles.teamId, releasedAt: paddles.releasedAt })
    .from(paddles)
    .where(and(eq(paddles.id, input.paddleId), eq(paddles.auctionId, auction.id)))
    .limit(1);
  if (paddle === undefined) {
    return { ok: false, code: "not_found" };
  }
  const leading = await leadingBidOf(db, lot.id);

  // Purse / squad / role projections are per TEAM (doc 41: purses belong to
  // teams) — money committed through ANY of the team's paddles counts.
  const [purseRow] = await db
    .select({
      // int8 arrives as a string from the driver — parsed exactly below.
      committed: sql<string>`coalesce(sum(${lots.soldPrice}), 0)::bigint`,
      squad: sql<number>`count(*)::int`,
    })
    .from(lots)
    .innerJoin(paddles, eq(paddles.id, lots.soldToPaddleId))
    .where(and(eq(lots.auctionId, auction.id), eq(paddles.teamId, paddle.teamId)));
  const committed = Number(purseRow?.committed ?? "0");
  // DA-09: pre-signed players occupy a place in the XI, so they count against
  // squadMax like anyone else. Counting only auction wins let a team with an
  // icon finish on squadMax + 1 and every board render "16/15" — a fraction
  // above its own denominator, which is how you know the cap was not real.
  const [preSignedRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(registrations)
    .where(
      and(
        eq(registrations.competitionId, auction.competitionId),
        eq(registrations.teamId, paddle.teamId),
        eq(registrations.isIcon, true),
      ),
    );
  const squadSize = (purseRow?.squad ?? 0) + (preSignedRow?.count ?? 0);
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
    .innerJoin(paddles, eq(paddles.id, lots.soldToPaddleId))
    .where(
      and(
        eq(lots.auctionId, auction.id),
        eq(paddles.teamId, paddle.teamId),
        eq(registrations.role, role),
      ),
    );

  const atMs = serverNowMs();
  const decision = decideBid({
    auctionStatus: auction.status,
    lotStatus: lot.status,
    basePrice: paise(lot.basePrice),
    leadingAmount: leading === null ? null : paise(leading.amount),
    leadingTeamId: leading?.teamId ?? null,
    teamId: paddle.teamId,
    // A released paddle may never bid again (M-IP4-2 claim model).
    bidderAuthorized: input.bidderAuthorized && paddle.releasedAt === null,
    amountRaw: input.amountRaw,
    slabs: auction.config.slabs,
    purseRemaining: paise(Math.max(0, auction.config.pursePerTeam - committed)),
    squadSize,
    squadMin: auction.config.squadMin,
    squadMax: auction.config.squadMax,
    minPossiblePrice: minPossiblePrice(auction.config),
    roleCount: roleCountRow?.count ?? 0,
    roleMax: auction.config.roleQuotas[role] ?? null,
    // The lot's deadline is a RULE, not just a scheduler input — judged on when
    // the bid ARRIVED, so queue depth can never turn a bid that was in time
    // into one that was not.
    nowMs: input.receivedAtMs ?? atMs,
    endsAtMs: lot.endsAtMs,
  });

  const correlationId = newId();

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

export interface LotProjectionRow {
  id: string;
  status: LotStatus;
  soldPrice: number | null;
  soldToPaddleId: string | null;
  roundsUsed: number;
}

/**
 * The money rows (M-IP4-4). A lot's sale price is read from its leading bid
 * row, so an unverified `bids` table is an unverified sale — certification
 * defect D-2.
 */
export interface BidProjectionRow {
  id: string;
  lotId: string;
  paddleId: string;
  amount: number;
  status: BidStatus;
}

export async function loadBidRows(db: Db, auctionId: string): Promise<BidProjectionRow[]> {
  return db
    .select({
      id: bids.id,
      lotId: bids.lotId,
      paddleId: bids.paddleId,
      amount: bids.amount,
      status: bids.status,
    })
    .from(bids)
    .where(eq(bids.auctionId, auctionId));
}

/**
 * The identity + authority rows (M-IP4-4, defect D-3). A paddle's `personId`
 * gates WHO may bid with it (`holder = paddle.personId === actor`), its `teamId`
 * attributes every bid and sale to a purse/squad/role, and `releasedAt` gates
 * whether it may bid at all. All three are read straight from this row by the
 * gauntlet — so an unverified `paddles` table is an unverified authorization AND
 * an unverified purse.
 */
export interface PaddleProjectionRow {
  id: string;
  teamId: string;
  personId: string;
  paddleNumber: string;
  releasedAt: Date | null;
}

export async function loadPaddleRows(db: Db, auctionId: string): Promise<PaddleProjectionRow[]> {
  return db
    .select({
      id: paddles.id,
      teamId: paddles.teamId,
      personId: paddles.personId,
      paddleNumber: paddles.paddleNumber,
      releasedAt: paddles.releasedAt,
    })
    .from(paddles)
    .where(eq(paddles.auctionId, auctionId));
}

/**
 * Row-vs-events divergence report (exported for the engine's watchdog — the
 * same comparison recovery uses, without the healing).
 *
 * Covers EVERY row the engine derives truth from: the auction status, the lot
 * rows (status, sale, rounds), the bid rows (amount, paddle, lot, status), and
 * the paddle rows (team, person, number, released). A bid row that disagrees
 * with its BidAccepted event is a money divergence; a paddle row that disagrees
 * with its PaddleIssued event is an authorization AND purse divergence. Any of
 * them halts the auction like any other integrity failure.
 */
export function diffProjection(
  projection: AuctionProjection,
  auctionStatus: AuctionStatus,
  lotRows: LotProjectionRow[],
  bidRows: BidProjectionRow[],
  paddleRows: PaddleProjectionRow[],
): string[] {
  const divergences: string[] = [];
  if (projection.status !== auctionStatus) {
    divergences.push(`auction: rows=${auctionStatus} events=${projection.status}`);
  }
  // A lot the log knows about with no row is a lot whose sale (soldPrice — the
  // purse source) has silently vanished. Detected exactly like a missing bid or
  // paddle row so a DELETE fails closed instead of inflating a team's purse.
  const lotRowIds = new Set(lotRows.map((row) => row.id));
  for (const lotId of Object.keys(projection.lots)) {
    if (!lotRowIds.has(lotId)) {
      divergences.push(`lot ${lotId}: row missing`);
    }
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
    if (replayed.roundsUsed !== row.roundsUsed) {
      divergences.push(
        `lot ${row.id}: rounds diverged (rows=${String(row.roundsUsed)} events=${String(replayed.roundsUsed)})`,
      );
    }
  }
  for (const row of paddleRows) {
    const replayed = projection.paddles[row.id];
    if (replayed === undefined) {
      divergences.push(`paddle ${row.id}: missing from event log`);
      continue;
    }
    if (replayed.teamId !== row.teamId) {
      divergences.push(`paddle ${row.id}: team diverged`);
    }
    if (replayed.personId !== row.personId) {
      divergences.push(`paddle ${row.id}: person diverged`);
    }
    if (replayed.paddleNumber !== row.paddleNumber) {
      divergences.push(`paddle ${row.id}: number diverged`);
    }
    if (replayed.released !== (row.releasedAt !== null)) {
      divergences.push(
        `paddle ${row.id}: released diverged (rows=${String(row.releasedAt !== null)} events=${String(replayed.released)})`,
      );
    }
  }
  const paddleRowIds = new Set(paddleRows.map((row) => row.id));
  for (const paddleId of Object.keys(projection.paddles)) {
    if (!paddleRowIds.has(paddleId)) {
      divergences.push(`paddle ${paddleId}: row missing`);
    }
  }
  for (const row of bidRows) {
    const replayed = projection.bids[row.id];
    if (replayed === undefined) {
      divergences.push(`bid ${row.id}: missing from event log`);
      continue;
    }
    if (replayed.amount !== row.amount) {
      divergences.push(
        `bid ${row.id}: amount diverged (rows=${String(row.amount)} events=${String(replayed.amount)})`,
      );
    }
    if (replayed.paddleId !== row.paddleId) {
      divergences.push(`bid ${row.id}: paddle diverged`);
    }
    if (replayed.lotId !== row.lotId) {
      divergences.push(`bid ${row.id}: lot diverged`);
    }
    if (replayed.status !== row.status) {
      divergences.push(`bid ${row.id}: rows=${row.status} events=${replayed.status}`);
    }
  }
  // A BidAccepted event with no row is money the engine would never see.
  const rowIds = new Set(bidRows.map((row) => row.id));
  for (const bidId of Object.keys(projection.bids)) {
    if (!rowIds.has(bidId)) {
      divergences.push(`bid ${bidId}: row missing`);
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
      roundsUsed: lots.roundsUsed,
    })
    .from(lots)
    .where(eq(lots.auctionId, auction.id));
  const bidRows = await loadBidRows(db, auction.id);
  const paddleRows = await loadPaddleRows(db, auction.id);
  const divergences = diffProjection(
    replay.projection,
    auction.status,
    lotRows,
    bidRows,
    paddleRows,
  );

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
          (replayed.soldPaddleId ?? null) !== row.soldToPaddleId ||
          replayed.roundsUsed !== row.roundsUsed
        ) {
          await tx
            .update(lots)
            .set({
              status: replayed.status,
              soldPrice: replayed.soldAmount,
              soldToPaddleId: replayed.soldPaddleId,
              roundsUsed: replayed.roundsUsed,
            })
            .where(eq(lots.id, row.id));
        }
      }
      // Heal the identity + authority rows from the log: team, person, number
      // and the release state all come back from PaddleIssued/PaddleReleased. A
      // paddle the log does not know about is NOT invented — it surfaces as a
      // divergence and the engine stays halted.
      for (const row of paddleRows) {
        const replayed = replay.projection.paddles[row.id];
        if (replayed === undefined) {
          continue;
        }
        if (
          replayed.teamId !== row.teamId ||
          replayed.personId !== row.personId ||
          replayed.paddleNumber !== row.paddleNumber ||
          replayed.released !== (row.releasedAt !== null)
        ) {
          await tx
            .update(paddles)
            .set({
              teamId: replayed.teamId,
              personId: replayed.personId,
              paddleNumber: replayed.paddleNumber,
              releasedAt: replayed.releasedAtMs !== null ? new Date(replayed.releasedAtMs) : null,
            })
            .where(eq(paddles.id, row.id));
        }
      }
      // Heal the money rows from the log: amount, paddle and lifecycle status
      // all come back from BidAccepted/BidInvalidated. A row the log does not
      // know about is NOT invented here — it surfaces as a divergence and the
      // engine stays halted rather than fabricating a bid.
      for (const row of bidRows) {
        const replayed = replay.projection.bids[row.id];
        if (replayed === undefined) {
          continue;
        }
        if (
          replayed.amount !== row.amount ||
          replayed.paddleId !== row.paddleId ||
          replayed.status !== row.status
        ) {
          await tx
            .update(bids)
            .set({
              amount: replayed.amount,
              paddleId: replayed.paddleId,
              status: replayed.status,
            })
            .where(eq(bids.id, row.id));
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

// --- Paddle claims (M-IP4-2). Identity stays immutable: a claim ISSUES a new
// paddle; a release ENDS the claim (released_at) — the row's identity fields
// never change and numbers are never reissued.

export type ClaimPaddleResult =
  | { ok: true; paddleId: string; paddleNumber: string; alreadyHeld: boolean }
  | { ok: false; reason: "terminal_auction" | "unknown_team" | "paddle_held" | "no_grant" };

export async function claimPaddle(
  db: Db,
  auction: AuctionRecord,
  actorId: string,
  teamId: string,
): Promise<ClaimPaddleResult> {
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
  // M-IP4-3 production rule: NO active paddle without an explicit grant. The
  // temporary any-member rule is gone — only granted owners may claim.
  const [grant] = await db
    .select({ id: paddleGrants.id })
    .from(paddleGrants)
    .where(
      and(
        eq(paddleGrants.auctionId, auction.id),
        eq(paddleGrants.teamId, teamId),
        eq(paddleGrants.personId, actorId),
        isNull(paddleGrants.revokedAt),
      ),
    )
    .limit(1);
  if (grant === undefined) {
    return { ok: false, reason: "no_grant" };
  }
  const [active] = await db
    .select({ id: paddles.id, personId: paddles.personId, number: paddles.paddleNumber })
    .from(paddles)
    .where(
      and(
        eq(paddles.auctionId, auction.id),
        eq(paddles.teamId, teamId),
        isNull(paddles.releasedAt),
      ),
    )
    .limit(1);
  if (active !== undefined) {
    // Claiming a paddle you already hold is idempotent; someone else's is refused.
    if (active.personId === actorId) {
      return { ok: true, paddleId: active.id, paddleNumber: active.number, alreadyHeld: true };
    }
    return { ok: false, reason: "paddle_held" };
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
      // Numbers count EVERY paddle ever issued — never reused after release.
      const number = paddleNumber((countRow?.count ?? 0) + 1);
      await tx.insert(paddles).values({
        id: paddleId,
        orgId: auction.orgId,
        auctionId: auction.id,
        teamId,
        personId: actorId,
        paddleNumber: number,
      });
      await appendEvent(
        tx,
        auction,
        actorId,
        correlationId,
        atMs,
        "PaddleIssued",
        { paddleId, teamId, personId: actorId, paddleNumber: number },
        paddleId,
        "claim",
      );
    });
  } catch {
    // The partial unique (auction, team) WHERE released_at IS NULL lost a race.
    return { ok: false, reason: "paddle_held" };
  }
  const [issued] = await db
    .select({ number: paddles.paddleNumber })
    .from(paddles)
    .where(eq(paddles.id, paddleId))
    .limit(1);
  return { ok: true, paddleId, paddleNumber: issued?.number ?? "", alreadyHeld: false };
}

export type ReleasePaddleResult =
  { ok: true } | { ok: false; reason: "no_active_paddle" | "not_authorized" };

export async function releasePaddle(
  db: Db,
  auction: AuctionRecord,
  actorId: string,
  teamId: string,
  conduct: boolean,
): Promise<ReleasePaddleResult> {
  const [active] = await db
    .select({ id: paddles.id, personId: paddles.personId })
    .from(paddles)
    .where(
      and(
        eq(paddles.auctionId, auction.id),
        eq(paddles.teamId, teamId),
        isNull(paddles.releasedAt),
      ),
    )
    .limit(1);
  if (active === undefined) {
    return { ok: false, reason: "no_active_paddle" };
  }
  if (active.personId !== actorId && !conduct) {
    return { ok: false, reason: "not_authorized" };
  }
  const correlationId = newId();
  const atMs = serverNowMs();
  await db.transaction(async (tx) => {
    await tx
      .update(paddles)
      .set({ releasedAt: new Date(atMs) })
      .where(eq(paddles.id, active.id));
    await appendEvent(
      tx,
      auction,
      actorId,
      correlationId,
      atMs,
      "PaddleReleased",
      { paddleId: active.id, teamId },
      active.id,
    );
  });
  return { ok: true };
}

// --- Live conduct helpers (M-IP4-2) ------------------------------------------------

/**
 * Close the lot on the block: with a leading bid → sold, without → unsold
 * (doc 41 close semantics). One idempotent-by-machine operation for both the
 * gavel and timer expiry — a lot that already resolved refuses with
 * illegal_transition, which callers treat as "already closed".
 */
export async function closeLot(
  db: Db,
  auction: AuctionRecord,
  lotId: string,
  actorId: string,
  reason?: string,
): Promise<LotMutationResult> {
  const leading = await leadingBidOf(db, lotId);
  return transitionLot(db, auction, lotId, actorId, leading !== null ? "sell" : "pass", reason);
}

/**
 * on_block → closing_soon when the timer runs under the extension window
 * (doc 39: the SAME machine carries urgency so every surface agrees). Driven
 * by the engine's timer loop; anti-snipe extension flips it back via placeBid.
 */
export async function markLotClosingSoon(
  db: Db,
  auction: AuctionRecord,
  lotId: string,
  actorId: string,
): Promise<LotMutationResult> {
  const lot = await loadLot(db, auction.id, lotId);
  if (lot === undefined) {
    return { ok: false, reason: "not_found" };
  }
  const decision = lotTransition(lot.status, "closing");
  if (!decision.ok) {
    return decision;
  }
  const correlationId = newId();
  const atMs = serverNowMs();
  await db.transaction(async (tx) => {
    await tx.update(lots).set({ status: decision.next }).where(eq(lots.id, lot.id));
    await appendEvent(
      tx,
      auction,
      actorId,
      correlationId,
      atMs,
      "LotClosingSoon",
      { lotId: lot.id },
      lot.id,
    );
  });
  return { ok: true, status: decision.next };
}

// --- The owner model (M-IP4-3). Invitation → acceptance → grant → claim; every
// step is one auction event + one audit row through the SAME appendEvent path
// as everything else — the ledger and replay carry the full workflow.

export type InviteOwnerResult =
  { ok: true; inviteId: string } | { ok: false; reason: "terminal_auction" | "unknown_team" };

/**
 * Mint an owner invitation for a team. The raw token never reaches this layer:
 * the web tier generates it and passes the HASH (the IP-2 invite discipline);
 * the event records ids only — secrets never enter the immutable log.
 */
export async function inviteOwner(
  db: Db,
  auction: AuctionRecord,
  actorId: string,
  teamId: string,
  tokenHash: string,
  expiresAtMs: number,
): Promise<InviteOwnerResult> {
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
  const inviteId = newId();
  const correlationId = newId();
  const atMs = serverNowMs();
  await db.transaction(async (tx) => {
    await tx.insert(auctionOwnerInvites).values({
      id: inviteId,
      orgId: auction.orgId,
      auctionId: auction.id,
      teamId,
      tokenHash,
      createdBy: actorId,
      expiresAt: new Date(expiresAtMs),
    });
    await appendEvent(
      tx,
      auction,
      actorId,
      correlationId,
      atMs,
      "OwnerInvited",
      { inviteId, teamId },
      inviteId,
    );
  });
  return { ok: true, inviteId };
}

export type RevokeOwnerInviteResult =
  { ok: true } | { ok: false; reason: "unknown_invite" | "already_accepted" | "terminal_auction" };

/**
 * TAKE THE LINK BACK.
 *
 * `auction_owner_invites.revoked_at` was READ in six places and WRITTEN in
 * none. There was no command, no event and no control, so an owner link stayed
 * live for its full seven days no matter what happened after it was sent — a
 * number typed wrong, a team owner who pulled out, a link forwarded into a
 * group chat. The cockpit had to apologise for it in copy: "An owner link
 * cannot be withdrawn once you send it."
 *
 * An ACCEPTED invitation is refused rather than revoked, and that distinction
 * is the point. Acceptance has already minted an org membership and a paddle
 * grant; quietly flipping `revoked_at` underneath would leave those standing
 * while the invite claimed otherwise, which is worse than the gap this closes.
 * Removing an owner who has accepted is a different operation on a different
 * object, and it is not this one.
 */
export async function revokeOwnerInvite(
  db: Db,
  auction: AuctionRecord,
  actorId: string,
  inviteId: string,
): Promise<RevokeOwnerInviteResult> {
  if (
    auction.status === "completed" ||
    auction.status === "reconciled" ||
    auction.status === "abandoned"
  ) {
    return { ok: false, reason: "terminal_auction" };
  }
  const [row] = await db
    .select({ id: auctionOwnerInvites.id, acceptedAt: auctionOwnerInvites.acceptedAt })
    .from(auctionOwnerInvites)
    .where(and(eq(auctionOwnerInvites.id, inviteId), eq(auctionOwnerInvites.auctionId, auction.id)))
    .limit(1);
  if (row === undefined) {
    return { ok: false, reason: "unknown_invite" };
  }
  if (row.acceptedAt !== null) {
    return { ok: false, reason: "already_accepted" };
  }
  const correlationId = newId();
  const atMs = serverNowMs();
  await db.transaction(async (tx) => {
    /*
     * Guarded on `revoked_at IS NULL`, so a double-click writes ONE event.
     * The invite table is the claim; the event is the history. A second
     * revocation event for the same link would be a lie about how many times
     * an organizer acted.
     */
    const updated = await tx
      .update(auctionOwnerInvites)
      .set({ revokedAt: new Date(atMs) })
      .where(and(eq(auctionOwnerInvites.id, inviteId), isNull(auctionOwnerInvites.revokedAt)))
      .returning({ id: auctionOwnerInvites.id });
    if (updated.length === 0) {
      // Already revoked. A no-op, not an error: the organizer wanted the link
      // dead and the link is dead.
      return;
    }
    await appendEvent(
      tx,
      auction,
      actorId,
      correlationId,
      atMs,
      "OwnerRevoked",
      { inviteId },
      inviteId,
    );
  });
  return { ok: true };
}

export type AcceptOwnerInviteResult =
  | { ok: true; teamId: string; alreadyAccepted: boolean }
  | { ok: false; reason: "unknown_invite" | "expired" | "already_accepted" };

/**
 * One-time acceptance (atomic claim — only one accept flips acceptedAt from
 * NULL). Revoked, expired and unknown invitations are indistinguishable
 * failures; re-acceptance by the SAME person is idempotent.
 */
export async function acceptOwnerInvite(
  db: Db,
  auction: AuctionRecord,
  actorId: string,
  inviteId: string,
): Promise<AcceptOwnerInviteResult> {
  const [row] = await db
    .select({
      id: auctionOwnerInvites.id,
      teamId: auctionOwnerInvites.teamId,
      expiresAt: auctionOwnerInvites.expiresAt,
      acceptedBy: auctionOwnerInvites.acceptedBy,
      revokedAt: auctionOwnerInvites.revokedAt,
    })
    .from(auctionOwnerInvites)
    .where(and(eq(auctionOwnerInvites.id, inviteId), eq(auctionOwnerInvites.auctionId, auction.id)))
    .limit(1);
  if (row === undefined || row.revokedAt !== null) {
    return { ok: false, reason: "unknown_invite" };
  }
  if (row.acceptedBy !== null) {
    return row.acceptedBy === actorId
      ? { ok: true, teamId: row.teamId, alreadyAccepted: true }
      : { ok: false, reason: "already_accepted" };
  }
  const atMs = serverNowMs();
  if (row.expiresAt.getTime() < atMs) {
    return { ok: false, reason: "expired" };
  }
  const correlationId = newId();
  const claimed = await db
    .update(auctionOwnerInvites)
    .set({ acceptedBy: actorId, acceptedAt: new Date(atMs) })
    .where(
      and(
        eq(auctionOwnerInvites.id, row.id),
        isNull(auctionOwnerInvites.acceptedAt),
        isNull(auctionOwnerInvites.revokedAt),
      ),
    )
    .returning({ id: auctionOwnerInvites.id });
  if (claimed.length === 0) {
    return { ok: false, reason: "already_accepted" };
  }
  await db.transaction(async (tx) => {
    await appendEvent(
      tx,
      auction,
      actorId,
      correlationId,
      atMs,
      "OwnerAccepted",
      { inviteId: row.id, teamId: row.teamId, personId: actorId },
      row.id,
    );
  });
  return { ok: true, teamId: row.teamId, alreadyAccepted: false };
}

export type GrantPaddleResult =
  | { ok: true; grantId: string; alreadyGranted: boolean }
  | { ok: false; reason: "terminal_auction" | "unknown_team" | "not_an_owner" };

/**
 * The explicit grant (directive: "no active paddle without explicit grant").
 * Only an ACCEPTED owner of the team may be granted; the grant is durable
 * authorization, not a token — claiming converts it into an active paddle.
 */
export async function grantPaddle(
  db: Db,
  auction: AuctionRecord,
  actorId: string,
  teamId: string,
  personId: string,
): Promise<GrantPaddleResult> {
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
  const [accepted] = await db
    .select({ id: auctionOwnerInvites.id })
    .from(auctionOwnerInvites)
    .where(
      and(
        eq(auctionOwnerInvites.auctionId, auction.id),
        eq(auctionOwnerInvites.teamId, teamId),
        eq(auctionOwnerInvites.acceptedBy, personId),
        isNull(auctionOwnerInvites.revokedAt),
      ),
    )
    .limit(1);
  if (accepted === undefined) {
    return { ok: false, reason: "not_an_owner" };
  }
  const grantId = newId();
  const correlationId = newId();
  const atMs = serverNowMs();
  try {
    await db.transaction(async (tx) => {
      await tx.insert(paddleGrants).values({
        id: grantId,
        orgId: auction.orgId,
        auctionId: auction.id,
        teamId,
        personId,
        grantedBy: actorId,
      });
      await appendEvent(
        tx,
        auction,
        actorId,
        correlationId,
        atMs,
        "PaddleGranted",
        { grantId, teamId, personId },
        grantId,
      );
    });
  } catch {
    // The partial unique (auction, team, person) WHERE revoked_at IS NULL:
    // granting twice is idempotent — the original grant stands.
    const [existing] = await db
      .select({ id: paddleGrants.id })
      .from(paddleGrants)
      .where(
        and(
          eq(paddleGrants.auctionId, auction.id),
          eq(paddleGrants.teamId, teamId),
          eq(paddleGrants.personId, personId),
          isNull(paddleGrants.revokedAt),
        ),
      )
      .limit(1);
    return { ok: true, grantId: existing?.id ?? grantId, alreadyGranted: true };
  }
  return { ok: true, grantId, alreadyGranted: false };
}

// --- Compensating undo (M-IP4-3; doc 41 `lot.reopen`) ------------------------------

export type UndoLastActionResult =
  | { ok: true; lotId: string; kind: "sold" | "unsold"; compensatesSeq: number }
  | {
      ok: false;
      reason: "auction_not_live" | "nothing_to_undo" | "undo_window_closed" | "not_found";
    };

/**
 * Undo the most recent lot resolution with COMPENSATING events — history is
 * never deleted (invariant 10). A sold undo voids the winning bid
 * (voided-but-visible: the row survives as `invalidated`), clears the sale
 * (the purse restores by projection — committed money is derived, never
 * stored), and returns the lot to the block with a fresh opening window.
 * Legal only until the next lot opens (doc 41) and only while live.
 */
export async function undoLastAction(
  db: Db,
  auction: AuctionRecord,
  actorId: string,
  reason?: string,
): Promise<UndoLastActionResult> {
  if (auction.status !== "live") {
    return { ok: false, reason: "auction_not_live" };
  }
  const events = await loadEvents(db, auction.id);
  const decision = decideUndo(events);
  if (!decision.ok) {
    return { ok: false, reason: decision.reason };
  }
  const target = decision.target;
  const lot = await loadLot(db, auction.id, target.lotId);
  if (lot === undefined) {
    return { ok: false, reason: "not_found" };
  }
  // Fail closed: LotReopened is only replayable onto a RESOLVED lot. If the lot
  // has moved on since it resolved, writing the compensating event would poison
  // the log — the reducer would reject it forever and recovery could never
  // succeed. decideUndo already refuses this; the guard makes it structural.
  if (lot.status !== target.kind) {
    return { ok: false, reason: "undo_window_closed" };
  }
  const correlationId = newId();
  const atMs = serverNowMs();
  const endsAtMs = openLotTimer(atMs, auction.config.timer).endsAtMs;
  await db.transaction(async (tx) => {
    if (target.kind === "sold" && target.bidId !== null) {
      const voided = bidTransition("accepted", "invalidate");
      if (voided.ok) {
        await tx.update(bids).set({ status: voided.next }).where(eq(bids.id, target.bidId));
      }
      await appendEvent(
        tx,
        auction,
        actorId,
        correlationId,
        atMs,
        "BidInvalidated",
        { lotId: target.lotId, bidId: target.bidId, reason: "undo" },
        target.bidId,
        reason,
      );
    }
    await tx
      .update(lots)
      .set({
        status: "on_block",
        soldToPaddleId: null,
        soldPrice: null,
        endsAtMs,
        heldRemainingMs: null,
        timerExtensions: 0,
      })
      .where(eq(lots.id, target.lotId));
    // Undoing a sale must also undo the squad placement, or the roster keeps a
    // player the ledger says was never signed — the failure mode that looks
    // correct and so never gets reported.
    await tx
      .update(registrations)
      .set({ teamId: null })
      .where(eq(registrations.id, lot.registrationId));
    await appendEvent(
      tx,
      auction,
      actorId,
      correlationId,
      atMs,
      "LotReopened",
      { lotId: target.lotId, compensatesSeq: target.atSeq, endsAtMs },
      target.lotId,
      reason,
    );
  });
  return { ok: true, lotId: target.lotId, kind: target.kind, compensatesSeq: target.atSeq };
}
