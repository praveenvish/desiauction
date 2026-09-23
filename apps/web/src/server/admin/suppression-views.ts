import { auditLog, people, suppressions, type Db } from "@desiauction/db";
import { and, desc, eq, inArray } from "drizzle-orm";

import { liftNeedsConfirmation, parseSuppressionContact } from "../messaging/suppression-contact";
import {
  SUPPRESSION_AUDIT_ACTION_LIST,
  isSuppressionAuditMeta,
  type SuppressionAuditMeta,
} from "../messaging/suppression-writer";
import { systemDb } from "../db";
import { platformAdminGate } from "./authz";
import { PLATFORM_SCOPE_ID, PLATFORM_SCOPE_TYPE } from "./capabilities";

/**
 * THE SUPPRESSION DESK, read (Notification Control Center, Phase 4) —
 * /admin/notifications/suppressions.
 *
 * A projection: it writes nothing. The writes are
 * server/messaging/suppression-writer.ts, called from suppression-actions.ts.
 *
 * WHAT IT WILL NOT SHOW (DPDP). There is no browsable list of contacts here.
 * The desk answers ONE question — "is this contact suppressed, and why?" —
 * for the contact the operator typed, by exact match on the stored shape. The
 * rows it returns carry channel, scope, reason, times and a SOURCE derived from
 * the row; never the free-text note, which for an inbound STOP is the person's
 * own message. The recent-changes list names each row by a masked hint.
 */

const SEARCH_LIMIT = 50;
const RECENT = 20;

export type SuppressionSource = "inbound_text" | "email_provider" | "admin" | "system";

export interface SuppressionRowView {
  readonly id: string;
  readonly channel: "sms" | "email";
  readonly scope: string;
  readonly reason: string;
  readonly createdAt: Date;
  readonly liftedAt: Date | null;
  readonly source: SuppressionSource;
  /** Lifting it overrides something the person said: STOP or complaint. */
  readonly needsConfirmation: boolean;
}

export type SuppressionSearch =
  | {
      readonly ok: true;
      /** The contact as stored — what the operator typed, normalized. */
      readonly contact: string;
      readonly channel: "sms" | "email";
      readonly rows: readonly SuppressionRowView[];
    }
  | { readonly ok: false; readonly error: string };

export interface SuppressionChange {
  readonly id: string;
  readonly at: Date;
  readonly actorName: string | null;
  readonly summary: string;
  readonly reason: string | null;
  readonly revertOf: string | null;
  readonly revertable: boolean;
}

/**
 * Where a row came from, read off the note's prefix as each writer sets it
 * (inbound.ts `inbound:`, the delivery webhook `provider event:`, the admin
 * writer `admin:`) — and falling back to the reason for older rows.
 */
export function sourceOf(row: { reason: string; note: string | null }): SuppressionSource {
  const note = row.note ?? "";
  if (note.startsWith("admin:") || row.reason === "manual") return "admin";
  if (note.startsWith("provider event:")) return "email_provider";
  if (note.startsWith("inbound:") || row.reason === "stop") return "inbound_text";
  if (row.reason === "bounce" || row.reason === "complaint") return "email_provider";
  return "system";
}

export async function searchSuppressions(db: Db, raw: string): Promise<SuppressionSearch> {
  const parsed = parseSuppressionContact(raw);
  if (!parsed.ok) return parsed;
  // Exact contact + channel: the leading columns of suppressions_contact_idx.
  const rows = await db
    .select({
      id: suppressions.id,
      channel: suppressions.channel,
      scope: suppressions.scope,
      reason: suppressions.reason,
      note: suppressions.note,
      createdAt: suppressions.createdAt,
      liftedAt: suppressions.liftedAt,
    })
    .from(suppressions)
    .where(and(eq(suppressions.contact, parsed.contact), eq(suppressions.channel, parsed.channel)))
    .orderBy(desc(suppressions.createdAt), desc(suppressions.id))
    .limit(SEARCH_LIMIT);
  return {
    ok: true,
    contact: parsed.contact,
    channel: parsed.channel,
    // In force first, then history; newest first within each.
    rows: rows
      .map((row): SuppressionRowView => ({
        id: row.id,
        channel: row.channel,
        scope: row.scope,
        reason: row.reason,
        createdAt: row.createdAt,
        liftedAt: row.liftedAt,
        source: sourceOf(row),
        needsConfirmation: liftNeedsConfirmation(row.reason),
      }))
      .sort((a, b) => Number(a.liftedAt !== null) - Number(b.liftedAt !== null)),
  };
}

