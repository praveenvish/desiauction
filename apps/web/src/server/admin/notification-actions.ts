"use server";

import { revalidatePath } from "next/cache";

import { db as appDb, systemDb } from "../db";
import { logger } from "../logger";
import {
  applyNotificationChange,
  revertNotificationChange,
  type WriteResult,
} from "../messaging/platform-switch-writer";
import type { NotificationChange } from "../messaging/platform-switches";
import { platformAdminGate } from "./authz";

/**
 * THE NOTIFICATION CONTROL CENTER, write — `platform.admin` only.
 *
 * No new role (founder decision, 2026-09-23): the people who see the whole
 * platform are the people who switch its messages. Each action gates, then
 * hands the change to the writer, which validates it against the catalogue
 * (login never, security only with a reason, controllability restrict-only),
 * writes it and audits it. Nothing here writes a table itself — the write verbs
 * live in server/messaging/platform-switch-writer.ts, like every desk's.
 *
 * The switch tables ride the APP pool (no RLS, the app role holds the DML);
 * the platform-scoped audit row rides the SYSTEM pool, which is the only one
 * allowed to write it. See the writer for why the two cannot drift apart.
 */

export type NotificationActionResult = WriteResult;

const REFUSED: NotificationActionResult = { ok: false, error: "Not available." };

async function run(
  change: NotificationChange | { revert: string },
): Promise<NotificationActionResult> {
  const operator = await platformAdminGate();
  if (operator === null) {
    return REFUSED;
  }
  const handles = { db: appDb, auditDb: systemDb };
  try {
    const result =
      "revert" in change
        ? await revertNotificationChange(handles, operator.personId, change.revert)
        : await applyNotificationChange(handles, operator.personId, change);
    if (result.ok && result.auditId !== null) {
      logger().info(
        { operator: operator.personId, auditId: result.auditId },
        "notifications.switch_changed",
      );
      revalidatePath("/admin/notifications");
    }
    return result;
  } catch (error) {
    // A CHECK from 0086 (the database's own copy of the rules) lands here, as
    // does a failed audit write — which rolled the switch back with it.
    logger().error({ err: error, operator: operator.personId }, "notifications.switch_failed");
    return { ok: false, error: "That did not save. Nothing was changed." };
  }
}

/** One kind on one channel. A security alert needs `reason` to go off. */
export async function setNotificationSwitch(
  kind: string,
  channel: string,
  enabled: boolean,
  reason?: string,
): Promise<NotificationActionResult> {
  return run({ type: "switch", kind, channel, enabled, reason });
}

/** A whole channel, everywhere. Sign-in codes still go. */
export async function setChannelSwitch(
  channel: string,
  enabled: boolean,
  reason?: string,
): Promise<NotificationActionResult> {
  return run({ type: "channel", channel, enabled, reason });
}

/**
 * Who may switch a kind off. `true` gives the catalogue's answer back, `false`
 * takes the switch away; `undefined` leaves that side alone. Channel omitted:
 * every channel the kind is sent on.
 */
export async function setControllability(
  kind: string,
  channel: string | undefined,
  person: boolean | undefined,
  org: boolean | undefined,
): Promise<NotificationActionResult> {
  return run({ type: "control", kind, channel, person, org });
}

/** Re-apply what an audited change moved away from. */
export async function revertNotificationSwitch(auditId: string): Promise<NotificationActionResult> {
  return run({ revert: auditId });
}
