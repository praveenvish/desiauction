import { createDb, type DbHandle } from "@desiauction/db";

import { env } from "../env";

// Next dev/HMR re-evaluates modules; keep one pool per process (IP-2 D1).
const globalStore = globalThis as { __daDb?: DbHandle; __daSystemDb?: DbHandle };

export const dbHandle: DbHandle = globalStore.__daDb ?? createDb(env.DATABASE_URL);
globalStore.__daDb = dbHandle;

export const db = dbHandle.db;

// The system pool (PRP-1 §1): RLS-exempt role for the named pre-tenant token
// paths only. With SYSTEM_DATABASE_URL unset it aliases the main pool, so
// local dev and tests keep a single connection budget.
export const systemHandle: DbHandle =
  globalStore.__daSystemDb ??
  (env.SYSTEM_DATABASE_URL === undefined ? dbHandle : createDb(env.SYSTEM_DATABASE_URL));
globalStore.__daSystemDb = systemHandle;

export const systemDb = systemHandle.db;
