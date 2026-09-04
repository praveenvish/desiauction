import { timingSafeEqual } from "node:crypto";

import { ingestDeliveryCallback } from "@desiauction/financial-operations/server";
import { finopsDispatches, withTenantDb } from "@desiauction/db";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { env } from "../../../../env";
import { db, dbHandle, systemDb } from "../../../../server/db";
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

// Matches the settlement writer's SYSTEM_ACTOR: platform-derived events name
// the system rather than borrowing a person who did not do them.
const SYSTEM_ACTOR = "00000000000000000000000000";

/**
 * The dispatch's org, for the one purpose of opening its tenant boundary.
 *
 * Deliberately the whole of the system pool's involvement in this route: the
 * provider reference is verified by the adapter FIRST, so the id below is one
 * the platform issued rather than one the caller chose, and this reads a single
 * column and writes nothing. Null means "no such dispatch", which the caller
 * turns into the same `dispatch_unknown` the platform already answered.
 */
async function resolveDispatchOrg(raw: string): Promise<string | null> {
  const parsed = webFinopsDeps(systemDb).delivery("email")?.verifyCallback?.(raw);
  if (parsed === undefined || !parsed.ok) {
    return null;
  }
  const [row] = await systemDb
    .select({ orgId: finopsDispatches.orgId })
    .from(finopsDispatches)
    .where(eq(finopsDispatches.id, parsed.dispatchId))
    .limit(1);
  return row?.orgId ?? null;
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
    // THE APP POOL. `desiauction_system` holds SELECT on `suppressions` and
    // nothing more, so this wrote nothing in production and answered 500 — a
    // hard bounce kept being sent to, which is how a sending domain dies
    // (audit PA-1 §10 P0-2). The table is deliberately not org-scoped: a bounce
    // is a fact about an address, not about one club, so there is no tenant
    // boundary to enter and the app pool is the correct one.
    await suppress(db, {
      contact: parsed.recipient.toLowerCase(),
      channel: "email",
      reason: parsed.event.includes("complain") || parsed.event === "spam" ? "complaint" : "bounce",
      note: `provider event: ${parsed.event}`,
    });
  }

  /**
   * THE FINOPS HALF NEEDS A TENANT BOUNDARY, AND HAD NONE.
   *
   * `ingestDeliveryCallback` verifies the payload, loads the dispatch and then
   * appends finops events scoped to that dispatch's org. Run on the system pool
   * it wrote through a role holding SELECT and nothing else; run on the app pool
   * with no boundary it would see no rows at all, because every finops table is
   * FORCE RLS on `app.org_id`.
   *
   * Which org, though, is a fact only the dispatch knows — and reading the
   * dispatch is itself an org-scoped read. That circle is exactly what the
   * system pool exists for, and this is the smallest possible use of it: ONE
   * id→org lookup, no payload trusted, nothing written. The provider's
   * reference is verified by the adapter before it is used, so the id is not
   * attacker-chosen; and if the lookup finds nothing the platform answers
   * `dispatch_unknown`, which is what it answered before.
   *
   * Everything after it runs inside the boundary, on the app role, which now
   * holds append-only INSERT on `finops_events` (create-app-role.sql).
   */
  const orgId = await resolveDispatchOrg(raw);
  const ack =
    orgId === null
      ? ({ ok: false, reason: "dispatch_unknown" } as const)
      : await withTenantDb(dbHandle, { personId: SYSTEM_ACTOR, orgId }, (tenantDb) =>
          ingestDeliveryCallback(webFinopsDeps(tenantDb), "email", raw),
        );

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
