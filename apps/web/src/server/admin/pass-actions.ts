"use server";

import { revalidatePath } from "next/cache";

import { systemDb } from "../db";
import { resolvePassRequest, type GrantOutcome } from "../competition/pass-grant";
import { platformBillingGate } from "./authz";

/**
 * THE ONE THING ADMINISTRATION MAY CHANGE.
 *
 * Everything else in this folder observes. This module writes, and it is a
 * separate module behind a separate grant for exactly that reason: keeping the
 * write out of `views.ts` and `actions.ts` is what lets the runtime read-only
 * proof keep holding the projections, and what lets `platform:admin` keep
 * meaning "may see" rather than quietly becoming "may act".
 *
 * `platform:billing`, not `platform:admin`. Seeing every organization's money
 * and every person's phone, and changing what a customer is entitled to, are
 * different acts of trust; nobody acquires the second by being handed the
 * first. An operator who does both holds both grants, and the audit says which
 * of them answered.
 *
 * Runs on the SYSTEM pool because a platform operator is not a member of the
 * organization whose season this is — the same reason every cross-tenant
 * projection does. The gate that admits them ran under RLS first.
 */

export type AnswerPassResult = { ok: true; summary: string } | { ok: false; error: string };

/**
 * The two answers there are, kept in step with `GrantOutcome` by the `satisfies`
 * — if the domain ever grows a third, this list stops compiling rather than
 * silently refusing it.
 */
const OUTCOMES = ["granted", "declined"] as const satisfies readonly GrantOutcome[];

function isGrantOutcome(value: string): value is GrantOutcome {
  return (OUTCOMES as readonly string[]).includes(value);
}

/**
 * `outcome` is typed at the call site but NOT trusted here: a server action's
 * arguments arrive over the wire, so the parameter is widened to `string` on
 * purpose. It used to travel unread all the way to
 * `pass_upgrade_requests_outcome_check`, where anything else came back as an
 * unhandled 500 — a stack trace where the surface has a refusal it knows how to
 * render.
 */
export async function answerPassRequest(
  slug: string,
  outcome: string,
  note: string,
): Promise<AnswerPassResult> {
  const operator = await platformBillingGate();
  if (operator === null) {
    // The same silence as the rest of the console: a locked door that announces
    // itself is a map.
    return { ok: false, error: "Not available." };
  }
  if (!isGrantOutcome(outcome)) {
    return { ok: false, error: "Answer the request with a grant or a decline." };
  }
  const result = await resolvePassRequest(systemDb, {
    slug,
    outcome,
    actorId: operator.personId,
    ...(note.trim() === "" ? {} : { note: note.trim().slice(0, 500) }),
  });
  if (!result.ok) {
    return { ok: false, error: result.detail };
  }
  revalidatePath("/admin/passes");
  return {
    ok: true,
    summary:
      result.outcome === "granted"
        ? `${result.slug} moved to ${result.toTier}.`
        : `${result.slug} declined; still ${result.fromTier}.`,
  };
}
