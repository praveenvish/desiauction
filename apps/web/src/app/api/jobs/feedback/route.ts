import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { env } from "../../../../env";
import { withRequestId } from "../../../../server/logger";
import { sweepReviewAsks } from "../../../../server/reviews/review-sweep";
import {
  purgeExpiredProblemReports,
  purgeSpentSecurityRecords,
  purgeWhatsAppInbound,
} from "../../../../server/support/report-retention";

/**
 * THE FEEDBACK SWEEP (FR-1) — an endpoint a scheduler calls, like
 * `demo-reminders`, and for the same reasons: the web tier holds no scheduler,
 * and the certified finops runner is no home for this.
 *
 * Two jobs: the problem-report retention purge (Phase 1 — a retention promise
 * with no scheduled enforcement is a paragraph), and the review-ask sweep
 * (Phase 3 — see `server/reviews/review-sweep.ts` for who is asked and when).
 *
 * Fail-closed (no secret → 404) and idempotent (a purge that finds nothing does
 * nothing), so calling it every ten minutes is fine.
 */
export const dynamic = "force-dynamic";

function secretMatches(provided: string | null, expected: string): boolean {
  if (provided === null) {
    return false;
  }
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function handle(request: Request): Promise<NextResponse> {
  const expected = env.FEEDBACK_JOB_SECRET;
  if (expected === undefined || expected === "") {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (!secretMatches(request.headers.get("x-feedback-job-secret"), expected)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  // In sequence, not in parallel: the purge is cheap and the sweep sends mail,
  // and a failure in one should be attributable from the response alone.
  const purged = await purgeExpiredProblemReports();
  const security = await purgeSpentSecurityRecords();
  const whatsappInbound = await purgeWhatsAppInbound();
  const reviewAsks = await sweepReviewAsks();
  return NextResponse.json({ purged, security, whatsappInbound, reviewAsks });
}

export function POST(request: Request): Promise<NextResponse> {
  return withRequestId(request.headers, () => handle(request));
}
