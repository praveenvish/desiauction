import type { GrantLike } from "@desiauction/core";
import {
  CHECKPOINT_CADENCE,
  buildPolicyEvent,
  canonicalJournalBytes,
  checkpointDue,
  checkpointOf,
  collectionCommandId,
  computeObligations,
  coordinationEffects,
  decideAttestCapture,
  decideCloseCase,
  decideComputeObligations,
  decideExpirePayment,
  decideInitiatePayment,
  decideManualRefund,
  decideOpenCase,
  decideReopen,
  decideSettle,
  decideVerifyCase,
  decideVoid,
  decideWaive,
  decideWebhookEvent,
  derivedCommandId,
  diffCase,
  diffJournal,
  diffPayment,
  foldFromCheckpoint,
  foldJournalEvents,
  foldSource,
  hasSettlementCapability,
  isManualMethod,
  outstandingOf,
  paymentHasEffects,
  policyFor,
  postingsForCase,
  projectCase,
  projectJournal,
  projectPayment,
  refundLiability,
  replayCase,
  replayJournal,
  replayPayment,
  sourceStreamId,
  trialBalance,
  verifyClosure,
  verifySource,
  type CaseProjection,
  type ClosureVerification,
  type CoordinationContext,
  type Decision,
  type JournalProjection,
  type NewEvent,
  type ObligationBasis,
  type PaymentMethod,
  type PaymentProjection,
  type SettlementCapability,
  type SettlementEventEnvelope,
  type WebhookFacts,
} from "@desiauction/settlement";

import type { SettlementDeps } from "./deps";

/** The settlement system actor (all-zero ULID) — webhook ingress and the sweep
 * authenticate by HMAC / schedule, not by session (§19); their writes are
 * attributed to the system, audited with a webhook/sweep source. */
const SYSTEM_ACTOR = "00000000000000000000000000";

/**
 * THE SETTLEMENT WRITER (IP-5_ARCHITECTURE §6/§7/§13) — the single mutation
 * authority for every settlement aggregate. No route, no service and no read
 * model writes these tables anywhere else.
 *
 * Every command follows one shape, and there are no exceptions:
 *
 *   capability (re-checked here — surfaces are courtesy, never the boundary)
 *   → idempotency (a duplicate commandId returns the ORIGINAL ack, appends nothing)
 *   → load the stream, FOLD it (pure reducer)
 *   → VERIFY the projection rows against the fold — every row read to decide
 *   → decide (pure command handler → events)
 *   → ONE transaction: append the event(s) + ONE audit row + the projection rows
 *   → coordinate: derive the journal consequence, idempotently
 *
 * Divergence between rows and log HALTS the aggregate: `settlement_halted` is
 * returned to every command until recovery heals the rows FROM the events. The
 * halt is not a flag in memory — it is re-derived on every command, so a
 * restarted process is exactly as fail-closed as a running one.
 */

export interface SettlementActor {
  readonly personId: string;
  readonly orgId: string;
  readonly grants: readonly GrantLike[];
}

export type AckFailure = { ok: false; reason: string; detail?: string };

export type Ack =
  { ok: true; status: "accepted" | "duplicate"; caseId: string; seq: number } | AckFailure;

function authorized(actor: SettlementActor, capability: SettlementCapability): boolean {
  return hasSettlementCapability(
    actor.grants,
    { scopeType: "org", scopeId: actor.orgId },
    capability,
  );
}

function halted(divergences: readonly string[]): AckFailure {
  return { ok: false, reason: "settlement_halted", detail: divergences.join(" · ") };
}

// --- Committing ---------------------------------------------------------------------

interface CommitContext {
  readonly deps: SettlementDeps;
  readonly actor: SettlementActor;
  readonly commandId: string;
  readonly reason?: string;
}

/**
 * Append the decided case events with their audit rows and rebuild the case's
 * projection rows FROM the resulting fold — inside one transaction. The
 * projection is written from the log, never from the command: a row can only
 * ever say what the events say.
 */
async function commitCase(
  context: CommitContext,
  existing: readonly SettlementEventEnvelope[],
  events: readonly NewEvent[],
): Promise<Ack> {
  const { deps, actor, commandId } = context;
  const atMs = deps.now();
  const correlationId = deps.newId();
  const caseId = events[0]?.streamId ?? "";

  // If this command has a consequence in the journal, the journal must be
  // HEALTHY before the case event is written. Otherwise the case would record a
  // waiver whose posting can never land — a case saying one thing and the books
  // saying another. Money quiesces together or not at all.
  if (events.some((event) => policyFor(event.type) !== null)) {
    const loaded = await loadJournal(deps, actor.orgId);
    if (!loaded.ok) {
      return { ok: false, reason: "journal_halted", detail: loaded.ack.detail ?? "" };
    }
    const divergences = await verifyJournalTail(deps, actor.orgId, loaded.fold);
    if (divergences.length > 0) {
      return { ok: false, reason: "journal_halted", detail: divergences.join(" · ") };
    }
  }

  const committed = await deps.store.transact(async (tx) => {
    const appended: SettlementEventEnvelope[] = [];
    for (const event of events) {
      const seq = await tx.appendEvent({
        orgId: actor.orgId,
        streamType: "case",
        streamId: event.streamId,
        type: event.type,
        atMs,
        actor: actor.personId,
        correlationId,
        commandId,
        payload: event.payload,
      });
      await tx.writeAudit({
        actor: actor.personId,
        action: `settlement.${event.type}`,
        orgId: actor.orgId,
        subject: event.streamId,
        source: "web",
        correlationId,
        eventSeq: seq,
        ...(context.reason !== undefined ? { reason: context.reason } : {}),
      });
      appended.push({
        streamType: "case",
        streamId: event.streamId,
        seq,
        type: event.type,
        atMs,
        actor: actor.personId,
        correlationId,
        commandId,
        payload: event.payload,
      });
    }

    const replay = replayCase([...existing, ...appended]);
    if (!replay.ok) {
      // Unreachable: the decision was taken against this very fold. If it ever
      // happens, the transaction rolls back — a projection is never written from
      // a log the reducer refuses.
      throw new Error(`replay_failed:${replay.reason}`);
    }
    const projected = projectCase(replay.projection, actor.orgId);
    await tx.putCase(projected.caseRow);
    await tx.putObligations(replay.projection.caseId, projected.obligationRows);
    return { appended, projection: replay.projection };
  });

  // Coordination is deliberately OUTSIDE the case transaction: cross-aggregate
  // effects are policies, not distributed transactions (§7). A crash here leaves
  // the case correct and the journal behind — which the catch-up scan repairs,
  // idempotently, because the derived command id is a function of the source.
  for (const event of committed.appended) {
    await coordinate(deps, actor, event, committed.projection.caseId);
  }

  const last = committed.appended[committed.appended.length - 1];
  return { ok: true, status: "accepted", caseId, seq: last?.seq ?? 0 };
}

