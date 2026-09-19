import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { env } from "../../../../env";
import { withRequestId } from "../../../../server/logger";
import { drainOutbox } from "../../../../server/messaging/outbox";

/**
 * THE PERSONAL-MESSAGE DRAIN — the scheduled half of the outbox (0079).
 *
 * Every moment is drained right after the action that queued it; this is the
 * safety net for whatever a restart or a provider outage left pending, and the
 * retry clock for backed-off sends. Call it every few minutes. Same secret and
 * the same fail-closed shape as the feedback sweep (no secret → 404).
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
  const drained = await drainOutbox({ limit: 200 });
  return NextResponse.json({ drained });
}

export function POST(request: Request): Promise<NextResponse> {
  return withRequestId(request.headers, () => handle(request));
}
