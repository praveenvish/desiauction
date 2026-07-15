import {
  deriveCheckpointChain,
  diffCase,
  diffJournal,
  diffPayment,
  projectCase,
  projectJournal,
  projectPayment,
  replayCase,
  replayJournal,
  replayPayment,
  verifyCheckpoint,
  type JournalCheckpoint,
} from "@desiauction/settlement";

import type { SettlementDeps } from "./deps";
import type { SettlementActor } from "./writer";

/**
 * RECOVERY (IP-5_ARCHITECTURE §15) — the answer to every divergence.
 *
 * Recovery is REPLAY, from genesis, never from a checkpoint: fold the immutable
 * log with the pure reducer, compare it against the rows, and rebuild the rows
 * FROM the events. It never invents a fact; it restores the log's. A log that
 * will not fold heals nothing and says so — that is the restore-from-backup
 * case, and it is not something a writer may paper over.
 *
 * `RecoverJournal` additionally discards the checkpoint chain and re-derives it
 * from genesis, re-proving every checkpoint byte-for-byte. A checkpoint is
 * acceleration; it is never allowed to be the reason a balance is what it is.
 */

export interface RecoveryReport {
  readonly ok: boolean;
  readonly reason?: string;
  readonly atSeq?: number;
  readonly eventCount: number;
  readonly divergences: readonly string[];
  readonly healed: boolean;
  readonly checkpointsRederived?: number;
}

export async function recoverCase(
  deps: SettlementDeps,
  actor: SettlementActor,
  caseId: string,
): Promise<RecoveryReport> {
  const events = await deps.store.loadStream("case", caseId);
  const replay = replayCase(events);
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
  const caseRow = await deps.store.loadCase(caseId);
  const obligations = await deps.store.loadObligations(caseId);
  const divergences = diffCase(replay.projection, caseRow, obligations);

  const atMs = deps.now();
  const correlationId = deps.newId();
  await deps.store.transact(async (tx) => {
    if (divergences.length > 0) {
      const projected = projectCase(replay.projection, actor.orgId);
      await tx.putCase(projected.caseRow);
      await tx.putObligations(caseId, projected.obligationRows);
    }
    const seq = await tx.appendEvent({
      orgId: actor.orgId,
      streamType: "case",
      streamId: caseId,
      type: "CaseRecovered",
      atMs,
      actor: actor.personId,
      correlationId,
      commandId: deps.newId(),
      payload: { divergences: divergences.length, eventCount: events.length },
    });
    await tx.writeAudit({
      actor: actor.personId,
      action: "settlement.CaseRecovered",
      orgId: actor.orgId,
      subject: caseId,
      source: "recovery",
      correlationId,
      eventSeq: seq,
      reason: divergences.length > 0 ? divergences.join(" · ") : "no divergence",
    });
    // The recovery event is itself history, so the rows must reflect the log
    // INCLUDING it — otherwise the very next command would see a divergence.
    const after = replayCase([
      ...events,
      {
        streamType: "case",
        streamId: caseId,
        seq,
        type: "CaseRecovered",
        atMs,
        actor: actor.personId,
        correlationId,
        commandId: "",
        payload: { divergences: divergences.length, eventCount: events.length },
      },
    ]);
    if (!after.ok) {
      throw new Error(`replay_failed:${after.reason}`);
    }
    const projected = projectCase(after.projection, actor.orgId);
    await tx.putCase(projected.caseRow);
    await tx.putObligations(caseId, projected.obligationRows);
  });

  return {
    ok: true,
    eventCount: events.length,
    divergences,
    healed: divergences.length > 0,
  };
}

/**
 * Rebuild a single payment's projection row from its stream. The row id is the
 * stream id, so the rebuilt row is byte-identical (no fresh id is minted) — a
 * tampered `captured` is healed back to exactly what the events say.
 */
export async function recoverPayment(
  deps: SettlementDeps,
  actor: SettlementActor,
  paymentId: string,
): Promise<RecoveryReport> {
  const events = await deps.store.loadStream("payment", paymentId);
  const replay = replayPayment(events);
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
  const row = await deps.store.loadPayment(paymentId);
  const divergences = diffPayment(replay.projection, row);
  if (divergences.length > 0) {
    await deps.store.transact(async (tx) => {
      await tx.putPayment(projectPayment(replay.projection, actor.orgId));
    });
  }
  return {
    ok: true,
    eventCount: events.length,
    divergences,
    healed: divergences.length > 0,
  };
}

/** Rebuild every payment projection in the org — the org-wide recovery path. */
export async function recoverPayments(
  deps: SettlementDeps,
  actor: SettlementActor,
): Promise<RecoveryReport> {
  const ids = await deps.store.loadPaymentIds(actor.orgId);
  const divergences: string[] = [];
  let eventCount = 0;
  for (const paymentId of ids) {
    const report = await recoverPayment(deps, actor, paymentId);
    if (!report.ok) {
      return report;
    }
    eventCount += report.eventCount;
    divergences.push(...report.divergences);
  }
  return { ok: true, eventCount, divergences, healed: divergences.length > 0 };
}

