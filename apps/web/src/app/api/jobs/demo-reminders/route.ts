import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { env } from "../../../../env";
import { sweepDemoReminders } from "../../../../server/marketing/demo-reminders";
import { purgeExpiredDemoData } from "../../../../server/marketing/demo-retention";

/**
 * THE REMINDER SWEEP — an endpoint, deliberately, rather than a loop.
 *
 * The finops runner is described in its own header as "the platform's ONE home
 * for scheduled work", and that sentence is worth keeping true. It is also a
 * certified money process, and putting a marketing reminder inside it would
 * widen the blast radius of a demo email into settlement's runtime for no gain.
 * A second always-on process for two messages a day is worse still.
 *
 * So this is the third option and the honest one: the work is a function, this
 * is a door onto it, and whatever cron the host already has calls it. Nothing
 * schedules itself; nothing is hidden.
 *
 * Fail-closed and idempotent. With no secret the route 404s. Sending is stamped
 * on the row inside the same pass, so calling this twice a minute, or twice at
 * once, does not send anything twice.
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

export async function POST(request: Request): Promise<NextResponse> {
  const expected = env.DEMO_JOB_SECRET;
  if (expected === undefined || expected === "") {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (!secretMatches(request.headers.get("x-demo-job-secret"), expected)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // The retention sweep rides the same door. `/legal/data-retention` promises
  // demo requests are deleted at twenty-four months and their network addresses
  // at ninety days, and a promise with no scheduled enforcement is a paragraph.
  // Both are idempotent, so a caller running this every ten minutes is fine.
  const [reminders, purged] = await Promise.all([sweepDemoReminders(), purgeExpiredDemoData()]);
  return NextResponse.json({ reminders, purged });
}
