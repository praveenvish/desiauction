/**
 * AuctionSnapshot + the command model (M-IP4-2). The snapshot is THE wire
 * contract of the live engine: an immutable, presentation-ready projection
 * every connected client converges to. It is a PURE function of the replayed
 * projection plus static reference data (names, prices) — no clock is read
 * during construction or serialization, so identical events yield identical
 * snapshot BYTES (canonical JSON, sorted keys). Remaining time is carried as
 * the absolute `endsAtMs` from the event log; clients render countdowns from
 * it using the server clock carried on the transport envelope — never their
 * own idea of time.
 */

import {
  nextMinimumBid,
  type AuctionProjection,
  type AuctionStatus,
  type IncrementSlab,
  type LotOutcomeKind,
  type LotStatus,
} from "./auction";
import { paise, type Paise } from "./money";

// --- Reference data (static per auction; ids → human labels) --------------------

export interface SnapshotLotRef {
  lotNumber: string;
  seq: number;
  playerName: string | null;
  role: string;
  basePrice: number;
}

export interface SnapshotPaddleRef {
  paddleNumber: string;
  teamId: string;
  teamName: string;
}

export interface SnapshotRefs {
  auctionId: string;
  auctionName: string;
  pursePerTeam: number;
  slabs: readonly IncrementSlab[];
  lots: Readonly<Record<string, SnapshotLotRef>>;
  paddles: Readonly<Record<string, SnapshotPaddleRef>>;
}

// --- The snapshot ---------------------------------------------------------------

export interface SnapshotBidEntry {
  readonly bidId: string;
  readonly paddleNumber: string;
  readonly teamName: string;
  readonly amount: number;
}

export interface SnapshotQueueEntry {
  readonly lotId: string;
  readonly lotNumber: string;
  readonly playerName: string | null;
  readonly role: string;
  readonly basePrice: number;
  readonly status: LotStatus;
}

export interface SnapshotPaddleEntry {
  readonly paddleId: string;
  readonly paddleNumber: string;
  readonly teamId: string;
  readonly teamName: string;
  /**
   * Money is `null` when the VIEWER may not see it.
   *
   * The engine's canonical snapshot always carries real numbers — that is what
   * gets hashed and byte-compared for the determinism proof. These become null
   * only on the wire, per socket, in `redactPurses` below. The server used to
   * decide that bidders may not see rivals' purses and then broadcast every
   * team's money to every socket anyway, leaving the client to hide it: the
   * seal was a CSS-level promise that any bidder could break in the Network tab
   * (audit 2026-08-18, P1-6).
   */
  readonly committed: number | null;
  readonly purseRemaining: number | null;
  readonly released: boolean;
}

/**
 * The viewer's money scope, bound into the WebSocket ticket so a client cannot
 * widen its own: `null` = see every purse (the conductor's board), otherwise
 * the set of team ids whose money this viewer owns.
 */
export type PurseScope = readonly string[] | null;

/**
 * Redact a snapshot for one viewer. Pure, so the transport can apply it per
 * socket and the canonical snapshot stays untouched for hashing and replay.
 */
export function redactPurses(snapshot: AuctionSnapshot, scope: PurseScope): AuctionSnapshot {
  if (scope === null) {
    return snapshot;
  }
  const visible = new Set(scope);
  return {
    ...snapshot,
    paddles: snapshot.paddles.map((paddle) =>
      visible.has(paddle.teamId) ? paddle : { ...paddle, committed: null, purseRemaining: null },
    ),
  };
}

