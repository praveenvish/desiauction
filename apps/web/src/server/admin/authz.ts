import { withTenantDb } from "@desiauction/db";

import { currentSession } from "../auth/actions";
import { dbHandle } from "../db";
import { grantsFor } from "../orgs/authz";
import { recordAdminAccess, type AdminSurface } from "./access-log";
import {
  hasPlatformCapability,
  PLATFORM_CAPABILITY_SETS,
  platformCapabilitiesOf,
  type PlatformCapability,
} from "./capabilities";
import { grantsOfPerson } from "../request-cache";

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
  /** Nullable since 0062 — an operator may be anchored by an email. */
  readonly phone: string | null;
  readonly email: string | null;
}

/**
 * Every door here is the same evaluation with a different key: resolve the
 * session, read the person's OWN grants under RLS, and answer with an identity
 * or with null. One implementation, so the six doors cannot drift apart.
 */
async function gateOn(capability: PlatformCapability): Promise<AdminIdentity | null> {
  const session = await currentSession();
  if (session === null) {
    return null;
  }
  const allowed = hasPlatformCapability(await grantsOfPerson(session.personId), capability);
  if (!allowed) {
    return null;
  }
  return {
    personId: session.personId,
    name: session.name,
    phone: session.phone,
    email: session.email,
  };
}

export async function platformAdminGate(): Promise<AdminIdentity | null> {
  return gateOn("platform.admin");
}

/**
 * THE SECOND DOOR — answering a pass request.
 *
 * Separate from `platformAdminGate` because `platform:billing` is a separate
 * grant: seeing the whole platform does not license changing what a customer is
 * entitled to, and an operator who does both holds both, on purpose. Returns
 * null the same way, for the same reason — a locked door that announces itself
 * is a map.
 */
export async function platformBillingGate(): Promise<AdminIdentity | null> {
  return gateOn("platform.pass");
}

/**
 * THE THIRD DOOR — the demo desk (DEMO-1).
 *
 * Separate from both gates above, and the reason is what is behind it: the
 * names and mobile numbers of people who are not customers, have no account
 * here, and typed them into a public form on the promise that we would ring
 * once. Reading the platform does not license that, and neither does answering
 * a pass request. Returns null the same way, for the same reason — a locked
 * door that announces itself is a map.
 */
export async function platformDemoGate(): Promise<AdminIdentity | null> {
  return gateOn("platform.demo");
}

/**
 * THE FOURTH DOOR — the privacy desk, which can erase a person.
 *
 * Its own grant for the reason every door here has its own: seeing the whole
 * platform, answering a pass and answering a demo request are all different
 * from ending somebody's account in every club at once, and none of them should
 * carry that power by accident. Returns null the same way as the others.
 */
export async function platformPrivacyGate(): Promise<AdminIdentity | null> {
  return gateOn("platform.privacy");
}

/**
 * THE FIFTH DOOR — the support desk (FR-1): problem reports and reviews.
 *
 * Separate from every gate above: behind it are people's own words about what
 * went wrong, their reply addresses, and screenshots of their screens. Returns
 * null the same way, for the same reason.
 */
export async function platformSupportGate(): Promise<AdminIdentity | null> {
  return gateOn("platform.support");
}

/**
 * THE SIXTH DOOR — the moderation desk, which can take a public page down.
 *
 * Overriding an organizer's decision to publish their own season is its own act
 * of trust, so it is its own grant. Returns null the same way as the others.
 */
export async function platformModerationGate(): Promise<AdminIdentity | null> {
  return gateOn("platform.moderate");
}

/**
 * Which desks the signed-in person holds — for the Overview's "waiting on your
 * desks" card, so it lists only work this operator can actually pick up. Read
 * under RLS exactly like the gates; an empty set for anyone else.
 */
export async function heldPlatformCapabilities(): Promise<ReadonlySet<PlatformCapability>> {
  const session = await currentSession();
  if (session === null) {
    return new Set();
  }
  return withTenantDb(dbHandle, { personId: session.personId }, async (db) => {
    const grants = await grantsFor(db, session.personId);
    const held = new Set<PlatformCapability>();
    for (const set of PLATFORM_CAPABILITY_SETS) {
      for (const capability of platformCapabilitiesOf(set)) {
        if (hasPlatformCapability(grants, capability)) {
          held.add(capability);
        }
      }
    }
    return held;
  });
}

/** Nav-only: whether to reveal the Platform admin door. Same evaluation, no leak. */
export async function isPlatformAdmin(): Promise<boolean> {
  return (await platformAdminGate()) !== null;
}

/**
 * The gate, for a PAGE — the same evaluation, plus the access record.
 *
 * Pages use this; the per-call gates inside `actions.ts` deliberately do not,
 * so one page view is one row rather than one row per projection. See
 * `access-log.ts` for why administration writes at all, and why this is the
 * only thing it writes.
 */
export async function platformAdminPageGate(
  surface: AdminSurface,
  subject: string | null = null,
): Promise<AdminIdentity | null> {
  const admin = await platformAdminGate();
  if (admin !== null) {
    await recordAdminAccess(admin, surface, subject);
  }
  return admin;
}