// --- The journal (checkpointed verification) ------------------------------------------

interface JournalFold {
  readonly projection: JournalProjection;
  /** The seq up to which rows were already verified by a VERIFIED checkpoint. */
  readonly verifiedThrough: number;
}

type JournalLoad = { ok: true; fold: JournalFold } | { ok: false; ack: AckFailure };

/**
 * Fold the org journal for the command path: from the latest VERIFIED checkpoint
 * plus the tail, so the cost is bounded by the cadence rather than by the
 * journal's lifetime (§13a). The genesis fold remains the definition of truth —
 * it runs in the maintenance verification pass and in recovery, both of which
 * would catch a checkpoint that lied.
 */
async function loadJournal(deps: SettlementDeps, orgId: string): Promise<JournalLoad> {
  const checkpoint = await deps.store.latestVerifiedCheckpoint(orgId);
  if (checkpoint === null) {
    const events = await deps.store.loadStream("journal", orgId);
    const replay = replayJournal(events);
    if (!replay.ok) {
      return {
        ok: false,
        ack: halted([`journal: ${replay.reason} at seq ${String(replay.atSeq)}`]),
      };
    }
    return { ok: true, fold: { projection: replay.projection, verifiedThrough: 0 } };
  }
  const tail = await deps.store.loadStreamFrom("journal", orgId, checkpoint.seq);
  const folded = foldFromCheckpoint(
    { seq: checkpoint.seq, bytes: checkpoint.bytes, digest: checkpoint.digest },
    tail,
    deps.digest,
  );
  if (!folded.ok) {
    return {
      ok: false,
      ack: halted([`journal: ${folded.reason} at seq ${String(folded.atSeq)}`]),
    };
  }
  return { ok: true, fold: { projection: folded.projection, verifiedThrough: checkpoint.seq } };
}

/**
 * Verify the journal rows the writer is about to add to, and the books
 * themselves. Row verification is windowed to the unverified tail (the rows a
 * verified checkpoint already covers were proven when it was verified); the full
 * row sweep belongs to `verifyJournal` and to recovery, which are not on the
 * command path.
 */
async function verifyJournalTail(
  deps: SettlementDeps,
  orgId: string,
  fold: JournalFold,
): Promise<readonly string[]> {
  const rows = await deps.store.loadPostingsFrom(orgId, fold.verifiedThrough);
  const divergences = [...diffJournal(fold.projection, rows, fold.verifiedThrough)];
  const balance = trialBalance(fold.projection);
  if (!balance.balanced) {
    divergences.push(
      `journal: trial balance broken (debits=${String(balance.debits)} credits=${String(balance.credits)})`,
    );
  }
  return divergences;
}

/**
 * Append one journal event: the balanced posting, its audit row and its posting
 * rows — and, at the cadence, a fresh (unverified) checkpoint. A checkpoint is
 * born untrusted: only `verifyJournal` may promote it, and only by proving it
 * byte-identical to the genesis fold.
 */
