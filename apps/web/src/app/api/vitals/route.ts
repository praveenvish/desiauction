import { parseVitalSample, redactPath } from "../../../lib/web-vitals-report";
import { readCapped } from "../../../lib/read-capped";
import { logger } from "../../../server/logger";

/**
 * WHERE A BROWSER REPORTS HOW FAST A PAGE WAS FOR IT (SEO-1 Phase 8).
 *
 * The same shape as `/api/client-error` beside it: unauthenticated (a visitor
 * on the landing page has no session), read at most 1 KB, accept only the
 * fields it knows, write nothing but a log line, cap the lines a minute, and
 * answer 204 to everything. The log line — `web_vitals` — is what the p75 in
 * docs/57 is computed from; it carries no user, no session and no address.
 */
export const dynamic = "force-dynamic";

const MAX_BYTES = 1024;
const MAX_LOGGED_PER_MINUTE = 600;
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
  if (text === null) return none();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return none();
  }
  const sample = parseVitalSample(body);
  if (sample === null) return none();
  const now = Date.now();
  if (now - windowStart > 60_000) {
    windowStart = now;
    loggedThisWindow = 0;
  }
  if (loggedThisWindow >= MAX_LOGGED_PER_MINUTE) return none();
  loggedThisWindow += 1;
  logger().info(
    {
      metric: sample.name,
      value: sample.value,
      rating: sample.rating,
      path: redactPath(sample.path),
    },
    "web_vitals",
  );
  return none();
}
