import { auditLog, newId } from "@desiauction/db";

import { systemDb } from "../db";
import { ADMIN_ACCESS_ACTION, PLATFORM_SCOPE_ID, PLATFORM_SCOPE_TYPE } from "./capabilities";

/**
 * THE ONE WRITE IN PLATFORM ADMINISTRATION.
 *
 * ---------------------------------------------------------------------------
 * The decision, and why it went this way.
 * ---------------------------------------------------------------------------
 * Administration was entirely unlogged: 70 admin page views added ZERO rows to
 * `audit_log`. In those views an operator read 349 organization names, 1,148
 * people's names and full mobile numbers, every grant on the platform, and 100
 * raw audit events including their `meta`. No trace existed anywhere. The audit
 * explorer is the platform's own accountability surface, and it was the only
 * surface on the platform that was not itself accountable.
 *
 * Against that stood a genuinely valuable property: administration is PROVABLY
 * read-only, and that proof is held by three locks — a structural one (`views.ts`
 * imports only tables and read-only snapshots), a merge-time one (the
 * `admin-is-read-only` dependency-cruiser rule), and a runtime one
 * (`admin-foundation.regression.test.ts`, which drives every projection through
 * a db handle that throws on any mutation). Access logging is a write, and the
 * cheap way to add it is to loosen all three until they no longer say anything.
 *
 * They are not loosened. The property that actually matters is "administration
 * cannot ACT on the platform" — it cannot issue a grant, move money, change a
 * lifecycle or touch a tenant's row. An append-only record of the OBSERVER is
 * not an action on the observed; it is the observation, written down. Those two
 * are separable, and they are separated here:
 *
 *   · This module is the ONLY module under `server/admin` or `app/admin` that
 *     holds a write verb. It writes exactly one shape of row: `admin.accessed`,
 *     on the platform singleton scope, actor = the admin, subject = the record
 *     they opened. It cannot write anything else — there is no parameter that
 *     would let it.
 *   · `views.ts` — every projection — is untouched, and the runtime read-only
 *     proof over it still runs through a handle that throws. That proof did not
 *     get weaker by one line.
 *   · The regression suite gained a SOURCE-LEVEL scan: it reads every file
 *     under administration and fails if a mutation verb appears in any of them
 *     except this one. Before, a write introduced through a module the
 *     read-only proof did not happen to drive would have passed; now it cannot.
 *     The test is strictly stronger than it was, not weaker.
 *   · The dependency-cruiser rule that forbids importing a domain writer stands
 *     unchanged, and a new rule forbids the projections from importing THIS
 *     module — so the read path can never acquire the write by accident.
 *
 * The narrowness is the whole argument. If a second write is ever wanted here,
 * the source scan fails, and the conversation happens at review.
 */

/**
 * The surfaces an admin can open, as a CLOSED set. A free-form string would
 * make this a general-purpose logger; naming the eight routes keeps it a record
 * of administration and nothing else.
 */
export type AdminSurface =
  | "overview"
  | "organizations"
  | "organization"
  | "users"
  | "user"
  | "audit"
  | "health"
  | "messaging"
  /** The pass queue — the one surface behind `platform:billing`, not admin. */
  | "passes";

/**
 * Record that an administrator opened a surface.
 *
 * Fails OPEN, loudly. A console that 500s because its own logging is down is
 * worse than an unlogged page view in the exact moment — an incident — when the
 * console matters most. The failure is written to the server log rather than
 * swallowed.
 */
export async function recordAdminAccess(
  // Structurally typed rather than imported from `authz.ts`, which imports THIS
  // module: the cycle would be types-only and erased, but the no-circular gate
  // is worth more than the one shared name.
  admin: { readonly personId: string },
  surface: AdminSurface,
  subject: string | null = null,
): Promise<void> {
  try {
    await systemDb.insert(auditLog).values({
      id: newId(),
      actor: admin.personId,
      action: ADMIN_ACCESS_ACTION,
      // The platform singleton, never the org being inspected: an administrator
      // READING an organization is not activity by that organization, and it
      // must not appear in the org's own timeline as though it were.
      scopeType: PLATFORM_SCOPE_TYPE,
      scopeId: PLATFORM_SCOPE_ID,
      subject,
      meta: { surface },
    });
  } catch (error) {
    // The failure of the audit trail is exactly the thing that must not be
    // silent, even though it must not break the page either.
    // eslint-disable-next-line no-console
    console.error("admin access log failed", { surface, subject, error });
  }
}
