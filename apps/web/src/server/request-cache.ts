import { hasCapability, type Capability, type GrantLike, type Scope } from "@desiauction/core";
import { withTenantDb } from "@desiauction/db";
import { cache } from "react";

import { competitionAllows, type CompetitionScope } from "./competition/authz";
import { dbHandle } from "./db";
import { grantsFor } from "./orgs/authz";
import { orgsFor, resolveTenant, type OrgSummary } from "./orgs/orgs";
import { sharedPerRender } from "./render-memo";

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

const tenantOfPersonShared = sharedPerRender<OrgSummary | null>();

/**
 * Club slug → club, membership required, resolved under person context — the
 * one question every club-scoped view asks first. It used to be asked as
 * `withTenantDb(…, (db) => resolveTenant(…))` at each view, so once the answer
 * itself was shared the wrappers were still opening a transaction apiece to
 * receive it: six empty BEGIN/set_config/COMMIT trips on /org/[slug]. Shared
 * here at the wrapper, per page render only (render-memo.ts).
 */
export function tenantOfPerson(personId: string, slug: string): Promise<OrgSummary | null> {
  return tenantOfPersonShared([personId, slug], () =>
    withTenantDb(dbHandle, { personId }, (db) => resolveTenant(db, personId, slug)),
  );
}

/**
 * A permission question asked on its own — "may this person do X here?" with
 * nothing else to read. It used to be asked as `withTenantDb(…, (db) =>
 * canCompetition(db, …))`, a transaction opened for one grants read; once that
 * read was shared per render, those transactions carried nothing at all. The
 * answer is the same rule over the same rows (`grantsFor` filters on the person
 * whatever the tenant context), read fresh outside a render as before.
 */
export async function personCanCompetition(
  personId: string,
  scope: CompetitionScope,
  capability: Capability,
): Promise<boolean> {
  return competitionAllows(await grantsOfPerson(personId), scope, capability);
}

/** The org/platform form of `personCanCompetition` — `can` without a transaction. */
export async function personCan(
  personId: string,
  scope: Scope,
  capability: Capability,
): Promise<boolean> {
  return hasCapability(await grantsOfPerson(personId), scope, capability);
}
