import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { env } from "../../../../env";
import { readCapped } from "../../../../lib/read-capped";
import { SUPPRESSING_EVENTS, parseEmailCallback } from "../../../../server/messaging/email-adapter";
import { ingestEmailReport, suppressEmailAddress } from "../../../../server/messaging/email-events";
import { withRequestId } from "../../../../server/logger";

/**
 * PROVIDER DELIVERY REPORTS — where "accepted" becomes "arrived".
 *
 * The email adapter returns a providerRef and deliberately does NOT confirm,
 * because a provider taking a message is not a mailbox receiving it. This is
 * the other half of that contract.
 *
 * Almost none of the work happens here. `ingestDeliveryCallback` is a certified
 * part of the platform — adapter-verified, idempotent on
 * `provider:{providerEventRef}`, deterministic against late and out-of-order
 * arrivals, and audited even when it rejects — and it has existed, exported and
 * covered by its own regression suite, with **no caller anywhere in the
 * product**. This route is the door it never had.
 *
 * Same ingress order as the settlement webhook and the inbound-SMS route:
 * verify the secret before touching anything, and never answer 500.
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
  const expected = env.DELIVERY_CALLBACK_SECRET;
  if (expected === undefined || expected === "") {
    // Closed until configured, and indistinguishable from absent. A callback
    // endpoint that accepts anything when misconfigured would let a stranger
    // mark documents delivered.
    return new NextResponse(null, { status: 404 });
  }
  if (!secretMatches(request.headers.get("x-callback-secret"), expected)) {
    return new NextResponse(null, { status: 401 });
  }

  // Provider delivery reports are a few KB. Read under a cap: the secret check
  // above is one shared string, and an unbounded `request.text()` behind it is
  // a memory budget for whoever learns it (the Razorpay route's rule).
  const raw = await readCapped(request, 64 * 1024);
  if (raw === null) {
    return new NextResponse(null, { status: 413 });
  }

  /*
   * The suppression happens BEFORE the ingest, and on purpose.
   *
   * A bounce or a complaint is a fact about an address, and it stays true
   * whether or not the dispatch it arrived for can still be transitioned. If
   * the ingest refused first — a dispatch already terminal, an out-of-order
   * report — we would drop the one part of the message that protects the
   * sending domain. Continuing to send to a hard bounce is how a domain dies,
   * and a complaint is somebody telling their provider we are spam.
   */
  const parsed = parseEmailCallback(raw);
  if (parsed !== null && parsed.recipient !== null && SUPPRESSING_EVENTS.has(parsed.event)) {
    // The app pool, deduplicated — email-events.ts has the why.
    await suppressEmailAddress({
      recipient: parsed.recipient,
      reason: parsed.event.includes("complain") || parsed.event === "spam" ? "complaint" : "bounce",
      note: `provider event: ${parsed.event}`,
    });
  }

  // The finops half, inside the dispatch's tenant boundary (email-events.ts).
  const ack = await ingestEmailReport(raw);

  /*
   * 200 even when the platform refuses.
   *
   * Providers retry anything that is not 2xx, and every refusal here is
   * permanent by construction: an unparseable body, an event we do not treat as
   * delivery truth (opens and clicks), a dispatch that no longer exists, a
   * transition the frozen state machine will not make. Retrying cannot change
   * any of them, and a provider hammering a rejected callback for a day is a
   * self-inflicted outage. The reason is returned so it is visible in their
   * dashboard.
   */
  return NextResponse.json(ack.ok ? { status: "ok" } : { status: "ignored", reason: ack.reason }, {
    status: 200,
  });
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
