"use server";

import { revalidatePath } from "next/cache";

import { currentSession } from "../auth/actions";
import { logSecurityEvent } from "../auth/security-events";
import { logger } from "../logger";
import { asPerson } from "../tenant";
import { fileRequest, latestRequestOf, withdrawRequest, type MyErasureRequest } from "./requests";

/**
 * THE PERSON'S SIDE OF ERASURE — ask, see where it stands, take it back.
 *
 * Nothing here erases anything. Filing is a request a human reads (the privacy
 * desk, `platform:privacy`), because an erasure cannot be undone and ends the
 * person's standing in every club at once — the kind of act that deserves a
 * second pair of eyes and a refusal path, not a button that fires on a misclick
 * from a shared handset.
 */

export async function myErasureRequest(): Promise<MyErasureRequest | null> {
  const session = await currentSession();
  if (session === null) {
    return null;
  }
  return asPerson(session.personId, (db) => latestRequestOf(db, session.personId));
}

export interface ErasureFormState {
  error?: string;
  filed?: boolean;
}

export async function requestErasureAction(
  _previous: ErasureFormState,
  formData: FormData,
): Promise<ErasureFormState> {
  const session = await currentSession();
  if (session === null) {
    return { error: "Sign in again to make this request." };
  }
  // The dialog gates its button on this box; the server holds the same line,
  // because a client gate is a courtesy.
  if (formData.get("understood") !== "yes") {
    return { error: "Tick the box to confirm you understand what deleting your account does." };
  }
  const reason = formData.get("reason");
  const filed = await asPerson(session.personId, (db) =>
    fileRequest(db, session.personId, typeof reason === "string" ? reason : null),
  );
  if (filed.created) {
    try {
      await logSecurityEvent(session.personId, "privacy.erasure.requested");
    } catch (error) {
      // The request is the fact; the ledger line is a courtesy to the person.
      logger().error({ err: error }, "privacy.erasure_request_ledger_failed");
    }
  }
  revalidatePath("/account");
  return { filed: true };
}

export async function withdrawErasureAction(): Promise<{ ok: boolean }> {
  const session = await currentSession();
  if (session === null) {
    return { ok: false };
  }
  const withdrawn = await asPerson(session.personId, (db) => withdrawRequest(db, session.personId));
  if (withdrawn) {
    try {
      await logSecurityEvent(session.personId, "privacy.erasure.withdrawn");
    } catch (error) {
      logger().error({ err: error }, "privacy.erasure_withdraw_ledger_failed");
    }
    revalidatePath("/account");
  }
  return { ok: withdrawn };
}
