import { NextResponse } from "next/server";

import { env } from "../../../../env";
import { readCapped } from "../../../../lib/read-capped";
import { logger, withRequestId } from "../../../../server/logger";
import { ingestEmailReport, suppressEmailAddress } from "../../../../server/messaging/email-events";
import {
  handleZeptomailWebhook,
  ZEPTOMAIL_KEY_HEADER,
} from "../../../../server/messaging/zeptomail-webhook";

/**
 * ZEPTOMAIL (ZOHO CPAAS) EVENTS — hard bounces and spam complaints for every
 * message sent through the Mail Agent (docs/EMAIL_INFRASTRUCTURE.md →
 * ZeptoMail). The SES route's twin: prove the caller before touching the
 * database, here by the `producer-signature` HMAC; the logic is
 * zeptomail-webhook.ts, the database half email-events.ts.
 *
 * `ZEPTOMAIL_WEBHOOK_KEY` unset means CLOSED (404), indistinguishable from absent.
 */

export const dynamic = "force-dynamic";

/** One event notification is a few KB; this is generous. */
const MAX_BODY_BYTES = 256 * 1024;

async function handle(request: Request): Promise<NextResponse> {
  const key = env.ZEPTOMAIL_WEBHOOK_KEY;
  if (key === undefined || key === "") {
    return new NextResponse(null, { status: 404 });
  }
  const raw = await readCapped(request, MAX_BODY_BYTES);
  if (raw === null) {
    return new NextResponse(null, { status: 413 });
  }
  try {
    const result = await handleZeptomailWebhook(
      raw,
      {
        signature: request.headers.get("producer-signature"),
        headerKey:
          request.headers.get(ZEPTOMAIL_KEY_HEADER) ?? request.headers.get("authorization"),
      },
      {
        key,
        now: () => Date.now(),
        suppress: (action) => suppressEmailAddress(action),
        report: (reportRaw) => ingestEmailReport(reportRaw),
        log: (fields, message) => {
          // Unproved is WARN: Zoho's keyless Verify is one, but a real event
          // here means the key in Zoho and in web.env disagree.
          if (message === "zeptomail_webhook.unproved") logger().warn(fields, message);
          else logger().info(fields, message);
        },
      },
    );
    return result.body === null
      ? new NextResponse(null, { status: result.status })
      : NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    // Our database, not their event: 503 so ZeptoMail delivers it again
    // rather than a bounce going unrecorded.
    logger().error({ err: error }, "zeptomail_webhook.failed");
    return new NextResponse(null, { status: 503 });
  }
}

export function POST(request: Request): Promise<NextResponse> {
  return withRequestId(request.headers, () => handle(request));
}
