import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { env } from "./env.js";

export const sql = postgres(env.DATABASE_URL, { max: 10 });
export const db = drizzle(sql);

/** Fail-closed connectivity probe used by /healthz (§29). */
export async function checkDb(): Promise<boolean> {
  try {
    await sql`select 1`;
    return true;
  } catch {
    return false;
  }
}
