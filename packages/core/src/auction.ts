/**
 * The Auction domain foundation (IP-4, M-IP4-1; docs 39/41). This module freezes
 * every invariant that money, bidding, timing, recovery and fairness depend on:
 *
 *   1. the Auction / Lot / Bid state machines — typed states, typed commands,
 *      guards, fail-closed, illegal transitions unrepresentable;
 *   2. the bid validation gauntlet (doc 41's eleven ordered checks, exact codes);
 *   3. the increment ladder (flat or IPL-style slabs) — pure arithmetic on Paise;
 *   4. the deterministic timer model + anti-snipe auto-extension
 *      (endsAt := max(endsAt, now + extension), never shrinks, never beyond
 *      now + initial — invariant 14). Server time only, injected as a number;
 *   5. the immutable event model and the pure replay reducer — the recovery
 *      spine: fold(events) rebuilds the aggregates, deterministically.
 *
 * Pure: no storage, no IO, no ambient time, no randomness. The web aggregate
 * orchestrates; this module decides.
 */

import { paise, type Paise } from "./money";

// --- Auction lifecycle (doc 39: Scheduled → Live ⇄ Paused → Completed →
// Reconciled, ↘ Abandoned). "Reconciled" is declared with its edge so the
// machine never changes when settlement (IP-6) arrives; the aggregate exposes
// no reconcile operation this milestone.

export type AuctionStatus =
  "scheduled" | "live" | "paused" | "completed" | "reconciled" | "abandoned";

export const AUCTION_STATUSES: readonly AuctionStatus[] = [
  "scheduled",
  "live",
  "paused",
  "completed",
  "reconciled",
  "abandoned",
];

export type AuctionCommand = "open" | "pause" | "resume" | "complete" | "reconcile" | "abort";

const AUCTION_EDGES: Record<AuctionStatus, ReadonlySet<AuctionCommand>> = {
  scheduled: new Set(["open", "abort"]),
  live: new Set(["pause", "complete", "abort"]),
  paused: new Set(["resume", "complete", "abort"]),
  completed: new Set(["reconcile"]),
  // Terminal: reconciled is the verified end; abandoned freezes the ledger as-is.
  reconciled: new Set([]),
  abandoned: new Set([]),
};

const AUCTION_TARGET: Record<AuctionCommand, AuctionStatus> = {
  open: "live",
  pause: "paused",
  resume: "live",
  complete: "completed",
  reconcile: "reconciled",
  abort: "abandoned",
};

/** Guard inputs (invariant 15 slice): the caller supplies proof, never intent. */
export interface AuctionReadiness {
  paddleCount: number; // ≥2 teams with issued paddles
  queuedLots: number; // ≥1 lot in the queue
  unresolvedLots: number; // on_block + closing_soon + frozen (blocks complete)
}

export type AuctionTransition =
  { ok: true; next: AuctionStatus } | { ok: false; reason: "illegal_transition" | "guard_failed" };

/**
 * Upholds: only declared edges are legal; opening needs ≥2 paddles and ≥1
 * queued lot; completing needs zero unresolved lots (a frozen lot never blocks
 * the NIGHT — invariant 19 — but it does block declaring the auction complete).
 * Abort is always available from non-terminal states: the catastrophic exit
 * freezes everything as-is (doc 39).
 */
export function auctionTransition(
  from: AuctionStatus,
  command: AuctionCommand,
  readiness?: AuctionReadiness,
): AuctionTransition {
  if (!AUCTION_EDGES[from].has(command)) {
    return { ok: false, reason: "illegal_transition" };
  }
  if (command === "open") {
    const ready =
      readiness !== undefined && readiness.paddleCount >= 2 && readiness.queuedLots >= 1;
    if (!ready) {
      return { ok: false, reason: "guard_failed" };
    }
  }
  if (command === "complete") {
    if (readiness === undefined || readiness.unresolvedLots > 0) {
      return { ok: false, reason: "guard_failed" };
    }
  }
  return { ok: true, next: AUCTION_TARGET[command] };
}

