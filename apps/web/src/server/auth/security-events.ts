import { auditLog, newId, type Db } from "@desiauction/db";
import { desc, eq } from "drizzle-orm";

// Security events ride the append-only audit substrate (IP-2_DESIGN D8) with
// person scope — one ledger, one query surface, no parallel event store.

export type SecurityAction =
  | "auth.login.otp"
  | "auth.login.passkey"
  | "auth.otp.lockout"
  | "auth.passkey.enrolled"
  | "auth.passkey.renamed"
  | "auth.passkey.removed"
  | "auth.session.revoked";

export async function logSecurityEvent(
  db: Db,
  personId: string,
  action: SecurityAction,
  meta?: Record<string, string>,
): Promise<void> {
  await db.insert(auditLog).values({
    id: newId(),
    actor: personId,
    action,
    scopeType: "person",
    scopeId: personId,
    meta: meta ?? null,
  });
}

export interface SecurityEvent {
  action: string;
  at: Date;
  meta: unknown;
}

export async function listSecurityEvents(db: Db, personId: string): Promise<SecurityEvent[]> {
  return db
    .select({ action: auditLog.action, at: auditLog.at, meta: auditLog.meta })
    .from(auditLog)
    .where(eq(auditLog.scopeId, personId))
    .orderBy(desc(auditLog.at))
    .limit(10);
}
