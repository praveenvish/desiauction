import { env } from "../../../../env";
import { logger } from "../../../../server/logger";
import { unsubscribeTokenMatches } from "../../../../server/messaging/unsubscribe";
import {
  setTopicFromEmailLink,
  switchableTopic,
} from "../../../../server/messaging/unsubscribe-writer";

/**
 * ONE-CLICK UNSUBSCRIBE (RFC 8058) — where a mail client's own "Unsubscribe"
 * button POSTs, from the mail's `List-Unsubscribe` header.
 *
 * No session, by design: Gmail sends this from its servers, with the body
 * `List-Unsubscribe=One-Click` and nothing else. The signed link (person +
 * topic, unsubscribe.ts) is the proof, and all it can do is turn that one
 * switch OFF — the least harmful thing a leaked link could do, and undone from
 * the page or /account.
 *
 * A GET (a person pasting the header's link, or a link scanner) changes
 * nothing: it goes to the page, where a person presses the button. Scanners
 * follow links; they must never unsubscribe anybody.
 */
export const dynamic = "force-dynamic";

function params(request: Request): { p: string | null; topic: string | null; t: string | null } {
  const url = new URL(request.url);
  return {
    p: url.searchParams.get("p"),
    topic: url.searchParams.get("topic"),
    t: url.searchParams.get("t"),
  };
}

export async function POST(request: Request): Promise<Response> {
  const { p, topic, t } = params(request);
  if (!unsubscribeTokenMatches(p, topic, t) || p === null || topic === null) {
    return new Response("This unsubscribe link is not valid.", { status: 400 });
  }
  try {
    if ((await switchableTopic(topic)) === undefined) {
      return new Response("These emails can't be switched off right now.", { status: 409 });
    }
    await setTopicFromEmailLink({ personId: p, topic, allowed: false, via: "one_click" });
  } catch (error) {
    // A mail client retries a 5xx; the person can also use the page.
    logger().error({ err: error, topic }, "email_unsubscribe.one_click_failed");
    return new Response("Could not unsubscribe right now.", { status: 503 });
  }
  return new Response("Unsubscribed.", { status: 200 });
}

export function GET(request: Request): Response {
  const search = new URL(request.url).search;
  return Response.redirect(
    `${env.PUBLIC_BASE_URL.replace(/\/$/, "")}/email/unsubscribe${search}`,
    303,
  );
}