/** Machine descriptor — the single source for diagrams, docs and the demo UI. */
export interface MachineEdge<S extends string, C extends string> {
  from: S;
  command: C;
  to: S;
  guard?: string;
}

export const AUCTION_MACHINE: readonly MachineEdge<AuctionStatus, AuctionCommand>[] = (
  Object.entries(AUCTION_EDGES) as [AuctionStatus, ReadonlySet<AuctionCommand>][]
).flatMap(([from, commands]) =>
  [...commands].map((command) => ({
    from,
    command,
    to: AUCTION_TARGET[command],
    ...(command === "open"
      ? { guard: "≥2 paddles · ≥1 queued lot" }
      : command === "complete"
        ? { guard: "no unresolved lots" }
        : {}),
  })),
);

// --- Lot lifecycle (doc 39 + directive: Prepare/Queue/Open/Hold/Sold/Unsold/
// Withdrawn; ClosingSoon is the anti-snipe visual state in the SAME machine so
// every surface agrees on urgency; requeue follows the unsold policy).

export type LotStatus =
  "prepared" | "queued" | "on_block" | "closing_soon" | "sold" | "unsold" | "frozen" | "withdrawn";

export const LOT_STATUSES: readonly LotStatus[] = [
  "prepared",
  "queued",
  "on_block",
  "closing_soon",
  "sold",
  "unsold",
  "frozen",
  "withdrawn",
];

export type LotCommand =
  | "queue" // prepared → queued
  | "open" // queued → on_block (auction must be live — aggregate-checked)
  | "closing" // on_block → closing_soon (timer under threshold)
  | "extend" // closing_soon → on_block (anti-snipe; the timer never shrinks)
  | "hold" // on_block | closing_soon → frozen (invariant 17: human resolution)
  | "sell" // → sold (guard: leading bid exists — purchase durability is IP-6)
  | "pass" // → unsold (guard: NO leading bid)
  | "requeue" // unsold | frozen → queued (guard: unsold policy allows)
  | "withdraw"; // prepared | queued → withdrawn

const LOT_EDGES: Record<LotStatus, ReadonlySet<LotCommand>> = {
  prepared: new Set(["queue", "withdraw"]),
  queued: new Set(["open", "withdraw"]),
  on_block: new Set(["closing", "hold", "sell", "pass"]),
  closing_soon: new Set(["extend", "hold", "sell", "pass"]),
  frozen: new Set(["sell", "pass", "requeue"]),
  unsold: new Set(["requeue"]),
  // Sold is terminal: undo is a COMPENSATING event (lot.reopened, doc 41),
  // never a backward edge — history stays intact (C-9). Arrives post-M-IP4-1.
  sold: new Set([]),
  withdrawn: new Set([]),
};

const LOT_TARGET: Record<LotCommand, LotStatus> = {
  queue: "queued",
  open: "on_block",
  closing: "closing_soon",
  extend: "on_block",
  hold: "frozen",
  sell: "sold",
  pass: "unsold",
  requeue: "queued",
  withdraw: "withdrawn",
};

export interface LotGuards {
  hasLeadingBid: boolean;
  requeueAllowed: boolean; // caller computes from unsoldPolicy + rounds used
}

export type LotTransition =
  { ok: true; next: LotStatus } | { ok: false; reason: "illegal_transition" | "guard_failed" };

/**
 * Upholds: sell requires a leading bid; pass requires NO leading bid (a lot
 * with money on it cannot quietly go unsold — freeze it instead); requeue only
 * when the policy allows. Everything else fails closed.
 */
export function lotTransition(
  from: LotStatus,
  command: LotCommand,
  guards?: LotGuards,
): LotTransition {
  if (!LOT_EDGES[from].has(command)) {
    return { ok: false, reason: "illegal_transition" };
  }
  if (command === "sell" && guards?.hasLeadingBid !== true) {
    return { ok: false, reason: "guard_failed" };
  }
  if (command === "pass" && guards?.hasLeadingBid !== false) {
    return { ok: false, reason: "guard_failed" };
  }
  if (command === "requeue" && guards?.requeueAllowed !== true) {
    return { ok: false, reason: "guard_failed" };
  }
  return { ok: true, next: LOT_TARGET[command] };
}

