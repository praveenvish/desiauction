/**
 * HOW THE NIGHT WENT — the plan against the record (WR-1, Phase 1.5).
 *
 * After the auction the owner's plan is read-only and the question changes
 * from "where do I stand" to "what happened to what I planned". This answers
 * it from two records that already exist: the plan's own append-only revision
 * history, and the auction ledger's sales.
 *
 * THE PLAN AS IT STOOD WHEN THE HAMMER FELL. An owner may raise a max
 * mid-night or drop a target before its lot comes up; judging the night by the
 * plan's final shape would rewrite what they actually meant at the time. So
 * each player is judged by the LAST revision at or before their lot's sale
 * (or, for a lot never sold, the last revision of the night): removed before
 * the hammer means "not a target"; added after it means the same.
 *
 * Pure, deterministic, and — like everything in the plan — a statement of
 * facts the owner can check by hand. It never grades the owner.
 */

import type { Paise } from "./money";
import { paise } from "./money";
import type { PlanLot, TargetPriority } from "./team-plan";

export interface PlanRevisionLike {
  readonly targetId: string;
  readonly kind: "added" | "updated" | "removed";
  readonly registrationId: string;
  readonly maxBid: Paise | null;
  readonly priority: TargetPriority;
  /** When the revision was written (epoch ms). */
  readonly atMs: number;
}

/** One `LotSold` from the ledger. A reopened-and-resold lot appears more than once. */
export interface PlanSaleLike {
  readonly lotId: string;
  readonly atMs: number;
  readonly seq: number;
}

export interface PlanReportInput {
  readonly lots: readonly PlanLot[];
  readonly sales: readonly PlanSaleLike[];
  readonly revisions: readonly PlanRevisionLike[];
  readonly myTeamId: string;
}

export type ReportOutcome = "won" | "lost" | "unsold" | "withdrawn" | "open";

export interface PlanReportRow {
  readonly registrationId: string;
  readonly lotId: string | null;
  /** As the plan stood when the hammer fell. */
  readonly priority: TargetPriority;
  readonly maxBid: Paise | null;
  readonly outcome: ReportOutcome;
  /** The hammer price, whoever paid it; null when the lot was not sold. */
  readonly paid: Paise | null;
  /** Won above the max, by this much; null otherwise. */
  readonly overBy: Paise | null;
}

export interface PlanReport {
  readonly rows: readonly PlanReportRow[];
  readonly targets: number;
  readonly signed: number;
  readonly lost: number;
  /** Targets whose lot ended unsold, withdrawn, or never came up. */
  readonly undecided: number;
  /** Σ max over targets that carried one. */
  readonly plannedTotal: Paise;
  /** Σ hammer price over the targets signed. */
  readonly paidForTargets: Paise;
  readonly overMaxCount: number;
  readonly overMaxTotal: Paise;
  /** Lots this team won that were not on the plan when they were sold. */
  readonly outsidePlan: readonly {
    readonly registrationId: string;
    readonly lotId: string;
    readonly paid: Paise;
  }[];
  readonly outsidePlanTotal: Paise;
}

function outcomeOf(lot: PlanLot | undefined, myTeamId: string): ReportOutcome {
  if (lot === undefined) {
    return "open";
  }
  switch (lot.status) {
    case "sold":
      return lot.soldToTeamId === myTeamId ? "won" : "lost";
    case "unsold":
      return "unsold";
    case "withdrawn":
      return "withdrawn";
    default:
      return "open";
  }
}

export function planVersusActual(input: PlanReportInput): PlanReport {
  const lotsByRegistration = new Map(input.lots.map((lot) => [lot.registrationId, lot]));
  // The LAST sale per lot: a lot reopened by undo and sold again is judged by
  // the sale that stood.
  const saleByLot = new Map<string, PlanSaleLike>();
  for (const sale of input.sales) {
    const known = saleByLot.get(sale.lotId);
    if (known === undefined || sale.seq > known.seq) {
      saleByLot.set(sale.lotId, sale);
    }
  }
  const byRegistration = new Map<string, PlanRevisionLike[]>();
  for (const revision of input.revisions) {
    const list = byRegistration.get(revision.registrationId) ?? [];
    list.push(revision);
    byRegistration.set(revision.registrationId, list);
  }

  const rows: PlanReportRow[] = [];
  for (const [registrationId, history] of [...byRegistration.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const lot = lotsByRegistration.get(registrationId);
    const sale = lot === undefined ? undefined : saleByLot.get(lot.lotId);
    const cutoff = sale === undefined ? Number.POSITIVE_INFINITY : sale.atMs;
    const ordered = [...history].sort((a, b) => a.atMs - b.atMs);
    let standing: PlanRevisionLike | null = null;
    for (const revision of ordered) {
      if (revision.atMs <= cutoff) {
        standing = revision;
      }
    }
    if (standing === null || standing.kind === "removed") {
      continue;
    }
    const outcome = outcomeOf(lot, input.myTeamId);
    const paid = lot?.status === "sold" ? lot.soldPrice : null;
    const overBy =
      outcome === "won" && standing.maxBid !== null && paid !== null && paid > standing.maxBid
        ? paise(paid - standing.maxBid)
        : null;
    rows.push({
      registrationId,
      lotId: lot?.lotId ?? null,
      priority: standing.priority,
      maxBid: standing.maxBid,
      outcome,
      paid,
      overBy,
    });
  }

  const targeted = new Set(rows.map((row) => row.registrationId));
  const outsidePlan = input.lots
    .filter(
      (lot) =>
        lot.status === "sold" &&
        lot.soldToTeamId === input.myTeamId &&
        lot.soldPrice !== null &&
        !targeted.has(lot.registrationId),
    )
    .map((lot) => ({
      registrationId: lot.registrationId,
      lotId: lot.lotId,
      paid: lot.soldPrice as Paise,
    }))
    .sort((a, b) => a.registrationId.localeCompare(b.registrationId));

  const won = rows.filter((row) => row.outcome === "won");
  const over = won.filter((row) => row.overBy !== null);
  return {
    rows,
    targets: rows.length,
    signed: won.length,
    lost: rows.filter((row) => row.outcome === "lost").length,
    undecided: rows.filter((row) => row.outcome !== "won" && row.outcome !== "lost").length,
    plannedTotal: paise(rows.reduce((sum, row) => sum + (row.maxBid ?? 0), 0)),
    paidForTargets: paise(won.reduce((sum, row) => sum + (row.paid ?? 0), 0)),
    overMaxCount: over.length,
    overMaxTotal: paise(over.reduce((sum, row) => sum + (row.overBy ?? 0), 0)),
    outsidePlan,
    outsidePlanTotal: paise(outsidePlan.reduce((sum, row) => sum + row.paid, 0)),
  };
}
