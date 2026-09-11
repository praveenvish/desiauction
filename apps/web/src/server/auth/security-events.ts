import { auditLog, newId, withTenantDb } from "@desiauction/db";
import { desc, eq, sql } from "drizzle-orm";

import { dbHandle } from "../db";

// Security events ride the append-only audit substrate (IP-2_DESIGN D8) with
// person scope — one ledger, one query surface, no parallel event store.
// PRP-1 §1: audit_log is RLS-guarded (WITH CHECK actor = app.person_id), so
// both the write and the read open their own person boundary here — the
// personId parameter IS the tenant context for person-scoped evidence.

export type SecurityAction =
  | "auth.login.otp"
  /** Signed in with a code sent to a verified mailbox (email sign-in). */
  | "auth.login.email"
  /**
   * The account was CREATED by that code (Phase 2 email sign-up). Its own row
   * rather than a login: this is the first line of the person's ledger, and it
   * is the one that answers "where did this account come from?" — which a run
   * of identical `auth.login.email` rows never could.
   */
  | "auth.signup.email"
  | "auth.login.passkey"
  | "auth.otp.lockout"
  // PI-1 audit-gap closures. Requests, sign-outs and refused passkey
  // ceremonies were invisible: the ledger showed only what SUCCEEDED, so the
  // page a person checks after "did someone try to get in?" had no idea.
  // Each is written only when a person exists to own the row — the audit
  // substrate is person-scoped, and an unknown phone has no ledger.
  | "auth.otp.requested"
  | "auth.logout"
  | "auth.passkey.failed"
  | "auth.passkey.enrolled"
  | "auth.passkey.renamed"
  | "auth.passkey.removed"
  | "auth.session.revoked"
  // PX-3: profile changes are person-scoped evidence on the same ledger.
  | "profile.name.updated"
  // The FIRST name is not an update. Every new account's very first inbox row
  // read "Name updated" about a name that had never existed — the product's
  // opening sentence to a person, and it was wrong about the one thing that
  // had just happened. Same ledger, no new store; a different verb.
  | "profile.name.set"
  // The account's ONE credential moving. Written for the person, not for us:
  // sign-in is phone-first, so this row is the record of the single change that
  // can take an account away from somebody.
  | "auth.phone.changed"
  // An address the platform may now send documents to. On the person's own
  // ledger, because it is a change to how the product can reach them.
  | "profile.email.verified"
  // PI-1: the person-level cricket profile changed (gender/DOB/location/
  // defaults). Meta names the FIELDS touched, never the values — the ledger
  // records that an answer moved, not what a person answered.
  | "profile.player.updated"
  // DA-19: the decisions a PLAYER cares about. 48 people were approved and one
  // rejected during certification and not one of them was told — the inbox
  // carried sign-in events only, and its own empty state admitted it. These
  // ride the same person-scoped ledger; no notification store was invented.
  | "registration.approved"
  | "registration.rejected"
  | "registration.waitlisted"
  // The night itself. Being sold at auction is the moment this whole product
  // exists for, and the player was the one person never told it had happened —
  // the same hole DA-19 closed for registration decisions, reopened at the
  // climax. Written at COMPLETION, not at the hammer: an unsold lot is requeued
  // by default, so "unsold" mid-night is a verdict the auction has not reached.
  | "auction.sold"
  | "auction.unsold";

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
      .where(eq(auditLog.scopeId, personId))
      .orderBy(desc(auditLog.at))
      .limit(limit)
      .offset(offset),
  );
}

/** How many person-scoped events exist — so a truncated list can admit it. */
export async function countSecurityEvents(personId: string): Promise<number> {
  const rows = await withTenantDb(dbHandle, { personId }, (db) =>
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(auditLog)
      .where(eq(auditLog.scopeId, personId)),
  );
  return rows[0]?.total ?? 0;
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
