import { auditLog, newId, withTenantDb } from "@desiauction/db";
import { desc, eq } from "drizzle-orm";

import { dbHandle } from "../db";

// Security events ride the append-only audit substrate (IP-2_DESIGN D8) with
// person scope — one ledger, one query surface, no parallel event store.
// PRP-1 §1: audit_log is RLS-guarded (WITH CHECK actor = app.person_id), so
// both the write and the read open their own person boundary here — the
// personId parameter IS the tenant context for person-scoped evidence.

export type SecurityAction =
  | "auth.login.otp"
  | "auth.login.passkey"
  | "auth.otp.lockout"
  | "auth.passkey.enrolled"
  | "auth.passkey.renamed"
  | "auth.passkey.removed"
  | "auth.session.revoked"
  // PX-3: profile changes are person-scoped evidence on the same ledger.
  | "profile.name.updated";

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
}

export interface SecurityEvent {
  action: string;
  at: Date;
  meta: unknown;
}

export async function listSecurityEvents(personId: string): Promise<SecurityEvent[]> {
  return withTenantDb(dbHandle, { personId }, (db) =>
    db
      .select({ action: auditLog.action, at: auditLog.at, meta: auditLog.meta })
      .from(auditLog)
      .where(eq(auditLog.scopeId, personId))
      .orderBy(desc(auditLog.at))
      .limit(10),
  );
}

/** PX-3 bell indicator: the newest person-scoped event's timestamp (one row). */
export async function latestSecurityEventAt(personId: string): Promise<Date | null> {
  const rows = await withTenantDb(dbHandle, { personId }, (db) =>
    db
      .select({ at: auditLog.at })
      .from(auditLog)
      .where(eq(auditLog.scopeId, personId))
      .orderBy(desc(auditLog.at))
      .limit(1),
  );
  return rows[0]?.at ?? null;
}
