"use server";

import { headers } from "next/headers";

import { env } from "../../env";
import { clientIp } from "../../lib/client-ip";
import { currentSession } from "../auth/actions";
import { reportReview } from "./season";

/**
 * REPORTING A REVIEW (FR-1 Phase 4) — the one public write on a season page.
 *
 * Anybody reading a published review may say it should not be there. The
 * report queues for platform operators; nothing is taken down by it, and the
 * reporter is told so, so nobody mistakes the button for a delete.
 */
export interface ReportState {
  readonly error?: string;
  readonly done?: boolean;
}

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

export async function reportReviewAction(
  _previous: ReportState,
  formData: FormData,
): Promise<ReportState> {
  const session = await currentSession();
  const result = await reportReview({
    reviewId: field(formData, "reviewId"),
    reason: field(formData, "reason"),
    note: field(formData, "note"),
    ip: clientIp(await headers(), env.TRUSTED_PROXY_COUNT),
    personId: session?.personId ?? null,
  });
  return result.ok ? { done: true } : { error: result.error };
}
