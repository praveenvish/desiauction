/**
 * Closure & Ceremony (IP-5_ARCHITECTURE §11, M-IP5-3) — the pure financial
 * verification engine, the immutable evidence package, the close decider, and
 * the read-only ceremony projections.
 *
 * Closure adds NO event type: the directive's workflow (CaseReadyForClosure,
 * CaseVerified, DiscrepancyDetected, OverrideApproved) maps onto the CLOSED
 * catalog exactly as M-IP5-2's payment vocabulary did —
 *
 *   CaseReadyForClosure → the `settled` state (CaseSettled, existing)
 *   financial CaseVerified → the verification GUARD + evidence in CaseClosed
 *   DiscrepancyDetected → a deterministic close REJECTION (money quiesces; the
 *                         case stays settled) surfaced as ceremony evidence
 *   OverrideApproved → the `settlement.override` capability + reason on reopen
 *   CaseClosed → CaseClosed (payload carries the evidence package)
 *   CaseReopened → CaseReopened (override), existing
 *
 * Nothing after closure may alter financial truth, and every proof is
 * reproducible: re-fold the same prefixes, re-run verifyClosure → identical
 * evidence.
 */

import { addPaise, canonicalJson, paise, type Paise } from "@desiauction/core";

import {
  outstandingOf,
  totalObligations,
  type CaseProjection,
  type ObligationProjection,
} from "./case";
import type { Decision, NewEvent, SettlementEventEnvelope } from "./events";
import {
  duesAccount,
  refundLiability,
  statementOf,
  trialBalance,
  walletOf,
  type JournalProjection,
  type PostingRecord,
} from "./journal";
import type { DigestFn } from "./ports";

// --- The financial verification engine (§2) ------------------------------------------

export type ClosureCheckName =
  | "case_settled"
  | "no_outstanding"
  | "trial_balance_zero"
  | "dues_cleared"
  | "no_refund_liability"
  | "obligations_match_source"
  | "collections_reconcile";

export interface ClosureCheck {
  readonly name: ClosureCheckName;
  readonly pass: boolean;
  readonly detail: string;
}

/**
 * The immutable evidence package (§7). Every field is reproducible by replay:
 * fold the case up to `caseEventCount` and the journal up to `journalSeq`, then
 * re-run verifyClosure — the digests reproduce exactly.
 */
export interface ClosureEvidence {
  readonly caseEventCount: number;
  readonly journalSeq: number;
  readonly verificationDigest: string;
  readonly projectionDigest: string;
  readonly journalDigest: string;
  readonly walletDigest: string;
  readonly paymentDigest: string;
  readonly trialBalanceDigest: string;
}

export interface ClosureVerification {
  readonly ok: boolean;
  readonly checks: readonly ClosureCheck[];
  readonly evidence: ClosureEvidence;
}

export interface ClosureInput {
  readonly caseProjection: CaseProjection;
  /** The org journal fold AS OF closure (prefix up to `journalSeq`). */
  readonly journal: JournalProjection;
  readonly journalSeq: number;
  /** The case's event count BEFORE the CaseClosed event (the settled prefix). */
  readonly caseEventCount: number;
  /** Obligations recomputed from the FROZEN auction fold under the pinned basis
   * — the "auction totals" check (§2), reproducible via intake. */
  readonly recomputedObligations: Readonly<Record<string, number>>;
}

function money(value: Paise): number {
  return value;
}

/**
 * Verify a case is fit to close, deterministically, and build the evidence.
 * Pure: the same inputs always produce the same checks AND the same digests.
 */