async function commitJournal(
  deps: SettlementDeps,
  actor: SettlementActor,
  event: NewEvent,
  commandId: string,
  fold: JournalFold,
): Promise<number> {
  const atMs = deps.now();
  const correlationId = deps.newId();
  return deps.store.transact(async (tx) => {
    const seq = await tx.appendEvent({
      orgId: actor.orgId,
      streamType: "journal",
      streamId: actor.orgId,
      type: event.type,
      atMs,
      actor: actor.personId,
      correlationId,
      commandId,
      payload: event.payload,
    });
    await tx.writeAudit({
      actor: actor.personId,
      action: `settlement.${event.type}`,
      orgId: actor.orgId,
      subject: actor.orgId,
      source: "policy",
      correlationId,
      eventSeq: seq,
    });

    const appended: SettlementEventEnvelope = {
      streamType: "journal",
      streamId: actor.orgId,
      seq,
      type: event.type,
      atMs,
      actor: actor.personId,
      correlationId,
      commandId,
      payload: event.payload,
    };
    // Fold FORWARD from the fold this command was decided against — never
    // re-read the whole journal here. That is the entire point of §13a: the
    // command path's cost is the tail's, not the journal's lifetime.
    const replay = foldJournalEvents(fold.projection, [appended]);
    if (!replay.ok) {
      // The posting the policy built does not fold — unbalanced, off-template or
      // a duplicated cause. Roll back: money never lands on a rejected fold.
      throw new Error(`journal_replay_failed:${replay.reason}`);
    }
    const posting = projectJournal(replay.projection, actor.orgId).find(
      (row) => row.eventSeq === seq,
    );
    if (posting !== undefined) {
      await tx.putPosting(posting);
    }
    if (checkpointDue(seq, deps.checkpointCadence)) {
      // Born UNVERIFIED: only the genesis pass (recovery.verifyJournal) may
      // promote it, and only by proving it byte-identical to the genesis fold.
      const checkpoint = checkpointOf(replay.projection, deps.digest);
      await tx.putCheckpoint({
        orgId: actor.orgId,
        seq: checkpoint.seq,
        digest: checkpoint.digest,
        bytes: checkpoint.bytes,
        verifiedAtMs: null,
      });
    }
    return seq;
  });
}

/**
 * The coordinator. A case event's consequence in the journal is derived from the
 * event itself and keyed by a DERIVED command id — so running it twice (after a
 * crash, or from the catch-up scan) finds the effect already present and does
 * nothing. One cause, one posting, forever.
 */
async function coordinate(
  deps: SettlementDeps,
  actor: SettlementActor,
  source: SettlementEventEnvelope,
  caseId: string,
): Promise<void> {
  const policy = policyFor(source.type);
  if (policy === null) {
    return;
  }
  const commandId = derivedCommandId(sourceStreamId(source), source.seq, policy);
  const already = await deps.store.findByCommandId("journal", actor.orgId, commandId);
  if (already !== null) {
    return;
  }
  const built = buildPolicyEvent(source, {
    orgId: actor.orgId,
    postingId: deps.newId(),
    caseId,
  });
  if (!built.ok) {
    // `no_effect` is a legitimate silence: a case with no dues posts nothing.
    return;
  }
  const loaded = await loadJournal(deps, actor.orgId);
  if (!loaded.ok) {
    throw new Error("journal_halted");
  }
  const divergences = await verifyJournalTail(deps, actor.orgId, loaded.fold);
  if (divergences.length > 0) {
    throw new Error(`journal_halted:${divergences.join(" · ")}`);
  }
  await commitJournal(deps, actor, built.event, built.commandId, loaded.fold);
}

/**
 * The catch-up scan (§7/§15): re-derive any policy effect that is missing —
 * after a crash between the case commit and the journal commit, or after a
 * recovery. Idempotent by construction; safe to run at any time.
 */
export async function runCoordination(
  deps: SettlementDeps,
  actor: SettlementActor,
  caseId: string,
): Promise<number> {
  const events = await deps.store.loadStream("case", caseId);
  let repaired = 0;
  for (const event of events) {
    const policy = policyFor(event.type);
    if (policy === null) {
      continue;
    }
    const commandId = derivedCommandId(sourceStreamId(event), event.seq, policy);
    const already = await deps.store.findByCommandId("journal", actor.orgId, commandId);
    if (already !== null) {
      continue;
    }
    await coordinate(deps, actor, event, caseId);
    repaired += 1;
  }
  return repaired;
}

// --- The command path ------------------------------------------------------------------

interface LoadedCase {
  readonly events: readonly SettlementEventEnvelope[];
  readonly projection: CaseProjection;
}

type CaseLoad = { ok: true; loaded: LoadedCase } | { ok: false; ack: AckFailure };

/** Load, fold, and VERIFY every row the decision will read. */
async function loadCase(deps: SettlementDeps, caseId: string): Promise<CaseLoad> {
  const events = await deps.store.loadStream("case", caseId);
  if (events.length === 0) {
    return { ok: false, ack: { ok: false, reason: "unknown_case" } };
  }
  const replay = replayCase(events);
  if (!replay.ok) {
    return {
      ok: false,
      ack: halted([`case: ${replay.reason} at seq ${String(replay.atSeq)}`]),
    };
  }
  const caseRow = await deps.store.loadCase(caseId);
  const obligations = await deps.store.loadObligations(caseId);
  const divergences = diffCase(replay.projection, caseRow, obligations);
  if (divergences.length > 0) {
    return { ok: false, ack: halted(divergences) };
  }
  return { ok: true, loaded: { events, projection: replay.projection } };
}

/** The one command shape every case mutation flows through. */
async function caseCommand(
  deps: SettlementDeps,
  actor: SettlementActor,
  caseId: string,
  commandId: string,
  capability: SettlementCapability,
  decide: (projection: CaseProjection) => Promise<Decision> | Decision,
  reason?: string,
): Promise<Ack> {
  if (!authorized(actor, capability)) {
    return { ok: false, reason: "not_authorized" };
  }
  const duplicate = await deps.store.findByCommandId("case", caseId, commandId);
  if (duplicate !== null) {
    return { ok: true, status: "duplicate", caseId, seq: duplicate.seq };
  }
  const loaded = await loadCase(deps, caseId);
  if (!loaded.ok) {
    return loaded.ack;
  }
  const decision = await decide(loaded.loaded.projection);
  if (!decision.ok) {
    return { ok: false, reason: decision.reason };
  }
  return commitCase(
    { deps, actor, commandId, ...(reason !== undefined ? { reason } : {}) },
    loaded.loaded.events,
    decision.events,
  );
}

