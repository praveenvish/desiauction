import { withTenantDb, type Db } from "@desiauction/db";

import { dbHandle } from "./db";

/**
 * THE THREE SHAPES A TENANT READ CAN TAKE, NAMED.
 *
 * Every read of org data belongs inside `withTenantDb`, where `app.org_id` makes
 * the row-level policies load-bearing. Eight modules had drifted onto the
 * RLS-exempt system pool instead, for one of two honest reasons: they did not
 * yet know the org (a slug in a URL), or they wanted several orgs at once (a
 * person's home screen spans every club they belong to). The first is now the
 * sole business of `competition/resolve.ts`. The second is what `acrossOrgs`
 * below is for — so neither reason is a reason to bypass RLS any more.
 */

/** A person-only boundary: their own rows, and the tables with a person arm. */
export function asPerson<T>(personId: string, fn: (db: Db) => Promise<T>): Promise<T> {
  return withTenantDb(dbHandle, { personId }, fn);
}

/** One org's boundary. Every org-scoped policy admits that org and no other. */
export function inOrg<T>(personId: string, orgId: string, fn: (db: Db) => Promise<T>): Promise<T> {
  return withTenantDb(dbHandle, { personId, orgId }, fn);
}

/**
 * How many org boundaries may be open at once. Each is a transaction holding a
 * pooled connection for its duration, and the pool is sized by one operator
 * number (`DB_POOL_MAX`, default 10) shared by every request on the instance.
 */
const ORG_CONCURRENCY = 3;

/**
 * Run `fn` once inside EACH org's own boundary and return the results in the
 * order the orgs were given (duplicates removed).
 *
 * This is the replacement for "one query over a list of ids from several
 * tenants on the bypass pool". A query that filters by a list of ids may keep
 * that list whole: inside org A's boundary, rows belonging to org B are simply
 * not visible, so the list cannot widen what is returned — which is the point.
 * Callers merge the per-org results; because every row belongs to exactly one
 * org, concatenation never double-counts.
 */
export async function acrossOrgs<T>(
  personId: string,
  orgIds: readonly string[],
  fn: (db: Db, orgId: string) => Promise<T>,
): Promise<T[]> {
  const unique = [...new Set(orgIds)];
  const results = new Array<T>(unique.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < unique.length) {
      const index = next;
      next += 1;
      const orgId = unique[index] as string;
      results[index] = await inOrg(personId, orgId, (db) => fn(db, orgId));
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(ORG_CONCURRENCY, unique.length) }, () => worker()),
  );
  return results;
}
