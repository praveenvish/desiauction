import { problemReports } from "@desiauction/db";
import { eq } from "drizzle-orm";

import { db } from "../db";
import { PROBLEM_STATUSES, type ProblemStatus } from "./problem-reports";

/**
 * MOVING A REPORT ALONG — the write, and why it lives HERE (FR-1 Phase 1).
 *
 * Not under `server/admin/`, for the reason `marketing/demo-desk.ts` gives:
 * administration holds exactly one write, and that is enforced by a source scan,
 * a runtime proof and a dependency rule. The action lives in administration; the
 * verb lives in the domain.
 *
 * ON THE APP POOL. `problem_reports` has no RLS (0064), so there is nothing to
 * bypass, and the system role's pinned write list stays where it is.
 */

export type TriageResult =
  { readonly ok: true; readonly summary: string } | { readonly ok: false; readonly error: string };

/** Everything an operator may move a report TO. Back to `new` is not a move. */
export const TRIAGE_STATUSES = PROBLEM_STATUSES.filter(
  (status): status is Exclude<ProblemStatus, "new"> => status !== "new",
);

const STATUS_WORDS: Record<Exclude<ProblemStatus, "new">, string> = {
  triaged: "looking into it",
  fixed: "fixed",
  wont_fix: "won't fix",
  duplicate: "duplicate",
};

export async function triageProblemReport(
  reportId: string,
  status: string,
  actorId: string,
  now: Date = new Date(),
): Promise<TriageResult> {
  const target = TRIAGE_STATUSES.find((candidate) => candidate === status);
  if (target === undefined) {
    return { ok: false, error: "That isn't a status we record." };
  }
  const updated = await db
    .update(problemReports)
    .set({ status: target, triagedAt: now, triagedBy: actorId })
    .where(eq(problemReports.id, reportId))
    .returning({ id: problemReports.id });
  if (updated[0] === undefined) {
    return { ok: false, error: "That report no longer exists." };
  }
  return { ok: true, summary: `Marked ${STATUS_WORDS[target]}.` };
}
