/**
 * The command handlers (IP-5_ARCHITECTURE §7/§11) — pure decisions, nothing else.
 *
 * A handler takes the current fold and an input, and returns EVENTS. It never
 * writes a projection, never reads a clock, never mints an id: the Settlement
 * Writer (the single mutation authority) supplies ids and time at the edge and
 * commits what these functions decide. Every rejection is a deterministic
 * reason code — the same input always earns the same answer.
 *
 * Coordination between aggregates is by deterministic policy, never by a
 * distributed transaction: a case event's consequence in the journal is derived
 * from the event itself, keyed by a DERIVED command id, so re-running
 * coordination after a crash is idempotent by construction (§7).
 */

import { deductPaise, paise } from "@desiauction/core";

import {
  caseCommandAllowed,
  outstandingOf,
  type CaseProjection,
  type ObligationBasis,
} from "./case";
import type { Decision, NewEvent, SettlementEventEnvelope } from "./events";
import type { IntakePin, ObligationItem, VerifyOutcome } from "./intake";
import { buildObligationPosting, buildWaiverPosting } from "./journal";

/** The closed set of command rejections. Deterministic, never an exception. */
export type RejectionReason =
  | "illegal_transition"
  | "case_exists"
  | "auction_not_final"
  | "unknown_case"
  | "unknown_team"
  | "invalid_amount"
  | "amount_exceeds_outstanding"
  | "obligations_outstanding"
  | "case_has_postings"
  | "receipts_missing"
  | "not_authorized"
  | "settlement_halted";

function reject(reason: RejectionReason): Decision {
  return { ok: false, reason };
}

function caseEvent(caseId: string, type: string, payload: Record<string, unknown>): NewEvent {
  return { streamType: "case", streamId: caseId, type, payload };
}

// --- Case lifecycle ----------------------------------------------------------------

export interface OpenCaseInput {
  readonly caseId: string;
  readonly auctionId: string;
  readonly competitionId: string;
  /** The frozen auction's status — settlement opens on a finished night only. */
  readonly auctionStatus: string;
  readonly basis: ObligationBasis;
  readonly fixed: Readonly<Record<string, number>>;
  readonly pin: IntakePin;
  /** True when a non-voided case already exists for this auction (one per auction). */
  readonly caseExists: boolean;
}

export function decideOpenCase(input: OpenCaseInput): Decision {
  if (input.auctionStatus !== "completed" && input.auctionStatus !== "abandoned") {
    return reject("auction_not_final");
  }
  if (input.caseExists) {
    return reject("case_exists");
  }
  for (const amount of Object.values(input.fixed)) {
    if (!Number.isSafeInteger(amount) || amount < 0) {
      return reject("invalid_amount");
    }
  }
  return {
    ok: true,
    events: [
      caseEvent(input.caseId, "CaseOpened", {
        caseId: input.caseId,
        auctionId: input.auctionId,
        competitionId: input.competitionId,
        basis: input.basis,
        // The declared policy is pinned WITH the case: the platform never
        // invents a debt, and can never quietly change the rule it invented one by.
        ...(input.basis === "fixed" ? { fixed: input.fixed } : {}),
        sourceEventCount: input.pin.sourceEventCount,
        sourceDigest: input.pin.sourceDigest,
      }),
    ],
  };
}

/**
 * Verification. The outcome is chosen by the intake fold, never by the caller:
 * a matching source verifies (and RE-PINS — §11), a mismatching one freezes the
 * case's money until a human with override authority resolves it.
 */
export function decideVerifyCase(projection: CaseProjection, outcome: VerifyOutcome): Decision {
  if (!caseCommandAllowed(projection.status, "verify")) {
    return reject("illegal_transition");
  }
  if (!outcome.ok) {
    return {
      ok: true,
      events: [
        caseEvent(projection.caseId, "CaseDiscrepant", {
          reasonCode: outcome.reasonCode,
          detail: outcome.detail,
        }),
      ],
    };
  }
  return {
    ok: true,
    events: [
      caseEvent(projection.caseId, "CaseVerified", {
        foldDigest: outcome.source.foldDigest,
        sourceEventCount: outcome.source.pin.sourceEventCount,
        sourceDigest: outcome.source.pin.sourceDigest,
        teamCount: outcome.source.teamCount,
        totalCommitted: outcome.source.totalCommitted,
      }),
    ],
  };
}

