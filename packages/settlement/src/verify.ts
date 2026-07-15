/**
 * Verification and healing (IP-5_ARCHITECTURE §13/§15) — pure.
 *
 * The IP-4 certification lesson, adopted as a birthright rather than a defect
 * fix: **every row the writer reads to decide is verified against the log
 * before it decides.** A row that disagrees with the events halts the aggregate
 * fail-closed; recovery then rebuilds the row FROM the events, because
 * projections are disposable and the log is the only truth.
 *
 * These functions do both jobs from one definition — `projectX` says what the
 * rows MUST be, `diffX` says how the rows differ from that. Recovery cannot
 * drift from verification, because they are the same statement.
 */

import { canonicalJson } from "@desiauction/core";

import { outstandingOf, type CaseProjection } from "./case";
import type { JournalProjection } from "./journal";
import type { PaymentProjection } from "./payment";
import type { CaseRow, LegRow, ObligationRow, PaymentRow, PostingRow } from "./ports";

// --- SettlementCase ------------------------------------------------------------------

/** The case rows the event log demands. */
export function projectCase(
  projection: CaseProjection,
  orgId: string,
): { readonly caseRow: CaseRow; readonly obligationRows: readonly ObligationRow[] } {
  const caseRow: CaseRow = {
    caseId: projection.caseId,
    orgId,
    createdBy: projection.openedBy,
    auctionId: projection.auctionId,
    competitionId: projection.competitionId,
    status: projection.status,
    basis: projection.basis,
    sourceEventCount: projection.sourceEventCount,
    sourceDigest: projection.sourceDigest,
    foldDigest: projection.foldDigest,
    closureEvidence: projection.closureEvidence,
    closedAtSeq: projection.closedAtSeq,
  };
  const obligationRows: readonly ObligationRow[] = Object.values(projection.obligations)
    .map((obligation) => ({
      caseId: projection.caseId,
      orgId,
      teamId: obligation.teamId,
      amount: obligation.amount,
      increased: obligation.increased,
      reduced: obligation.reduced,
      discharged: obligation.discharged,
      waived: obligation.waived,
      reinstated: obligation.reinstated,
    }))
    .sort((a, b) => (a.teamId < b.teamId ? -1 : a.teamId > b.teamId ? 1 : 0));
  return { caseRow, obligationRows };
}

/**
 * Row-vs-events divergence for a case. Covers every field the writer reads to
 * decide: the status (which gates every transition), the intake pin (which gates
 * verification), and every obligation counter (which gates settlement itself).
 */