export interface OpenCaseCommand {
  readonly commandId: string;
  readonly auctionId: string;
  readonly basis: ObligationBasis;
  readonly fixed?: Readonly<Record<string, number>>;
}

/**
 * Open a case on a finished auction: fold the FROZEN log, pin what was seen, and
 * record the organizer's declared obligation basis. This is the aggregate's
 * birth — the only command with no prior stream to fold.
 */
export async function openCase(
  deps: SettlementDeps,
  actor: SettlementActor,
  command: OpenCaseCommand,
): Promise<Ack> {
  if (!authorized(actor, "settlement.manage")) {
    return { ok: false, reason: "not_authorized" };
  }
  const auction = await deps.source.loadAuction(command.auctionId);
  if (auction === null || auction.orgId !== actor.orgId) {
    // Existence privacy: another org's auction is indistinguishable from none.
    return { ok: false, reason: "unknown_auction" };
  }
  const existing = await deps.store.loadCaseByAuction(command.auctionId);
  const sourceEvents = await deps.source.loadEvents(command.auctionId);
  const folded = foldSource(sourceEvents, deps.digest);
  if (!folded.ok) {
    return { ok: false, reason: "source_unfoldable", detail: folded.reason };
  }

  const caseId = deps.newId();
  const decision = decideOpenCase({
    caseId,
    auctionId: auction.auctionId,
    competitionId: auction.competitionId,
    auctionStatus: auction.status,
    basis: command.basis,
    fixed: command.fixed ?? {},
    pin: folded.source.pin,
    caseExists: existing !== null,
  });
  if (!decision.ok) {
    return { ok: false, reason: decision.reason };
  }
  const duplicate = await deps.store.findByCommandId("case", caseId, command.commandId);
  if (duplicate !== null) {
    return { ok: true, status: "duplicate", caseId, seq: duplicate.seq };
  }
  return commitCase({ deps, actor, commandId: command.commandId }, [], decision.events);
}

/**
 * Verify the case against the frozen source. The outcome is the fold's, not the
 * caller's. Exiting a discrepancy is an OVERRIDE and re-pins intake (§11) —
 * which is why the capability demanded depends on where the case stands.
 */
export async function verifyCase(
  deps: SettlementDeps,
  actor: SettlementActor,
  caseId: string,
  commandId: string,
  reason?: string,
): Promise<Ack> {
  const current = await deps.store.loadCase(caseId);
  const capability: SettlementCapability =
    current?.status === "discrepant" ? "settlement.override" : "settlement.manage";
  if (capability === "settlement.override" && (reason === undefined || reason === "")) {
    return { ok: false, reason: "reason_required" };
  }
  return caseCommand(
    deps,
    actor,
    caseId,
    commandId,
    capability,
    async (projection) => {
      const events = await deps.source.loadEvents(projection.auctionId);
      const outcome = verifySource(
        events,
        {
          sourceEventCount: projection.sourceEventCount,
          sourceDigest: projection.sourceDigest,
        },
        deps.digest,
      );
      return decideVerifyCase(projection, outcome);
    },
    reason,
  );
}

/** Turn the verified fold into per-team dues, under the basis pinned at open. */
export async function computeCaseObligations(
  deps: SettlementDeps,
  actor: SettlementActor,
  caseId: string,
  commandId: string,
): Promise<Ack> {
  return caseCommand(
    deps,
    actor,
    caseId,
    commandId,
    "settlement.manage",
    async (projection): Promise<Decision> => {
      const events = await deps.source.loadEvents(projection.auctionId);
      const folded = foldSource(events, deps.digest);
      if (!folded.ok) {
        return { ok: false, reason: "source_unfoldable" };
      }
      const fixed = fixedAmountsOf(await deps.store.loadStream("case", caseId));
      const items = computeObligations(folded.source.fold, projection.basis, fixed);
      if (!items.ok) {
        return { ok: false, reason: items.reason };
      }
      return decideComputeObligations(projection, items.items);
    },
  );
}

/** The declared per-team amounts, read back from the CaseOpened event itself. */
function fixedAmountsOf(events: readonly SettlementEventEnvelope[]): Record<string, number> {
  const opened = events.find((event) => event.type === "CaseOpened");
  const fixed = opened?.payload["fixed"];
  if (typeof fixed !== "object" || fixed === null || Array.isArray(fixed)) {
    return {};
  }
  const result: Record<string, number> = {};
  for (const [teamId, amount] of Object.entries(fixed as Record<string, unknown>)) {
    if (typeof amount === "number") {
      result[teamId] = amount;
    }
  }
  return result;
}

export async function waiveObligation(
  deps: SettlementDeps,
  actor: SettlementActor,
  caseId: string,
  commandId: string,
  input: { teamId: string; amount: number; reason: string },
): Promise<Ack> {
  return caseCommand(
    deps,
    actor,
    caseId,
    commandId,
    "settlement.override",
    (projection) => decideWaive(projection, input),
    input.reason,
  );
}

// `ObligationAdjusted` is in the closed catalog and its reducer branch exists —
// but NO adjust command ships in Foundation, deliberately. The ratified template
// set (§9.3) gives an adjustment no posting shape and the policy list (§8.2)
// gives it no journal consequence, so an adjustment would move what a team owes
// in the CASE while the dues wallet in the JOURNAL stood still. Rather than
// invent a template (which is an ADR, not an implementation choice) or ship a
// command that desynchronises the books, the gap is referred to the Board.
// Foundation therefore holds a stronger property than the architecture demands:
// **every team's dues wallet equals its case outstanding, at every seq** — a
// cross-aggregate conservation law the regression suite asserts.