export function decideComputeObligations(
  projection: CaseProjection,
  items: readonly ObligationItem[],
): Decision {
  if (!caseCommandAllowed(projection.status, "compute")) {
    return reject("illegal_transition");
  }
  for (const item of items) {
    if (!Number.isSafeInteger(item.amount) || item.amount <= 0) {
      return reject("invalid_amount");
    }
  }
  return {
    ok: true,
    events: [
      caseEvent(projection.caseId, "ObligationsComputed", {
        items: items.map((item) => ({ teamId: item.teamId, amount: item.amount })),
      }),
    ],
  };
}

export interface WaiveInput {
  readonly teamId: string;
  readonly amount: number;
  readonly reason: string;
}

/** Forgiveness is override-gated, bounded by what is owed, and always visible. */
export function decideWaive(projection: CaseProjection, input: WaiveInput): Decision {
  if (projection.status !== "settling") {
    return reject("illegal_transition");
  }
  const obligation = projection.obligations[input.teamId];
  if (obligation === undefined) {
    return reject("unknown_team");
  }
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) {
    return reject("invalid_amount");
  }
  if (input.reason === "") {
    return reject("invalid_amount");
  }
  if (!deductPaise(outstandingOf(obligation), paise(input.amount)).ok) {
    return reject("amount_exceeds_outstanding");
  }
  return {
    ok: true,
    events: [
      caseEvent(projection.caseId, "ObligationWaived", {
        teamId: input.teamId,
        amount: input.amount,
        reason: input.reason,
      }),
    ],
  };
}

export interface AdjustInput {
  readonly teamId: string;
  readonly kind: "increase" | "reduce";
  readonly amount: number;
  readonly reason: string;
}

export function decideAdjust(projection: CaseProjection, input: AdjustInput): Decision {
  if (projection.status !== "settling") {
    return reject("illegal_transition");
  }
  const obligation = projection.obligations[input.teamId];
  if (obligation === undefined) {
    return reject("unknown_team");
  }
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0 || input.reason === "") {
    return reject("invalid_amount");
  }
  if (input.kind === "reduce" && !deductPaise(outstandingOf(obligation), paise(input.amount)).ok) {
    return reject("amount_exceeds_outstanding");
  }
  return {
    ok: true,
    events: [
      caseEvent(projection.caseId, "ObligationAdjusted", {
        teamId: input.teamId,
        kind: input.kind,
        amount: input.amount,
        reason: input.reason,
      }),
    ],
  };
}

export function decideSettle(projection: CaseProjection): Decision {
  if (!caseCommandAllowed(projection.status, "settle")) {
    return reject("illegal_transition");
  }
  const outstanding = Object.values(projection.obligations).some(
    (obligation) => outstandingOf(obligation) > 0,
  );
  if (outstanding) {
    return reject("obligations_outstanding");
  }
  return { ok: true, events: [caseEvent(projection.caseId, "CaseSettled", {})] };
}

export interface CloseInput {
  readonly publishedDigest: string;
  /** Teams whose collected money already carries a receipt (M-IP5-3 issues them). */
  readonly receiptedTeams: readonly string[];
}

/**
 * Closure — the terminal state that surfaces render as **Reconciled**. Every
 * team whose money was actually COLLECTED must hold a receipt before the case
 * can close; waived dues carry no receipt because no money moved.
 */
export function decideClose(projection: CaseProjection, input: CloseInput): Decision {
  if (!caseCommandAllowed(projection.status, "close")) {
    return reject("illegal_transition");
  }
  const receipted = new Set(input.receiptedTeams);
  const missing = Object.values(projection.obligations).some(
    (obligation) => obligation.discharged > 0 && !receipted.has(obligation.teamId),
  );
  if (missing) {
    return reject("receipts_missing");
  }
  return {
    ok: true,
    events: [
      caseEvent(projection.caseId, "CaseClosed", {
        publishedDigest: input.publishedDigest,
        receiptRefs: [...receipted].sort(),
      }),
    ],
  };
}

export interface ReopenInput {
  readonly reason: string;
}

/** Reopening is compensating, never a back edge: the closed history stays. */
export function decideReopen(projection: CaseProjection, input: ReopenInput): Decision {
  if (!caseCommandAllowed(projection.status, "reopen")) {
    return reject("illegal_transition");
  }
  if (input.reason === "") {
    return reject("invalid_amount");
  }
  return {
    ok: true,
    events: [
      caseEvent(projection.caseId, "CaseReopened", {
        reason: input.reason,
        compensates: projection.lastSeq,
      }),
    ],
  };
}

export interface VoidInput {
  readonly reason: string;
  /** Journal postings that reference this case. A case that moved money never voids. */
  readonly postingCount: number;
}

