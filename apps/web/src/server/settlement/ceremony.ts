import {
  caseFinancial,
  closureSummary,
  closureTimeline,
  collectionSummary,
  computeObligations,
  foldSource,
  journalSummary,
  reconciledOverlay,
  replayCase,
  replayJournal,
  verifyClosure,
  type CaseFinancial,
  type ClosureSummary,
  type ClosureVerification,
  type JournalSummaryLine,
  type ReconciledOverlay,
  type SettlementEventEnvelope,
  type TeamCollection,
  type TimelineRow,
} from "@desiauction/settlement";

import type { SettlementDeps } from "./deps";

/**
 * The FLOODLIGHT ceremony read model (IP-5_ARCHITECTURE §11, directive §4/§10).
 *
 * READ-ONLY and DERIVED ONLY: every field is a pure fold of the immutable log.
 * Nothing here is written, nothing is stored, and there is no business logic —
 * ceremony owns presentation, settlement owns settlement. The projections are
 * therefore trivially recoverable (§8): re-fold the same events → byte-identical.
 */

export interface CeremonyProjection {
  readonly summary: ClosureSummary;
  readonly financial: CaseFinancial;
  readonly collections: readonly TeamCollection[];
  readonly journal: readonly JournalSummaryLine[];
  readonly overlay: ReconciledOverlay;
  /** The sealed evidence (present once closed; null while open / after reopen). */
  readonly evidence: Readonly<Record<string, unknown>> | null;
  readonly timeline: readonly TimelineRow[];
}

/** Assemble the full ceremony projection for a case — all folds, no writes. */
export async function closureCeremony(
  deps: SettlementDeps,
  caseId: string,
): Promise<CeremonyProjection | null> {
  const caseRow = await deps.store.loadCase(caseId);
  if (caseRow === null) {
    return null;
  }
  const caseEvents = await deps.store.loadStream("case", caseId);
  const caseReplay = replayCase(caseEvents);
  if (!caseReplay.ok) {
    return null;
  }
  const projection = caseReplay.projection;
  const journalEvents = await deps.store.loadStream("journal", caseRow.orgId);
  const journalReplay = replayJournal(journalEvents);
  const journal = journalReplay.ok ? journalReplay.projection : null;

  return {
    summary: closureSummary(projection),
    financial: caseFinancial(projection),
    collections: collectionSummary(projection),
    journal: journal === null ? [] : journalSummary(journal, caseId),
    overlay: reconciledOverlay(projection),
    evidence: projection.closureEvidence,
    timeline: closureTimeline(caseEvents),
  };
}

/**
 * The Reconciled overlay for an auction (§5) — closure projected onto the
 * auction. The auction is NEVER read for its status here beyond identity; the
 * reconciled fact comes purely from the settlement case.
 */
export async function reconciledOverlayFor(
  deps: SettlementDeps,
  auctionId: string,
): Promise<ReconciledOverlay | null> {
  const caseRow = await deps.store.loadCaseByAuction(auctionId);
  if (caseRow === null) {
    return null;
  }
  const events = await deps.store.loadStream("case", caseRow.caseId);
  const replay = replayCase(events);
  return replay.ok ? reconciledOverlay(replay.projection) : null;
}

export interface EvidenceReproduction {
  readonly ok: boolean;
  readonly stored: Readonly<Record<string, unknown>> | null;
  readonly reproduced: Readonly<Record<string, unknown>> | null;
  readonly matches: boolean;
}

/**
 * Reproduce the sealed evidence by replay (§7 "every digest reproducible by
 * replay"): re-fold the case up to `caseEventCount` and the journal up to
 * `journalSeq` (the prefixes pinned in the evidence), re-run verifyClosure, and
 * compare byte-for-byte with what the CaseClosed event sealed.
 */
export async function reproduceClosureEvidence(
  deps: SettlementDeps,
  caseId: string,
): Promise<EvidenceReproduction> {
  const caseRow = await deps.store.loadCase(caseId);
  if (caseRow === null || caseRow.closureEvidence === null) {
    return { ok: false, stored: null, reproduced: null, matches: false };
  }
  const stored = caseRow.closureEvidence;
  const journalSeq = Number(stored["journalSeq"]);
  const caseEventCount = Number(stored["caseEventCount"]);

  // Re-fold the SETTLED case prefix (the state closure was justified against).
  const caseEvents = (await deps.store.loadStream("case", caseId)).filter(
    (event) => event.seq <= caseEventCount,
  );
  const caseReplay = replayCase(caseEvents);
  const journalEvents = (await deps.store.loadStream("journal", caseRow.orgId)).filter(
    (event) => event.seq <= journalSeq,
  );
  const journalReplay = replayJournal(journalEvents);
  if (!caseReplay.ok || !journalReplay.ok) {
    return { ok: false, stored, reproduced: null, matches: false };
  }
  const verification = await deriveVerification(
    deps,
    caseRow.orgId,
    caseReplay.projection,
    journalReplay.projection,
    journalSeq,
    caseEventCount,
  );
  if (verification === null) {
    return { ok: false, stored, reproduced: null, matches: false };
  }
  const reproduced = { ...verification.evidence } as Record<string, unknown>;
  const matches = canonical(reproduced) === canonical(stored);
  return { ok: true, stored, reproduced, matches };
}

async function deriveVerification(
  deps: SettlementDeps,
  orgId: string,
  caseProjection: Parameters<typeof verifyClosure>[0]["caseProjection"],
  journal: Parameters<typeof verifyClosure>[0]["journal"],
  journalSeq: number,
  caseEventCount: number,
): Promise<ClosureVerification | null> {
  void orgId;
  const sourceEvents = await deps.source.loadEvents(caseProjection.auctionId);
  const folded = foldSource(sourceEvents, deps.digest);
  if (!folded.ok) {
    return null;
  }
  const caseEvents = await deps.store.loadStream("case", caseProjection.caseId);
  const fixed = fixedAmountsOf(caseEvents);
  const items = computeObligations(folded.source.fold, caseProjection.basis, fixed);
  const recomputed: Record<string, number> = {};
  if (items.ok) {
    for (const item of items.items) {
      recomputed[item.teamId] = item.amount;
    }
  }
  return verifyClosure(
    { caseProjection, journal, journalSeq, caseEventCount, recomputedObligations: recomputed },
    deps.digest,
  );
}

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

function canonical(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      sorted[key] = sortKeys(record[key]);
    }
    return sorted;
  }
  return value;
}