export function verifyClosure(input: ClosureInput, digest: DigestFn): ClosureVerification {
  const { caseProjection, journal, recomputedObligations } = input;
  const checks: ClosureCheck[] = [];

  // 1 · the case must be settled (ready for closure).
  checks.push({
    name: "case_settled",
    pass: caseProjection.status === "settled",
    detail: `status=${caseProjection.status}`,
  });

  // 2 · no team may still owe money.
  const outstanding = Object.values(caseProjection.obligations).reduce<Paise>(
    (sum, obligation) => addPaise(sum, outstandingOf(obligation)),
    paise(0),
  );
  checks.push({
    name: "no_outstanding",
    pass: outstanding === 0,
    detail: `outstanding=${String(money(outstanding))}`,
  });

  // 3 · the org's books balance (trial balance zero).
  const balance = trialBalance(journal);
  checks.push({
    name: "trial_balance_zero",
    pass: balance.balanced,
    detail: `debits=${String(balance.debits)} credits=${String(balance.credits)}`,
  });

  // 4 · every dues wallet for THIS case reads zero (journal agrees with the case).
  let duesCleared = true;
  for (const teamId of Object.keys(caseProjection.obligations)) {
    const wallet = walletOf(journal, duesAccount(caseProjection.caseId, teamId));
    if ((wallet?.balance ?? 0) !== 0) {
      duesCleared = false;
    }
  }
  checks.push({ name: "dues_cleared", pass: duesCleared, detail: "" });

  // 5 · nothing is owed back — over-collection must be refunded before closure.
  const liability = refundLiability(journal);
  checks.push({
    name: "no_refund_liability",
    pass: liability === 0,
    detail: `refundLiability=${String(liability)}`,
  });

  // 6 · the obligations still match the frozen auction totals under the pinned basis.
  const recomputedTeams = Object.keys(recomputedObligations).sort();
  const caseTeams = Object.keys(caseProjection.obligations).sort();
  let obligationsMatch = canonicalJson(recomputedTeams) === canonicalJson(caseTeams);
  for (const teamId of caseTeams) {
    const obligation = caseProjection.obligations[teamId];
    if (obligation !== undefined && obligation.amount !== recomputedObligations[teamId]) {
      obligationsMatch = false;
    }
  }
  checks.push({ name: "obligations_match_source", pass: obligationsMatch, detail: "" });

  // 7 · collections reconcile: for each team, collected + waived + reduced ==
  //     original + increased + reinstated (i.e. the obligation nets to zero by
  //     legitimate movements, not by a lost rupee).
  let collectionsReconcile = true;
  for (const obligation of Object.values(caseProjection.obligations)) {
    const owed = addPaise(
      addPaise(paise(obligation.amount), paise(obligation.increased)),
      paise(obligation.reinstated),
    );
    const settledSide = addPaise(
      addPaise(paise(obligation.discharged), paise(obligation.waived)),
      paise(obligation.reduced),
    );
    if (owed !== settledSide) {
      collectionsReconcile = false;
    }
  }
  checks.push({ name: "collections_reconcile", pass: collectionsReconcile, detail: "" });

  const evidence = buildEvidence(input, checks, digest);
  return { ok: checks.every((check) => check.pass), checks, evidence };
}

function buildEvidence(
  input: ClosureInput,
  checks: readonly ClosureCheck[],
  digest: DigestFn,
): ClosureEvidence {
  const { caseProjection, journal } = input;
  // Case-scoped financial view — stable regardless of other cases in the org.
  const financial = caseFinancial(caseProjection);
  // The case's payment-sourced postings, in journal order.
  const paymentPostings = casePaymentPostings(journal, caseProjection.caseId);
  return {
    caseEventCount: input.caseEventCount,
    journalSeq: input.journalSeq,
    verificationDigest: digest(canonicalJson(checks)),
    projectionDigest: digest(canonicalJson(closureProjectionView(caseProjection))),
    journalDigest: digest(canonicalJson(journalView(journal))),
    walletDigest: digest(canonicalJson(financial)),
    paymentDigest: digest(canonicalJson(paymentPostings)),
    trialBalanceDigest: digest(canonicalJson(trialBalance(journal))),
  };
}

/** The projection fields that constitute closure truth (excludes volatile counters). */
function closureProjectionView(projection: CaseProjection): unknown {
  return {
    caseId: projection.caseId,
    auctionId: projection.auctionId,
    basis: projection.basis,
    status: projection.status,
    sourceDigest: projection.sourceDigest,
    foldDigest: projection.foldDigest,
    obligations: sortedObligations(projection),
  };
}

function sortedObligations(projection: CaseProjection): unknown {
  return Object.keys(projection.obligations)
    .sort()
    .map((teamId) => projection.obligations[teamId]);
}