export const LOT_MACHINE: readonly MachineEdge<LotStatus, LotCommand>[] = (
  Object.entries(LOT_EDGES) as [LotStatus, ReadonlySet<LotCommand>][]
).flatMap(([from, commands]) =>
  [...commands].map((command) => ({
    from,
    command,
    to: LOT_TARGET[command],
    ...(command === "sell"
      ? { guard: "leading bid exists" }
      : command === "pass"
        ? { guard: "no leading bid" }
        : command === "requeue"
          ? { guard: "unsold policy allows" }
          : command === "closing"
            ? { guard: "timer under threshold" }
            : command === "extend"
              ? { guard: "anti-snipe — timer never shrinks" }
              : {}),
  })),
);

// --- Bid lifecycle -------------------------------------------------------------
// An accepted bid is immutable evidence (the BidAccepted event). The bid RECORD
// carries projection state: leading (accepted) → outbid (replaced by a higher
// accepted bid) → invalidated (adjudication — arrives with undo/override work).
// Rejected attempts never become bid records: they are events + audit only.

export type BidStatus = "accepted" | "outbid" | "invalidated";

export const BID_STATUSES: readonly BidStatus[] = ["accepted", "outbid", "invalidated"];

export type BidCommand = "outbid" | "invalidate";

const BID_EDGES: Record<BidStatus, ReadonlySet<BidCommand>> = {
  accepted: new Set(["outbid", "invalidate"]),
  outbid: new Set(["invalidate"]),
  invalidated: new Set([]),
};

const BID_TARGET: Record<BidCommand, BidStatus> = {
  outbid: "outbid",
  invalidate: "invalidated",
};

export type BidTransition =
  { ok: true; next: BidStatus } | { ok: false; reason: "illegal_transition" };

export function bidTransition(from: BidStatus, command: BidCommand): BidTransition {
  if (!BID_EDGES[from].has(command)) {
    return { ok: false, reason: "illegal_transition" };
  }
  return { ok: true, next: BID_TARGET[command] };
}

export const BID_MACHINE: readonly MachineEdge<BidStatus, BidCommand>[] = (
  Object.entries(BID_EDGES) as [BidStatus, ReadonlySet<BidCommand>][]
).flatMap(([from, commands]) =>
  [...commands].map((command) => ({ from, command, to: BID_TARGET[command] })),
);

// --- Increment ladder (doc 41: flat carries reference behaviour; slabs default) --

/** Ordered slabs; the LAST slab has upTo === null (open-ended). Prices in paise. */
export interface IncrementSlab {
  upTo: Paise | null; // slab applies while price < upTo
  step: Paise;
}

export function isValidSlabs(slabs: readonly IncrementSlab[]): boolean {
  if (slabs.length === 0) {
    return false;
  }
  for (let i = 0; i < slabs.length; i++) {
    const slab = slabs[i] as IncrementSlab;
    if (slab.step <= 0) {
      return false;
    }
    const isLast = i === slabs.length - 1;
    if (isLast ? slab.upTo !== null : slab.upTo === null) {
      return false;
    }
    if (!isLast) {
      const next = slabs[i + 1] as IncrementSlab;
      if (next.upTo !== null && slab.upTo !== null && next.upTo <= slab.upTo) {
        return false;
      }
    }
  }
  return true;
}

/** The step that applies at a given price (the slab containing it). */
export function ladderStep(slabs: readonly IncrementSlab[], price: Paise): Paise {
  for (const slab of slabs) {
    if (slab.upTo === null || price < slab.upTo) {
      return slab.step;
    }
  }
  // Unreachable for valid slabs (last is open-ended); fail closed to last step.
  return (slabs[slabs.length - 1] as IncrementSlab).step;
}

/**
 * The ladder is the deterministic price sequence base, base+step(base), … —
 * each rung advances by the step of the slab the CURRENT rung sits in. A bid
 * is well-formed only if it lands exactly on a rung (doc 41 check 7). Bounded
 * walk: rungs are ≥ the smallest step apart, so this terminates quickly for
 * realistic purses.
 */
