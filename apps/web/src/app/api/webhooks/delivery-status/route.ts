import { timingSafeEqual } from "node:crypto";

import { ingestDeliveryCallback } from "@desiauction/financial-operations/server";
import { NextResponse } from "next/server";

import { env } from "../../../../env";
import { systemDb } from "../../../../server/db";
import { webFinopsDeps } from "../../../../server/financial-operations/deps";
import { suppress } from "../../../../server/messaging/consent";
import { SUPPRESSING_EVENTS, parseEmailCallback } from "../../../../server/messaging/email-adapter";

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

export async function POST(request: Request): Promise<NextResponse> {
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

  const raw = await request.text();

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
    await suppress(systemDb, {
      contact: parsed.recipient.toLowerCase(),
      channel: "email",
      reason: parsed.event.includes("complain") || parsed.event === "spam" ? "complaint" : "bounce",
      note: `provider event: ${parsed.event}`,
    });
  }

  const ack = await ingestDeliveryCallback(webFinopsDeps(systemDb), "email", raw);

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