export interface AuctionSnapshot {
  /** The snapshot version = last event seq — the out-of-order rejection key. */
  readonly version: number;
  readonly auctionId: string;
  readonly auctionName: string;
  readonly auctionStatus: AuctionStatus;
  readonly currentLot: {
    readonly lotId: string;
    readonly lotNumber: string;
    readonly playerName: string | null;
    readonly role: string;
    readonly basePrice: number;
    readonly status: LotStatus;
    readonly endsAtMs: number | null;
    readonly extensions: number;
    readonly nextMinimumBid: number;
    readonly currentBid: SnapshotBidEntry | null;
    readonly bidHistory: readonly SnapshotBidEntry[]; // current lot only, seq order
  } | null;
  readonly queue: readonly SnapshotQueueEntry[]; // queued lots, deterministic seq order
  readonly paddles: readonly SnapshotPaddleEntry[]; // paddle-number order
  readonly lotsResolved: number;
  readonly lotsTotal: number;
  /**
   * M-IP4-3: the most recent lot resolution (ceremony input — SOLD/UNSOLD/
   * HELD/REOPENED splashes render from the snapshot, never a side channel).
   * Null while a fresh lot is on the block. Spectator-safe: the auctioned
   * player's name (the lot's subject), paddle numbers and team names — never a
   * bidder's identity or contact details (the paddle holder's personId is not
   * in the snapshot).
   */
  readonly lastOutcome: {
    readonly kind: LotOutcomeKind;
    readonly lotId: string;
    readonly lotNumber: string;
    readonly playerName: string | null;
    readonly amount: number | null;
    readonly teamName: string | null;
    readonly paddleNumber: string | null;
    readonly atSeq: number;
  } | null;
  /** Count of AuctionRecovered events — the ceremony's "Recovered" trigger. */
  readonly recoveries: number;
}

/**
 * Per-lot bid history must come from the projection's event walk; the reducer
 * tracks only the leader, so the builder receives the current lot's accepted
 * bids (seq order) from the caller — still a pure function of the event log.
 */
export interface CurrentLotBids {
  lotId: string;
  bids: readonly { bidId: string; paddleId: string; amount: number }[];
}

