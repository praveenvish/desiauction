/**
 * The FLOODLIGHT ceremony (M-IP4-3). Presentation ONLY: a pure derivation of
 * "what should the room feel right now" from two consecutive AuctionSnapshots.
 * It owns no business logic — every input is already decided, broadcast state.
 * Deterministic: the same (previous, next) pair always yields the same phase,
 * so every connected surface (cockpit, live, spectator) agrees on the moment.
 *
 * `key` changes exactly when a NEW ceremony moment begins — surfaces key their
 * transitions on it (and suppress motion under prefers-reduced-motion, IP-1).
 */

import type { AuctionSnapshot } from "./auction-snapshot";

export type CeremonyPhase =
  | "idle" // nothing on the block, nothing to announce
  | "opening" // a lot has just arrived on the block
  | "bid" // a new leading bid
  | "extension" // anti-snipe extension
  | "hold" // the lot froze for human resolution
  | "sold"
  | "unsold"
  | "withdrawn"
  | "reopened" // compensating undo returned the lot to the block
  | "paused"
  | "recovered" // the engine healed and re-verified state
  | "completed"; // the auction ended (completed / reconciled / abandoned)

export interface CeremonyState {
  readonly phase: CeremonyPhase;
  /** Stable identity of the moment — transitions trigger when this changes. */
  readonly key: string;
}

/** Ordered decision — earlier rules dominate (recovery > pause > lot moments). */
export function deriveCeremony(
  prev: AuctionSnapshot | null,
  next: AuctionSnapshot,
  /**
   * The moment the surface is showing right now, when it has one.
   *
   * Optional, and only consulted for frames that carry no new moment — see the
   * steady-state branch at the bottom. Two consecutive snapshots cannot always
   * tell "nothing happened" from "the moment before this one was an
   * extension", and the first answer was being given for both.
   */
  current?: CeremonyState,
): CeremonyState {
  if (prev !== null && next.recoveries > prev.recoveries) {
    return { phase: "recovered", key: `recovered-${String(next.recoveries)}` };
  }
  if (next.auctionStatus === "paused") {
    return { phase: "paused", key: "paused" };
  }
  if (
    next.auctionStatus === "completed" ||
    next.auctionStatus === "reconciled" ||
    next.auctionStatus === "abandoned"
  ) {
    return { phase: "completed", key: `completed-${next.auctionStatus}` };
  }
  const lot = next.currentLot;
  if (lot === null) {
    const outcome = next.lastOutcome;
    if (outcome !== null && outcome.kind !== "reopened") {
      const phase: CeremonyPhase = outcome.kind === "held" ? "hold" : outcome.kind;
      return { phase, key: `${outcome.kind}-${String(outcome.atSeq)}` };
    }
    return { phase: "idle", key: "idle" };
  }
  // A lot is on the block. A reopened outcome for THIS lot is the undo moment.
  if (next.lastOutcome !== null && next.lastOutcome.kind === "reopened") {
    if (next.lastOutcome.lotId === lot.lotId && lot.currentBid === null) {
      return { phase: "reopened", key: `reopened-${String(next.lastOutcome.atSeq)}` };
    }
  }
  const prevLot = prev?.currentLot ?? null;
  const sameLot = prevLot !== null && prevLot.lotId === lot.lotId;
  if (!sameLot) {
    return { phase: "opening", key: `opening-${lot.lotId}` };
  }
  if (lot.extensions > prevLot.extensions) {
    return { phase: "extension", key: `extension-${lot.lotId}-${String(lot.extensions)}` };
  }
  if (lot.currentBid !== null && lot.currentBid.bidId !== (prevLot.currentBid?.bidId ?? null)) {
    return { phase: "bid", key: `bid-${lot.currentBid.bidId}` };
  }
  /*
   * A FRAME WITH NO NEW MOMENT MUST NOT REPLACE THE ONE ON SCREEN.
   *
   * Every anti-snipe extension used to be announced for about a quarter of a
   * second. The bid that extends a lot sets its clock to exactly the extension
   * window and puts it back `on_block`; on the engine's very next 250 ms tick
   * that remainder is, by definition, inside the window, so the watchdog flips
   * the lot to `closing_soon` and broadcasts again. That second frame has the
   * same bid and the same extension count — nothing a person would call a new
   * moment — but it reached this branch, which answered "bid" under a NEW key.
   * Every surface keyed on it re-fired: the stage replaced "Timer extended"
   * with a second bid announcement, and the live region read the bid out twice.
   *
   * Found by `conduct-ceremony.spec.ts`, which intermittently saw "bid" where it
   * expected "extension": it passed whenever its polling happened to land
   * inside those 250 ms, so the flaky test was the only witness telling the
   * truth. The extension now stays up until something actually happens — a new
   * bid, another extension, the lot resolving or changing.
   */
  if (
    current !== undefined &&
    current.phase === "extension" &&
    current.key === `extension-${lot.lotId}-${String(lot.extensions)}`
  ) {
    return current;
  }
  // Steady state: keep presenting the lot (opening pose without re-triggering).
  return {
    phase: lot.currentBid === null ? "opening" : "bid",
    key: lot.currentBid === null ? `opening-${lot.lotId}` : `bid-${lot.currentBid.bidId}`,
  };
}