export async function settleCase(
  deps: SettlementDeps,
  actor: SettlementActor,
  caseId: string,
  commandId: string,
): Promise<Ack> {
  return caseCommand(deps, actor, caseId, commandId, "settlement.manage", (projection) =>
    decideSettle(projection),
  );
}

/**
 * Close the case (M-IP5-3) — the terminal state surfaces render as
 * **Reconciled**. Closure runs the full FINANCIAL VERIFICATION first and embeds
 * the immutable evidence package; a failed verification (imbalance, refund
 * liability, source mismatch) BLOCKS closure deterministically — money quiesces,
 * the case stays settled. Nothing bypasses verification.
 */
export async function closeCase(
  deps: SettlementDeps,
  actor: SettlementActor,
  caseId: string,
  commandId: string,
): Promise<Ack> {
  return caseCommand(deps, actor, caseId, commandId, "settlement.manage", async (projection) => {
    const verification = await assembleClosureVerification(deps, actor.orgId, projection);
    if (verification === null) {
      return { ok: false, reason: "source_unfoldable" };
    }
    return decideCloseCase(projection, verification);
  });
}

/**
 * Assemble the closure verification inputs from the CURRENT folds: the org
 * journal (genesis), the obligations RECOMPUTED from the frozen auction under
 * the pinned basis (the "auction totals" check), and the settled case prefix.
 * Pure `verifyClosure` does the deterministic work; this only gathers.
 */
async function assembleClosureVerification(
  deps: SettlementDeps,
  orgId: string,
  projection: CaseProjection,
): Promise<ClosureVerification | null> {
  const journal = await journalFold(deps, orgId);
  if (journal === null) {
    return null;
  }
  const events = await deps.source.loadEvents(projection.auctionId);
  const folded = foldSource(events, deps.digest);
  if (!folded.ok) {
    return null;
  }
  const caseEvents = await deps.store.loadStream("case", projection.caseId);
  const fixed = fixedAmountsOf(caseEvents);
  const items = computeObligations(folded.source.fold, projection.basis, fixed);
  const recomputed: Record<string, number> = {};
  if (items.ok) {
    for (const item of items.items) {
      recomputed[item.teamId] = item.amount;
    }
  }
  return verifyClosure(
    {
      caseProjection: projection,
      journal,
      journalSeq: journal.lastSeq,
      caseEventCount: projection.eventCount,
      recomputedObligations: recomputed,
    },
    deps.digest,
  );
}

/**
 * CaseReadyForClosure — the read-only readiness projection (§1). Reports whether
 * a settled case would pass verification, and which checks block it. No write.
 */
export async function readyForClosure(
  deps: SettlementDeps,
  orgId: string,
  caseId: string,
): Promise<{ ready: boolean; status: string; blockers: readonly string[] }> {
  const state = await caseFold(deps, caseId);
  if (state === null) {
    return { ready: false, status: "unknown", blockers: ["unknown_case"] };
  }
  if (state.projection.status !== "settled") {
    return { ready: false, status: state.projection.status, blockers: ["not_settled"] };
  }
  const verification = await assembleClosureVerification(deps, orgId, state.projection);
  if (verification === null) {
    return { ready: false, status: "settled", blockers: ["source_unfoldable"] };
  }
  return {
    ready: verification.ok,
    status: "settled",
    blockers: verification.checks.filter((check) => !check.pass).map((check) => check.name),
  };
}

export { assembleClosureVerification };

export async function reopenCase(
  deps: SettlementDeps,
  actor: SettlementActor,
  caseId: string,
  commandId: string,
  reason: string,
): Promise<Ack> {
  return caseCommand(
    deps,
    actor,
    caseId,
    commandId,
    "settlement.override",
    (projection) => decideReopen(projection, { reason }),
    reason,
  );
}

export async function voidCase(
  deps: SettlementDeps,
  actor: SettlementActor,
  caseId: string,
  commandId: string,
  reason: string,
): Promise<Ack> {
  return caseCommand(
    deps,
    actor,
    caseId,
    commandId,
    "settlement.override",
    async (projection) => {
      const loaded = await loadJournal(deps, actor.orgId);
      if (!loaded.ok) {
        return { ok: false, reason: "settlement_halted" };
      }
      const postings = postingsForCase(loaded.fold.projection, caseId);
      return decideVoid(projection, { reason, postingCount: postings.length });
    },
    reason,
  );
}

// --- Read-side folds (derived; no surface in Foundation) --------------------------------

export interface CaseFold {
  readonly projection: CaseProjection;
  readonly events: readonly SettlementEventEnvelope[];
}

export async function caseFold(deps: SettlementDeps, caseId: string): Promise<CaseFold | null> {
  const events = await deps.store.loadStream("case", caseId);
  if (events.length === 0) {
    return null;
  }
  const replay = replayCase(events);
  return replay.ok ? { projection: replay.projection, events } : null;
}

/** The org's wallets, always from the GENESIS fold — the definition of truth. */
export async function journalFold(
  deps: SettlementDeps,
  orgId: string,
): Promise<JournalProjection | null> {
  const events = await deps.store.loadStream("journal", orgId);
  const replay = replayJournal(events);
  return replay.ok ? replay.projection : null;
}