export function buildAuctionSnapshot(
  projection: AuctionProjection,
  refs: SnapshotRefs,
  currentLotBids: CurrentLotBids | null,
): AuctionSnapshot {
  const lotEntries = Object.entries(projection.lots)
    .map(([lotId, lot]) => ({ lotId, lot, ref: refs.lots[lotId] }))
    .filter((entry) => entry.ref !== undefined)
    .sort((a, b) => (a.ref as SnapshotLotRef).seq - (b.ref as SnapshotLotRef).seq);

  const onBlock = lotEntries.find(
    (entry) => entry.lot.status === "on_block" || entry.lot.status === "closing_soon",
  );

  const paddleEntries = Object.entries(projection.paddles)
    .map(([paddleId, paddle]) => {
      const ref = refs.paddles[paddleId];
      return {
        paddleId,
        paddleNumber: paddle.paddleNumber,
        teamId: paddle.teamId,
        teamName: ref?.teamName ?? "Unknown",
        committed: paddle.committed,
        purseRemaining: Math.max(0, refs.pursePerTeam - committedByTeam(projection, paddle.teamId)),
        released: paddle.released,
      };
    })
    .sort((a, b) =>
      a.paddleNumber < b.paddleNumber ? -1 : a.paddleNumber > b.paddleNumber ? 1 : 0,
    );

  const bidEntry = (bid: { bidId: string; paddleId: string; amount: number }): SnapshotBidEntry => {
    const paddle = projection.paddles[bid.paddleId];
    const ref = refs.paddles[bid.paddleId];
    return {
      bidId: bid.bidId,
      paddleNumber: paddle?.paddleNumber ?? "?",
      teamName: ref?.teamName ?? "Unknown",
      amount: bid.amount,
    };
  };

  let currentLot: AuctionSnapshot["currentLot"] = null;
  if (onBlock !== undefined) {
    const ref = onBlock.ref as SnapshotLotRef;
    const leading =
      onBlock.lot.leadingBidId !== null &&
      onBlock.lot.leadingPaddleId !== null &&
      onBlock.lot.leadingAmount !== null
        ? bidEntry({
            bidId: onBlock.lot.leadingBidId,
            paddleId: onBlock.lot.leadingPaddleId,
            amount: onBlock.lot.leadingAmount,
          })
        : null;
    const history =
      currentLotBids !== null && currentLotBids.lotId === onBlock.lotId
        ? currentLotBids.bids.map(bidEntry)
        : [];
    currentLot = {
      lotId: onBlock.lotId,
      lotNumber: ref.lotNumber,
      playerName: ref.playerName,
      role: ref.role,
      basePrice: ref.basePrice,
      status: onBlock.lot.status,
      endsAtMs: onBlock.lot.endsAtMs,
      extensions: onBlock.lot.timerExtensions,
      nextMinimumBid: nextMinimumBid(
        paise(ref.basePrice),
        refs.slabs,
        onBlock.lot.leadingAmount === null ? null : paise(onBlock.lot.leadingAmount),
      ),
      currentBid: leading,
      bidHistory: history,
    };
  }

  const resolved = lotEntries.filter(
    (entry) =>
      entry.lot.status === "sold" ||
      entry.lot.status === "unsold" ||
      entry.lot.status === "withdrawn",
  ).length;

  let lastOutcome: AuctionSnapshot["lastOutcome"] = null;
  if (projection.lastOutcome !== null) {
    const outcome = projection.lastOutcome;
    const lotRef = refs.lots[outcome.lotId];
    const paddle = outcome.paddleId !== null ? projection.paddles[outcome.paddleId] : undefined;
    const paddleRef = outcome.paddleId !== null ? refs.paddles[outcome.paddleId] : undefined;
    lastOutcome = {
      kind: outcome.kind,
      lotId: outcome.lotId,
      lotNumber: lotRef?.lotNumber ?? "?",
      playerName: lotRef?.playerName ?? null,
      amount: outcome.amount,
      teamName: paddleRef?.teamName ?? null,
      paddleNumber: paddle?.paddleNumber ?? null,
      atSeq: outcome.atSeq,
    };
  }

  const snapshot: AuctionSnapshot = {
    version: projection.lastSeq,
    auctionId: refs.auctionId,
    auctionName: refs.auctionName,
    auctionStatus: projection.status,
    currentLot,
    queue: lotEntries
      .filter((entry) => entry.lot.status === "queued")
      .map((entry) => ({
        lotId: entry.lotId,
        lotNumber: (entry.ref as SnapshotLotRef).lotNumber,
        playerName: (entry.ref as SnapshotLotRef).playerName,
        role: (entry.ref as SnapshotLotRef).role,
        basePrice: (entry.ref as SnapshotLotRef).basePrice,
        status: entry.lot.status,
      })),
    paddles: paddleEntries,
    lotsResolved: resolved,
    lotsTotal: lotEntries.length,
    lastOutcome,
    recoveries: projection.recoveries,
  };
  return deepFreeze(snapshot);
}

function committedByTeam(projection: AuctionProjection, teamId: string): number {
  let total = 0;
  for (const paddle of Object.values(projection.paddles)) {
    if (paddle.teamId === teamId) {
      total += paddle.committed;
    }
  }
  return total;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value;
}

// --- Canonical serialization (identical snapshot → identical bytes) --------------

