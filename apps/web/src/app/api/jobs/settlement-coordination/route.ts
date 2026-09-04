import { timingSafeEqual } from "node:crypto";

import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";

import { env } from "../../../../env";
import { sweepSettlementCoordination } from "../../../../server/settlement/coordination-sweep";
import { withRequestId } from "../../../../server/logger";

/**
 * THE SETTLEMENT CATCH-UP SWEEP — an endpoint onto the repair scan (PRR P1-3).
 *
 * `commitCase` coordinates the journal outside the case transaction and says a
 * crash in that seam "the catch-up scan repairs, idempotently". The scan
 * (`runCoordination` / `runPaymentCoordination`) existed but had no production
 * caller — no cron, no route, no button — so the one non-transactional seam in
 * the money system could diverge with nothing able to heal it. The certified
 * finops runner is dependency-cruiser-forbidden from settlement writes, so this
 * is the honest third option, exactly like the demo-reminder sweep: the work is
 * a function, this is the door, and the host's scheduler calls it.
 *
 * Fail-closed and idempotent. No secret → 404. A wrong secret → 404. Every
 * repaired effect is skipped when already present, so calling this every few
 * minutes is safe. Any UNHEALABLE stream (a log that will not fold — the
 * restore-from-backup case) is reported to Sentry so a human is paged rather
 * than the divergence sitting silent.
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
  const expected = env.SETTLEMENT_JOB_SECRET;
  if (expected === undefined || expected === "") {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (!secretMatches(request.headers.get("x-settlement-job-secret"), expected)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const report = await sweepSettlementCoordination();

  // A divergence the scan could not FOLD is a money-integrity incident — surface
  // it loudly so it is never discovered by a customer. The `effectsRepaired`
  // count is deliberately NOT alerted on: runCoordination counts a no-op
  // "obligation-posting" for legitimate zero-item cases (all-icon nights) as a
  // repair, so a healthy org would emit a warning every run and drown the real
  // signal (PRR re-validation). The count still rides the JSON response and the
  // logs for an operator; only a genuine unhealable stream pages anyone.
  if (report.unhealable.length > 0) {
    Sentry.captureMessage(
      `settlement coordination sweep found ${String(report.unhealable.length)} unhealable stream(s)`,
      { level: "error", extra: { unhealable: report.unhealable } },
    );
  }

  return NextResponse.json(report);
}

/**
 * Every line this request logs carries one id (PA-1 §20).
 *
 * Provider callbacks and scheduled sweeps are exactly the requests nobody is
 * watching when they run, so "which delivery did that error belong to" has to
 * be answerable afterwards from the log alone.
 */
export function POST(request: Request): Promise<NextResponse> {
  return withRequestId(request.headers, () => handle(request));
}
