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
