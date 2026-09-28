import { NextResponse } from "next/server";

import { env } from "../../../../env";
import { readCapped } from "../../../../lib/read-capped";
import { logger, withRequestId } from "../../../../server/logger";
import { ingestEmailReport, suppressEmailAddress } from "../../../../server/messaging/email-events";
import { providerFetch } from "../../../../server/messaging/provider-fetch";
import { handleSesWebhook } from "../../../../server/messaging/ses-webhook";
import { createCertFetcher, verifySnsSignature } from "../../../../server/messaging/sns";

/**
 * AMAZON SES EVENTS, delivered by SNS — bounces, complaints and deliveries
 * for every message sent with our configuration set
 * (docs/EMAIL_INFRASTRUCTURE.md → Bounce and complaint handling).
 *
 * Same ingress order as the other webhooks: prove the caller before touching
 * the database. Here that is AWS's own message signature plus our topic ARN
 * (sns.ts); the logic is ses-webhook.ts, the database half email-events.ts.
 *
 * `SES_SNS_TOPIC_ARN` unset means CLOSED (404), indistinguishable from absent.
 */

export const dynamic = "force-dynamic";

/** SNS messages are at most 256 KB; SES events are a few. */
const MAX_BODY_BYTES = 256 * 1024;

// Module-scoped so the certificate is fetched once per process, not per event.
const fetchCert = createCertFetcher();

async function handle(request: Request): Promise<NextResponse> {
  const topicArn = env.SES_SNS_TOPIC_ARN;
  if (topicArn === undefined || topicArn === "") {
    return new NextResponse(null, { status: 404 });
  }
  const raw = await readCapped(request, MAX_BODY_BYTES);
  if (raw === null) {
    return new NextResponse(null, { status: 413 });
  }
  try {
    const result = await handleSesWebhook(raw, {
      topicArn,
      verify: (envelope) => verifySnsSignature(envelope, fetchCert),
      confirm: async (url) => {
        try {
          return (await providerFetch(url, { method: "GET", headers: {} })).status === 200;
        } catch {
          return false;
        }
      },
      suppress: (action) => suppressEmailAddress(action),
      report: (reportRaw) => ingestEmailReport(reportRaw),
      log: (fields, message) => {
        logger().info(fields, message);
      },
    });
    return result.body === null
      ? new NextResponse(null, { status: result.status })
      : NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    // Our database, not their message: 503 so SNS delivers the event again
    // rather than a bounce going unrecorded.
    logger().error({ err: error }, "ses_webhook.failed");
    return new NextResponse(null, { status: 503 });
  }
}

export function POST(request: Request): Promise<NextResponse> {
  return withRequestId(request.headers, () => handle(request));
}
