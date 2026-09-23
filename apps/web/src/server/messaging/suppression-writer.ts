import { auditLog, newId, suppressions, type Db } from "@desiauction/db";
import { and, eq, inArray, isNull } from "drizzle-orm";

import { PLATFORM_SCOPE_ID, PLATFORM_SCOPE_TYPE } from "../admin/capabilities";
import { maskContact } from "../admin/format";
import { liftSuppression, reinstateSuppression, suppress } from "./consent";
import { normalizeReason } from "./platform-switches";
import type { WriteHandles, WriteResult } from "./platform-switch-writer";
import {
  isSuppressionScope,
  liftNeedsConfirmation,
  parseSuppressionContact,
} from "./suppression-contact";

/**
 * THE ADMIN'S WRITES TO THE SUPPRESSION LIST (Notification Control Center,
 * Phase 4) — /admin/notifications/suppressions is the only caller.
 *
 * Here, beside the platform-switch writer and for the same reason: the admin
 * folder's projections are proven read-only by a source scan, so the write
 * verbs live under server/messaging and the actions only gate and call in.
 *
 * It goes THROUGH `suppress` / `liftSuppression` (consent.ts), the writers
 * inbound STOP/START and the bounce webhook already use, so there is one way a
 * row enters or leaves the list. What those writers do not know — who, and why
 * — is the audit row's: platform-scoped, on the SYSTEM pool, written inside the
 * app-pool transaction's callback so a change that cannot be recorded is
 * rolled back (the platform-switch writer's argument, unchanged).
 *
 * THE AUDIT ROW CARRIES A MASKED CONTACT, NEVER THE CONTACT. The recent-changes
 * list must say which row a change touched without becoming a second copy of
 * the list itself; the suppression id is the handle, the hint is for a human.
 *
 * Every change is a flip of ONE row between in force and lifted, recorded as
 * before/after. Revert applies `before` again if the row is still at `after`,
 * and is itself audited — the same contract as Phase 1's switches.
 */

export const SUPPRESSION_AUDIT_ACTIONS = {
  add: "notification.suppression_added",
  lift: "notification.suppression_lifted",
  reinstate: "notification.suppression_reinstated",
} as const;

export const SUPPRESSION_AUDIT_ACTION_LIST: readonly string[] =
  Object.values(SUPPRESSION_AUDIT_ACTIONS);

export type SuppressionOp = keyof typeof SUPPRESSION_AUDIT_ACTIONS;

export interface SuppressionAuditMeta {
  readonly change: "suppression";
  readonly op: SuppressionOp;
  readonly suppressionId: string;
  readonly channel: "sms" | "email";
  readonly scope: string;
  /** The row's own reason: stop, bounce, complaint, manual, unreachable. */
  readonly suppressionReason: string;
  readonly contactHint: string;
  readonly before: { readonly active: boolean };
  readonly after: { readonly active: boolean };
  /** The operator's written reason. */
  readonly reason: string | null;
  readonly revertOf?: string;
}

export type SuppressionWriteResult =
  | WriteResult
  /** A STOP or complaint, lifted without the explicit confirmation. */
  | { readonly ok: false; readonly error: string; readonly needsConfirmation: true };

export const SUPPRESSION_REASON_MIN = 5;
export const SUPPRESSION_REASON_MAX = 500;

function writtenReason(raw: string | undefined): string | null {
  const reason = normalizeReason(raw);
  if (reason === null || reason.length < SUPPRESSION_REASON_MIN) return null;
  return reason.slice(0, SUPPRESSION_REASON_MAX);
}

const NEEDS_REASON: WriteResult = {
  ok: false,
  error: `Write a reason, at least ${String(SUPPRESSION_REASON_MIN)} characters.`,
};

async function audit(
  handles: WriteHandles,
  actorId: string,
  meta: SuppressionAuditMeta,
): Promise<string> {
  const id = newId();
  await handles.auditDb.insert(auditLog).values({
    id,
    actor: actorId,
    action: SUPPRESSION_AUDIT_ACTIONS[meta.op],
    scopeType: PLATFORM_SCOPE_TYPE,
    scopeId: PLATFORM_SCOPE_ID,
    subject: meta.suppressionId,
    meta,
  });
  return id;
}

type SuppressionRow = typeof suppressions.$inferSelect;

async function lockRow(tx: Db, id: string): Promise<SuppressionRow | undefined> {
  const [row] = await tx
    .select()
    .from(suppressions)
    .where(eq(suppressions.id, id))
    .for("update")
    .limit(1);
  return row;
}

function channelWords(channel: "sms" | "email"): string {
  return channel === "sms" ? "texts (SMS and WhatsApp)" : "email";
}

/**
 * Add a manual suppression: this contact gets nothing on its channel, for one
 * topic or all of them. A no-op, not a second row, when one is already in force.
 */
