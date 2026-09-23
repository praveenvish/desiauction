import { NextResponse } from "next/server";

import { env } from "../../../../env";
import { readCappedBytes } from "../../../../lib/read-capped";
import { db } from "../../../../server/db";
import { logger, withRequestId } from "../../../../server/logger";
import {
  createWhatsAppReplier,
  handleWhatsAppCallback,
  parseWhatsAppCallback,
  verifyHandshake,
  verifyWhatsAppSignature,
} from "../../../../server/messaging/whatsapp-webhook";

/**
 * META'S CALLBACK URL for the WhatsApp Cloud API — delivery receipts and the
 * replies people send, STOP among them (docs/messaging/WHATSAPP_SETUP.md).
 *
 * Same ingress order as the other webhooks: prove the caller before touching
 * the database, and never let a failure's shape say how far the caller got
 * (the one non-2xx after verification is a retryable 503, below). Stronger than the SMS receiver's shared
 * header, because Meta signs: every POST carries an HMAC of its exact bytes
 * under the app secret, so a forged or altered callback is refused before a
 * byte of it is parsed.
 *
 * Both secrets unset means the endpoint is CLOSED (404), indistinguishable from
 * absent — the sibling routes' rule. Production refuses to boot with WhatsApp
 * sending configured and this closed (env.ts), because a number whose replies
 * land nowhere cannot be told to stop.
 */

export const dynamic = "force-dynamic";

/**
 * Meta's callbacks are a few KB — a batch of statuses, a message or two. The
 * cap is generous for that and still stops an unbounded chunked body from being
 * buffered in front of a signature check (the Razorpay route's rule).
 */
const MAX_BODY_BYTES = 256 * 1024;

function configured(): boolean {
  return (env.WHATSAPP_APP_SECRET ?? "") !== "" || (env.WHATSAPP_WEBHOOK_VERIFY_TOKEN ?? "") !== "";
}

/**
 * The subscription handshake. Meta calls this once, when the URL is saved in
 * the app dashboard, with `hub.verify_token` set to the string we typed there;
 * echoing `hub.challenge` is how the URL proves it is ours. The token rides in
 * the query string, which is why Caddy's webhook access log redacts queries.
 */
function handshake(request: Request): NextResponse {
  if (!configured()) {
    return new NextResponse(null, { status: 404 });
  }
  const token = env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
  const challenge =
    token === undefined || token === ""
      ? null
      : verifyHandshake(new URL(request.url).searchParams, token);
  if (challenge === null) {
    return new NextResponse(null, { status: 403 });
  }
  return new NextResponse(challenge, {
    status: 200,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

async function handle(request: Request): Promise<NextResponse> {
  if (!configured()) {
    return new NextResponse(null, { status: 404 });
  }
  const secret = env.WHATSAPP_APP_SECRET;
  if (secret === undefined || secret === "") {
    // Configured for the handshake only: nothing can be verified, so nothing
    // is accepted. 401 rather than 404 so the webhook alert sees it.
    return new NextResponse(null, { status: 401 });
  }
  const raw = await readCappedBytes(request, MAX_BODY_BYTES);
  if (raw === null) {
    return new NextResponse(null, { status: 413 });
  }
  if (!verifyWhatsAppSignature(raw, request.headers.get("x-hub-signature-256"), secret)) {
    return new NextResponse(null, { status: 401 });
  }

  /*
   * FROM HERE ON, 200 — with one exception.
   *
   * The caller is proven to be Meta, and Meta retries anything that is not a
   * 2xx for days. Every refusal past this point is permanent by construction
   * (a body that is not JSON, a status for a message that is not ours, a word
   * that is not a keyword), and no retry changes it, so each one answers 200.
   *
   * THE EXCEPTION IS A WRITE THAT FAILED. A STOP that could not be recorded
   * because the database blinked is exactly what Meta's retry exists for, and
   * answering 200 would drop the opt-out for good — Meta keeps nothing we could
   * replay. So a thrown write answers 503 and Meta tries again, which is safe
   * because every write is idempotent (whatsapp-webhook.ts). A 503 that
   * persists is a 5xx on /api/webhooks/*, which is what the webhook alert
   * counts.
   */
  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    return NextResponse.json({ status: "ignored" }, { status: 200 });
  }
  const callback = parseWhatsAppCallback(payload);
  if (callback.statuses.length === 0 && callback.messages.length === 0) {
    return NextResponse.json({ status: "ok" }, { status: 200 });
  }

  /**
   * THE APP POOL, and no tenant boundary to enter — the same reasoning as the
   * SMS receiver. `message_outbox` and `whatsapp_inbound` are platform tables
   * with no org and no RLS; `consent_records` is between the platform and a
   * person, not a club; `people` is read by phone only. The app role holds the
   * DML on all four (ALTER DEFAULT PRIVILEGES in create-app-role.sql), which is
   * what the posture suite proves under the production roles.
   */
  const replier =
    env.WHATSAPP_PHONE_NUMBER_ID !== undefined && env.WHATSAPP_ACCESS_TOKEN !== undefined
      ? createWhatsAppReplier({
          phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID,
          accessToken: env.WHATSAPP_ACCESS_TOKEN,
        })
      : null;
  try {
    const summary = await handleWhatsAppCallback(db, callback, replier);
    // Counts only: never a body, a number or a message id tied to one.
    logger().info({ whatsapp: summary }, "whatsapp callback handled");
  } catch (error) {
    logger().error(
      { err: error instanceof Error ? error.name : "unknown" },
      "whatsapp callback failed to write; asking Meta to retry",
    );
    return new NextResponse(null, { status: 503 });
  }
  return NextResponse.json({ status: "ok" }, { status: 200 });
}

export function GET(request: Request): Promise<NextResponse> {
  return withRequestId(request.headers, () => Promise.resolve(handshake(request)));
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
