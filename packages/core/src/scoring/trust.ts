import type { TrustLevel } from "./types";

/** Stable explanation order, independent of discovery or input order. */
export const TRUST_REASON_ORDER = [
  "disputed",
  "pace_impossible",
  "same_person_both_sides",
  "overlapping_matches",
  "backfilled",
  "scorer_is_top_scorer",
  "opponent_all_guests",
] as const;
export type TrustReason = (typeof TRUST_REASON_ORDER)[number];
const HARD_SIGNALS: ReadonlySet<TrustReason> = new Set([
  "disputed",
  "pace_impossible",
  "same_person_both_sides",
  "overlapping_matches",
]);
export const LIVE_RECEIPT_WINDOW_MS = 120_000;
const CONFIRMATION_WAIT_MS = 48 * 60 * 60 * 1000;
export interface PaceRecord {
  legal: boolean;
  clientRecordedAt: string;
  receivedAt: string;
}
export interface TrustFacts {
  authority: { a: boolean; b: boolean; c: boolean; d: boolean };
  kind: "club" | "personal";
  /** Effective evidence for this revision, accounting for subsequent disputes. */
  confirmations: {
    organiserVerified: boolean;
    opposingManagerConfirmed: boolean;
    disputed: boolean;
  };
  liveScored: boolean;
  viewerPeak: number;
  finishedAt: string | null;
  now: string;
  signals: readonly TrustReason[];
}
function orderedReasons(signals: readonly TrustReason[]): TrustReason[] {
  return TRUST_REASON_ORDER.filter((reason) => signals.includes(reason));
}
/** Receipt timestamps identify batches; offline timing is soft evidence only. */
export function detectPace(events: readonly PaceRecord[]): {
  signals: TrustReason[];
  liveScored: boolean;
} {
  return receiptPace(events, true);
}
/** Rally receipt evidence has no cricket physical-pace or attribution threshold. */
export function detectRallyPace(events: readonly PaceRecord[]): {
  signals: TrustReason[];
  liveScored: boolean;
} {
  return receiptPace(events, false);
}
/** Effective raid receipt evidence has no guessed physical or individual-score threshold. */
export function detectRaidPace(events: readonly PaceRecord[]): {
  signals: TrustReason[];
  liveScored: boolean;
} {
  return receiptPace(events, false);
}
function receiptPace(
  events: readonly PaceRecord[],
  cricketPhysicalLimit: boolean,
): {
  signals: TrustReason[];
  liveScored: boolean;
} {
  const batches = new Map<string, PaceRecord[]>();
  for (const event of events) {
    if (!event.legal) continue;
    const batch = batches.get(event.receivedAt) ?? [];
    batch.push(event);
    batches.set(event.receivedAt, batch);
  }
  const signals: TrustReason[] = [];
  let liveScored = batches.size > 0;
  for (const [receivedAt, batch] of batches) {
    const receipt = Date.parse(receivedAt);
    const times = batch.map((event) => Date.parse(event.clientRecordedAt));
    const live =
      Number.isFinite(receipt) &&
      times.every(
        (time, index) =>
          Number.isFinite(time) &&
          time >= receipt - LIVE_RECEIPT_WINDOW_MS &&
          time <= receipt &&
          (index === 0 || time >= (times[index - 1] ?? Infinity)),
      );
    if (!live) {
      signals.push("backfilled");
      liveScored = false;
      continue;
    }
    const first = times[0];
    const last = times.at(-1);
    if (
      cricketPhysicalLimit &&
      times.length >= 30 &&
      first !== undefined &&
      last !== undefined &&
      (last - first) / (times.length - 1) < 4000
    )
      signals.push("pace_impossible");
  }
  return { signals: orderedReasons(signals), liveScored };
}
export function computeTrust(facts: TrustFacts): { level: TrustLevel; reasons: TrustReason[] } {
  const reasons = orderedReasons([
    ...facts.signals,
    ...(facts.confirmations.disputed ? (["disputed"] as const) : []),
  ]);
  const confirmations = facts.confirmations;
  if (reasons.some((reason) => HARD_SIGNALS.has(reason)) && !confirmations.organiserVerified)
    return { level: "flagged", reasons };
  if (confirmations.organiserVerified)
    return { level: facts.kind === "club" ? "verified" : "confirmed", reasons };
  const explicitlyConfirmed = confirmations.opposingManagerConfirmed && !confirmations.disputed;
  if (!facts.liveScored || reasons.includes("backfilled"))
    return { level: explicitlyConfirmed ? "confirmed" : "self_scored", reasons };
  if (facts.kind === "club" && (facts.authority.a || facts.authority.b || facts.authority.c))
    return { level: "verified", reasons };
  if (explicitlyConfirmed) return { level: "confirmed", reasons };
  const finished = facts.finishedAt === null ? NaN : Date.parse(facts.finishedAt);
  const now = Date.parse(facts.now);
  if (
    facts.viewerPeak >= 15 &&
    Number.isFinite(finished) &&
    Number.isFinite(now) &&
    now - finished >= CONFIRMATION_WAIT_MS &&
    !confirmations.disputed
  )
    return { level: "confirmed", reasons };
  return { level: "self_scored", reasons };
}
