import { withTenantDb } from "@desiauction/db";

import { currentSession } from "../auth/actions";
import { dbHandle } from "../db";
import { grantsFor } from "../orgs/authz";
import { hasPlatformCapability } from "./capabilities";

/**
 * The one door into Platform Administration (PX-1 02 G1).
 *
 * Every admin read passes through `platformAdminGate`. It is deliberately the
 * ONLY export that yields an admin identity, so there is exactly one place to
 * audit and exactly one place to break.
 *
 * The gate runs under RLS, not around it. `grants_tenant`'s USING clause admits
 * a person's OWN grant rows (`person_id = current_setting('app.person_id')`),
 * so the person's platform grant is legible inside a person-scoped tenant
 * boundary — no system pool needed to answer "may this person in?". The system
 * pool is reserved for the cross-tenant PROJECTIONS, which no tenant context
 * could serve, and it is never used to decide access.
 *
 * Returns null rather than throwing: callers render notFound(), so a person
 * without the grant is told the console does not exist rather than that it
 * exists and is locked. Administration does not advertise itself.
 */
export interface AdminIdentity {
  readonly personId: string;
  readonly name: string | null;
  readonly phone: string;
}

export async function platformAdminGate(): Promise<AdminIdentity | null> {
  const session = await currentSession();
  if (session === null) {
    return null;
  }
  const admin = await withTenantDb(dbHandle, { personId: session.personId }, async (db) =>
    hasPlatformCapability(await grantsFor(db, session.personId), "platform.admin"),
  );
  if (!admin) {
    return null;
  }
  return { personId: session.personId, name: session.name, phone: session.phone };
}

/** Nav-only: whether to reveal the Platform admin door. Same evaluation, no leak. */
export async function isPlatformAdmin(): Promise<boolean> {
  return (await platformAdminGate()) !== null;
}
