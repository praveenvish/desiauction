"use server";
import { currentSession } from "../../../../server/auth/actions";
import { confirmationTenant } from "../../../../server/competition/resolve";
import { inOrg } from "../../../../server/tenant";
import { confirmMatch } from "../../../../server/scoring/confirmation";
import { revalidatePath } from "next/cache";
import type { ConfirmationFormState } from "./confirmation-types";
export async function submitConfirmation(
  token: string,
  _state: ConfirmationFormState,
  form: FormData,
): Promise<ConfirmationFormState> {
  const session = await currentSession();
  if (!session) return { error: "Sign in to confirm this result." };
  const orgId = await confirmationTenant(session.personId, token);
  if (!orgId) return { error: "This confirmation is unavailable." };
  const result = await inOrg(session.personId, orgId, (db) =>
    confirmMatch(db, session.personId, token, form.get("verdict"), form.get("note") ?? ""),
  );
  if (!result.ok) return { error: result.error };
  revalidatePath(`/match/confirm/${token}`);
  return { saved: true, trust: result.trust };
}