/** Deterministic JSON: object keys sorted at every level, no whitespace. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  const keys = Object.keys(value).sort();
  const parts = keys.map(
    (key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`,
  );
  return `{${parts.join(",")}}`;
}

export function serializeSnapshot(snapshot: AuctionSnapshot): string {
  return canonicalJson(snapshot);
}

// --- The command model (M-IP4-2) --------------------------------------------------
// Every mutation of a live auction is a COMMAND submitted to the engine, which
// processes commands strictly serially per auction (the single writer). Every
// command receives Accepted or Rejected with a deterministic reason — no silent
// failures.

export type AuctionCommandType =
  | "ClaimPaddle"
  | "ReleasePaddle"
  | "QueueLots"
  | "OpenLot"
  | "PlaceBid"
  | "CloseLot"
  | "PauseAuction"
  | "ResumeAuction"
  | "CompleteAuction"
  | "AbortAuction"
  | "RecoverAuction"
  // M-IP4-3: conduct moves ENTIRELY onto the command path — the auction open
  // edge, manual lot conduct, the owner workflow, and compensating undo. No
  // setup surface writes through the aggregate directly anymore.
  | "OpenAuction"
  | "IssuePaddle"
  | "WithdrawLot"
  | "HoldLot"
  | "RequeueLot"
  | "UndoLastAction"
  | "InviteOwner"
  | "RevokeOwnerInvite"
  | "AcceptOwnerInvite"
  | "GrantPaddle";

export const AUCTION_COMMAND_TYPES: readonly AuctionCommandType[] = [
  "ClaimPaddle",
  "ReleasePaddle",
  "QueueLots",
  "OpenLot",
  "PlaceBid",
  "CloseLot",
  "PauseAuction",
  "ResumeAuction",
  "CompleteAuction",
  "AbortAuction",
  "RecoverAuction",
  "OpenAuction",
  "IssuePaddle",
  "WithdrawLot",
  "HoldLot",
  "RequeueLot",
  "UndoLastAction",
  "InviteOwner",
  "RevokeOwnerInvite",
  "AcceptOwnerInvite",
  "GrantPaddle",
];

export function isAuctionCommandType(value: string): value is AuctionCommandType {
  return (AUCTION_COMMAND_TYPES as readonly string[]).includes(value);
}

/**
 * The wire envelope. `commandId` is the idempotency key: resubmitting the same
 * command id returns the ORIGINAL ack instead of re-executing. `conduct` marks
 * a conductor-authorized actor (capability resolved by the web gate — the
 * engine trusts its authenticated caller, never the browser).
 */
/**
 * A command id the TRANSPORT is allowed to choose.
 *
 * `commandId` is the idempotency key, it originates in the browser, and it used
 * to be any string at all. The engine keys its ack cache on it and enqueues its
 * OWN timer commands into the same map under ids derived from values published
 * in every snapshot — `timer-close-{lotId}-{endsAtMs}`. So a participant could
 * pre-seed one, have the rejection cached, and the real close would then return
 * that cached rejection and never fire. Verified live (audit 2026-08-18, P0-2):
 * the gavel stopped and a bid 57 seconds past the deadline won the player.
 *
 * Pinning the shape makes the internal namespace unreachable by construction
 * rather than by obscurity. Both id shapes this codebase mints are accepted:
 * `crypto.randomUUID()` in the browser and `newId()` (ULID) on the server.
 */
const TRANSPORT_COMMAND_ID_RE =
  /^(?:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{26})$/;

export function isTransportCommandId(value: string): boolean {
  return TRANSPORT_COMMAND_ID_RE.test(value);
}

export interface AuctionCommandEnvelope {
  commandId: string;
  auctionId: string;
  type: AuctionCommandType;
  actor: string;
  conduct: boolean;
  /**
   * M-IP4-3: `auction.override` resolved by the web gate — required by
   * UndoLastAction (doc 41: undo is the highest-friction action; conduct
   * alone never suffices). Absent means false.
   */
  override?: boolean;
  payload: Readonly<Record<string, unknown>>;
}

export type CommandRejectReason =
  | "unknown_command"
  | "unknown_auction"
  | "engine_halted"
  | "not_authorized"
  | "illegal_transition"
  | "guard_failed"
  | "not_found"
  | "auction_not_live"
  | "another_lot_open"
  | "paddle_held"
  | "no_active_paddle"
  | "unknown_team"
  | "invalid_payload"
  | "invalid_command_id"
  | "rate_limited"
  | "replay_failed";

export interface CommandAck {
  readonly commandId: string;
  readonly accepted: boolean;
  /** Deterministic reason — a CommandRejectReason or a doc-41 bid code. */
  readonly reason?: string;
  /** Snapshot version after the command (for client ordering). */
  readonly version: number;
  /** PlaceBid extras (the acknowledgement the bidder renders). */
  readonly bidId?: string;
  readonly amount?: number;
  readonly extended?: boolean;
}

/** Minimum legal bid helper re-exported for engines/surfaces. */
export function snapshotNextMinimumBid(
  basePrice: number,
  slabs: readonly IncrementSlab[],
  leadingAmount: number | null,
): Paise {
  return nextMinimumBid(
    paise(basePrice),
    slabs,
    leadingAmount === null ? null : paise(leadingAmount),
  );
}