export async function recoverJournal(
  deps: SettlementDeps,
  actor: SettlementActor,
): Promise<RecoveryReport> {
  const orgId = actor.orgId;
  const events = await deps.store.loadStream("journal", orgId);
  const replay = replayJournal(events);
  if (!replay.ok) {
    // Unhealable by design: corruption in the LOG itself is a restore, not a
    // repair. Nothing is written, and the reason is named.
    return {
      ok: false,
      reason: replay.reason,
      atSeq: replay.atSeq,
      eventCount: events.length,
      divergences: [],
      healed: false,
    };
  }
  const rows = await deps.store.loadPostings(orgId);
  const divergences = [...diffJournal(replay.projection, rows)];

  // The checkpoint chain is disposable: compare it to genesis, then re-derive it.
  const stored = await deps.store.loadCheckpoints(orgId);
  const chain = deriveCheckpointChain(events, deps.checkpointCadence, deps.digest);
  if (!chain.ok) {
    return {
      ok: false,
      reason: chain.reason,
      atSeq: chain.atSeq,
      eventCount: events.length,
      divergences,
      healed: false,
    };
  }
  for (const checkpoint of stored) {
    const verification = verifyCheckpoint(
      { seq: checkpoint.seq, bytes: checkpoint.bytes, digest: checkpoint.digest },
      chain.checkpoints,
    );
    if (!verification.ok) {
      divergences.push(`checkpoint ${String(checkpoint.seq)}: ${verification.reason}`);
    }
  }

  const atMs = deps.now();
  const correlationId = deps.newId();
  await deps.store.transact(async (tx) => {
    if (divergences.length > 0) {
      // Rows are rebuilt FROM events — never patched towards them.
      await tx.deletePostings(orgId);
      for (const posting of projectJournal(replay.projection, orgId)) {
        await tx.putPosting(posting);
      }
      await tx.clearCheckpoints(orgId);
      for (const checkpoint of chain.checkpoints) {
        await putVerified(tx, orgId, checkpoint, atMs);
      }
    }
    const seq = await tx.appendEvent({
      orgId,
      streamType: "journal",
      streamId: orgId,
      type: "JournalRecovered",
      atMs,
      actor: actor.personId,
      correlationId,
      commandId: deps.newId(),
      payload: { divergences: divergences.length, eventCount: events.length },
    });
    await tx.writeAudit({
      actor: actor.personId,
      action: "settlement.JournalRecovered",
      orgId,
      subject: orgId,
      source: "recovery",
      correlationId,
      eventSeq: seq,
      reason: divergences.length > 0 ? divergences.join(" · ") : "no divergence",
    });
  });

  return {
    ok: true,
    eventCount: events.length,
    divergences,
    healed: divergences.length > 0,
    checkpointsRederived: divergences.length > 0 ? chain.checkpoints.length : 0,
  };
}

async function putVerified(
  tx: Parameters<Parameters<SettlementDeps["store"]["transact"]>[0]>[0],
  orgId: string,
  checkpoint: JournalCheckpoint,
  atMs: number,
): Promise<void> {
  await tx.putCheckpoint({
    orgId,
    seq: checkpoint.seq,
    digest: checkpoint.digest,
    bytes: checkpoint.bytes,
    verifiedAtMs: null,
  });
  // Re-derived from genesis in this very call — which is exactly the proof the
  // verification pass demands, so it is verified here rather than pending.
  await tx.markCheckpointVerified(orgId, checkpoint.seq, atMs);
}

export interface JournalVerification {
  readonly ok: boolean;
  readonly reason?: string;
  readonly rowDivergences: readonly string[];
  readonly checkpointDivergences: readonly string[];
  readonly verified: number;
  readonly created: number;
}

/**
 * The maintenance verification pass (§13a): fold the journal from GENESIS,
 * sweep EVERY posting row against it, and promote checkpoints to verified only
 * where they are byte-identical to that fold. This is the pass that gives the
 * command path the right to trust a checkpoint — and the only thing that ever
 * does. Off the command path by design: its cost is O(journal), and the command
 * path's is not.
 */
export async function verifyJournal(
  deps: SettlementDeps,
  orgId: string,
): Promise<JournalVerification> {
  const events = await deps.store.loadStream("journal", orgId);
  const replay = replayJournal(events);
  if (!replay.ok) {
    return {
      ok: false,
      reason: `${replay.reason} at seq ${String(replay.atSeq)}`,
      rowDivergences: [],
      checkpointDivergences: [],
      verified: 0,
      created: 0,
    };
  }
  const rows = await deps.store.loadPostings(orgId);
  const rowDivergences = diffJournal(replay.projection, rows);

  const chain = deriveCheckpointChain(events, deps.checkpointCadence, deps.digest);
  if (!chain.ok) {
    return {
      ok: false,
      reason: `${chain.reason} at seq ${String(chain.atSeq)}`,
      rowDivergences,
      checkpointDivergences: [],
      verified: 0,
      created: 0,
    };
  }
  const stored = await deps.store.loadCheckpoints(orgId);
  const byStoredSeq = new Map(stored.map((checkpoint) => [checkpoint.seq, checkpoint]));
  const checkpointDivergences: string[] = [];
  let verified = 0;
  let created = 0;
  const atMs = deps.now();

  await deps.store.transact(async (tx) => {
    for (const derived of chain.checkpoints) {
      const existing = byStoredSeq.get(derived.seq);
      if (existing === undefined) {
        await putVerified(tx, orgId, derived, atMs);
        created += 1;
        verified += 1;
        continue;
      }
      const verification = verifyCheckpoint(
        { seq: existing.seq, bytes: existing.bytes, digest: existing.digest },
        chain.checkpoints,
      );
      if (!verification.ok) {
        checkpointDivergences.push(`checkpoint ${String(derived.seq)}: ${verification.reason}`);
        continue;
      }
      await tx.markCheckpointVerified(orgId, derived.seq, atMs);
      verified += 1;
    }
  });

  return {
    ok: rowDivergences.length === 0 && checkpointDivergences.length === 0,
    rowDivergences,
    checkpointDivergences,
    verified,
    created,
  };
}
