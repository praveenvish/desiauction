import { sql } from "drizzle-orm";
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

/**
 * Sockets one pool may hold, when the caller names no other number.
 *
 * Ten is right for a long-lived process and wrong for a fleet. On serverless it
 * is ten per WARM INSTANCE, and the web tier opens a second (system) pool
 * beside this one — twenty sockets per instance. Enough instances and a
 * perfectly healthy managed Postgres starts refusing connections at
 * `max_connections`, at which point every request 500s and nothing in the
 * database's own metrics looks wrong. The number therefore has to be settable
 * wherever the fleet is sized, not pinned in this file.
 */
const DEFAULT_POOL_MAX = 10;

/**
 * The database-side safety nets (PRR P2 / F49). No pool set either, so a single
 * runaway query or a transaction left open by a crashed handler could pin a
 * connection until `max_connections` was exhausted, undiagnosably. These are
 * ceilings, not budgets — an order of magnitude above the slowest legitimate
 * query (the settlement journal fold is a few seconds) — so nothing normal ever
 * hits them, and a genuinely stuck statement or transaction is released.
 */
const DEFAULT_STATEMENT_TIMEOUT_MS = 30_000;
const DEFAULT_IDLE_TXN_TIMEOUT_MS = 60_000;

export interface DbPoolOptions {
  /**
   * Sockets this pool may hold. Omitted means DEFAULT_POOL_MAX, so an existing
   * caller that passes nothing keeps exactly the pool it had. Apps read the
   * operator's number through their own env.ts (§11) — this package never
   * touches the environment itself.
   */
  max?: number | undefined;
  /** Per-statement ceiling in ms (0 disables). Default 30s — a safety net. */
  statementTimeoutMs?: number | undefined;
  /** Ceiling on an idle-in-transaction session in ms (0 disables). Default 60s. */
  idleTransactionTimeoutMs?: number | undefined;
}

/** One factory for every consumer; apps pass their validated env URL (§11). */
export function createDb(url: string, options: DbPoolOptions = {}): DbHandle {
  const sql = postgres(url, {
    max: options.max ?? DEFAULT_POOL_MAX,
    // Recycle connections so the pool can never hand out a dead socket. Without
    // these, a connection is held forever and a machine sleep, database
    // restart, or an idle cutoff upstream (managed Postgres, PgBouncer, a load
    // balancer) leaves the pool serving corpses — the next query fails with an
    // opaque "Failed query" even though the database is healthy.
    idle_timeout: 60, // close idle connections after 1 minute
    max_lifetime: 60 * 30, // retire any connection after 30 minutes
    connect_timeout: 10, // fail fast instead of hanging a request
    // Set once at connection startup and applied to every statement/transaction
    // on it (PRR F49). Values in milliseconds; Postgres reads a bare integer as
    // ms for these GUCs.
    connection: {
      statement_timeout: options.statementTimeoutMs ?? DEFAULT_STATEMENT_TIMEOUT_MS,
      idle_in_transaction_session_timeout:
        options.idleTransactionTimeoutMs ?? DEFAULT_IDLE_TXN_TIMEOUT_MS,
    },
  });
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

/**
 * The serving-path form of withTenant (PRP-1 §1): the same transaction-scoped
 * GUC boundary (set_config with is_local = true), expressed through drizzle's
 * own transaction so domain functions that take `Db` run under tenant context
 * unchanged. Under a non-BYPASSRLS runtime role the RLS policies are
 * load-bearing inside this boundary and fail closed outside it. Only set an
 * orgId the caller has already verified membership for (resolveTenant).
 */
/**
 * Run a write that may hit a unique constraint, and report the refusal without
 * poisoning the caller's transaction.
 *
 * Postgres aborts the ENTIRE transaction on a failed statement, so a bare
 * `try { await db.insert(...) } catch` looks correct and is not: the handler
 * returns a clean refusal, and then the COMMIT throws a raw PostgresError past
 * every handler. Every serving path here runs inside `withTenantDb`, so that
 * mistake reached users as a full-page error boundary on something as ordinary
 * as a duplicate team name (DA-03). A nested drizzle transaction is a
 * SAVEPOINT: rolling back to it leaves the enclosing transaction healthy.
 *
 * Returns true when the write landed, false when a constraint refused it.
 */
export async function writeSurvivingConstraint(
  db: Db,
  write: (tx: Db) => Promise<unknown>,
): Promise<boolean> {
  try {
    await db.transaction(async (tx) => {
      await write(tx);
    });
    return true;
  } catch {
    return false;
  }
}

export async function withTenantDb<T>(
  handle: DbHandle,
  context: TenantContext,
  fn: (db: Db) => Promise<T>,
): Promise<T> {
  return handle.db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.person_id', ${context.personId}, true)`);
    if (context.orgId !== undefined) {
      await tx.execute(sql`select set_config('app.org_id', ${context.orgId}, true)`);
    }
    // PgTransaction carries the full query-builder surface of Db; nested
    // db.transaction() calls become savepoints.
    return fn(tx);
  });
}