export function ladderContains(
  base: Paise,
  slabs: readonly IncrementSlab[],
  amount: Paise,
): boolean {
  if (amount < base) {
    return false;
  }
  let rung = base;
  while (rung < amount) {
    rung = paise(rung + ladderStep(slabs, rung));
  }
  return rung === amount;
}

/** The minimum legal next bid: the base when unled, else one rung above current. */
export function nextMinimumBid(
  base: Paise,
  slabs: readonly IncrementSlab[],
  current: Paise | null,
): Paise {
  if (current === null) {
    return base;
  }
  return paise(current + ladderStep(slabs, current));
}

// --- Bid validation gauntlet (doc 41 — eleven ordered checks, exact codes) ------

export type BidRejectionCode =
  | "LOT_NOT_OPEN"
  | "NOT_AUTHORIZED"
  | "ALREADY_LEADING"
  | "INVALID_AMOUNT"
  | "BELOW_BASE"
  | "BELOW_CURRENT"
  | "INVALID_INCREMENT"
  | "BUDGET_EXCEEDED"
  | "RESERVE_VIOLATION"
  | "SQUAD_FULL"
  | "ROLE_LIMIT";

export interface BidInput {
  auctionStatus: AuctionStatus;
  lotStatus: LotStatus;
  basePrice: Paise;
  leadingAmount: Paise | null;
  leadingPaddleId: string | null;
  paddleId: string;
  /** The action layer resolves capability/paddle ownership; core sees the verdict. */
  bidderAuthorized: boolean;
  amountRaw: number; // unvalidated wire value — check 4 owns its shape
  slabs: readonly IncrementSlab[];
  purseRemaining: Paise;
  squadSize: number;
  squadMin: number;
  squadMax: number;
  /** Reserve rule floor: the minimum possible price of any future lot. */
  minPossiblePrice: Paise;
  /** Role quota for THIS lot's role: null = no quota. */
  roleCount: number;
  roleMax: number | null;
}

export type BidDecision = { ok: true; amount: Paise } | { ok: false; code: BidRejectionCode };

/**
 * The ordered gauntlet — first failure returns its code (doc 41). Pure and
 * total: same input, same verdict, forever. The engine enforces even what
 * clients snap to (check 7).
 */
export function decideBid(input: BidInput): BidDecision {
  // 1 · auction live, lot on the block
  if (
    input.auctionStatus !== "live" ||
    (input.lotStatus !== "on_block" && input.lotStatus !== "closing_soon")
  ) {
    return { ok: false, code: "LOT_NOT_OPEN" };
  }
  // 2 · actor may bid for this paddle
  if (!input.bidderAuthorized) {
    return { ok: false, code: "NOT_AUTHORIZED" };
  }
  // 3 · self-outbidding is refused
  if (input.leadingPaddleId !== null && input.leadingPaddleId === input.paddleId) {
    return { ok: false, code: "ALREADY_LEADING" };
  }
  // 4 · a valid positive integer amount
  if (!Number.isSafeInteger(input.amountRaw) || input.amountRaw <= 0) {
    return { ok: false, code: "INVALID_AMOUNT" };
  }
  const amount = paise(input.amountRaw);
  // 5 · at or above base
  if (amount < input.basePrice) {
    return { ok: false, code: "BELOW_BASE" };
  }
  // 6 · above the current bid
  if (input.leadingAmount !== null && amount <= input.leadingAmount) {
    return { ok: false, code: "BELOW_CURRENT" };
  }
  // 7 · lands on the increment ladder
  if (!ladderContains(input.basePrice, input.slabs, amount)) {
    return { ok: false, code: "INVALID_INCREMENT" };
  }
  // 8 · within purse
  if (amount > input.purseRemaining) {
    return { ok: false, code: "BUDGET_EXCEEDED" };
  }
  // 9 · reserve rule: enough must remain to complete squadMin
  const stillNeeded = Math.max(0, input.squadMin - input.squadSize - 1);
  const reserve = paise(stillNeeded * input.minPossiblePrice);
  if (paise(input.purseRemaining - amount) < reserve) {
    return { ok: false, code: "RESERVE_VIOLATION" };
  }
  // 10 · squad not full
  if (input.squadSize >= input.squadMax) {
    return { ok: false, code: "SQUAD_FULL" };
  }
  // 11 · role quota
  if (input.roleMax !== null && input.roleCount >= input.roleMax) {
    return { ok: false, code: "ROLE_LIMIT" };
  }
  return { ok: true, amount };
}

