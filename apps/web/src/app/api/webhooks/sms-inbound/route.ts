import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { env } from "../../../../env";
import { db } from "../../../../server/db";
import { applyInbound } from "../../../../server/messaging/inbound";
import { withRequestId } from "../../../../server/logger";

/**
 * INBOUND SMS WEBHOOK — where a STOP actually lands.
 *
 * Follows the trusted-ingress order the settlement webhook established
 * (server/settlement/webhook.ts): verify the shared secret BEFORE touching the
 * database, and never answer with a 500, because the shape of a failure must
 * not tell the caller how far they got.
 *
 * The secret is a header rather than an HMAC because the operator posts a plain
 * form body with no signing scheme of its own. That is weaker than the
 * settlement gateway's signature, and the mitigations are: the secret is
 * long-lived and out of band, the endpoint performs exactly one narrow action
 * (suppress or lift a number), and it discloses nothing at all in its response.
 * The worst a leaked secret buys an attacker is the ability to silence numbers
 * they already know — annoying, reversible with START, and recorded.
 *
 * `SMS_INBOUND_SECRET` unset means the endpoint is CLOSED, not open. A webhook
 * that accepts anything when misconfigured is worse than one that never
 * accepts: the failure is silent and the list fills with forgeries.
 */

export const dynamic = "force-dynamic";

/** Constant-time compare, so the response time does not leak the secret. */
function secretMatches(provided: string | null, expected: string): boolean {
  if (provided === null) {
    return false;
  }
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  // timingSafeEqual throws on a length mismatch, which would itself be a
  // timing signal — compare lengths first and still run the comparison.
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Operators disagree about field names, and the cost of guessing wrong is a
 * STOP that silently does nothing. Accept the common spellings rather than
 * pinning one vendor's contract into the route.
 */
function readField(source: Record<string, unknown>, names: readonly string[]): string {
  for (const name of names) {
    const value = source[name];
    if (typeof value === "string" && value.trim() !== "") {
      return value;
    }
  }
  return "";
}

async function handle(request: Request): Promise<NextResponse> {
  const expected = env.SMS_INBOUND_SECRET;
  if (expected === undefined || expected === "") {
    // Closed until configured. 404 rather than 503: an unconfigured endpoint
    // should be indistinguishable from one that does not exist.
    return new NextResponse(null, { status: 404 });
  }
  if (!secretMatches(request.headers.get("x-inbound-secret"), expected)) {
    return new NextResponse(null, { status: 401 });
  }

  let payload: Record<string, unknown> = {};
  try {
    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      payload = (await request.json()) as Record<string, unknown>;
    } else {
      payload = Object.fromEntries(new URLSearchParams(await request.text()));
    }
  } catch {
    return new NextResponse(null, { status: 400 });
  }

  const from = readField(payload, ["from", "sender", "mobile", "msisdn", "number"]);
  const body = readField(payload, ["text", "message", "content", "body", "keyword"]);
  if (from === "") {
    return new NextResponse(null, { status: 400 });
  }

  /**
   * THE APP POOL, NOT THE SYSTEM POOL (audit PA-1 §10 P0-2).
   *
   * This wrote through `systemDb`, and `desiauction_system` holds SELECT on
   * `suppressions` and nothing more — so in production every STOP answered with
   * a 500 and nobody was ever unsubscribed. That is a DPDP opt-out we accepted
   * and dropped, and it was invisible locally because every local process
   * connects as the database owner.
   *
   * `suppressions` is deliberately NOT org-scoped: a person texting STOP is
   * telling the platform, not one club, and the table carries no `org_id` and no
   * RLS. So there is no tenant boundary to enter here — the correct pool is the
   * app pool, which holds the DML this write needs, and the absence of a
   * `withTenantDb` wrapper is the point rather than an omission.
   */
  const result = await applyInbound(db, { from, body });

  /*
   * 200 even for a keyword we do not recognise.
   *
   * The operator retries anything that is not a 2xx, and a person texting
   * "thanks" is not an error to retry — it is a message with no instruction in
   * it. Reserving non-2xx for "we could not read this request at all" keeps the
   * retry queue meaningful.
   *
   * The body says only what we did with the instruction, never whether the
   * number is known to us.
   */
  return NextResponse.json(
    result.handled ? { status: "ok", action: result.intent } : { status: "ok", action: "ignored" },
    { status: 200 },
  );
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
