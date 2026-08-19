import { NextResponse } from "next/server";

import { env } from "../../../../env";
import { dbHandle } from "../../../../server/db";
import { settlementDeps } from "../../../../server/settlement/deps";
import { handleRazorpayWebhook } from "../../../../server/settlement/webhook";

/**
 * PAYMENT GATEWAY INGRESS — where a Razorpay callback actually lands.
 *
 * `handleRazorpayWebhook` has existed, and been forgery-tested, since IP-5: bad
 * signature, stale timestamp, replayed event and mismatched envelope all fail
 * closed. It had no route. Nothing outside the test suite could reach it, so
 * the documented go-live gate — "one live order → webhook → capture →
 * discharge" — was unrunnable and payment capture could never complete in
 * production (audit 2026-08-18, P1-5).
 *
 * This file is only the doorway. Every decision, and the whole trusted-envelope
 * order, stays in the handler: signature → freshness → envelope → tenant
 * context → payment → pin → command. Nothing here touches the database.
 *
 * FAIL-CLOSED, like the other two webhooks: with no `RAZORPAY_WEBHOOK_SECRET`
 * the endpoint 404s rather than accepting callbacks it cannot verify.
 *
 * The body is read as TEXT and passed through unparsed, because the HMAC is
 * computed over the exact bytes Razorpay sent. Parsing the body here and
 * re-serialising it would change those bytes, and every signature would fail.
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<NextResponse> {
  if (env.RAZORPAY_WEBHOOK_SECRET === undefined) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  const signature = request.headers.get("x-razorpay-signature") ?? "";
  const rawBody = await request.text();

  const result = await handleRazorpayWebhook(settlementDeps(dbHandle.db), {
    rawBody,
    signature,
    receivedAtMs: Date.now(),
  });

  if (!result.ok) {
    // The handler already decided what each failure is worth: 401 forged, 400
    // stale or unparseable, 404 unknown payment, 409 envelope mismatch, 503 no
    // gateway configured. The reason is a stable machine token, never a
    // sentence about our internals.
    return NextResponse.json({ error: result.reason }, { status: result.status });
  }
  // A refused command is still a 200: we received and understood the event, and
  // retrying will not change the verdict. Only infrastructure faults are 5xx —
  // anything else teaches the provider to retry something that cannot succeed.
  return NextResponse.json(
    result.ack.ok
      ? { ok: true, status: result.ack.status }
      : { ok: true, refused: result.ack.reason },
  );
}