export function diffCase(
  projection: CaseProjection,
  caseRow: CaseRow | null,
  obligationRows: readonly ObligationRow[],
): readonly string[] {
  const divergences: string[] = [];
  if (caseRow === null) {
    divergences.push(`case ${projection.caseId}: row missing`);
    return divergences;
  }
  if (caseRow.status !== projection.status) {
    divergences.push(`case: rows=${caseRow.status} events=${projection.status}`);
  }
  if (caseRow.basis !== projection.basis) {
    divergences.push(`case: basis diverged (rows=${caseRow.basis} events=${projection.basis})`);
  }
  if (caseRow.auctionId !== projection.auctionId) {
    divergences.push("case: auction diverged");
  }
  if (caseRow.createdBy !== projection.openedBy) {
    divergences.push("case: creator diverged");
  }
  if (caseRow.sourceEventCount !== projection.sourceEventCount) {
    divergences.push(
      `case: source count diverged (rows=${String(caseRow.sourceEventCount)} events=${String(projection.sourceEventCount)})`,
    );
  }
  if (caseRow.sourceDigest !== projection.sourceDigest) {
    divergences.push("case: source digest diverged");
  }
  if (caseRow.foldDigest !== projection.foldDigest) {
    divergences.push("case: fold digest diverged");
  }
  if (caseRow.closedAtSeq !== projection.closedAtSeq) {
    divergences.push(
      `case: closed anchor diverged (rows=${String(caseRow.closedAtSeq)} events=${String(projection.closedAtSeq)})`,
    );
  }
  // The evidence package is immutable truth; a tampered row is a divergence.
  if (canonicalJson(caseRow.closureEvidence) !== canonicalJson(projection.closureEvidence)) {
    divergences.push("case: closure evidence diverged");
  }

  const byTeam = new Map(obligationRows.map((row) => [row.teamId, row]));
  for (const obligation of Object.values(projection.obligations)) {
    const row = byTeam.get(obligation.teamId);
    if (row === undefined) {
      divergences.push(`obligation ${obligation.teamId}: row missing`);
      continue;
    }
    for (const field of [
      "amount",
      "increased",
      "reduced",
      "discharged",
      "waived",
      "reinstated",
    ] as const) {
      if (row[field] !== obligation[field]) {
        divergences.push(
          `obligation ${obligation.teamId}: ${field} diverged (rows=${String(row[field])} events=${String(obligation[field])})`,
        );
      }
    }
    // The derived value the settle guard reads — checked explicitly, because it
    // is the number a tampered row would be trying to lie about.
    const rowOutstanding = outstandingOf({
      teamId: row.teamId,
      amount: row.amount,
      increased: row.increased,
      reduced: row.reduced,
      discharged: row.discharged,
      waived: row.waived,
      reinstated: row.reinstated,
    });
    if (rowOutstanding !== outstandingOf(obligation)) {
      divergences.push(`obligation ${obligation.teamId}: outstanding diverged`);
    }
  }
  // A row the log never wrote is a row somebody else did.
  for (const row of obligationRows) {
    if (projection.obligations[row.teamId] === undefined) {
      divergences.push(`obligation ${row.teamId}: missing from event log`);
    }
  }
  return divergences;
}

// --- OrgJournal -----------------------------------------------------------------------

/** The posting rows (with legs) the journal log demands. */
export function projectJournal(
  projection: JournalProjection,
  orgId: string,
): readonly PostingRow[] {
  return Object.values(projection.postings)
    .sort((a, b) => a.eventSeq - b.eventSeq)
    .map((posting) => ({
      postingId: posting.postingId,
      orgId,
      eventSeq: posting.eventSeq,
      template: posting.template,
      caseId: posting.caseId,
      teamId: posting.teamId,
      sourceStream: posting.sourceStream,
      sourceSeq: posting.sourceSeq,
      memo: posting.memo,
      atMs: posting.atMs,
      legs: posting.legs.map((leg, index): LegRow => ({
        legIndex: index,
        account: leg.account,
        direction: leg.direction,
        amount: leg.amount,
      })),
    }));
}

/**
 * Row-vs-events divergence for the journal: every posting, and every LEG of
 * every posting — amount, account and direction. These are the money rows. A
 * tampered leg amount is exactly the D-2 attack (a corrupted money row read as
 * truth), and it halts here.
 */