// --- Timer model (deterministic; server time only, injected as milliseconds) ----
// Phases: Opening (lot opens, endsAt = now + initial) → Extension (anti-snipe)
// → Hold (frozen remainder) → resolution. No setTimeout lives here — live
// scheduling is a later milestone; the MODEL is frozen now.

export interface TimerPolicy {
  initialSeconds: number; // doc 41 default 30
  extensionSeconds: number; // doc 41 default 15
}

export interface LotTimer {
  readonly opensAtMs: number;
  readonly endsAtMs: number;
  readonly extensions: number;
}

export function isValidTimerPolicy(policy: TimerPolicy): boolean {
  return (
    Number.isSafeInteger(policy.initialSeconds) &&
    policy.initialSeconds > 0 &&
    Number.isSafeInteger(policy.extensionSeconds) &&
    policy.extensionSeconds > 0 &&
    policy.extensionSeconds <= policy.initialSeconds
  );
}

/** Opening: the lot goes on the block with the full initial window. */
export function openLotTimer(nowMs: number, policy: TimerPolicy): LotTimer {
  return { opensAtMs: nowMs, endsAtMs: nowMs + policy.initialSeconds * 1000, extensions: 0 };
}

/**
 * Auto-extension (invariant 14): on each ACCEPTED bid,
 *   endsAt := max(endsAt, now + extension), capped at now + initial.
 * The timer never shrinks, and a bid can never buy more runway than a fresh
 * lot. Deterministic — no race: the single writer applies bids in seq order,
 * so the fold of (bid times) fully determines the final endsAt.
 */
export function extendOnBid(
  timer: LotTimer,
  nowMs: number,
  policy: TimerPolicy,
): { timer: LotTimer; extended: boolean } {
  const proposed = Math.min(
    Math.max(timer.endsAtMs, nowMs + policy.extensionSeconds * 1000),
    nowMs + policy.initialSeconds * 1000,
  );
  if (proposed <= timer.endsAtMs) {
    return { timer, extended: false };
  }
  return {
    timer: { ...timer, endsAtMs: proposed, extensions: timer.extensions + 1 },
    extended: true,
  };
}

/** Hold: freeze the remaining runway (never negative) for later resumption. */
export function holdRemainingMs(timer: LotTimer, nowMs: number): number {
  return Math.max(0, timer.endsAtMs - nowMs);
}

/** Recovery/resume: the frozen remainder re-attaches to the server's now. */
export function resumeLotTimer(remainingMs: number, nowMs: number, extensions: number): LotTimer {
  return { opensAtMs: nowMs, endsAtMs: nowMs + Math.max(0, remainingMs), extensions };
}

export function isTimerExpired(timer: LotTimer, nowMs: number): boolean {
  return nowMs >= timer.endsAtMs;
}

/** ClosingSoon = remaining runway at or under the extension window (doc 39). */
export function isClosingSoon(timer: LotTimer, nowMs: number, policy: TimerPolicy): boolean {
  const remaining = timer.endsAtMs - nowMs;
  return remaining > 0 && remaining <= policy.extensionSeconds * 1000;
}

// --- Auction configuration (doc 41 AuctionConfig; locks at creation) -------------

export type UnsoldPolicy = { mode: "requeue"; rounds: number } | { mode: "final" };

export interface AuctionConfig {
  pursePerTeam: Paise;
  squadMin: number;
  squadMax: number;
  slabs: readonly IncrementSlab[]; // flat mode = a single open-ended slab
  timer: TimerPolicy;
  unsoldPolicy: UnsoldPolicy;
  basePriceBands: Readonly<Record<string, Paise>>;
  basePriceDefault: Paise;
  roleQuotas: Readonly<Record<string, number>>; // max per role; absent = no quota
}

