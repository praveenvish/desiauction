import { createDb, type DbHandle } from "@desiauction/db";

import { env } from "../env";

// Next dev/HMR re-evaluates modules; keep one pool per process (IP-2 D1).
const globalStore = globalThis as { __daDb?: DbHandle };

export const dbHandle: DbHandle = globalStore.__daDb ?? createDb(env.DATABASE_URL);
globalStore.__daDb = dbHandle;

export const db = dbHandle.db;
