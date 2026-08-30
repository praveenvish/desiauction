import { demoBookings, demoRequests } from "@desiauction/db";
import { and, eq, isNull } from "drizzle-orm";

import { db } from "../db";
import { cancelBooking, tokenForRequest } from "./demo-booking";

/**
 * ANSWERING A DEMO REQUEST — the write, and why it lives HERE.
 *
 * It is not under `server/admin/` and it must not move there. Administration
 * holds exactly one write (`access-log.ts`), and that fact is enforced three
 * ways: a dependency-cruiser rule, a runtime proof that drives every projection
 * through a handle which throws on mutation, and a SOURCE-LEVEL scan that fails
 * the suite if a mutation verb appears in any file under administration at all.
 * `pass-actions.ts` solved the identical problem the identical way — the action
 * lives in administration, the verb lives in the domain — and copying that
 * shape is what keeps all three locks meaningful.
 *
 * ON THE APP POOL, NOT THE SYSTEM POOL. Every other cross-tenant admin write
 * needs BYPASSRLS because a platform operator is not a member of the
 * organization whose row they are changing. `demo_requests` has no organization
 * and no RLS at all (migration 0031), so there is nothing to bypass — and using
 * the system pool anyway would push its pinned write list from four tables to
 * five for no reason. `grants:verify` stays where it is.
 */

export const DEMO_OUTCOMES = [
  "scheduled",
  "showed",
  "no_show",
  "signed_up",
  "not_a_fit",
  "no_response",
] as const;

export type DemoOutcome = (typeof DEMO_OUTCOMES)[number];

export function isDemoOutcome(value: string): value is DemoOutcome {
  return (DEMO_OUTCOMES as readonly string[]).includes(value);
}

export type AnswerResult =
  { readonly ok: true; readonly summary: string } | { readonly ok: false; readonly error: string };

/**
 * Record how a request was answered.
 *
 * `contacted_at` and `outcome` move together — the CHECK in 0031 refuses an
 * outcome nobody gave, and this is the only writer, so the two can never drift
 * apart. Re-answering is allowed: "no response" becoming "signed up" a week
 * later is the ordinary shape of a sales conversation, not an error.
 */
export async function answerDemoRequest(
  requestId: string,
  outcome: string,
  actorId: string,
  now: Date = new Date(),
): Promise<AnswerResult> {
  if (!isDemoOutcome(outcome)) {
    return { ok: false, error: "That isn't an outcome we record." };
  }
  const updated = await db
    .update(demoRequests)
    .set({ contactedAt: now, contactedBy: actorId, outcome })
    .where(eq(demoRequests.id, requestId))
    .returning({ orgName: demoRequests.orgName });
  const row = updated[0];
  if (row === undefined) {
    return { ok: false, error: "That request no longer exists." };
  }
  return { ok: true, summary: `${row.orgName} marked ${outcome.replace("_", " ")}.` };
}

/**
 * Call one off on the requester's behalf — the phone call that says "something
 * has come up" needs a matching action, or the platform keeps reminding them
 * about a demo nobody is coming to.
 *
 * Reuses the public cancel path rather than issuing its own UPDATE, so an
 * organizer cancellation and a requester cancellation cannot diverge; only the
 * `by` differs, and the requester's page says which it was.
 */
export async function cancelDemoAsOrganizer(requestId: string): Promise<AnswerResult> {
  const [live] = await db
    .select({ id: demoBookings.id })
    .from(demoBookings)
    .where(and(eq(demoBookings.demoRequestId, requestId), isNull(demoBookings.cancelledAt)))
    .limit(1);
  if (live === undefined) {
    return { ok: false, error: "There's no live booking on that request." };
  }
  const result = await cancelBooking(tokenForRequest(requestId), "organizer");
  if (!result.ok) {
    return { ok: false, error: "That booking was already cancelled." };
  }
  return { ok: true, summary: "Cancelled. The requester can book another time." };
}