/** Doc 41 defaults: slabs +₹5k < ₹1L, +₹10k < ₹5L, +₹25k above; 30s/15s timer. */
export const DEFAULT_AUCTION_CONFIG: AuctionConfig = {
  pursePerTeam: paise(20_000_000 * 100), // ₹2,00,00,000
  squadMin: 8,
  squadMax: 15,
  slabs: [
    { upTo: paise(100_000 * 100), step: paise(5_000 * 100) },
    { upTo: paise(500_000 * 100), step: paise(10_000 * 100) },
    { upTo: null, step: paise(25_000 * 100) },
  ],
  timer: { initialSeconds: 30, extensionSeconds: 15 },
  unsoldPolicy: { mode: "requeue", rounds: 2 },
  basePriceBands: { A: paise(50_000 * 100), B: paise(25_000 * 100), C: paise(10_000 * 100) },
  basePriceDefault: paise(10_000 * 100),
  roleQuotas: {},
};

export type ConfigValidation = { ok: true } | { ok: false; reason: string };

export function validateAuctionConfig(config: AuctionConfig): ConfigValidation {
  if (config.squadMin < 1 || config.squadMax < config.squadMin) {
    return { ok: false, reason: "squad bounds" };
  }
  if (!isValidSlabs(config.slabs)) {
    return { ok: false, reason: "increment slabs" };
  }
  if (!isValidTimerPolicy(config.timer)) {
    return { ok: false, reason: "timer policy" };
  }
  if (config.unsoldPolicy.mode === "requeue" && config.unsoldPolicy.rounds < 1) {
    return { ok: false, reason: "unsold rounds" };
  }
  if (config.basePriceDefault <= 0 || config.pursePerTeam < config.basePriceDefault) {
    return { ok: false, reason: "base price vs purse" };
  }
  return { ok: true };
}

/** The reserve-rule floor: the cheapest any future lot can possibly open at. */
export function minPossiblePrice(config: AuctionConfig): Paise {
  const bands = Object.values(config.basePriceBands);
  return paise(Math.min(config.basePriceDefault, ...(bands.length > 0 ? bands : [Infinity])));
}

/** Base price for a registration's band (fail-closed to the default). */
export function basePriceFor(config: AuctionConfig, band: string | null): Paise {
  if (band !== null && band in config.basePriceBands) {
    return config.basePriceBands[band] as Paise;
  }
  return config.basePriceDefault;
}

export function requeueAllowed(policy: UnsoldPolicy, roundsUsed: number): boolean {
  return policy.mode === "requeue" && roundsUsed < policy.rounds;
}

// --- Identity derivations (human-friendly, immutable once issued) ----------------

export function paddleNumber(seq: number): string {
  return `P${String(seq).padStart(2, "0")}`;
}

export function lotNumber(seq: number): string {
  return `L${String(seq).padStart(3, "0")}`;
}

// --- Event model (every mutation emits exactly one immutable event) --------------

export type AuctionEventType =
  | "AuctionCreated"
  | "PaddleIssued"
  | "LotPrepared"
  | "LotQueued"
  | "AuctionOpened"
  | "AuctionPaused"
  | "AuctionResumed"
  | "AuctionClosed"
  | "AuctionAborted"
  | "AuctionRecovered"
  | "LotOpened"
  | "LotClosingSoon"
  | "LotHeld"
  | "LotSold"
  | "LotUnsold"
  | "LotRequeued"
  | "LotWithdrawn"
  | "BidAccepted"
  | "BidRejected"
  | "BidInvalidated"
  | "TimerExtended";

export const AUCTION_EVENT_TYPES: readonly AuctionEventType[] = [
  "AuctionCreated",
  "PaddleIssued",
  "LotPrepared",
  "LotQueued",
  "AuctionOpened",
  "AuctionPaused",
  "AuctionResumed",
  "AuctionClosed",
  "AuctionAborted",
  "AuctionRecovered",
  "LotOpened",
  "LotClosingSoon",
  "LotHeld",
  "LotSold",
  "LotUnsold",
  "LotRequeued",
  "LotWithdrawn",
  "BidAccepted",
  "BidRejected",
  "BidInvalidated",
  "TimerExtended",
];

