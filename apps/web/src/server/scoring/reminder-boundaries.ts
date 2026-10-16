import { withTenantDb, type DbHandle } from "@desiauction/db";
import { asPerson, inOrg } from "../tenant";

export interface ReminderBoundaries {
  asPerson: typeof asPerson;
  inOrg: typeof inOrg;
}
export const reminderBoundaries: ReminderBoundaries = { asPerson, inOrg };
/** Explicit injection for an isolated validation pool; production uses tenant.ts. */
export function reminderBoundariesFor(handle: DbHandle): ReminderBoundaries {
  return {
    asPerson: (personId, run) => withTenantDb(handle, { personId }, run),
    inOrg: (personId, orgId, run) => withTenantDb(handle, { personId, orgId }, run),
  };
}
