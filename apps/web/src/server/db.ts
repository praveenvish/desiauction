import { createDb, type DbHandle } from "@desiauction/db";

import { env } from "../env";

// Next dev/HMR re-evaluates modules; keep one pool per process (IP-2 D1).
const globalStore = globalThis as { __daDb?: DbHandle; __daSystemDb?: DbHandle };

// Both pools are sized by the same operator number, because both count against
// the same `max_connections`: sizing one and forgetting the other is how the
// budget gets doubled by accident.
const poolOptions = { max: env.DB_POOL_MAX };

export const dbHandle: DbHandle = globalStore.__daDb ?? createDb(env.DATABASE_URL, poolOptions);
globalStore.__daDb = dbHandle;

export const db = dbHandle.db;

// The system pool (PRP-1 §1): RLS-exempt role for the named pre-tenant token
// paths only. With SYSTEM_DATABASE_URL unset it aliases the main pool, so
// local dev and tests keep a single connection budget.
export const systemHandle: DbHandle =
  globalStore.__daSystemDb ??
  (env.SYSTEM_DATABASE_URL === undefined
    ? dbHandle
    : createDb(env.SYSTEM_DATABASE_URL, poolOptions));
globalStore.__daSystemDb = systemHandle;

export const systemDb = systemHandle.db;

/**
 * Runtime proof that RLS tenant isolation is actually load-bearing (PRR P1-1).
 *
 * The four-role recipe was a deployment-config FACT with no runtime assertion:
 * `env.ts` only checks the URL starts with "postgres", and every local process
 * connects as the database owner. So a production `DATABASE_URL` pointed at the
 * owner (or any BYPASSRLS/superuser role) would start, report healthy, and serve
 * traffic with RLS silently inert — turning every app-layer scoping omission
 * into a cross-tenant leak. This asserts, at boot, that the app pool's role is
 * neither SUPERUSER nor BYPASSRLS.
 *
 * Fail-closed but not crash-loopy: a definitive misconfiguration (connected, but
 * the role is privileged) refuses to serve; a transient connection error at boot
 * only warns — `/readyz` already pulls an instance that cannot reach the DB out
 * of rotation, so a blip must not turn into a restart storm.
 */
export async function assertTenantIsolation(): Promise<void> {
  // Only meaningful when actually serving production traffic. The rehearsal
  // escape (ALLOW_INSECURE_LOCAL_PRODUCTION) runs as the owner by design.
  if (
    env.NODE_ENV !== "production" ||
    env.NEXT_PHASE === "phase-production-build" ||
    env.ALLOW_INSECURE_LOCAL_PRODUCTION
  ) {
    // Not serving traffic: local/dev/test, the rehearsal escape, or `next build`
    // (which runs with NODE_ENV=production but no deployment DB) — mirror env.ts
    // serving() so the assertion never runs during a build.
    return;
  }
  let role: { role: string; rolsuper: boolean; rolbypassrls: boolean } | undefined;
  try {
    const rows = await dbHandle.sql<
      { role: string; rolsuper: boolean; rolbypassrls: boolean }[]
    >`select current_user as role, rolsuper, rolbypassrls
        from pg_roles where rolname = current_user`;
    role = rows[0];
  } catch (error) {
    process.stderr.write(
      `!! could not verify database RLS posture at boot (${String(
        error,
      )}); /readyz will gate routing until the DB is reachable\n`,
    );
    return;
  }
  if (role === undefined) {
    throw new Error(
      "web refused to start — could not resolve the connected database role to verify RLS isolation",
    );
  }
  if (role.rolsuper || role.rolbypassrls) {
    throw new Error(
      `web refused to start — the app database role '${role.role}' is ` +
        `${role.rolsuper ? "a SUPERUSER" : "BYPASSRLS"}, so RLS tenant isolation is INERT. ` +
        "Point DATABASE_URL at the non-BYPASSRLS app role (see ops/db/create-app-role.sql).",
    );
  }
}
