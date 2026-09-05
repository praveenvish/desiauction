import { sports } from "@desiauction/db";
import { asc, eq } from "drizzle-orm";

import { db } from "../db";

/**
 * WHICH SPORTS AN ORGANIZER MAY PICK (SP-1 Phase 1).
 *
 * The `sports` table holds a flag per shipped pack — see migration 0046 for why
 * a sport's DEFINITION is code and only its availability is data.
 *
 * NO TENANT, BY DESIGN. This is global reference data: the same rows for every
 * organization, carrying no `org_id` and no RLS policy, because a tenancy rule
 * here would be a rule with nothing to say. That is why it reads the app pool
 * directly rather than through `withTenantDb`, and why it is listed in
 * `ops/posture-allowlist.json` with that reason rather than left to look like
 * an oversight.
 */
export interface SportOption {
  readonly key: string;
  readonly label: string;
}

/**
 * The enabled sports, in picker order.
 *
 * Ordered by `sort_order` and not alphabetically: the top of a select is where
 * the likeliest answer belongs. Today it returns exactly one row, and a picker
 * over one option is still worth rendering — it is the difference between a
 * platform that runs cricket and a platform that currently has cricket
 * switched on.
 */
export async function enabledSports(): Promise<SportOption[]> {
  const rows = await db
    .select({ key: sports.key, label: sports.label })
    .from(sports)
    .where(eq(sports.enabled, true))
    .orderBy(asc(sports.sortOrder), asc(sports.key));
  return rows;
}

/** Every sport in the catalogue, enabled or not — the administration view. */
export async function sportCatalogue(): Promise<
  { key: string; label: string; enabled: boolean; sortOrder: number }[]
> {
  return db
    .select({
      key: sports.key,
      label: sports.label,
      enabled: sports.enabled,
      sortOrder: sports.sortOrder,
    })
    .from(sports)
    .orderBy(asc(sports.sortOrder), asc(sports.key));
}

/**
 * Is this key one an organizer is allowed to choose right now?
 *
 * Asked on the WRITE path, because a select is a suggestion and a form post is
 * whatever the poster sent. The foreign key stops a competition naming a sport
 * with no pack; this stops one naming a pack that is shipped but switched off.
 */
export async function isSportEnabled(key: string): Promise<boolean> {
  const [row] = await db
    .select({ enabled: sports.enabled })
    .from(sports)
    .where(eq(sports.key, key))
    .limit(1);
  return row?.enabled === true;
}