export async function paymentFold(
  deps: SettlementDeps,
  paymentId: string,
): Promise<PaymentProjection | null> {
  const events = await deps.store.loadStream("payment", paymentId);
  if (events.length === 0) {
    return null;
  }
  const replay = replayPayment(events);
  return replay.ok ? replay.projection : null;
}

// ============================================================================
// COLLECTIONS (M-IP5-2) — the Payment aggregate's writer surface and the
// deterministic coordinator between Payment → OrgJournal → SettlementCase.
// Still ONE writer: these are additional command shapes on the same mutation
// authority, appending to the payment stream and coordinating the ratified
// downstream effects (§8.3). The coordinator owns SEQUENCING only; every rule
// lives in an aggregate.
// ============================================================================

interface LoadedPayment {
  readonly events: readonly SettlementEventEnvelope[];
  readonly projection: PaymentProjection;
}

type PaymentLoad = { ok: true; loaded: LoadedPayment } | { ok: false; ack: AckFailure };

/**
 * Load, fold and VERIFY the payment row against its canonical fold before any
 * decision reads it (directive §10) — a tampered `captured` (the number that
 * drives the discharge) halts here, and no command self-heals.
 */
async function loadPayment(deps: SettlementDeps, paymentId: string): Promise<PaymentLoad> {
  const events = await deps.store.loadStream("payment", paymentId);
  if (events.length === 0) {
    return { ok: false, ack: { ok: false, reason: "unknown_payment" } };
  }
  const replay = replayPayment(events);
  if (!replay.ok) {
    return { ok: false, ack: halted([`payment: ${replay.reason} at seq ${String(replay.atSeq)}`]) };
  }
  const row = await deps.store.loadPayment(paymentId);
  const divergences = diffPayment(replay.projection, row);
  if (divergences.length > 0) {
    return { ok: false, ack: halted(divergences) };
  }
  return { ok: true, loaded: { events, projection: replay.projection } };
}

interface PaymentCommitContext {
  readonly deps: SettlementDeps;
  readonly actor: SettlementActor;
  readonly commandId: string;
  readonly source: string;
  readonly reason?: string;
}

/**
 * Append the decided payment events, rebuild the payment row FROM the fold, and
 * then coordinate the ratified downstream effects for any capture/refund. The
 * payment stream commits in one transaction; coordination is deliberately
 * OUTSIDE it (policies, not distributed transactions — §7), idempotent by
 * derived command id so a crash is repaired by the catch-up scan.
 */
async function commitPayment(
  context: PaymentCommitContext,
  paymentId: string,
  existing: readonly SettlementEventEnvelope[],
  events: readonly NewEvent[],
): Promise<Ack> {
  const { deps, actor, commandId } = context;
  const atMs = deps.now();
  const correlationId = deps.newId();

  const appended = await deps.store.transact(async (tx) => {
    const written: SettlementEventEnvelope[] = [];
    for (const event of events) {
      const seq = await tx.appendEvent({
        orgId: actor.orgId,
        streamType: "payment",
        streamId: paymentId,
        type: event.type,
        atMs,
        actor: actor.personId,
        correlationId,
        commandId,
        payload: event.payload,
      });
      await tx.writeAudit({
        actor: actor.personId,
        action: `settlement.${event.type}`,
        orgId: actor.orgId,
        subject: paymentId,
        source: context.source,
        correlationId,
        eventSeq: seq,
        ...(context.reason !== undefined ? { reason: context.reason } : {}),
      });
      written.push({
        streamType: "payment",
        streamId: paymentId,
        seq,
        type: event.type,
        atMs,
        actor: actor.personId,
        correlationId,
        commandId,
        payload: event.payload,
      });
    }
    const replay = replayPayment([...existing, ...written]);
    if (!replay.ok) {
      throw new Error(`payment_replay_failed:${replay.reason}`);
    }
    await tx.putPayment(projectPayment(replay.projection, actor.orgId));
    return written;
  });

  for (const event of appended) {
    if (paymentHasEffects(event.type)) {
      await coordinateCollections(deps, actor, event);
    }
  }

  const last = appended[appended.length - 1];
  return { ok: true, status: "accepted", caseId: paymentId, seq: last?.seq ?? 0 };
}

/**
 * The Collections Coordinator. For a committed PaymentCaptured / PaymentRefunded,
 * derive its ratified effects (§8.3) and commit them idempotently:
 *
 *   capture → JournalPosted(Collection|Overpaid) → ObligationDischarged
 *   refund  → JournalPosted(Refund, liability-first) → ObligationReinstated
 *
 * The posting id is RESOLVED, not always minted: if the journal effect already
 * landed (crash after posting, before discharge), the coordinator reads the
 * committed posting id and builds the discharge against it — so re-derivation is
 * byte-identical. Amounts are computed from the current durable folds and, once
 * written, never recomputed on replay.
 */
