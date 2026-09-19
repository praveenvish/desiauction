"use server";

import { revalidatePath } from "next/cache";

import { systemDb } from "../db";
import { resolvePassRequest, type GrantOutcome } from "../competition/pass-grant";
import { inOrg } from "../tenant";
import { platformBillingGate } from "./authz";
import { platformSeasonBySlug } from "./season-lookup";

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
 * The WRITE runs on the application role inside the season's own tenant
 * boundary. It used to run on the system pool, on the reasoning that a platform
 * operator is a member of no club — but the system role is a platform-READ role
 * with UPDATE on nothing a pass touches (ops/db/create-app-role.sql), so under
 * the production roles every answer failed with "permission denied for table
 * pass_upgrade_requests" while every local suite, running as the owner, passed.
 * The system pool now answers only "which club is this season in?", which a
 * member of no club cannot ask any other way; the boundary then names that club,
 * and the gate that admitted the operator ran under RLS first.
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
  const season = await platformSeasonBySlug(systemDb, slug);
  if (season === null) {
    return { ok: false, error: `No season with slug ${slug}.` };
  }
  const result = await inOrg(operator.personId, season.orgId, (db) =>
    resolvePassRequest(db, {
      slug,
      outcome,
      actorId: operator.personId,
      ...(note.trim() === "" ? {} : { note: note.trim().slice(0, 500) }),
    }),
  );
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
