"use server";

import { revalidatePath } from "next/cache";
import { inOrg } from "../tenant";
import { reviewMatchTrust, type TrustReviewDisposition } from "../scoring/trust-review";
import { operatorFor } from "./guard";

export async function moderateScoredMatch(input: {
  fixtureId: string;
  orgId: string;
  attempt: number;
  lastSeq: number;
  reason: string;
  disposition: TrustReviewDisposition;
}) {
  const gate = await operatorFor("platform.moderate", { reason: input.reason });
  if (!gate.ok) return gate;
  const result = await inOrg(gate.operator.personId, input.orgId, (db) =>
    reviewMatchTrust(db, {
      ...input,
      personId: gate.operator.personId,
      reason: gate.operator.reason,
      authority: "platform",
    }),
  );
  if (result.ok) revalidatePath("/admin/moderation");
  return result;
}
