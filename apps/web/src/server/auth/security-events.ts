import { auditLog, newId, people, withTenantDb } from "@desiauction/db";
import { and, desc, eq, gt, lt, notInArray, sql } from "drizzle-orm";
import { cache } from "react";

import { dbHandle } from "../db";
import { hiddenInboxActions } from "../messaging/gate";
import { isPushable, pushInboxNotice, pushKeys } from "../messaging/push";
import { UNREAD_CAP } from "../../lib/inbox-cap";
import { LEDGER_ONLY_ACTIONS, inboxExclusions } from "./inbox-filter";
import type { SecurityAction } from "./security-actions";

// Security events ride the append-only audit substrate (IP-2_DESIGN D8) with
// person scope — one ledger, one query surface, no parallel event store.
// PRP-1 §1: audit_log is RLS-guarded (WITH CHECK actor = app.person_id), so
// both the write and the read open their own person boundary here — the
// personId parameter IS the tenant context for person-scoped evidence.

export type { SecurityAction } from "./security-actions";

export async function logSecurityEvent(
  personId: string,
  action: SecurityAction,
  meta?: Record<string, string>,
): Promise<void> {
  await withTenantDb(dbHandle, { personId }, (db) =>
    db.insert(auditLog).values({
      id: newId(),
      actor: personId,
      action,
      scopeType: "person",
      scopeId: personId,
      meta: meta ?? null,
    }),
  );
  // The notice on the person's devices too (PR18) — not awaited: the row is
  // the fact, and a slow push service must never hold up the action that
  // wrote it. pushInboxNotice never throws, and returns at once when web push
  // is not configured or the action is not a notification.
  if (isPushable(action) && pushKeys() !== null) {
    void pushInboxNotice(personId, action, meta ?? null);
  }
}

export interface SecurityEvent {
  action: string;
  at: Date;
  meta: unknown;
}

/**
 * The person's ledger, newest first.
 *
 * The limit used to be a hard 10 with no pagination and no truncation notice.
 * Every sign-in writes a row, so on a real account all ten read
 * `auth.login.otp` and a passkey removal from the week before was invisible —
 * an audit surface that could not show an audit event. The limit is now the
 * caller's to choose, and `countSecurityEvents` lets a surface say how much it
 * is NOT showing instead of quietly truncating.
 */
export async function listSecurityEvents(
  personId: string,
  limit = 10,
  offset = 0,
): Promise<SecurityEvent[]> {
  return withTenantDb(dbHandle, { personId }, (db) =>
    db
      .select({ action: auditLog.action, at: auditLog.at, meta: auditLog.meta })
      .from(auditLog)
      // The upload quota ledger is a counter, not security activity.
      .where(
        and(eq(auditLog.scopeId, personId), notInArray(auditLog.action, [...LEDGER_ONLY_ACTIONS])),
      )
      .orderBy(desc(auditLog.at))
      .limit(limit)
      .offset(offset),
  );
}

/**
 * THE INBOX: the same ledger, minus the routine sign-in rows (inbox-filter.ts
 * `ACCOUNT_ONLY_ACTIONS` — they are the person's own doing, and they pushed
 * "You were sold" off the list) and the notifications this person switched off
 * for the app (gate.ts `hiddenInboxActions`).
 *
 * Filtered HERE, at read, and nowhere near the write. The row is the audit
 * trail of what happened to somebody; a preference hides it from their inbox
 * and brings it back when switched on, and never erases it — /account's
 * security panel, which reads `listSecurityEvents`, still shows the ledger
 * whole. The preference is read inside the same person boundary as the rows.
 */
export async function listInboxEvents(
  personId: string,
  limit = 10,
  /** Older than this — the next page of "Show older" (PR16). */
  before?: Date,
): Promise<SecurityEvent[]> {
  return withTenantDb(dbHandle, { personId }, async (db) => {
    const hidden = await hiddenInboxActions(db, personId);
    return db
      .select({ action: auditLog.action, at: auditLog.at, meta: auditLog.meta })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.scopeId, personId),
          notInArray(auditLog.action, inboxExclusions(hidden)),
          ...(before === undefined ? [] : [lt(auditLog.at, before)]),
        ),
      )
      .orderBy(desc(auditLog.at))
      .limit(limit);
  });
}

export interface InboxState {
  /** The newest notice this person has seen, on any device (0096). */
  readonly seenAt: Date | null;
  /** Notices after it, up to UNREAD_CAP + 1 (so the badge can say "9+"). */
  readonly unread: number;
}

/**
 * READ STATE, ON THE SERVER (email programme PR16). The bell's count and the
 * inbox's "new" dots read one watermark on the person, so a notice read on
 * the phone is read on the laptop. Filtered exactly as the inbox is, or the
 * bell would count a notice the inbox refuses to show.
 */
export const inboxState = cache(async function inboxState(personId: string): Promise<InboxState> {
  return withTenantDb(dbHandle, { personId }, async (db) => {
    const [person] = await db
      .select({ seenAt: people.inboxSeenAt })
      .from(people)
      .where(eq(people.id, personId))
      .limit(1);
    const seenAt = person?.seenAt ?? null;
    const hidden = await hiddenInboxActions(db, personId);
    const fresh = await db
      .select({ at: auditLog.at })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.scopeId, personId),
          notInArray(auditLog.action, inboxExclusions(hidden)),
          ...(seenAt === null ? [] : [gt(auditLog.at, seenAt)]),
        ),
      )
      .orderBy(desc(auditLog.at))
      .limit(UNREAD_CAP + 1);
    return { seenAt, unread: fresh.length };
  });
});

/**
 * Seen up to `upTo` — only ever forward, and never past now: a browser cannot
 * mark tomorrow's notices read by sending a date from the future.
 */
export async function markInboxSeen(
  personId: string,
  upTo: Date,
  now: Date = new Date(),
): Promise<void> {
  const at = upTo.getTime() > now.getTime() ? now : upTo;
  await withTenantDb(dbHandle, { personId }, (db) =>
    db
      .update(people)
      .set({
        inboxSeenAt: sql`greatest(coalesce(${people.inboxSeenAt}, ${at.toISOString()}::timestamptz), ${at.toISOString()}::timestamptz)`,
      })
      .where(eq(people.id, personId)),
  );
}

/** How many person-scoped events exist — so a truncated list can admit it. */
export async function countSecurityEvents(personId: string): Promise<number> {
  const rows = await withTenantDb(dbHandle, { personId }, (db) =>
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(auditLog)
      .where(
        and(eq(auditLog.scopeId, personId), notInArray(auditLog.action, [...LEDGER_ONLY_ACTIONS])),
      ),
  );
  return rows[0]?.total ?? 0;
}

/**
 * PX-3 bell indicator: the newest person-scoped event's timestamp (one row).
 * Filtered exactly as the inbox is, or the bell would light for a notice the
 * inbox then refuses to show.
 *
 * `cache`d per render: the root layout asks on every signed-in page, and Next
 * evaluates the root layout twice per request (once more for its not-found
 * fallback) — this transaction ran twice on every page.
 */
export const latestSecurityEventAt = cache(async function latestSecurityEventAt(
  personId: string,
): Promise<Date | null> {
  const rows = await withTenantDb(dbHandle, { personId }, async (db) => {
    const hidden = await hiddenInboxActions(db, personId);
    return db
      .select({ at: auditLog.at })
      .from(auditLog)
      .where(
        and(eq(auditLog.scopeId, personId), notInArray(auditLog.action, inboxExclusions(hidden))),
      )
      .orderBy(desc(auditLog.at))
      .limit(1);
  });
  return rows[0]?.at ?? null;
});
