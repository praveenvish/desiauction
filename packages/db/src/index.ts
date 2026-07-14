import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { ulid } from "ulidx";

import * as schema from "./schema";

export * from "./schema";

export type Db = PostgresJsDatabase<typeof schema>;

export interface DbHandle {
  db: Db;
  sql: postgres.Sql;
}

/** One factory for every consumer; apps pass their validated env URL (§11). */
export function createDb(url: string): DbHandle {
  const sql = postgres(url, { max: 10 });
  return { db: drizzle(sql, { schema }), sql };
}

/** App-generated ULIDs keep id discipline beside the schema (C-13). */
export function newId(): string {
  return ulid();
}

export interface TenantContext {
  personId: string;
  orgId?: string;
}

/**
 * RLS context (IP-2_DESIGN D5): runs `fn` in a transaction with
 * app.person_id / app.org_id set LOCAL, so policies see the caller.
 *
 * NOT YET WIRED into the serving path (as of IP-4): no runtime code calls this,
 * and the app connects as an RLS-exempt role — so at runtime tenant isolation is
 * enforced by application-layer query scoping, and the RLS policies are latent
 * defense-in-depth that engage only once queries route through here AND the app
 * runs under a non-BYPASSRLS role. Named pre-deploy item (IP-3 closure report §6,
 * identity/THREAT_MODEL residual risks); the RLS policy proofs exercise it under
 * a dedicated non-superuser role in tests.
 */
export async function withTenant<T>(
  handle: DbHandle,
  context: TenantContext,
  fn: (tx: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  return handle.sql.begin(async (tx) => {
    await tx`select set_config('app.person_id', ${context.personId}, true)`;
    if (context.orgId !== undefined) {
      await tx`select set_config('app.org_id', ${context.orgId}, true)`;
    }
    return fn(tx);
  }) as Promise<T>;
}
