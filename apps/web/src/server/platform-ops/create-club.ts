import { auditLog, newId } from "@desiauction/db";

import { createOrg } from "../orgs/orgs";
import { inOrg } from "../tenant";
import type { DeskResult } from "./club";

/*
 * NEW CLUB FROM /admin/orgs — called only from club-actions.ts after
 * `operatorFor("platform.grant")`.
 *
 * A superadmin with no club of their own has no road to /orgs (the rail shows
 * "Clubs" only to organizers), so admin had no way to start one. This is the
 * same `createOrg` every organizer uses, in the new club's own boundary on the
 * APP role, and the operator becomes its owner exactly as an organizer would.
 * Handing the club to someone else is the club desk's existing "Transfer
 * ownership", which has its own step-up, reason and audit row.
 */
export async function createClubAsOperator(input: {
  operator: string;
  name: string;
  reason: string;
}): Promise<DeskResult & { slug?: string }> {
  const orgId = newId();
  try {
    const org = await inOrg(input.operator, orgId, async (tx) => {
      const created = await createOrg(tx, input.operator, input.name, orgId);
      await tx.insert(auditLog).values({
        id: newId(),
        actor: input.operator,
        action: "org.created_by_admin",
        scopeType: "org",
        scopeId: orgId,
        subject: orgId,
        meta: { via: "admin", reason: input.reason },
      });
      return created;
    });
    return { ok: true, message: `${org.name} is ready. You're its owner.`, slug: org.slug };
  } catch (error) {
    if (error instanceof Error && error.message.includes("at least 3 characters")) {
      return { ok: false, error: "Give the club a name of at least 3 characters." };
    }
    throw error;
  }
}
