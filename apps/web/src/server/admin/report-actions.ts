"use server";

import { revalidatePath } from "next/cache";

import { triageProblemReport, type TriageResult } from "../support/report-desk";
import { platformSupportGate } from "./authz";

/**
 * THE REPORT DESK'S ONE ACTION — gate, delegate, revalidate (FR-1 Phase 1).
 *
 * The same shape as `demo-actions.ts`: the verb is somebody else's function, so
 * the source scan over administration keeps holding. Arguments arrive over the
 * wire and are validated by the domain, never trusted here.
 */
export async function triageReportAction(reportId: string, status: string): Promise<TriageResult> {
  const operator = await platformSupportGate();
  if (operator === null) {
    return { ok: false, error: "Not available." };
  }
  const result = await triageProblemReport(reportId, status, operator.personId);
  if (result.ok) {
    revalidatePath("/admin/reports");
  }
  return result;
}