async function coordinateCollections(
  deps: SettlementDeps,
  actor: SettlementActor,
  source: SettlementEventEnvelope,
): Promise<void> {
  const payment = await paymentFold(deps, source.streamId);
  if (payment === null) {
    throw new Error("payment_fold_failed");
  }
  const caseState = await caseFold(deps, payment.caseId);
  if (caseState === null) {
    throw new Error("case_fold_failed");
  }
  const obligation = caseState.projection.obligations[payment.teamId];
  const teamOutstanding = obligation === undefined ? 0 : outstandingOf(obligation);

  const loaded = await loadJournal(deps, actor.orgId);
  if (!loaded.ok) {
    throw new Error("journal_halted");
  }
  const divergences = await verifyJournalTail(deps, actor.orgId, loaded.fold);
  if (divergences.length > 0) {
    throw new Error(`journal_halted:${divergences.join(" · ")}`);
  }
  const remainingLiability = refundLiability(loaded.fold.projection);

  const stream = `payment:${source.streamId}`;
  const postingPolicy = source.type === "PaymentCaptured" ? "collection-posting" : "refund-posting";
  const postingCommandId = collectionCommandId(stream, source.seq, postingPolicy);
  const existingPosting = await deps.store.findByCommandId(
    "journal",
    actor.orgId,
    postingCommandId,
  );
  const postingId =
    existingPosting !== null ? (existingPosting.payload["postingId"] as string) : deps.newId();

  const ctx: CoordinationContext = {
    orgId: actor.orgId,
    caseId: payment.caseId,
    teamId: payment.teamId,
    method: payment.method,
    teamOutstanding,
    remainingLiability,
    postingId,
  };
  const effects = coordinationEffects(source, ctx);

  for (const effect of effects) {
    if (effect.event.streamType === "journal") {
      if (existingPosting === null) {
        await commitJournal(deps, actor, effect.event, effect.commandId, loaded.fold);
      }
    } else {
      const already = await deps.store.findByCommandId("case", payment.caseId, effect.commandId);
      if (already === null) {
        await commitCaseCoordination(deps, actor, payment.caseId, effect.event, effect.commandId);
      }
    }
  }
}

/**
 * The collections catch-up scan (§7/§15) — the payment analog of
 * `runCoordination`: re-derive any downstream effect missing after a crash
 * between the payment commit and its coordination. Idempotent by construction
 * (every effect is skipped if already present); safe to run at any time.
 */
export async function runPaymentCoordination(
  deps: SettlementDeps,
  actor: SettlementActor,
  paymentId: string,
): Promise<number> {
  const events = await deps.store.loadStream("payment", paymentId);
  let repaired = 0;
  for (const event of events) {
    if (!paymentHasEffects(event.type)) {
      continue;
    }
    const stream = `payment:${paymentId}`;
    const postingPolicy =
      event.type === "PaymentCaptured" ? "collection-posting" : "refund-posting";
    const postingCommandId = collectionCommandId(stream, event.seq, postingPolicy);
    const present = await deps.store.findByCommandId("journal", actor.orgId, postingCommandId);
    await coordinateCollections(deps, actor, event);
    if (present === null) {
      repaired += 1;
    }
  }
  return repaired;
}

/** Commit one coordinator-derived case event (discharge/reinstate) and rebuild
 * the case rows. The event carries no case→journal policy, so no pre-flight. */
async function commitCaseCoordination(
  deps: SettlementDeps,
  actor: SettlementActor,
  caseId: string,
  event: NewEvent,
  commandId: string,
): Promise<void> {
  const existing = await deps.store.loadStream("case", caseId);
  const atMs = deps.now();
  const correlationId = deps.newId();
  await deps.store.transact(async (tx) => {
    const seq = await tx.appendEvent({
      orgId: actor.orgId,
      streamType: "case",
      streamId: caseId,
      type: event.type,
      atMs,
      actor: actor.personId,
      correlationId,
      commandId,
      payload: event.payload,
    });
    await tx.writeAudit({
      actor: actor.personId,
      action: `settlement.${event.type}`,
      orgId: actor.orgId,
      subject: caseId,
      source: "policy",
      correlationId,
      eventSeq: seq,
    });
    const replay = replayCase([
      ...existing,
      {
        streamType: "case",
        streamId: caseId,
        seq,
        type: event.type,
        atMs,
        actor: actor.personId,
        correlationId,
        commandId,
        payload: event.payload,
      },
    ]);
    if (!replay.ok) {
      throw new Error(`case_replay_failed:${replay.reason}`);
    }
    const projected = projectCase(replay.projection, actor.orgId);
    await tx.putCase(projected.caseRow);
    await tx.putObligations(caseId, projected.obligationRows);
  });
}

// --- Payment commands (the M-IP5-2 lifecycle) ----------------------------------------

export interface CreatePaymentCommand {
  readonly paymentId: string;
  readonly commandId: string;
  readonly caseId: string;
  readonly teamId: string;
  readonly method: PaymentMethod;
  readonly amount: number;
}

/**
 * CreatePayment / GatewayPaymentInitiated / ManualPaymentReceived — the payment's
 * birth. The client mints `paymentId` at the edge; (paymentId, commandId) is the
 * idempotency anchor. For a gateway method a provider order is created FIRST (so
 * the trusted-envelope anchor exists), but only on the first execution — a
 * duplicate returns the original ack and creates no second order.
 */
