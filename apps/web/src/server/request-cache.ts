import type { GrantLike } from "@desiauction/core";
import { withTenantDb } from "@desiauction/db";
import { cache } from "react";

import { dbHandle } from "./db";
import { grantsFor } from "./orgs/authz";
import { orgsFor, type OrgSummary } from "./orgs/orgs";

/**
 * READS EVERY CONSOLE RENDER MAKES, ONCE PER REQUEST.
 *
 * The root layout fans out to the Money, Finance and Platform-admin gates and
 * to the org list; the page then asks several of the same questions again.
 * Each asker opened its own tenant transaction (BEGIN, set_config, SELECT,
 * COMMIT) for the SAME rows: the grants table was read three times and the
 * org list twice before a page rendered anything of its own.
 *
 * Memoised with React `cache`, so the scope is the request: nothing here
 * outlives it, and a write made in a server action is seen by the next
 * request's render. Keyed by person, because that is what the rows depend on.
 *
 * Not a `"use server"` module on purpose — `cache()` returns a plain function,
 * and every export of an action module must be an async function.
 */
export const grantsOfPerson = cache((personId: string): Promise<GrantLike[]> =>
  withTenantDb(dbHandle, { personId }, (db) => grantsFor(db, personId)),
);

export const orgsOfPerson = cache((personId: string): Promise<OrgSummary[]> =>
  withTenantDb(dbHandle, { personId }, (db) => orgsFor(db, personId)),
);
