import { redactReportedUrl } from "../../../lib/csp";
import { logger } from "../../../server/logger";
import { readCapped } from "../../../lib/read-capped";

/**
 * WHERE BROWSERS REPORT WHAT THE SCRIPT POLICY BLOCKED — or, in Report-Only,
 * WOULD have blocked. The evidence that decides when CSP_ENFORCE can be set.
 *
 * Unauthenticated by nature (browsers send these with no credentials), so it
 * is built to be harmless to abuse: it reads at most 16 KB, writes nothing but a
 * log line, caps how many lines it writes a minute, and answers 204 to
 * everything. Page addresses are redacted before logging, because the pages
 * most likely to report are the ones whose URL carries an invite token.
 */
export const dynamic = "force-dynamic";

const MAX_BYTES = 16 * 1024;
const MAX_LOGGED_PER_MINUTE = 120;
let windowStart = 0;
let loggedThisWindow = 0;

interface Violation {
  document: string | null;
  blocked: string | null;
  directive: string | null;
  disposition: string | null;
}

function read(entry: Record<string, unknown>): Violation {
  const field = (...names: string[]): string | null => {
    for (const name of names) {
      const value = entry[name];
      if (typeof value === "string" && value !== "") {
        return value;
      }
    }
    return null;
  };
  return {
    document: redactReportedUrl(field("document-uri", "documentURL")),
    blocked: redactReportedUrl(field("blocked-uri", "blockedURL")),
    directive: field("effective-directive", "effectiveDirective", "violated-directive"),
    disposition: field("disposition"),
  };
}

/** Both wire formats: the classic `{ "csp-report": {…} }` and the Reporting API's array. */
function violationsIn(body: unknown): Violation[] {
  if (Array.isArray(body)) {
    return body
      .map((item: unknown) =>
        typeof item === "object" && item !== null
          ? (item as { type?: unknown; body?: unknown })
          : null,
      )
      .filter((item) => item?.type === "csp-violation" && typeof item.body === "object")
      .map((item) => read(item?.body as Record<string, unknown>));
  }
  if (typeof body === "object" && body !== null) {
    const report = (body as Record<string, unknown>)["csp-report"];
    if (typeof report === "object" && report !== null) {
      return [read(report as Record<string, unknown>)];
    }
  }
  return [];
}

export async function POST(request: Request): Promise<Response> {
  let text: string | null;
  try {
    text = await readCapped(request, MAX_BYTES);
  } catch {
    return new Response(null, { status: 204 });
  }
  if (text === null) {
    return new Response(null, { status: 204 });
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return new Response(null, { status: 204 });
  }
  const now = Date.now();
  if (now - windowStart > 60_000) {
    windowStart = now;
    loggedThisWindow = 0;
  }
  for (const violation of violationsIn(body)) {
    if (loggedThisWindow >= MAX_LOGGED_PER_MINUTE) {
      break;
    }
    loggedThisWindow += 1;
    logger().warn(violation, "csp.violation");
  }
  return new Response(null, { status: 204 });
}
