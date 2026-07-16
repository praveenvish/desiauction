/**
 * The Follower's pure core (IP-6_ARCHITECTURE §9, ADR-3).
 *
 * The follower is the platform's FIRST after-commit projection mechanism: a
 * per-org cursor over the frozen settlement streams, advanced at-least-once,
 * with every consumption idempotent — rewinding any cursor to zero is always
 * safe. This module owns the DECISIONS (what to read, whether a batch is
 * lawful, what the watermark and lag are); the IO shell in `server/` owns
 * nothing but plumbing.
 *
 * The follower NEVER writes settlement. Its port is read-only by construction
 * (ports.SettlementSourcePort has no write operation), and in M-IP6-1 its only
 * products are cursors and watermark/operational projections.
 */

import { watermarkKey, type Watermark } from "./watermark";

export interface StreamHead {
  readonly streamType: string;
  readonly streamId: string;
  readonly headSeq: number;
}

export interface CursorState {
  readonly streamType: string;
  readonly streamId: string;
  readonly lastSeq: number;
}

export type BatchVerdict =
  | { ok: true; nextSeq: number }
  | { ok: false; reason: "sequence_gap" | "regression"; atSeq: number };

/**
 * A consumed batch must be DENSE from the cursor: the first event exactly
 * cursor+1, each next exactly +1. A gap means the read raced an in-flight
 * transaction (wait and re-read — never skip); a seq at or below the cursor
 * means the source re-served history (consume nothing; idempotency holds).
 */
export function verifyBatch(lastSeq: number, seqs: readonly number[]): BatchVerdict {
  let cursor = lastSeq;
  for (const seq of seqs) {
    if (seq <= cursor) {
      return { ok: false, reason: "regression", atSeq: seq };
    }
    if (seq !== cursor + 1) {
      return { ok: false, reason: "sequence_gap", atSeq: seq };
    }
    cursor = seq;
  }
  return { ok: true, nextSeq: cursor };
}

/** Which streams have unconsumed history, and how far behind each cursor is. */
export interface StreamLag {
  readonly streamType: string;
  readonly streamId: string;
  readonly cursorSeq: number;
  readonly headSeq: number;
  readonly behind: number;
}

export function streamLags(
  heads: readonly StreamHead[],
  cursors: readonly CursorState[],
): readonly StreamLag[] {
  const byKey = new Map(
    cursors.map((cursor) => [watermarkKey(cursor.streamType, cursor.streamId), cursor.lastSeq]),
  );
  return heads.map((head) => {
    const cursorSeq = byKey.get(watermarkKey(head.streamType, head.streamId)) ?? 0;
    return {
      streamType: head.streamType,
      streamId: head.streamId,
      cursorSeq,
      headSeq: head.headSeq,
      behind: Math.max(0, head.headSeq - cursorSeq),
    };
  });
}

export function totalLag(lags: readonly StreamLag[]): number {
  return lags.reduce((sum, lag) => sum + lag.behind, 0);
}

/** The org's consumed frontier — the watermark every finops surface renders. */
export function watermarkFromCursors(cursors: readonly CursorState[]): Watermark {
  const watermark: Record<string, number> = {};
  for (const cursor of [...cursors].sort((a, b) =>
    watermarkKey(a.streamType, a.streamId).localeCompare(watermarkKey(b.streamType, b.streamId)),
  )) {
    watermark[watermarkKey(cursor.streamType, cursor.streamId)] = cursor.lastSeq;
  }
  return watermark;
}
