import {
  FINOPS_SYSTEM_ACTOR,
  streamLags,
  totalLag,
  verifyBatch,
  type CursorState,
  type StreamLag,
} from "..";

import type { FinopsDeps } from "./deps";
import { issueDueReceipts, type AutoIssueResult } from "./documents";

/**
 * THE FOLLOWER (IP-6_ARCHITECTURE §9, ADR-3) — the platform's first
 * after-commit projection mechanism. Per org, it advances a cursor over the
 * READ-ONLY settlement streams and derives operational projections
 * (watermarks; in later milestones, policy effects with derived command ids).
 *
 * Guarantees, certified:
 *   • NEVER writes settlement — the source port has no write operation.
 *   • At-least-once with idempotent effects: rewinding any cursor to zero and
 *     re-running reproduces the identical state (cursors are operational
 *     state, never truth).
 *   • Dense consumption: a gap (an in-flight settlement transaction racing the
 *     read) makes the follower WAIT and re-read — it never skips history.
 */

export interface FollowerRunResult {
  readonly orgId: string;
  readonly streams: number;
  readonly consumed: number;
  /** Streams whose read raced an in-flight append; retried next run. */
  readonly waiting: readonly string[];
  readonly lags: readonly StreamLag[];
  /** The auto-receipt policy's outcome (M-IP6-2); zeros when not declared. */
  readonly autoReceipts: AutoIssueResult;
}

export async function runFollower(deps: FinopsDeps, orgId: string): Promise<FollowerRunResult> {
  const heads = await deps.source.listOrgStreamHeads(orgId);
  const cursors = await deps.store.loadCursors(orgId);
  const byKey = new Map(
    cursors.map((cursor) => [`${cursor.streamType}:${cursor.streamId}`, cursor.lastSeq]),
  );

  let consumed = 0;
  const waiting: string[] = [];

  for (const head of heads) {
    const lastSeq = byKey.get(`${head.streamType}:${head.streamId}`) ?? 0;
    if (head.headSeq <= lastSeq) {
      continue;
    }
    const events = await deps.source.loadEventsFrom(head.streamType, head.streamId, lastSeq);
    const verdict = verifyBatch(
      lastSeq,
      events.map((event) => event.seq),
    );
    if (!verdict.ok) {
      // The read raced an in-flight transaction (or re-served history): wait
      // and re-read next run — never skip, never guess.
      waiting.push(`${head.streamType}:${head.streamId}@${String(verdict.atSeq)}`);
      continue;
    }
    // M-IP6-1 derives cursors + watermarks only; later milestones hang policy
    // effects (auto-receipts, doc-impact exceptions) HERE, keyed by
    // `{stream}:{seq}:{policy}` derived command ids.
    await deps.store.transact(async (tx) => {
      await tx.putCursor({
        orgId,
        streamType: head.streamType,
        streamId: head.streamId,
        lastSeq: verdict.nextSeq,
        updatedAtMs: deps.now(),
      });
    });
    consumed += events.length;
  }

  // POLICY EFFECTS run AFTER the cursor advances, scan-based and keyed by
  // derived command ids (§7): a crash between cursor and effect leaves the
  // capture visible to the next run's candidate scan — re-derivation is the
  // catch-up, and the duplicate command returns its original ack.
  const autoReceipts = await issueDueReceipts(deps, orgId);

  const after = await deps.store.loadCursors(orgId);
  return {
    orgId,
    streams: heads.length,
    consumed,
    waiting,
    lags: streamLags(heads, after),
    autoReceipts,
  };
}

/** The org's total follower lag right now — the checklist's input. */
export async function followerLag(deps: FinopsDeps, orgId: string): Promise<number> {
  const heads = await deps.source.listOrgStreamHeads(orgId);
  const cursors = await deps.store.loadCursors(orgId);
  return totalLag(streamLags(heads, cursors));
}

/**
 * The rewind — always safe, audited. Deletes the org's cursors so the next run
 * re-consumes from genesis; every effect is idempotent by construction, so the
 * rebuilt state is byte-identical (certified).
 */
export async function rewindFollower(
  deps: FinopsDeps,
  orgId: string,
  actor: string = FINOPS_SYSTEM_ACTOR,
): Promise<void> {
  await deps.store.transact(async (tx) => {
    await tx.deleteCursors(orgId);
    await tx.writeAudit({
      actor,
      action: "finops.FollowerRewound",
      orgId,
      subject: orgId,
      source: actor === FINOPS_SYSTEM_ACTOR ? "recovery" : "web",
      correlationId: deps.newId(),
      eventSeq: 0,
    });
  });
}

export type { CursorState };
