import { createDb, type Db, type DbHandle } from "@desiauction/db";

import { env } from "./env.js";

/** The shared data layer (schema-aware) — the aggregate package requires it. */
export const handle: DbHandle = createDb(env.DATABASE_URL);
export const db: Db = handle.db;
export const sql = handle.sql;

/** Fail-closed connectivity probe used by /healthz (§29). */
export async function checkDb(): Promise<boolean> {
  try {
    await sql`select 1`;
    return true;
  } catch {
    return false;
  }
}