/**
 * The persisted envelope. seq is the per-auction total order (the fairness
 * proof — single writer, doc 41); atMs is server wall time; correlationId ties
 * the event to its audit row and triggering request.
 */
export interface AuctionEventEnvelope {
  seq: number;
  type: string; // validated by the reducer — unknown types fail replay closed
  atMs: number;
  actor: string;
  correlationId: string;
  payload: Readonly<Record<string, unknown>>;
}

// --- Replay reducer (the recovery spine) -----------------------------------------
// fold(events) → projection. Deterministic: same events, same projection.
// Fail-closed: a gap in seq, an unknown type, or an event that is illegal in
// the current state stops the replay with the offending seq — corrupted logs
// are surfaced, never silently absorbed.

export interface LotProjection {
  status: LotStatus;
  bidCount: number;
  leadingBidId: string | null;
  leadingPaddleId: string | null;
  leadingAmount: number | null; // paise as plain integer (JSON-exact)
  soldAmount: number | null;
  soldPaddleId: string | null;
  roundsUsed: number;
  endsAtMs: number | null;
}

export interface PaddleProjection {
  teamId: string;
  personId: string;
  paddleNumber: string;
  committed: number; // paise committed via sold lots
}

export interface AuctionProjection {
  status: AuctionStatus;
  lots: Record<string, LotProjection>;
  paddles: Record<string, PaddleProjection>;
  lastSeq: number;
  eventCount: number;
}

export type ReplayResult =
  { ok: true; projection: AuctionProjection } | { ok: false; atSeq: number; reason: string };

function str(payload: Readonly<Record<string, unknown>>, key: string): string | null {
  const value = payload[key];
  return typeof value === "string" ? value : null;
}

