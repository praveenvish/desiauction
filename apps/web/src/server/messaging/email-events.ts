import { ingestDeliveryCallback } from "@desiauction/financial-operations/server";
import { finopsDispatches, suppressions, withTenantDb } from "@desiauction/db";
import { and, eq, isNull } from "drizzle-orm";

import { db, dbHandle, systemDb } from "../db";
import { webFinopsDeps } from "../financial-operations/deps";
import { suppress } from "./consent";

/**
 * WHAT A PROVIDER'S DELIVERY REPORT DOES TO US — shared by both report routes:
 * `/api/webhooks/delivery-status` (the generic shared-secret callback) and
 * `/api/webhooks/ses` (Amazon SNS, signature-verified). Each route proves its
 * caller and parses its own format; what follows is the same for both.
 *
 * Two halves, deliberately independent:
 *   · a bounce or complaint SUPPRESSES the address — a fact about the address,
 *     true whatever became of the message it arrived for;
 *   · a report about a finops dispatch (a receipt, an invoice) is INGESTED by
 *     the certified platform, which moves that dispatch to delivered/failed.
 */

// Matches the settlement writer's SYSTEM_ACTOR: platform-derived events name
// the system rather than borrowing a person who did not do them.
const SYSTEM_ACTOR = "00000000000000000000000000";

/**
 * Stop emailing an address. THE APP POOL: `desiauction_system` holds SELECT
 * on `suppressions` and nothing more, so a write there would fail in
 * production and a hard bounce would keep being sent to — how a sending domain
 * dies (audit PA-1 §10 P0-2). The table is deliberately not org-scoped: a
 * bounce is a fact about an address, not about one club.
 *
 * Skips an address already actively suppressed on email, so a provider that
 * reports the same bounce twice — SNS retries, SES's own repeats — adds one
 * row, not one per report.
 */
export async function suppressEmailAddress(input: {
  readonly recipient: string;
  readonly reason: "bounce" | "complaint";
  readonly note: string;
}): Promise<"suppressed" | "already"> {
  const contact = input.recipient.trim().toLowerCase();
  const [existing] = await db
    .select({ id: suppressions.id })
    .from(suppressions)
    .where(
      and(
        eq(suppressions.contact, contact),
        eq(suppressions.channel, "email"),
        eq(suppressions.scope, "global"),
        isNull(suppressions.liftedAt),
      ),
    )
    .limit(1);
  if (existing !== undefined) return "already";
  await suppress(db, { contact, channel: "email", reason: input.reason, note: input.note });
  return "suppressed";
}

/**
 * The dispatch's org, for the one purpose of opening its tenant boundary.
 *
 * Deliberately the whole of the system pool's involvement: the provider
 * reference is verified by the adapter FIRST, so the id below is one the
 * platform issued rather than one the caller chose, and this reads a single
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

/**
 * Hand a report about a finops dispatch to the certified platform.
 *
 * `raw` is the generic callback shape `parseEmailCallback` reads
 * (`event`, `providerRef: "email:<dispatchId>"`, `eventId`, `recipient`).
 * `ingestDeliveryCallback` verifies it through the adapter, is idempotent on
 * `provider:{eventId}`, refuses late and out-of-order transitions against the
 * frozen state machine, and audits even what it rejects.
 *
 * THE FINOPS HALF NEEDS A TENANT BOUNDARY: every finops table is FORCE RLS on
 * `app.org_id`, and which org is a fact only the dispatch knows. So one
 * id→org lookup on the system pool (above), and everything after it inside
 * `withTenantDb` on the app role, which holds append-only INSERT on
 * `finops_events` (create-app-role.sql).
 */
export async function ingestEmailReport(
  raw: string,
): Promise<{ readonly ok: true } | { readonly ok: false; readonly reason: string }> {
  const orgId = await resolveDispatchOrg(raw);
  if (orgId === null) {
    return { ok: false, reason: "dispatch_unknown" };
  }
  const ack = await withTenantDb(dbHandle, { personId: SYSTEM_ACTOR, orgId }, (tenantDb) =>
    ingestDeliveryCallback(webFinopsDeps(tenantDb), "email", raw),
  );
  return ack.ok ? { ok: true } : { ok: false, reason: ack.reason };
}