export async function createPayment(
  deps: SettlementDeps,
  actor: SettlementActor,
  command: CreatePaymentCommand,
): Promise<Ack> {
  if (!authorized(actor, "settlement.collect")) {
    return { ok: false, reason: "not_authorized" };
  }
  const duplicate = await deps.store.findByCommandId(
    "payment",
    command.paymentId,
    command.commandId,
  );
  if (duplicate !== null) {
    return { ok: true, status: "duplicate", caseId: command.paymentId, seq: duplicate.seq };
  }
  const caseRow = await deps.store.loadCase(command.caseId);
  if (caseRow === null || caseRow.orgId !== actor.orgId) {
    return { ok: false, reason: "unknown_case" };
  }
  const caseState = await caseFold(deps, command.caseId);
  if (caseState === null) {
    return { ok: false, reason: "unknown_case" };
  }
  const obligation = caseState.projection.obligations[command.teamId];
  const teamOutstanding = obligation === undefined ? 0 : outstandingOf(obligation);

  let orderRef: string | undefined;
  if (!isManualMethod(command.method)) {
    const gateway = deps.gateway(command.method);
    if (gateway === null) {
      return { ok: false, reason: "no_gateway" };
    }
    /*
     * SPLIT SETTLEMENT, OR NO ORDER AT ALL (founder decision 2026-08-26).
     *
     * The platform holds one set of gateway credentials, so an order with no
     * destination collects the organizer's dues into the PLATFORM's account —
     * money held on behalf of a third party, which is a different regulated
     * business and contradicts the Terms ("we do not handle your money for
     * you"). Refusing here is what keeps that from becoming true by accident
     * the day somebody sets RAZORPAY_KEY_ID: the keys are no longer sufficient
     * on their own, the organizer also has to have their own account.
     *
     * Manual methods never reach this branch — nothing passes through the
     * platform for cash, UPI or a bank transfer.
     */
    const settlementAccountRef = await deps.settlementAccount(actor.orgId);
    if (settlementAccountRef === null) {
      return { ok: false, reason: "no_settlement_account" };
    }
    const order = await gateway.createOrder({
      paymentId: command.paymentId,
      orgId: actor.orgId,
      amount: command.amount,
      receipt: command.paymentId,
      settlementAccountRef,
    });
    orderRef = order.orderRef;
  }

  const decision = decideInitiatePayment({
    paymentId: command.paymentId,
    caseId: command.caseId,
    teamId: command.teamId,
    method: command.method,
    amount: command.amount,
    ...(orderRef !== undefined ? { orderRef } : {}),
    caseStatus: caseState.projection.status,
    teamOutstanding,
  });
  if (!decision.ok) {
    return { ok: false, reason: decision.reason };
  }
  return commitPayment(
    { deps, actor, commandId: command.commandId, source: "web" },
    command.paymentId,
    [],
    decision.events,
  );
}

/** The one shape every subsequent payment mutation flows through. */
async function paymentCommand(
  deps: SettlementDeps,
  actor: SettlementActor,
  paymentId: string,
  commandId: string,
  capability: SettlementCapability | null,
  source: string,
  decide: (projection: PaymentProjection) => Decision,
  reason?: string,
): Promise<Ack> {
  if (capability !== null && !authorized(actor, capability)) {
    return { ok: false, reason: "not_authorized" };
  }
  const duplicate = await deps.store.findByCommandId("payment", paymentId, commandId);
  if (duplicate !== null) {
    return { ok: true, status: "duplicate", caseId: paymentId, seq: duplicate.seq };
  }
  const loaded = await loadPayment(deps, paymentId);
  if (!loaded.ok) {
    return loaded.ack;
  }
  const decision = decide(loaded.loaded.projection);
  if (!decision.ok) {
    return { ok: false, reason: decision.reason };
  }
  return commitPayment(
    { deps, actor, commandId, source, ...(reason !== undefined ? { reason } : {}) },
    paymentId,
    loaded.loaded.events,
    decision.events,
  );
}

/** ManualPaymentReceived → capture: a capability-gated human attestation. */
export async function attestManualCapture(
  deps: SettlementDeps,
  actor: SettlementActor,
  paymentId: string,
  commandId: string,
  input: { attestedBy: string; evidenceRef?: string },
): Promise<Ack> {
  return paymentCommand(
    deps,
    actor,
    paymentId,
    commandId,
    "settlement.collect",
    "web",
    (projection) => decideAttestCapture(projection, input),
  );
}

/** A manual payment reversal — override-gated (it reverses collected money). */
export async function refundManualPayment(
  deps: SettlementDeps,
  actor: SettlementActor,
  paymentId: string,
  commandId: string,
  input: { amount: number; reason: string },
): Promise<Ack> {
  return paymentCommand(
    deps,
    actor,
    paymentId,
    commandId,
    "settlement.override",
    "web",
    (projection) => decideManualRefund(projection, input),
    input.reason,
  );
}

/** PaymentExpired → the sweep fails an uncaptured payment (system actor). */
export async function expirePayment(
  deps: SettlementDeps,
  systemActor: SettlementActor,
  paymentId: string,
  commandId: string,
): Promise<Ack> {
  return paymentCommand(deps, systemActor, paymentId, commandId, null, "sweep", (projection) =>
    decideExpirePayment(projection),
  );
}

/**
 * WebhookReceived — the provider-truth ingress command. Called by the trusted
 * webhook path (webhook.ts) AFTER signature/window/envelope verification and
 * AFTER tenant context + pin verification. No capability check: the webhook is
 * authenticated by HMAC, not by session (§19); the actor is the system.
 */
export async function ingestWebhookEvent(
  deps: SettlementDeps,
  orgId: string,
  paymentId: string,
  facts: WebhookFacts,
): Promise<Ack> {
  const systemActor: SettlementActor = { personId: SYSTEM_ACTOR, orgId, grants: [] };
  const commandId = `webhook:${facts.providerEventId}`;
  return paymentCommand(
    deps,
    systemActor,
    paymentId,
    commandId,
    null,
    "webhook:razorpay",
    (projection) => decideWebhookEvent(projection, facts),
  );
}

export { canonicalJournalBytes, CHECKPOINT_CADENCE, commitJournal, loadJournal, verifyJournalTail };