/** The org journal's canonical accounts view — reproducible from the prefix. */
function journalView(journal: JournalProjection): unknown {
  return {
    accounts: journal.accounts,
    postingCount: Object.keys(journal.postings).length,
    lastSeq: journal.lastSeq,
  };
}

function casePaymentPostings(journal: JournalProjection, caseId: string): unknown {
  return Object.values(journal.postings)
    .filter((posting) => posting.caseId === caseId && posting.sourceStream.startsWith("payment:"))
    .sort((a, b) => a.eventSeq - b.eventSeq)
    .map((posting) => ({
      template: posting.template,
      eventSeq: posting.eventSeq,
      sourceStream: posting.sourceStream,
      sourceSeq: posting.sourceSeq,
      legs: posting.legs,
    }));
}

// --- The close decider ---------------------------------------------------------------

function caseEvent(caseId: string, type: string, payload: Record<string, unknown>): NewEvent {
  return { streamType: "case", streamId: caseId, type, payload };
}

/**
 * Close a verified case, embedding the evidence (§7). Closure is BLOCKED — a
 * deterministic rejection, no event, money quiescent — when verification fails
 * (imbalance, refund liability, mismatch). Nothing bypasses verification.
 */
export function decideCloseCase(
  projection: CaseProjection,
  verification: ClosureVerification,
): Decision {
  if (projection.status !== "settled") {
    return { ok: false, reason: "illegal_transition" };
  }
  if (!verification.ok) {
    const failed = verification.checks.find((check) => !check.pass);
    return { ok: false, reason: `verification_failed:${failed?.name ?? "unknown"}` };
  }
  return {
    ok: true,
    events: [
      caseEvent(projection.caseId, "CaseClosed", {
        publishedDigest: verification.evidence.verificationDigest,
        evidence: { ...verification.evidence },
      }),
    ],
  };
}

// --- Read-only ceremony projections (§4) ---------------------------------------------

export interface CaseFinancial {
  readonly totalObligations: number;
  readonly discharged: number;
  readonly waived: number;
  readonly reinstated: number;
  readonly reduced: number;
  readonly outstanding: number;
}

/** Case-scoped money, folded from the case obligations (never a stored balance). */
export function caseFinancial(projection: CaseProjection): CaseFinancial {
  const zero = paise(0);
  let discharged = zero;
  let waived = zero;
  let reinstated = zero;
  let reduced = zero;
  let outstanding = zero;
  for (const obligation of Object.values(projection.obligations)) {
    discharged = addPaise(discharged, paise(obligation.discharged));
    waived = addPaise(waived, paise(obligation.waived));
    reinstated = addPaise(reinstated, paise(obligation.reinstated));
    reduced = addPaise(reduced, paise(obligation.reduced));
    outstanding = addPaise(outstanding, outstandingOf(obligation));
  }
  return {
    totalObligations: totalObligations(projection),
    discharged,
    waived,
    reinstated,
    reduced,
    outstanding,
  };
}

export interface ClosureSummary {
  readonly caseId: string;
  readonly auctionId: string;
  readonly competitionId: string;
  readonly status: string;
  readonly basis: string;
  readonly closedAtSeq: number | null;
  readonly closures: number;
  readonly reopenings: number;
  readonly recoveries: number;
}

export function closureSummary(projection: CaseProjection): ClosureSummary {
  return {
    caseId: projection.caseId,
    auctionId: projection.auctionId,
    competitionId: projection.competitionId,
    status: projection.status,
    basis: projection.basis,
    closedAtSeq: projection.closedAtSeq,
    closures: projection.closures,
    reopenings: projection.reopenings,
    recoveries: projection.recoveries,
  };
}

export interface TeamCollection {
  readonly teamId: string;
  readonly obligation: number;
  readonly discharged: number;
  readonly waived: number;
  readonly reinstated: number;
  readonly outstanding: number;
}

/** Per-team collection detail — the collection summary ceremony projection. */
export function collectionSummary(projection: CaseProjection): readonly TeamCollection[] {
  return Object.keys(projection.obligations)
    .sort()
    .map((teamId) => {
      const obligation = projection.obligations[teamId] as ObligationProjection;
      return {
        teamId,
        obligation: obligation.amount,
        discharged: obligation.discharged,
        waived: obligation.waived,
        reinstated: obligation.reinstated,
        outstanding: outstandingOf(obligation),
      };
    });
}