function channelName(channel: "sms" | "email"): string {
  return channel === "sms" ? "texts" : "email";
}

/** One sentence per audited change, naming the row by its masked hint. */
export function summarizeSuppression(meta: SuppressionAuditMeta): string {
  const what = `${meta.contactHint} · ${channelName(meta.channel)}${meta.scope === "global" ? "" : ` · ${meta.scope}`}`;
  switch (meta.op) {
    case "add":
      return `Suppressed by hand: ${what}`;
    case "lift":
      return `Lifted (${meta.suppressionReason}): ${what}`;
    case "reinstate":
      return `Put back in force (${meta.suppressionReason}): ${what}`;
  }
}

export async function recentSuppressionChanges(db: Db): Promise<SuppressionChange[]> {
  const rows = await db
    .select({
      id: auditLog.id,
      at: auditLog.at,
      meta: auditLog.meta,
      actorName: people.name,
    })
    .from(auditLog)
    .leftJoin(people, eq(people.id, auditLog.actor))
    .where(
      and(
        eq(auditLog.scopeType, PLATFORM_SCOPE_TYPE),
        eq(auditLog.scopeId, PLATFORM_SCOPE_ID),
        inArray(auditLog.action, [...SUPPRESSION_AUDIT_ACTION_LIST]),
      ),
    )
    .orderBy(desc(auditLog.at), desc(auditLog.id))
    .limit(RECENT);
  const metas = rows.flatMap((row) =>
    isSuppressionAuditMeta(row.meta) ? [{ ...row, meta: row.meta }] : [],
  );
  const ids = [...new Set(metas.map((row) => row.meta.suppressionId))];
  const current =
    ids.length === 0
      ? []
      : await db
          .select({ id: suppressions.id, liftedAt: suppressions.liftedAt })
          .from(suppressions)
          .where(inArray(suppressions.id, ids));
  const active = new Map(current.map((row) => [row.id, row.liftedAt === null]));
  // Only the NEWEST change to a row offers Revert. An add and the reinstate
  // after its lift both leave the row in force; offering both would let the
  // older one undo the newer by accident.
  const seen = new Set<string>();
  return metas.map((row) => {
    const newest = !seen.has(row.meta.suppressionId);
    seen.add(row.meta.suppressionId);
    return {
      id: row.id,
      at: row.at,
      actorName: row.actorName,
      summary: summarizeSuppression(row.meta),
      reason: row.meta.reason,
      revertOf: row.meta.revertOf ?? null,
      revertable: newest && active.get(row.meta.suppressionId) === row.meta.after.active,
    };
  });
}

/** The desk's server-rendered half: the change log. The search is an action. */
export interface SuppressionDesk {
  readonly recent: readonly SuppressionChange[];
}

export async function suppressionDesk(db: Db): Promise<SuppressionDesk> {
  return { recent: await recentSuppressionChanges(db) };
}

/**
 * The page's read: `platform.admin`, or nothing. On the SYSTEM pool: the
 * change log is platform-scoped audit rows no tenant context can read.
 */
export async function adminSuppressionDesk(): Promise<SuppressionDesk | null> {
  if ((await platformAdminGate()) === null) return null;
  return suppressionDesk(systemDb);
}
