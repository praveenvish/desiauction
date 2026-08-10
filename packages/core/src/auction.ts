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
  /**
   * Teams whose squad is under `squadMin`. "Squad 8–15" is printed on every
   * auction screen; until now it was enforced only as a ceiling, so an auction
   * could seal with three teams holding one player each and no objection.
   * Blocks complete — overridably, because an auction that genuinely ends
   * short at 11pm must still be closeable, and a rule with no exit gets worked
   * around with database edits, which is worse.
   */
  teamsBelowSquadMin?: number;
}

export type AuctionTransition =
  | { ok: true; next: AuctionStatus }
  | { ok: false; reason: "illegal_transition" | "guard_failed" | "squad_below_minimum" };

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
  /** Conductor's explicit, reasoned override of a soft guard (short squads). */
  override = false,
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
    // Hard: no lot may be mid-flight. Soft: short squads refuse unless the
    // conductor overrides on the record.
    if ((readiness.teamsBelowSquadMin ?? 0) > 0 && !override) {
      return { ok: false, reason: "squad_below_minimum" };
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
  | "withdraw"; // prepared | queued | frozen → withdrawn

const LOT_EDGES: Record<LotStatus, ReadonlySet<LotCommand>> = {
  prepared: new Set(["queue", "withdraw"]),
  queued: new Set(["open", "withdraw"]),
  on_block: new Set(["closing", "hold", "sell", "pass"]),
  closing_soon: new Set(["extend", "hold", "sell", "pass"]),
  /*
   * `withdraw` is here because without it a frozen lot could DEADLOCK an entire
   * auction, and the deadlock was reachable in ordinary use.
   *
   * A lot is frozen precisely because there is money on it that must not be
   * resolved automatically — invariant 17, human resolution. Its three exits
   * were sell (needs a leading bid), pass (needs NO leading bid) and requeue
   * (needs `unsoldPolicy.mode === "requeue"` with rounds left). So for a frozen
   * lot holding a MISTAKEN bid in an auction configured `{ mode: "final" }` —
   * a supported configuration, not an exotic one — pass was refused for having
   * money on it, requeue did not exist, and the only legal move was to SELL at
   * the very price the conductor froze the lot to avoid. `unresolvedLots`
   * counts frozen, so `complete` was refused too: the night could not end
   * without making the sale.
   *
   * Withdrawing is the honest exit and needs no new event, no new state and no
   * back edge. `LotWithdrawn` already exists and its replay accepts a lot in
   * any status; `withdrawn` is terminal and is NOT counted unresolved, so the
   * auction can close. The aggregate voids the leading bid on the way out, the
   * same way `requeue` always has.
   */
  frozen: new Set(["sell", "pass", "requeue", "withdraw"]),
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
 * is well-formed only if it lands exactly on a rung (doc 41 check 7).
 *
 * Computed in O(#slabs), NOT by walking rung-by-rung: a rung-by-rung walk is
 * O((amount − base) / smallest-step), so a crafted amount up to
 * Number.MAX_SAFE_INTEGER (which passes checks 4–6 before this check) would burn
 * seconds of synchronous CPU on the single-writer engine — a fairness/liveness
 * DoS reachable by any authorized bidder. Within one slab the reachable rungs
 * are an arithmetic progression, so membership is a single modulo; between slabs
 * we jump straight to the first rung at or past the slab boundary. Regression:
 * the walk is retained as the oracle in auction.test.ts.
 */
export function ladderContains(
  base: Paise,
  slabs: readonly IncrementSlab[],
  amount: Paise,
): boolean {
  if (amount < base) {
    return false;
  }
  let rung: number = base;
  for (const slab of slabs) {
    if (rung >= amount) {
      break;
    }
    // Skip slabs the current rung has already passed (base may start high).
    if (slab.upTo !== null && rung >= slab.upTo) {
      continue;
    }
    // `amount` falls in this slab's stepping range (or the slab is open-ended):
    // it is reachable iff it sits exactly on a rung of this arithmetic step.
    if (slab.upTo === null || amount < slab.upTo) {
      return (amount - rung) % slab.step === 0;
    }
    // Otherwise advance to the first rung at or beyond this slab's ceiling — the
    // rung from which the NEXT slab's step takes over (matches ladderStep's
    // `price < upTo` boundary exactly) — then continue with the next slab.
    const steps = Math.ceil((slab.upTo - rung) / slab.step);
    rung += steps * slab.step;
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
  /**
   * Check 3 compares TEAMS, not paddles (doc 41: "team is not already
   * leading") — a team that releases its paddle and claims a new one still
   * may not outbid itself (M-IP4-2 canon alignment).
   */
  leadingTeamId: string | null;
  teamId: string;
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
  if (input.leadingTeamId !== null && input.leadingTeamId === input.teamId) {
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
  | "PaddleReleased" // M-IP4-2: identity stays immutable; the claim ends
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
  | "TimerExtended"
  // M-IP4-2: auction pause is TOTAL (doc 39) — the open lot's runway freezes
  // with it and re-attaches on resume. Both flow through events so replay
  // reproduces the exact remaining time.
  | "TimerHeld"
  | "TimerResumed"
  // M-IP4-3: the production owner model (invitation → acceptance → grant →
  // claim) and the compensating undo (doc 41 `lot.reopen` — NEVER a back edge;
  // history stays immutable, the reversal is its own event).
  | "OwnerInvited"
  // The link can be taken back. Its absence was a live gap the cockpit had to
  // apologise for in copy: `revoked_at` was READ in six places and written in
  // none, so anyone holding an owner link could accept it for seven days no
  // matter who it was meant for or what had changed since.
  | "OwnerRevoked"
  | "OwnerAccepted"
  | "PaddleGranted"
  | "LotReopened";

export const AUCTION_EVENT_TYPES: readonly AuctionEventType[] = [
  "AuctionCreated",
  "PaddleIssued",
  "PaddleReleased",
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
  "TimerHeld",
  "TimerResumed",
  "OwnerInvited",
  "OwnerRevoked",
  "OwnerAccepted",
  "PaddleGranted",
  "LotReopened",
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
  timerExtensions: number; // anti-snipe extensions on the current opening
}

export interface PaddleProjection {
  teamId: string;
  personId: string;
  paddleNumber: string;
  committed: number; // paise committed via sold lots
  released: boolean; // M-IP4-2: a released paddle can no longer bid
  releasedAtMs: number | null; // when the claim ended — lets recovery heal the row exactly
}

/**
 * The replayed bid ledger (M-IP4-4). The `bids` table is a PROJECTION of
 * BidAccepted/BidInvalidated — and the most money-critical one: the sale price
 * of a lot is read from the leading bid row. Modelling it here is what lets the
 * watchdog verify those rows against the log instead of trusting them
 * (certification drill, defect D-2).
 */
export interface BidProjection {
  lotId: string;
  paddleId: string;
  amount: number; // paise
  status: BidStatus;
}

/** The workflow states of the M-IP4-3 owner model, replayed from events. */
export interface OwnerInviteProjection {
  teamId: string;
  acceptedBy: string | null;
  /** Withdrawn by the organizer. The row survives — history stays intact. */
  revoked: boolean;
}

export interface PaddleGrantProjection {
  teamId: string;
  personId: string;
}

/**
 * The most recent lot resolution — the ceremony's input (presentation reads
 * WHAT just happened from the snapshot, never from side channels). Cleared
 * when the next lot opens.
 */
export type LotOutcomeKind = "sold" | "unsold" | "withdrawn" | "held" | "reopened";

export interface LotOutcome {
  kind: LotOutcomeKind;
  lotId: string;
  amount: number | null; // paise; sold only
  paddleId: string | null; // sold only
  atSeq: number;
}

export interface AuctionProjection {
  status: AuctionStatus;
  lots: Record<string, LotProjection>;
  paddles: Record<string, PaddleProjection>;
  bids: Record<string, BidProjection>;
  ownerInvites: Record<string, OwnerInviteProjection>;
  paddleGrants: Record<string, PaddleGrantProjection>;
  lastOutcome: LotOutcome | null;
  recoveries: number;
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
    bids: {},
    ownerInvites: {},
    paddleGrants: {},
    lastOutcome: null,
    recoveries: 0,
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
        projection.paddles[paddleId] = {
          teamId,
          personId,
          paddleNumber: number,
          committed: 0,
          released: false,
          releasedAtMs: null,
        };
        break;
      }
      case "PaddleReleased": {
        const paddleId = str(event.payload, "paddleId");
        const paddle = paddleId !== null ? projection.paddles[paddleId] : undefined;
        if (paddle === undefined) {
          return fail("unknown_paddle");
        }
        paddle.released = true;
        // The event's atMs is the exact value the aggregate wrote to releasedAt,
        // so recovery can heal the row precisely (M-IP4-4 defect D-3).
        paddle.releasedAtMs = event.atMs;
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
          timerExtensions: 0,
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
        // Recovery leaves state as replayed — it IS the replay. The count
        // rides the snapshot so every surface can announce it (ceremony).
        projection.recoveries += 1;
        break;
      case "LotOpened": {
        const lot = lotOf();
        if (lot === null) {
          return fail("unknown_lot");
        }
        lot.status = "on_block";
        lot.endsAtMs = num(event.payload, "endsAtMs");
        lot.timerExtensions = 0;
        projection.lastOutcome = null; // a fresh lot supersedes the last result
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
        projection.lastOutcome = {
          kind: "held",
          lotId: str(event.payload, "lotId") ?? "",
          amount: null,
          paddleId: null,
          atSeq: event.seq,
        };
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
        projection.lastOutcome = {
          kind: "sold",
          lotId: str(event.payload, "lotId") ?? "",
          amount,
          paddleId,
          atSeq: event.seq,
        };
        break;
      }
      case "LotUnsold": {
        const lot = lotOf();
        if (lot === null) {
          return fail("unknown_lot");
        }
        lot.status = "unsold";
        projection.lastOutcome = {
          kind: "unsold",
          lotId: str(event.payload, "lotId") ?? "",
          amount: null,
          paddleId: null,
          atSeq: event.seq,
        };
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
        projection.lastOutcome = {
          kind: "withdrawn",
          lotId: str(event.payload, "lotId") ?? "",
          amount: null,
          paddleId: null,
          atSeq: event.seq,
        };
        break;
      }
      case "BidAccepted": {
        const lot = lotOf();
        const lotId = str(event.payload, "lotId");
        const bidId = str(event.payload, "bidId");
        const paddleId = str(event.payload, "paddleId");
        const amount = num(event.payload, "amount");
        if (
          lot === null ||
          lotId === null ||
          bidId === null ||
          paddleId === null ||
          amount === null
        ) {
          return fail("malformed_bid");
        }
        if (lot.status !== "on_block" && lot.status !== "closing_soon") {
          return fail("illegal_replayed_transition");
        }
        // The bid ledger: the outgoing leader is demoted, the new bid leads.
        // Mirrors exactly what the aggregate writes to the `bids` rows, so the
        // watchdog can compare the two.
        const outgoing = lot.leadingBidId !== null ? projection.bids[lot.leadingBidId] : undefined;
        if (outgoing !== undefined && outgoing.status === "accepted") {
          outgoing.status = "outbid";
        }
        projection.bids[bidId] = { lotId, paddleId, amount, status: "accepted" };
        lot.bidCount += 1;
        lot.leadingBidId = bidId;
        lot.leadingPaddleId = paddleId;
        lot.leadingAmount = amount;
        break;
      }
      case "BidRejected":
        break; // evidence only — no bid row, no state change
      case "BidInvalidated": {
        // Voided-but-visible (undo / requeue override): the row survives as
        // `invalidated` — history is never deleted (invariant 10).
        const bidId = str(event.payload, "bidId");
        const bid = bidId !== null ? projection.bids[bidId] : undefined;
        if (bid === undefined) {
          return fail("unknown_bid");
        }
        bid.status = "invalidated";
        break;
      }
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
        lot.timerExtensions += 1;
        // TimerExtended IS the anti-snipe `extend` edge (doc 39): a closing
        // lot returns to the block. Found by the M-IP4-2 watchdog halting on
        // a row/event divergence — now a permanent regression test.
        if (lot.status === "closing_soon") {
          lot.status = "on_block";
        }
        break;
      }
      case "TimerHeld": {
        const lot = lotOf();
        if (lot === null) {
          return fail("unknown_lot");
        }
        // The runway freezes: no absolute end exists while the auction pauses.
        lot.endsAtMs = null;
        break;
      }
      case "TimerResumed": {
        const lot = lotOf();
        const endsAtMs = num(event.payload, "endsAtMs");
        if (lot === null || endsAtMs === null) {
          return fail("malformed_timer");
        }
        lot.endsAtMs = endsAtMs; // a fresh axis: the held remainder re-attached
        break;
      }
      // --- M-IP4-3: the owner model. Workflow steps are auction events so the
      // ledger, the audit trail and replay all carry the SAME history.
      case "OwnerInvited": {
        const inviteId = str(event.payload, "inviteId");
        const teamId = str(event.payload, "teamId");
        if (inviteId === null || teamId === null) {
          return fail("malformed_invite");
        }
        projection.ownerInvites[inviteId] = { teamId, acceptedBy: null, revoked: false };
        break;
      }
      case "OwnerRevoked": {
        const inviteId = str(event.payload, "inviteId");
        const invite = inviteId !== null ? projection.ownerInvites[inviteId] : undefined;
        if (invite === undefined) {
          return fail("unknown_invite");
        }
        /*
         * The invite stays in the projection, revoked rather than deleted. An
         * OwnerAccepted for it would already be refused by the aggregate's
         * atomic claim, and removing the row here would make any historical
         * event that references it unreplayable — the exact failure mode doc 41
         * was written about.
         */
        invite.revoked = true;
        break;
      }
      case "OwnerAccepted": {
        const inviteId = str(event.payload, "inviteId");
        const personId = str(event.payload, "personId");
        const invite = inviteId !== null ? projection.ownerInvites[inviteId] : undefined;
        if (invite === undefined || personId === null) {
          return fail("unknown_invite");
        }
        invite.acceptedBy = personId;
        break;
      }
      case "PaddleGranted": {
        const grantId = str(event.payload, "grantId");
        const teamId = str(event.payload, "teamId");
        const personId = str(event.payload, "personId");
        if (grantId === null || teamId === null || personId === null) {
          return fail("malformed_grant");
        }
        projection.paddleGrants[grantId] = { teamId, personId };
        break;
      }
      // --- M-IP4-3: compensating undo (doc 41 `lot.reopen`, doc 39: NOT a back
      // edge). The reversal is its own event: the sale amount returns to the
      // team's purse, the lot returns to the block with a fresh window, prior
      // bids stay voided-but-visible (their BidInvalidated precedes this).
      case "LotReopened": {
        const lot = lotOf();
        const endsAtMs = num(event.payload, "endsAtMs");
        if (lot === null || endsAtMs === null) {
          return fail("malformed_reopen");
        }
        if (lot.status !== "sold" && lot.status !== "unsold") {
          return fail("illegal_replayed_transition");
        }
        if (lot.status === "sold") {
          if (lot.soldPaddleId === null || lot.soldAmount === null) {
            return fail("malformed_reopen");
          }
          const paddle = projection.paddles[lot.soldPaddleId];
          if (paddle === undefined) {
            return fail("unknown_paddle");
          }
          paddle.committed -= lot.soldAmount; // the purse restoration
        }
        lot.status = "on_block";
        lot.soldAmount = null;
        lot.soldPaddleId = null;
        lot.leadingBidId = null;
        lot.leadingPaddleId = null;
        lot.leadingAmount = null;
        lot.endsAtMs = endsAtMs;
        lot.timerExtensions = 0;
        projection.lastOutcome = {
          kind: "reopened",
          lotId: str(event.payload, "lotId") ?? "",
          amount: null,
          paddleId: null,
          atSeq: event.seq,
        };
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

// --- Compensating undo (M-IP4-3; doc 41 `lot.reopen`) -----------------------------
// Undo NEVER deletes history: it targets the most recent lot resolution and is
// legal only until the next lot opens (doc 41's window). The decision is a pure
// scan of the immutable log — same events, same verdict.

export interface UndoTarget {
  kind: "sold" | "unsold";
  lotId: string;
  atSeq: number;
  bidId: string | null;
  paddleId: string | null;
  amount: number | null; // paise
}

export type UndoDecision =
  | { ok: true; target: UndoTarget }
  | { ok: false; reason: "nothing_to_undo" | "undo_window_closed" };

/**
 * Events that move a lot OUT of a resolved state. A resolution that one of
 * these has already superseded can no longer be undone: the compensating
 * LotReopened would land on a lot that replay sees as queued/withdrawn/frozen,
 * writing an event the reducer must reject — an unreplayable log, i.e. an
 * auction that can never recover. Certification drill M-IP4-4 (defect D-1).
 */
const LOT_SUPERSEDING_EVENTS: ReadonlySet<string> = new Set([
  "LotQueued",
  "LotRequeued",
  "LotWithdrawn",
  "LotHeld",
]);

/**
 * Walk backwards: the first resolution (LotSold/LotUnsold) is the target; any
 * LotOpened or LotReopened encountered first means a lot has been on the block
 * SINCE the last resolution — the undo window is closed (doc 41: "allowed
 * until the next lot opens").
 *
 * The window ALSO closes when the target lot itself has already been acted on
 * (requeued, withdrawn, frozen) since it resolved — undoing a resolution the
 * conductor has already moved past is both meaningless and unreplayable. The
 * check is per-LOT, so acting on an unrelated lot never blocks a legitimate
 * undo.
 */
export function decideUndo(events: readonly AuctionEventEnvelope[]): UndoDecision {
  const superseded = new Set<string>();
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i] as AuctionEventEnvelope;
    if (event.type === "LotOpened" || event.type === "LotReopened") {
      return { ok: false, reason: "undo_window_closed" };
    }
    if (LOT_SUPERSEDING_EVENTS.has(event.type)) {
      const lotId = str(event.payload, "lotId");
      if (lotId !== null) {
        superseded.add(lotId);
      }
    }
    if (event.type === "LotSold") {
      const lotId = str(event.payload, "lotId");
      if (lotId === null) {
        return { ok: false, reason: "nothing_to_undo" };
      }
      if (superseded.has(lotId)) {
        return { ok: false, reason: "undo_window_closed" };
      }
      return {
        ok: true,
        target: {
          kind: "sold",
          lotId,
          atSeq: event.seq,
          bidId: str(event.payload, "bidId"),
          paddleId: str(event.payload, "paddleId"),
          amount: num(event.payload, "amount"),
        },
      };
    }
    if (event.type === "LotUnsold") {
      const lotId = str(event.payload, "lotId");
      if (lotId === null) {
        return { ok: false, reason: "nothing_to_undo" };
      }
      if (superseded.has(lotId)) {
        return { ok: false, reason: "undo_window_closed" };
      }
      return {
        ok: true,
        target: {
          kind: "unsold",
          lotId,
          atSeq: event.seq,
          bidId: null,
          paddleId: null,
          amount: null,
        },
      };
    }
  }
  return { ok: false, reason: "nothing_to_undo" };
}