export interface JournalSummaryLine {
  readonly account: string;
  readonly debit: number;
  readonly credit: number;
}

/** The case's journal footprint: the accounts it touched and their movement. */
export function journalSummary(
  journal: JournalProjection,
  caseId: string,
): readonly JournalSummaryLine[] {
  const accounts = new Set<string>();
  for (const posting of Object.values(journal.postings)) {
    if (posting.caseId === caseId) {
      for (const leg of posting.legs) {
        accounts.add(leg.account);
      }
    }
  }
  return [...accounts].sort().map((account) => {
    const lines = statementOf(journal, account).filter((line) => {
      const posting = journal.postings[line.postingId];
      return posting?.caseId === caseId;
    });
    const debit = lines
      .filter((line) => line.direction === "debit")
      .reduce((sum, line) => sum + line.amount, 0);
    const credit = lines
      .filter((line) => line.direction === "credit")
      .reduce((sum, line) => sum + line.amount, 0);
    return { account, debit, credit };
  });
}

export interface TimelineRow {
  readonly seq: number;
  readonly atMs: number;
  readonly type: string;
  readonly actor: string;
  readonly correlationId: string;
  readonly summary: string;
}

/**
 * The closure timeline — a pure fold of the case stream into human rows, the
 * AuctionLedger pattern (never a table; regenerated on read; unknown types
 * render as themselves so nothing is ever hidden).
 */
export function closureTimeline(
  events: readonly SettlementEventEnvelope[],
): readonly TimelineRow[] {
  return events.map((event) => ({
    seq: event.seq,
    atMs: event.atMs,
    type: event.type,
    actor: event.actor,
    correlationId: event.correlationId,
    summary: timelineSummary(event),
  }));
}

function timelineSummary(event: SettlementEventEnvelope): string {
  const payload = event.payload;
  switch (event.type) {
    case "CaseOpened":
      return `Case opened · basis ${String(payload["basis"])}`;
    case "CaseVerified":
      return "Source verified against the pinned auction log";
    case "CaseDiscrepant":
      return `Discrepancy: ${String(payload["reasonCode"])}`;
    case "ObligationsComputed":
      return "Obligations computed";
    case "ObligationDischarged":
      return `Discharged ${String(payload["amount"])} (team ${String(payload["teamId"])})`;
    case "ObligationWaived":
      return `Waived ${String(payload["amount"])} (team ${String(payload["teamId"])})`;
    case "ObligationReinstated":
      return `Reinstated ${String(payload["amount"])} (team ${String(payload["teamId"])})`;
    case "CaseSettled":
      return "Case settled — ready for closure";
    case "CaseClosed":
      return "Case CLOSED — evidence sealed";
    case "CaseReopened":
      return `Case reopened (override): ${String(payload["reason"])}`;
    case "CaseRecovered":
      return "Case recovered from the log";
    default:
      return event.type;
  }
}

// --- The auction overlay (§5) --------------------------------------------------------

export interface ReconciledOverlay {
  readonly auctionId: string;
  readonly reconciled: boolean;
  readonly caseId: string;
  readonly closedAtSeq: number | null;
  readonly verificationDigest: string | null;
}

/**
 * The Reconciled overlay: closure PROJECTED onto the auction. The auction's own
 * status and event catalog are never touched (§5) — "reconciled" is derived
 * purely from the settlement case's closed state.
 */
export function reconciledOverlay(projection: CaseProjection): ReconciledOverlay {
  const evidence = projection.closureEvidence;
  return {
    auctionId: projection.auctionId,
    reconciled: projection.status === "closed",
    caseId: projection.caseId,
    closedAtSeq: projection.closedAtSeq,
    verificationDigest:
      evidence !== null && typeof evidence["verificationDigest"] === "string"
        ? evidence["verificationDigest"]
        : null,
  };
}

/** Postings for a case, exposed for the ceremony's journal detail. */
export function casePostings(journal: JournalProjection, caseId: string): readonly PostingRecord[] {
  return Object.values(journal.postings)
    .filter((posting) => posting.caseId === caseId)
    .sort((a, b) => a.eventSeq - b.eventSeq);
}