export function diffJournal(
  projection: JournalProjection,
  postingRows: readonly PostingRow[],
  /**
   * Verify only postings after this seq. The command path passes the latest
   * VERIFIED checkpoint's seq, so its cost is bounded by the tail rather than by
   * the journal's lifetime (§13a); the maintenance pass and recovery pass 0 and
   * verify every row in the org. Both use this one comparison — there is no
   * second opinion about what a row should be.
   */
  fromEventSeq = 0,
): readonly string[] {
  const divergences: string[] = [];
  const expected = new Map(
    projectJournal(projection, "")
      .filter((row) => row.eventSeq > fromEventSeq)
      .map((row) => [row.postingId, row]),
  );
  const actual = new Map(
    postingRows.filter((row) => row.eventSeq > fromEventSeq).map((row) => [row.postingId, row]),
  );

  for (const [postingId, want] of expected) {
    const row = actual.get(postingId);
    if (row === undefined) {
      divergences.push(`posting ${postingId}: row missing`);
      continue;
    }
    if (row.template !== want.template) {
      divergences.push(`posting ${postingId}: template diverged`);
    }
    if (row.eventSeq !== want.eventSeq) {
      divergences.push(`posting ${postingId}: event seq diverged`);
    }
    if (row.sourceStream !== want.sourceStream || row.sourceSeq !== want.sourceSeq) {
      divergences.push(`posting ${postingId}: source diverged`);
    }
    if (row.caseId !== want.caseId || row.teamId !== want.teamId) {
      divergences.push(`posting ${postingId}: attribution diverged`);
    }
    if (row.legs.length !== want.legs.length) {
      divergences.push(
        `posting ${postingId}: leg count diverged (rows=${String(row.legs.length)} events=${String(want.legs.length)})`,
      );
      continue;
    }
    const rowLegs = [...row.legs].sort((a, b) => a.legIndex - b.legIndex);
    const wantLegs = [...want.legs].sort((a, b) => a.legIndex - b.legIndex);
    rowLegs.forEach((leg, index) => {
      const target = wantLegs[index];
      if (target === undefined) {
        return;
      }
      if (leg.account !== target.account) {
        divergences.push(`posting ${postingId} leg ${String(index)}: account diverged`);
      }
      if (leg.direction !== target.direction) {
        divergences.push(`posting ${postingId} leg ${String(index)}: direction diverged`);
      }
      if (leg.amount !== target.amount) {
        divergences.push(
          `posting ${postingId} leg ${String(index)}: amount diverged (rows=${String(leg.amount)} events=${String(target.amount)})`,
        );
      }
    });
  }
  // Reverse scan (the MAJ-1 lesson): a row the log never wrote — or a deleted
  // one — is a divergence too, not an absence nobody notices.
  for (const postingId of actual.keys()) {
    if (!expected.has(postingId)) {
      divergences.push(`posting ${postingId}: missing from event log`);
    }
  }
  return divergences;
}

// --- Payment --------------------------------------------------------------------------

/** The payment row the payment stream demands. */
export function projectPayment(projection: PaymentProjection, orgId: string): PaymentRow {
  return {
    paymentId: projection.paymentId,
    orgId,
    caseId: projection.caseId,
    teamId: projection.teamId,
    method: projection.method,
    status: projection.status,
    amount: projection.amount,
    captured: projection.captured,
    refundedTotal: projection.refundedTotal,
    attested: projection.attested,
    attestedBy: projection.attestedBy,
    providerRef: projection.providerRef,
  };
}

/**
 * Row-vs-events divergence for a payment: every field the writer reads to decide
 * a downstream effect — the captured amount (which drives the discharge), the
 * refunded total (which bounds further refunds), the status, and the provider/
 * attestation identity. A tampered `captured` is a money divergence and halts.
 */
export function diffPayment(
  projection: PaymentProjection,
  row: PaymentRow | null,
): readonly string[] {
  const divergences: string[] = [];
  if (row === null) {
    divergences.push(`payment ${projection.paymentId}: row missing`);
    return divergences;
  }
  if (row.status !== projection.status) {
    divergences.push(`payment: rows=${row.status} events=${projection.status}`);
  }
  if (row.caseId !== projection.caseId || row.teamId !== projection.teamId) {
    divergences.push("payment: attribution diverged");
  }
  if (row.method !== projection.method) {
    divergences.push("payment: method diverged");
  }
  for (const field of ["amount", "captured", "refundedTotal"] as const) {
    if (row[field] !== projection[field]) {
      divergences.push(
        `payment: ${field} diverged (rows=${String(row[field])} events=${String(projection[field])})`,
      );
    }
  }
  if (row.attested !== projection.attested || row.attestedBy !== projection.attestedBy) {
    divergences.push("payment: attestation diverged");
  }
  if (row.providerRef !== projection.providerRef) {
    divergences.push("payment: provider ref diverged");
  }
  return divergences;
}
