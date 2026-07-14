/**
 * The AuctionLedger (M-IP4-3). The canonical operational record: a HUMAN-
 * READABLE projection of the event store — never the event store itself, never
 * a second source of truth. It is a pure function of (events, reference data,
 * actor names): regenerating it can never diverge from history, appending an
 * event appends exactly one row, and nothing can mutate a row that only exists
 * as a fold. Immutable and append-only BY CONSTRUCTION.
 *
 * Every row carries the directive's ten columns: sequence, timestamp, actor,
 * paddle, team, lot, bid, result, reason, correlation.
 */

import type { AuctionEventEnvelope } from "./auction";
import type { SnapshotRefs } from "./auction-snapshot";

export interface AuctionLedgerRow {
  readonly seq: number;
  readonly atMs: number;
  readonly actorId: string;
  readonly actorName: string;
  readonly paddleNumber: string | null;
  readonly teamName: string | null;
  readonly lotNumber: string | null;
  readonly playerName: string | null;
  /** Money in integer paise (bid amount, sale amount, or base price). */
  readonly amount: number | null;
  readonly result: string;
  readonly reason: string | null;
  readonly correlationId: string;
}

function str(payload: Readonly<Record<string, unknown>>, key: string): string | null {
  const value = payload[key];
  return typeof value === "string" && value !== "" ? value : null;
}

function num(payload: Readonly<Record<string, unknown>>, key: string): number | null {
  const value = payload[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

interface RowParts {
  paddleId?: string | null;
  lotId?: string | null;
  teamId?: string | null;
  amount?: number | null;
  result: string;
  reason?: string | null;
}

/**
 * Fold the immutable log into ledger rows. Unknown event types never fail the
 * ledger (it is a rendering, not a validator — replay integrity is the
 * reducer's job); they render as their raw type so nothing is ever hidden.
 */
export function buildAuctionLedger(
  events: readonly AuctionEventEnvelope[],
  refs: SnapshotRefs,
  actorNames: Readonly<Record<string, string>>,
): readonly AuctionLedgerRow[] {
  // Paddle numbers arrive through PaddleIssued events, so the ledger resolves
  // paddles even for rows earlier than the refs' knowledge.
  const paddleTeam = new Map<string, string>();
  const paddleNumber = new Map<string, string>();
  const teamNames = new Map<string, string>();
  for (const [paddleId, ref] of Object.entries(refs.paddles)) {
    paddleTeam.set(paddleId, ref.teamId);
    paddleNumber.set(paddleId, ref.paddleNumber);
    teamNames.set(ref.teamId, ref.teamName);
  }

  const rows: AuctionLedgerRow[] = [];
  for (const event of events) {
    const payload = event.payload;
    const parts = describe(event, payload);
    const lotId = parts.lotId ?? null;
    const lotRef = lotId !== null ? refs.lots[lotId] : undefined;
    const paddleId = parts.paddleId ?? null;
    const teamId = parts.teamId ?? (paddleId !== null ? (paddleTeam.get(paddleId) ?? null) : null);
    rows.push({
      seq: event.seq,
      atMs: event.atMs,
      actorId: event.actor,
      actorName: actorNames[event.actor] ?? "Unknown",
      paddleNumber: paddleId !== null ? (paddleNumber.get(paddleId) ?? null) : null,
      teamName: teamId !== null ? (teamNames.get(teamId) ?? null) : null,
      lotNumber: lotRef?.lotNumber ?? null,
      playerName: lotRef?.playerName ?? null,
      amount: parts.amount ?? null,
      result: parts.result,
      reason: parts.reason ?? null,
      correlationId: event.correlationId,
    });
  }
  return rows;
}

function describe(
  event: AuctionEventEnvelope,
  payload: Readonly<Record<string, unknown>>,
): RowParts {
  switch (event.type) {
    case "AuctionCreated":
      return { result: `Auction created — ${String(num(payload, "lotCount") ?? 0)} lots prepared` };
    case "PaddleIssued":
      return {
        paddleId: str(payload, "paddleId"),
        teamId: str(payload, "teamId"),
        result: `Paddle ${str(payload, "paddleNumber") ?? "?"} issued`,
      };
    case "PaddleReleased":
      return {
        paddleId: str(payload, "paddleId"),
        teamId: str(payload, "teamId"),
        result: "Paddle released",
      };
    case "OwnerInvited":
      return { teamId: str(payload, "teamId"), result: "Owner invited" };
    case "OwnerAccepted":
      return { teamId: str(payload, "teamId"), result: "Owner invitation accepted" };
    case "PaddleGranted":
      return { teamId: str(payload, "teamId"), result: "Paddle grant issued" };
    case "LotPrepared":
      return {
        lotId: str(payload, "lotId"),
        amount: num(payload, "basePrice"),
        result: "Lot prepared",
      };
    case "LotQueued":
      return { lotId: str(payload, "lotId"), result: "Lot queued" };
    case "AuctionOpened":
      return { result: "Auction opened" };
    case "AuctionPaused":
      return { result: "Auction paused" };
    case "AuctionResumed":
      return { result: "Auction resumed" };
    case "AuctionClosed":
      return { result: "Auction completed" };
    case "AuctionAborted":
      return { result: "Auction aborted" };
    case "AuctionRecovered":
      return {
        result: `Engine recovered — ${String(num(payload, "divergences") ?? 0)} divergence(s) across ${String(num(payload, "eventCount") ?? 0)} events`,
      };
    case "LotOpened":
      return { lotId: str(payload, "lotId"), result: "Lot on the block" };
    case "LotClosingSoon":
      return { lotId: str(payload, "lotId"), result: "Closing soon" };
    case "LotHeld":
      return { lotId: str(payload, "lotId"), result: "Lot frozen" };
    case "LotSold":
      return {
        lotId: str(payload, "lotId"),
        paddleId: str(payload, "paddleId"),
        amount: num(payload, "amount"),
        result: "SOLD",
      };
    case "LotUnsold":
      return { lotId: str(payload, "lotId"), result: "UNSOLD" };
    case "LotRequeued":
      return { lotId: str(payload, "lotId"), result: "Lot requeued" };
    case "LotWithdrawn":
      return { lotId: str(payload, "lotId"), result: "Lot withdrawn" };
    case "BidAccepted":
      return {
        lotId: str(payload, "lotId"),
        paddleId: str(payload, "paddleId"),
        amount: num(payload, "amount"),
        result: "Bid accepted",
      };
    case "BidRejected":
      return {
        lotId: str(payload, "lotId"),
        paddleId: str(payload, "paddleId"),
        amount: num(payload, "amount"),
        result: "Bid rejected",
        reason: str(payload, "code"),
      };
    case "BidInvalidated":
      return {
        lotId: str(payload, "lotId"),
        result: "Bid voided",
        reason: str(payload, "reason"),
      };
    case "TimerExtended":
      return { lotId: str(payload, "lotId"), result: "Anti-snipe — timer extended" };
    case "TimerHeld":
      return { lotId: str(payload, "lotId"), result: "Timer held" };
    case "TimerResumed":
      return { lotId: str(payload, "lotId"), result: "Timer resumed" };
    case "LotReopened":
      return {
        lotId: str(payload, "lotId"),
        result: `UNDO — lot reopened (compensates #${String(num(payload, "compensatesSeq") ?? 0)})`,
      };
    default:
      return { result: event.type };
  }
}