export function decideVoid(projection: CaseProjection, input: VoidInput): Decision {
  if (!caseCommandAllowed(projection.status, "void")) {
    return reject("illegal_transition");
  }
  if (input.reason === "") {
    return reject("invalid_amount");
  }
  if (input.postingCount > 0) {
    return reject("case_has_postings");
  }
  return {
    ok: true,
    events: [caseEvent(projection.caseId, "CaseVoided", { reason: input.reason })],
  };
}

// --- Policies (deterministic coordination, source-keyed) ----------------------------

export type PolicyName = "obligation-posting" | "waiver-posting";

/** Which case events have a consequence in the journal — and which do not. */
export function policyFor(eventType: string): PolicyName | null {
  if (eventType === "ObligationsComputed") {
    return "obligation-posting";
  }
  if (eventType === "ObligationWaived") {
    return "waiver-posting";
  }
  return null;
}

/**
 * The derived command id. Keyed by the SOURCE event, so a coordinator that
 * crashes and re-derives produces the same id — and the journal's unique
 * (stream, command id) turns the second attempt into the original ack instead
 * of a second posting.
 */
export function derivedCommandId(
  sourceStream: string,
  sourceSeq: number,
  policy: PolicyName,
): string {
  return `${sourceStream}:${String(sourceSeq)}:${policy}`;
}

export function sourceStreamId(event: SettlementEventEnvelope): string {
  return `${event.streamType}:${event.streamId}`;
}

export interface PolicyInput {
  /** The org's journal stream id. */
  readonly orgId: string;
  /** Minted by the writer at the edge and recorded in the payload — replay never re-mints. */
  readonly postingId: string;
  readonly caseId: string;
}

export type PolicyResult =
  { ok: true; event: NewEvent; commandId: string } | { ok: false; reason: string };

/**
 * Build the journal consequence of a case event. ONE cause → ONE posting
 * (§9.4): an ObligationsComputed carrying N teams becomes a single balanced
 * posting with N dues debits and one control credit — never N postings sharing
 * a source, which is exactly what `duplicate_posting_source` forbids.
 */
export function buildPolicyEvent(
  source: SettlementEventEnvelope,
  input: PolicyInput,
): PolicyResult {
  const policy = policyFor(source.type);
  if (policy === null) {
    return { ok: false, reason: "no_policy" };
  }
  const stream = sourceStreamId(source);
  const commandId = derivedCommandId(stream, source.seq, policy);
  const sourceRef = { stream, seq: source.seq };

  if (policy === "obligation-posting") {
    const raw = source.payload["items"];
    if (!Array.isArray(raw)) {
      return { ok: false, reason: "malformed_source" };
    }
    const items: ObligationItem[] = [];
    for (const entry of raw) {
      if (
        typeof entry !== "object" ||
        entry === null ||
        typeof (entry as Record<string, unknown>)["teamId"] !== "string" ||
        typeof (entry as Record<string, unknown>)["amount"] !== "number"
      ) {
        return { ok: false, reason: "malformed_source" };
      }
      const record = entry as Record<string, unknown>;
      items.push({ teamId: record["teamId"] as string, amount: record["amount"] as number });
    }
    if (items.length === 0) {
      // A basis of `none` (or a night where nobody bought anyone) recognises no
      // dues — and therefore posts nothing. Silence is the correct entry.
      return { ok: false, reason: "no_effect" };
    }
    const posting = buildObligationPosting(input.caseId, items);
    return {
      ok: true,
      commandId,
      event: {
        streamType: "journal",
        streamId: input.orgId,
        type: "JournalPosted",
        payload: {
          postingId: input.postingId,
          template: posting.template,
          legs: posting.legs.map((leg) => ({ ...leg })),
          source: sourceRef,
          memo: `Obligations recognised · case ${input.caseId}`,
        },
      },
    };
  }

  // waiver-posting
  const teamId = source.payload["teamId"];
  const amount = source.payload["amount"];
  if (typeof teamId !== "string" || typeof amount !== "number") {
    return { ok: false, reason: "malformed_source" };
  }
  const posting = buildWaiverPosting(input.caseId, teamId, amount);
  return {
    ok: true,
    commandId,
    event: {
      streamType: "journal",
      streamId: input.orgId,
      type: "JournalPosted",
      payload: {
        postingId: input.postingId,
        template: posting.template,
        legs: posting.legs.map((leg) => ({ ...leg })),
        source: sourceRef,
        memo: `Waiver · case ${input.caseId} · team ${teamId}`,
      },
    },
  };
}