function num(payload: Readonly<Record<string, unknown>>, key: string): number | null {
  const value = payload[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function replayAuction(events: readonly AuctionEventEnvelope[]): ReplayResult {
  const projection: AuctionProjection = {
    status: "scheduled",
    lots: {},
    paddles: {},
    lastSeq: 0,
    eventCount: 0,
  };
  for (const event of events) {
    if (event.seq !== projection.lastSeq + 1) {
      return { ok: false, atSeq: event.seq, reason: "sequence_gap" };
    }
    const fail = (reason: string): ReplayResult => ({ ok: false, atSeq: event.seq, reason });
    const lotOf = (): LotProjection | null => {
      const lotId = str(event.payload, "lotId");
      return lotId !== null ? (projection.lots[lotId] ?? null) : null;
    };
    switch (event.type) {
      case "AuctionCreated":
        break;
      case "PaddleIssued": {
        const paddleId = str(event.payload, "paddleId");
        const teamId = str(event.payload, "teamId");
        const personId = str(event.payload, "personId");
        const number = str(event.payload, "paddleNumber");
        if (paddleId === null || teamId === null || personId === null || number === null) {
          return fail("malformed_paddle");
        }
        projection.paddles[paddleId] = { teamId, personId, paddleNumber: number, committed: 0 };
        break;
      }
      case "LotPrepared": {
        const lotId = str(event.payload, "lotId");
        if (lotId === null) {
          return fail("malformed_lot");
        }
        projection.lots[lotId] = {
          status: "prepared",
          bidCount: 0,
          leadingBidId: null,
          leadingPaddleId: null,
          leadingAmount: null,
          soldAmount: null,
          soldPaddleId: null,
          roundsUsed: 0,
          endsAtMs: null,
        };
        break;
      }
      case "LotQueued": {
        const lot = lotOf();
        if (lot === null) {
          return fail("unknown_lot");
        }
        // Requeue and first queue share the event type; the machine legality
        // was proven at write time — replay re-verifies reachability.
        if (lot.status !== "prepared" && lot.status !== "unsold" && lot.status !== "frozen") {
          return fail("illegal_replayed_transition");
        }
        if (lot.status === "unsold" || lot.status === "frozen") {
          lot.roundsUsed += 1;
          lot.leadingBidId = null;
          lot.leadingPaddleId = null;
          lot.leadingAmount = null;
        }
        lot.status = "queued";
        break;
      }
      case "AuctionOpened":
        projection.status = "live";
        break;
      case "AuctionPaused":
        projection.status = "paused";
        break;
      case "AuctionResumed":
        projection.status = "live";
        break;
      case "AuctionClosed":
        projection.status = "completed";
        break;
      case "AuctionAborted":
        projection.status = "abandoned";
        break;
      case "AuctionRecovered":
        break; // recovery leaves state as replayed — it IS the replay
      case "LotOpened": {
        const lot = lotOf();
        if (lot === null) {
          return fail("unknown_lot");
        }
        lot.status = "on_block";
        lot.endsAtMs = num(event.payload, "endsAtMs");
        break;
      }
      case "LotClosingSoon": {
        const lot = lotOf();
        if (lot === null) {
          return fail("unknown_lot");
        }
        lot.status = "closing_soon";
        break;
      }
      case "LotHeld": {
        const lot = lotOf();
        if (lot === null) {
          return fail("unknown_lot");
        }
        lot.status = "frozen";
        break;
      }
      case "LotSold": {
        const lot = lotOf();
        const amount = num(event.payload, "amount");
        const paddleId = str(event.payload, "paddleId");
        if (lot === null || amount === null || paddleId === null) {
          return fail("malformed_sale");
        }
        lot.status = "sold";
        lot.soldAmount = amount;
        lot.soldPaddleId = paddleId;
        const paddle = projection.paddles[paddleId];
        if (paddle === undefined) {
          return fail("unknown_paddle");
        }
        paddle.committed += amount;
        break;
      }
      case "LotUnsold": {
        const lot = lotOf();
        if (lot === null) {
          return fail("unknown_lot");
        }
        lot.status = "unsold";
        break;
      }
      case "LotRequeued": {
        // Emitted alongside LotQueued semantics for later rounds; kept distinct
        // in the catalog. Same handling as LotQueued from unsold/frozen.
        const lot = lotOf();
        if (lot === null || (lot.status !== "unsold" && lot.status !== "frozen")) {
          return fail("illegal_replayed_transition");
        }
        lot.roundsUsed += 1;
        lot.leadingBidId = null;
        lot.leadingPaddleId = null;
        lot.leadingAmount = null;
        lot.status = "queued";
        break;
      }
      case "LotWithdrawn": {
        const lot = lotOf();
        if (lot === null) {
          return fail("unknown_lot");
        }
        lot.status = "withdrawn";
        break;
      }
      case "BidAccepted": {
        const lot = lotOf();
        const bidId = str(event.payload, "bidId");
        const paddleId = str(event.payload, "paddleId");
        const amount = num(event.payload, "amount");
        if (lot === null || bidId === null || paddleId === null || amount === null) {
          return fail("malformed_bid");
        }
        if (lot.status !== "on_block" && lot.status !== "closing_soon") {
          return fail("illegal_replayed_transition");
        }
        lot.bidCount += 1;
        lot.leadingBidId = bidId;
        lot.leadingPaddleId = paddleId;
        lot.leadingAmount = amount;
        break;
      }
      case "BidRejected":
        break; // evidence only — no state change
      case "BidInvalidated":
        break; // projection impact arrives with adjudication (post-M-IP4-1)
      case "TimerExtended": {
        const lot = lotOf();
        const endsAtMs = num(event.payload, "endsAtMs");
        if (lot === null || endsAtMs === null) {
          return fail("malformed_timer");
        }
        if (lot.endsAtMs !== null && endsAtMs < lot.endsAtMs) {
          return fail("timer_shrank"); // invariant 14 — replay re-proves it
        }
        lot.endsAtMs = endsAtMs;
        break;
      }
      default:
        return fail("unknown_event_type");
    }
    projection.lastSeq = event.seq;
    projection.eventCount += 1;
  }
  return { ok: true, projection };
}
