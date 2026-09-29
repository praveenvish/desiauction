import { scrub } from "@desiauction/core";

import { parseClientErrorReport } from "../../../lib/client-error-report";
import { readCapped } from "../../../lib/read-capped";
import { logger } from "../../../server/logger";

/**
 * WHERE A BROWSER REPORTS A FAILURE THAT HAPPENED IN IT.
 *
 * The same shape as `/api/csp-report` beside it, for the same reasons. It is
 * unauthenticated — the page that crashed may be the login page — so it is
 * built to be harmless to abuse: it reads at most 8 KB, accepts only the fields
 * it knows, writes nothing but a log line, caps how many lines it writes a
 * minute, and answers 204 to everything, so it confirms nothing to a caller.
 *
 * What it logs has been through `scrub`: an error message is free text, and the
 * one that says `Key (phone)=(+91…)` is the reason that function exists. The
 * path has lost its query string on both sides of the wire, and any segment
 * long enough to be a token is replaced here.
 *
 * A page that CRASHED (either boundary) is logged at ERROR, so the alert that
 * counts error lines per service (`da-error-rate`) sees a broken page the way
 * it sees a broken request. What the window listeners catch is logged at WARN:
 * it includes other people's code — a browser extension, an injected script —
 * and one visitor's broken extension must not be able to page an operator.
 */
export const dynamic = "force-dynamic";

const MAX_BYTES = 8 * 1024;
const MAX_LOGGED_PER_MINUTE = 60;
let windowStart = 0;
let loggedThisWindow = 0;

const none = (): Response => new Response(null, { status: 204 });

export async function POST(request: Request): Promise<Response> {
  let text: string | null;
  try {
    text = await readCapped(request, MAX_BYTES);
  } catch {
    return none();
  }
  if (text === null) {
    return none();
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return none();
  }
  const report = parseClientErrorReport(body);
  if (report === null) {
    return none();
  }
  const now = Date.now();
  if (now - windowStart > 60_000) {
    windowStart = now;
    loggedThisWindow = 0;
  }
  if (loggedThisWindow >= MAX_LOGGED_PER_MINUTE) {
    return none();
  }
  loggedThisWindow += 1;
  const path = report.path
    .split("/")
    .map((segment) => (segment.length >= 16 ? ":redacted" : segment))
    .join("/");
  const crashed = report.source === "boundary" || report.source === "root-boundary";
  const fields = scrub({
    source: report.source,
    errorName: report.name,
    errorMessage: report.message,
    stack: report.stack,
    digest: report.digest,
    path,
    userAgent: (request.headers.get("user-agent") ?? "").slice(0, 200),
  }) as Record<string, unknown>;
  if (crashed) {
    logger().error(fields, "client.error");
  } else {
    logger().warn(fields, "client.error");
  }
  return none();
}
