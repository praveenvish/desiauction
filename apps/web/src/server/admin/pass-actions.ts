"use server";

import { revalidatePath } from "next/cache";

import { systemDb } from "../db";
import { resolvePassRequest } from "../competition/pass-grant";
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

export async function answerPassRequest(
  slug: string,
  outcome: "granted" | "declined",
  note: string,
): Promise<AnswerPassResult> {
  const operator = await platformBillingGate();
  if (operator === null) {
    // The same silence as the rest of the console: a locked door that announces
    // itself is a map.
    return { ok: false, error: "Not available." };
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