export async function addManualSuppression(
  handles: WriteHandles,
  actorId: string,
  input: { contact: string; scope: string; reason?: string },
): Promise<WriteResult> {
  const parsed = parseSuppressionContact(input.contact);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  if (!isSuppressionScope(input.scope)) return { ok: false, error: "Pick what it covers." };
  const reason = writtenReason(input.reason);
  if (reason === null) return NEEDS_REASON;
  const { contact, channel } = parsed;
  return handles.db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: suppressions.id })
      .from(suppressions)
      .where(
        and(
          eq(suppressions.contact, contact),
          eq(suppressions.channel, channel),
          eq(suppressions.scope, input.scope),
          isNull(suppressions.liftedAt),
        ),
      )
      .limit(1);
    if (existing !== undefined) {
      return { ok: true, message: "Already suppressed. Nothing changed.", auditId: null } as const;
    }
    const id = await suppress(tx, {
      contact,
      channel,
      scope: input.scope,
      reason: "manual",
      note: `admin: ${reason}`,
    });
    const auditId = await audit(handles, actorId, {
      change: "suppression",
      op: "add",
      suppressionId: id,
      channel,
      scope: input.scope,
      suppressionReason: "manual",
      contactHint: maskContact(contact),
      before: { active: false },
      after: { active: true },
      reason,
    });
    return {
      ok: true,
      message: `Suppressed: no ${channelWords(channel)}${input.scope === "global" ? "" : ` about ${input.scope}`} to ${maskContact(contact)}.`,
      auditId,
    } as const;
  });
}

/**
 * Lift one suppression. A written reason always; for a STOP or a complaint,
 * `confirmed` as well — the person asked us not to contact them, and the
 * dialog saying so is not the only thing standing between a click and a text.
 */
export async function liftSuppressionByAdmin(
  handles: WriteHandles,
  actorId: string,
  input: { suppressionId: string; reason?: string; confirmed?: boolean },
): Promise<SuppressionWriteResult> {
  const reason = writtenReason(input.reason);
  if (reason === null) return NEEDS_REASON;
  return handles.db.transaction(async (tx) => {
    const row = await lockRow(tx, input.suppressionId);
    if (row === undefined) return { ok: false, error: "That suppression is not on the list." };
    if (row.liftedAt !== null) {
      return { ok: true, message: "Already lifted. Nothing changed.", auditId: null } as const;
    }
    if (liftNeedsConfirmation(row.reason) && input.confirmed !== true) {
      return {
        ok: false,
        error:
          row.reason === "stop"
            ? "This person asked us to stop. Confirm before lifting it."
            : "This person complained. Confirm before lifting it.",
        needsConfirmation: true,
      } as const;
    }
    await liftSuppression(tx, { contact: row.contact, channel: row.channel, ids: [row.id] });
    const auditId = await audit(handles, actorId, {
      change: "suppression",
      op: "lift",
      suppressionId: row.id,
      channel: row.channel,
      scope: row.scope,
      suppressionReason: row.reason,
      contactHint: maskContact(row.contact),
      before: { active: true },
      after: { active: false },
      reason,
    });
    return {
      ok: true,
      message: `Lifted: ${channelWords(row.channel)} to ${maskContact(row.contact)} can go again.`,
      auditId,
    } as const;
  });
}

export function isSuppressionAuditMeta(value: unknown): value is SuppressionAuditMeta {
  if (typeof value !== "object" || value === null) return false;
  const meta = value as Partial<SuppressionAuditMeta>;
  return (
    meta.change === "suppression" &&
    (meta.op === "add" || meta.op === "lift" || meta.op === "reinstate") &&
    typeof meta.suppressionId === "string" &&
    (meta.channel === "sms" || meta.channel === "email") &&
    typeof meta.before?.active === "boolean" &&
    typeof meta.after?.active === "boolean"
  );
}

/**
 * REVERT: put the row back where the audited change found it — refused when
 * the row has moved since (a START, a later lift), for the reason Phase 1
 * gives: reverting on top of a newer change would silently undo that too.
 */
export async function revertSuppressionChange(
  handles: WriteHandles,
  actorId: string,
  auditId: string,
): Promise<WriteResult> {
  const [entry] = await handles.auditDb
    .select({ meta: auditLog.meta })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.id, auditId),
        eq(auditLog.scopeType, PLATFORM_SCOPE_TYPE),
        inArray(auditLog.action, [...SUPPRESSION_AUDIT_ACTION_LIST]),
      ),
    )
    .limit(1);
  if (entry === undefined) return { ok: false, error: "That change is not on the list." };
  if (!isSuppressionAuditMeta(entry.meta)) {
    return { ok: false, error: "That change cannot be reverted." };
  }
  const meta = entry.meta;
  return handles.db.transaction(async (tx) => {
    const row = await lockRow(tx, meta.suppressionId);
    if (row === undefined) return { ok: false, error: "That suppression is gone." } as const;
    const active = row.liftedAt === null;
    if (active !== meta.after.active) {
      return {
        ok: false,
        error: "That suppression has changed since. Revert the later change first.",
      } as const;
    }
    const target = meta.before.active;
    if (target) {
      await reinstateSuppression(tx, [row.id]);
    } else {
      await liftSuppression(tx, { contact: row.contact, channel: row.channel, ids: [row.id] });
    }
    const id = await audit(handles, actorId, {
      ...meta,
      op: target ? "reinstate" : "lift",
      before: { active },
      after: { active: target },
      reason: meta.reason,
      revertOf: auditId,
    });
    return {
      ok: true,
      message: `Reverted: ${meta.contactHint} is ${target ? "suppressed again" : "no longer suppressed"} on ${channelWords(row.channel)}.`,
      auditId: id,
    } as const;
  });
}
