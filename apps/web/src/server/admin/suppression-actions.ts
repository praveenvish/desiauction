"use server";

import { revalidatePath } from "next/cache";

import { db as appDb, systemDb } from "../db";
import { logger } from "../logger";
import {
  addManualSuppression,
  liftSuppressionByAdmin,
  revertSuppressionChange,
  type SuppressionWriteResult,
} from "../messaging/suppression-writer";
import { platformAdminGate } from "./authz";
import { searchSuppressions, type SuppressionSearch } from "./suppression-views";

/**
 * THE SUPPRESSION DESK, write — `platform.admin` only, like the rest of the
 * Notification Control Center. Each action gates, hands off to the writer
 * (server/messaging/suppression-writer.ts) and says what happened.
 *
 * The search is an action too, and on purpose: the contact an operator types
 * never goes into a URL, so it is not in the address bar, the browser history,
 * a proxy's access log or the admin access log.
 *
 * `suppressions` rides the APP pool (no RLS, the app role holds its DML — the
 * delivery webhook's argument); the platform-scoped audit row rides the SYSTEM
 * pool, the only one allowed to write it.
 */

export type SuppressionActionResult = SuppressionWriteResult;

const REFUSED = { ok: false, error: "Not available." } as const;
const PATH = "/admin/notifications/suppressions";

async function run(
  act: (
    handles: { db: typeof appDb; auditDb: typeof systemDb },
    actorId: string,
  ) => Promise<SuppressionWriteResult>,
): Promise<SuppressionActionResult> {
  const operator = await platformAdminGate();
  if (operator === null) return REFUSED;
  try {
    const result = await act({ db: appDb, auditDb: systemDb }, operator.personId);
    if (result.ok && result.auditId !== null) {
      logger().info(
        { operator: operator.personId, auditId: result.auditId },
        "notifications.suppression_changed",
      );
      revalidatePath(PATH);
    }
    return result;
  } catch (error) {
    logger().error({ err: error, operator: operator.personId }, "notifications.suppression_failed");
    return { ok: false, error: "That did not save. Nothing was changed." };
  }
}

/** Is this contact suppressed? Exact match on what was typed, normalized. */
export async function findSuppressions(contact: string): Promise<SuppressionSearch> {
  if ((await platformAdminGate()) === null) return REFUSED;
  return searchSuppressions(systemDb, String(contact).slice(0, 320));
}

export async function addSuppression(
  contact: string,
  scope: string,
  reason: string,
): Promise<SuppressionActionResult> {
  return run((handles, actorId) =>
    addManualSuppression(handles, actorId, { contact: String(contact), scope, reason }),
  );
}

/** `confirmed` must be true to lift a STOP or a complaint — checked by the writer. */
export async function liftSuppressionAction(
  suppressionId: string,
  reason: string,
  confirmed: boolean,
): Promise<SuppressionActionResult> {
  return run((handles, actorId) =>
    liftSuppressionByAdmin(handles, actorId, {
      suppressionId: String(suppressionId),
      reason,
      confirmed: confirmed === true,
    }),
  );
}

export async function revertSuppression(auditId: string): Promise<SuppressionActionResult> {
  return run((handles, actorId) => revertSuppressionChange(handles, actorId, String(auditId)));
}
